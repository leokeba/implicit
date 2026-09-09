/**
 * Derives the print statistics Bambu's package format advertises (filament
 * length/weight, duration, layer count) by reading back the emitted G-code.
 *
 * Reading the toolpath a second time keeps the slicer free of reporting
 * concerns, and it measures exactly what the printer will execute — start and
 * end G-code purge lines included.
 */

export interface GcodePrintStats {
    /** Extruded filament length in mm, summed over positive E deltas. */
    filamentLengthMm: number;
    /** Wall-clock estimate in seconds; feedrate-only, no acceleration model. */
    durationSeconds: number;
    layerCount: number;
    maxZMm: number;
}

export function measureGcode(gcode: string): GcodePrintStats {
    let x = 0;
    let y = 0;
    let z = 0;
    let e = 0;
    let feedMmPerMin = 1200;
    let relativeExtrusion = false;
    let relativePositioning = false;

    let filamentLengthMm = 0;
    let durationSeconds = 0;
    let layerCount = 0;
    let maxZMm = 0;

    for (const rawLine of gcode.split('\n')) {
        const line = stripComment(rawLine);
        if (!line) {
            // Layer changes are only visible as comments; the emitter writes
            // one `; LAYER:<n>` marker per layer.
            if (/^\s*;\s*LAYER:/i.test(rawLine)) {
                layerCount += 1;
            }
            continue;
        }

        const command = readWord(line, 'G');

        if (command === 90) {
            relativePositioning = false;
            continue;
        }
        if (command === 91) {
            relativePositioning = true;
            continue;
        }
        if (command === 92) {
            const resetE = readParameter(line, 'E');
            if (resetE !== null) {
                e = resetE;
            }
            continue;
        }
        if (command === 4) {
            const milliseconds = readParameter(line, 'P');
            const seconds = readParameter(line, 'S');
            durationSeconds += (milliseconds !== null ? milliseconds / 1000 : 0) + (seconds ?? 0);
            continue;
        }

        const mCommand = readWord(line, 'M');
        if (mCommand === 82) {
            relativeExtrusion = false;
            continue;
        }
        if (mCommand === 83) {
            relativeExtrusion = true;
            continue;
        }

        if (command !== 0 && command !== 1) {
            continue;
        }

        const feed = readParameter(line, 'F');
        if (feed !== null && feed > 0) {
            feedMmPerMin = feed;
        }

        const nextX = resolveAxis(readParameter(line, 'X'), x, relativePositioning);
        const nextY = resolveAxis(readParameter(line, 'Y'), y, relativePositioning);
        const nextZ = resolveAxis(readParameter(line, 'Z'), z, relativePositioning);

        const rawE = readParameter(line, 'E');
        if (rawE !== null) {
            const delta = relativeExtrusion ? rawE : rawE - e;
            if (delta > 0) {
                filamentLengthMm += delta;
            }
            e = relativeExtrusion ? e + rawE : rawE;
        }

        const distance = Math.hypot(nextX - x, nextY - y, nextZ - z);
        if (distance > 0 && feedMmPerMin > 0) {
            durationSeconds += (distance / feedMmPerMin) * 60;
        }

        x = nextX;
        y = nextY;
        z = nextZ;
        maxZMm = Math.max(maxZMm, z);
    }

    return { filamentLengthMm, durationSeconds, layerCount, maxZMm };
}

/**
 * Filament mass in grams for a length of round stock. Bambu shows this on the
 * printer and in Bambu Connect's plate summary.
 */
export function filamentMassGrams(
    lengthMm: number,
    diameterMm: number,
    densityGramsPerCm3: number,
): number {
    const radiusCm = diameterMm / 20;
    const volumeCm3 = Math.PI * radiusCm * radiusCm * (lengthMm / 10);
    return volumeCm3 * densityGramsPerCm3;
}

function stripComment(line: string): string {
    const commentIndex = line.indexOf(';');
    const body = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    return body.trim();
}

/** Reads a leading `G<n>`/`M<n>` opcode, ignoring lines that start elsewhere. */
function readWord(line: string, letter: 'G' | 'M'): number | null {
    if (line[0] !== letter && line[0] !== letter.toLowerCase()) {
        return null;
    }

    const value = Number.parseFloat(line.slice(1));
    return Number.isFinite(value) ? value : null;
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

function resolveAxis(parsed: number | null, current: number, relative: boolean): number {
    if (parsed === null) {
        return current;
    }
    return relative ? current + parsed : parsed;
}
