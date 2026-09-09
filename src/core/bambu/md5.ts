/**
 * MD5, needed only because Bambu's package format ships a `.md5` sidecar next
 * to the plate G-code and the printer checks it before accepting the file.
 * WebCrypto deliberately omits MD5, so it is implemented here.
 */

const SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(2^32 * abs(sin(i + 1))), precomputed at module load. */
const SINE_CONSTANTS = (() => {
    const constants = new Uint32Array(64);
    for (let index = 0; index < 64; index += 1) {
        constants[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0;
    }
    return constants;
})();

export function md5Hex(data: Uint8Array): string {
    const padded = padMessage(data);
    const words = new Uint32Array(padded.buffer, padded.byteOffset, padded.byteLength / 4);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let chunk = 0; chunk < words.length; chunk += 16) {
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;

        for (let i = 0; i < 64; i += 1) {
            let f: number;
            let g: number;

            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) % 16;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) % 16;
            }

            const rotated = (a + f + SINE_CONSTANTS[i] + words[chunk + g]) >>> 0;
            a = d;
            d = c;
            c = b;
            b = (b + rotateLeft(rotated, SHIFTS[i])) >>> 0;
        }

        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0].map(toLittleEndianHex).join('');
}

/** Appends the 0x80 terminator, zero padding, and the 64-bit bit length. */
function padMessage(data: Uint8Array): Uint8Array {
    const paddedLength = (((data.length + 8) >> 6) + 1) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(data);
    padded[data.length] = 0x80;

    const bitLength = data.length * 8;
    const view = new DataView(padded.buffer);
    // Lengths beyond 2^32 bits (512 MB) cannot occur for a sliced plate, so
    // the high word stays zero.
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    return padded;
}

function rotateLeft(value: number, count: number): number {
    return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function toLittleEndianHex(value: number): string {
    let hex = '';
    for (let byte = 0; byte < 4; byte += 1) {
        hex += ((value >>> (byte * 8)) & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
}
