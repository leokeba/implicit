/**
 * Renders the plate thumbnail Bambu Connect shows before you press Print.
 *
 * There is no canvas to capture here — the viewport is WebGL without a
 * preserved drawing buffer — so the preview is rasterised straight from the
 * extrusion moves in the emitted G-code. That also makes it an honest picture
 * of the plate: it shows what will actually be printed, top-down.
 */

import { encodePng } from './png';

const SIZE_PX = 512;
const MARGIN_PX = 24;
/** Transparent background: Connect composites the thumbnail on its own plate. */
const LINE_RGB: readonly [number, number, number] = [0x2f, 0xd8, 0xa8];

export async function renderPlateThumbnail(gcode: string): Promise<Uint8Array> {
    const path = collectExtrusionPath(gcode);
    const pixels = new Uint8Array(SIZE_PX * SIZE_PX * 4);

    if (path.count > 1) {
        drawPath(pixels, path);
    }

    return encodePng(SIZE_PX, SIZE_PX, pixels);
}

interface ExtrusionPath {
    x: Float64Array;
    y: Float64Array;
    /** False starts a new polyline (travel move) at that index. */
    connected: Uint8Array;
    count: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * Collects the XY of every extruding move in the model itself. Mirrors the
 * modal-state tracking in gcode-stats (M82/M83, G90/G91, G92) because a wrong
 * extrusion mode would classify prints as travels and draw nothing.
 *
 * Collection only starts at the first `;LAYER:` marker: the machine start
 * G-code purges along the far edges of the bed, and letting those lines into
 * the bounds shrinks the actual model into a corner of the thumbnail.
 */
function collectExtrusionPath(gcode: string): ExtrusionPath {
    const xs: number[] = [];
    const ys: number[] = [];
    const connected: number[] = [];

    let x = 0;
    let y = 0;
    let e = 0;
    let relativeExtrusion = false;
    let relativePositioning = false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let lastWasExtrusion = false;
    let inModel = false;

    for (const rawLine of gcode.split('\n')) {
        const commentIndex = rawLine.indexOf(';');
        const line = (commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine).trim();
        if (!line) {
            if (!inModel && /^\s*;\s*LAYER:/i.test(rawLine)) {
                inModel = true;
            }
            continue;
        }

        const head = line[0];
        if (head === 'M' || head === 'm') {
            const code = Number.parseFloat(line.slice(1));
            if (code === 82) {
                relativeExtrusion = false;
            } else if (code === 83) {
                relativeExtrusion = true;
            }
            continue;
        }

        if (head !== 'G' && head !== 'g') {
            continue;
        }

        const code = Number.parseFloat(line.slice(1));
        if (code === 90) {
            relativePositioning = false;
            continue;
        }
        if (code === 91) {
            relativePositioning = true;
            continue;
        }
        if (code === 92) {
            const resetE = readParameter(line, 'E');
            if (resetE !== null) {
                e = resetE;
            }
            continue;
        }
        if (code !== 0 && code !== 1) {
            continue;
        }

        const parsedX = readParameter(line, 'X');
        const parsedY = readParameter(line, 'Y');
        const nextX = parsedX === null ? x : (relativePositioning ? x + parsedX : parsedX);
        const nextY = parsedY === null ? y : (relativePositioning ? y + parsedY : parsedY);

        const rawE = readParameter(line, 'E');
        let extruding = false;
        if (rawE !== null) {
            const delta = relativeExtrusion ? rawE : rawE - e;
            extruding = delta > 0;
            e = relativeExtrusion ? e + rawE : rawE;
        }

        if (extruding && inModel) {
            xs.push(nextX);
            ys.push(nextY);
            connected.push(lastWasExtrusion ? 1 : 0);
            minX = Math.min(minX, nextX);
            maxX = Math.max(maxX, nextX);
            minY = Math.min(minY, nextY);
            maxY = Math.max(maxY, nextY);
        }

        lastWasExtrusion = extruding && inModel;
        x = nextX;
        y = nextY;
    }

    return {
        x: Float64Array.from(xs),
        y: Float64Array.from(ys),
        connected: Uint8Array.from(connected),
        count: xs.length,
        minX,
        maxX,
        minY,
        maxY,
    };
}

function drawPath(pixels: Uint8Array, path: ExtrusionPath): void {
    const spanX = Math.max(path.maxX - path.minX, 0.001);
    const spanY = Math.max(path.maxY - path.minY, 0.001);
    // One uniform scale keeps the plate's aspect ratio intact.
    const scale = (SIZE_PX - MARGIN_PX * 2) / Math.max(spanX, spanY);
    const offsetX = (SIZE_PX - spanX * scale) / 2;
    const offsetY = (SIZE_PX - spanY * scale) / 2;

    const toPixelX = (value: number) => Math.round(offsetX + (value - path.minX) * scale);
    // Bed Y grows away from the viewer, so flip it into image space.
    const toPixelY = (value: number) => Math.round(SIZE_PX - (offsetY + (value - path.minY) * scale));

    for (let index = 1; index < path.count; index += 1) {
        if (!path.connected[index]) {
            continue;
        }
        drawLine(
            pixels,
            toPixelX(path.x[index - 1]),
            toPixelY(path.y[index - 1]),
            toPixelX(path.x[index]),
            toPixelY(path.y[index]),
        );
    }
}

/** Bresenham; the toolpath is dense enough that 1px lines read clearly. */
function drawLine(pixels: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
    let x = x0;
    let y = y0;
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    const deltaX = Math.abs(x1 - x0);
    const deltaY = -Math.abs(y1 - y0);
    let error = deltaX + deltaY;

    for (;;) {
        setPixel(pixels, x, y);
        if (x === x1 && y === y1) {
            return;
        }
        const doubled = 2 * error;
        if (doubled >= deltaY) {
            error += deltaY;
            x += stepX;
        }
        if (doubled <= deltaX) {
            error += deltaX;
            y += stepY;
        }
    }
}

function setPixel(pixels: Uint8Array, x: number, y: number): void {
    if (x < 0 || y < 0 || x >= SIZE_PX || y >= SIZE_PX) {
        return;
    }

    const offset = (y * SIZE_PX + x) * 4;
    pixels[offset] = LINE_RGB[0];
    pixels[offset + 1] = LINE_RGB[1];
    pixels[offset + 2] = LINE_RGB[2];
    pixels[offset + 3] = 0xff;
}

function readParameter(line: string, letter: string): number | null {
    const pattern = new RegExp(`(?:^|\\s)${letter}(-?\\d*\\.?\\d+)`, 'i');
    const match = pattern.exec(line);
    if (!match) {
        return null;
    }

    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
}
