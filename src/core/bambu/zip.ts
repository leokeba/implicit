/**
 * Minimal ZIP writer for building 3MF containers in the browser.
 *
 * 3MF is an OPC package: a plain ZIP with a fixed set of parts. Only the
 * subset the format needs is implemented — no zip64 (a vase-mode plate stays
 * far below 4 GB), no encryption, no data descriptors.
 */

export interface ZipEntry {
    /** Forward-slash path inside the archive; no leading slash. */
    path: string;
    data: Uint8Array;
    /**
     * Deflate the entry instead of storing it. G-code compresses roughly
     * 5:1, so it is worth the async round-trip; tiny XML parts are not.
     */
    compress?: boolean;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** ZIP spec version 2.0: the baseline that permits deflate. */
const VERSION_NEEDED = 20;

export async function buildZipArchive(entries: ZipEntry[]): Promise<Uint8Array> {
    const prepared = await Promise.all(entries.map(prepareEntry));

    let localSectionLength = 0;
    let centralSectionLength = 0;
    for (const entry of prepared) {
        localSectionLength += 30 + entry.nameBytes.length + entry.payload.length;
        centralSectionLength += 46 + entry.nameBytes.length;
    }

    const archive = new Uint8Array(localSectionLength + centralSectionLength + 22);
    const view = new DataView(archive.buffer);
    const { time, date } = encodeDosTimestamp(new Date());

    let offset = 0;
    const localOffsets: number[] = [];

    for (const entry of prepared) {
        localOffsets.push(offset);
        view.setUint32(offset, LOCAL_HEADER_SIGNATURE, true);
        view.setUint16(offset + 4, VERSION_NEEDED, true);
        view.setUint16(offset + 6, 0, true); // general purpose flags
        view.setUint16(offset + 8, entry.method, true);
        view.setUint16(offset + 10, time, true);
        view.setUint16(offset + 12, date, true);
        view.setUint32(offset + 14, entry.crc, true);
        view.setUint32(offset + 18, entry.payload.length, true);
        view.setUint32(offset + 22, entry.data.length, true);
        view.setUint16(offset + 26, entry.nameBytes.length, true);
        view.setUint16(offset + 28, 0, true); // extra field length
        offset += 30;
        archive.set(entry.nameBytes, offset);
        offset += entry.nameBytes.length;
        archive.set(entry.payload, offset);
        offset += entry.payload.length;
    }

    const centralDirectoryOffset = offset;

    for (const [index, entry] of prepared.entries()) {
        view.setUint32(offset, CENTRAL_HEADER_SIGNATURE, true);
        view.setUint16(offset + 4, VERSION_NEEDED, true); // version made by
        view.setUint16(offset + 6, VERSION_NEEDED, true);
        view.setUint16(offset + 8, 0, true); // general purpose flags
        view.setUint16(offset + 10, entry.method, true);
        view.setUint16(offset + 12, time, true);
        view.setUint16(offset + 14, date, true);
        view.setUint32(offset + 16, entry.crc, true);
        view.setUint32(offset + 20, entry.payload.length, true);
        view.setUint32(offset + 24, entry.data.length, true);
        view.setUint16(offset + 28, entry.nameBytes.length, true);
        view.setUint16(offset + 30, 0, true); // extra field length
        view.setUint16(offset + 32, 0, true); // comment length
        view.setUint16(offset + 34, 0, true); // disk number start
        view.setUint16(offset + 36, 0, true); // internal attributes
        view.setUint32(offset + 38, 0, true); // external attributes
        view.setUint32(offset + 42, localOffsets[index], true);
        offset += 46;
        archive.set(entry.nameBytes, offset);
        offset += entry.nameBytes.length;
    }

    view.setUint32(offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(offset + 4, 0, true); // this disk
    view.setUint16(offset + 6, 0, true); // disk with central directory
    view.setUint16(offset + 8, prepared.length, true);
    view.setUint16(offset + 10, prepared.length, true);
    view.setUint32(offset + 12, offset - centralDirectoryOffset, true);
    view.setUint32(offset + 16, centralDirectoryOffset, true);
    view.setUint16(offset + 20, 0, true); // comment length

    return archive;
}

interface PreparedEntry {
    nameBytes: Uint8Array;
    data: Uint8Array;
    payload: Uint8Array;
    method: number;
    crc: number;
}

async function prepareEntry(entry: ZipEntry): Promise<PreparedEntry> {
    const crc = crc32(entry.data);
    const nameBytes = new TextEncoder().encode(entry.path);

    if (!entry.compress) {
        return { nameBytes, data: entry.data, payload: entry.data, method: METHOD_STORE, crc };
    }

    const deflated = await deflateRaw(entry.data);
    // Deflate can inflate incompressible input; storing is then both smaller
    // and cheaper for the printer to read back.
    if (deflated.length >= entry.data.length) {
        return { nameBytes, data: entry.data, payload: entry.data, method: METHOD_STORE, crc };
    }

    return { nameBytes, data: entry.data, payload: deflated, method: METHOD_DEFLATE, crc };
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
    if (crcTable) {
        return crcTable;
    }

    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }

    crcTable = table;
    return table;
}

export function crc32(data: Uint8Array): number {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index += 1) {
        crc = table[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time, the only timestamp a base ZIP header carries. */
function encodeDosTimestamp(when: Date): { time: number; date: number } {
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (Math.floor(when.getSeconds() / 2));
    const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    return { time, date };
}
