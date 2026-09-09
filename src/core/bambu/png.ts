/**
 * Minimal PNG encoder for the plate thumbnail Bambu Connect displays.
 *
 * Only what the format needs for a single opaque RGBA image: one IHDR, one
 * zlib-compressed IDAT with no per-scanline filtering, one IEND. Compression
 * comes from `CompressionStream('deflate')`, whose zlib wrapper is exactly
 * what IDAT expects.
 */

import { crc32 } from './zip';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_RGBA = 6;
const BIT_DEPTH = 8;
const BYTES_PER_PIXEL = 4;

/** `rgba` must hold width * height * 4 bytes in row-major order. */
export async function encodePng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
    if (rgba.length !== width * height * BYTES_PER_PIXEL) {
        throw new Error('PNG pixel buffer does not match the requested dimensions.');
    }

    // Each scanline is prefixed with its filter byte; 0 means "no filter".
    const raw = new Uint8Array(height * (1 + width * BYTES_PER_PIXEL));
    for (let row = 0; row < height; row += 1) {
        const source = row * width * BYTES_PER_PIXEL;
        const target = row * (1 + width * BYTES_PER_PIXEL);
        raw[target] = 0;
        raw.set(rgba.subarray(source, source + width * BYTES_PER_PIXEL), target + 1);
    }

    const header = new Uint8Array(13);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, width, false);
    headerView.setUint32(4, height, false);
    header[8] = BIT_DEPTH;
    header[9] = COLOR_TYPE_RGBA;
    header[10] = 0; // deflate compression
    header[11] = 0; // adaptive filtering
    header[12] = 0; // no interlace

    const chunks = [
        PNG_SIGNATURE,
        buildChunk('IHDR', header),
        buildChunk('IDAT', await zlibDeflate(raw)),
        buildChunk('IEND', new Uint8Array(0)),
    ];

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const png = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        png.set(chunk, offset);
        offset += chunk.length;
    }

    return png;
}

/** length + type + payload + CRC over (type + payload), all big-endian. */
function buildChunk(type: string, payload: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const chunk = new Uint8Array(12 + payload.length);
    const view = new DataView(chunk.buffer);

    view.setUint32(0, payload.length, false);
    chunk.set(typeBytes, 4);
    chunk.set(payload, 8);

    const crcTarget = chunk.subarray(4, 8 + payload.length);
    view.setUint32(8 + payload.length, crc32(crcTarget), false);
    return chunk;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
