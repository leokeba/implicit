/**
 * Measures, for every deposited bead, how far away the nearest bead of a
 * *different* pass is.
 *
 * This is the diagnostic that matters for single-wall printing. A vase-mode
 * wall is one bead per revolution with no infill behind it, so neighbouring
 * revolutions have to touch or the wall is not a wall - it is a stack of
 * disconnected rings. Planar slicing separates revolutions horizontally by
 * `layerHeight / tan(slope)`, which diverges as the surface flattens, so the
 * failure is a function of shape rather than of settings.
 *
 * Two things make this harder than a nearest-point query:
 *
 * The deposited bead is a continuous line, not the points that define it, and
 * move merging leaves those points millimetres apart on straight runs. So the
 * answer is the distance to the nearest *segment*, computed exactly. A grid
 * of sampled positions only narrows down which segments to test - sampling
 * alone would quantise the neighbour's position to the sample spacing, which
 * against a 0.2 mm neighbour distance is enough to swing the reported angle
 * by tens of degrees.
 *
 * And "a different pass" cannot be a count of points along the path, for the
 * same merging reason: a revolution is 44 points where the wall is smooth and
 * 400 where it curves. It is a pass identifier instead.
 */

import type { ToolpathPoint } from '../slicer/types';

export interface BeadNeighbourhood {
    /** Distance to the nearest bead of another pass, mm. */
    distanceMm: Float32Array;
    /**
     * Angle of the direction to that neighbour, degrees from horizontal.
     * The neighbouring pass sits across the wall, so this reads as the local
     * wall slope: 90 is a vertical wall, 0 a flat region.
     */
    angleDeg: Float32Array;
    /** 0 where no neighbour was found inside the search radius. */
    found: Uint8Array;
}

/**
 * @param segmentDeposited one flag per segment (point i to i + 1); travels
 *        lay no material and are neither queried nor treated as neighbours.
 * @param passId which continuous run of extrusion each point belongs to - a
 *        revolution of the spiral, or one brim or fill loop.
 * @param arcMm cumulative path length, used to reject the continuation of the
 *        same stroke across a pass boundary: at the seam the next point is a
 *        different revolution but the nozzle never lifted.
 */
export function measureBeadNeighbourhood(
    points: ToolpathPoint[],
    segmentDeposited: Uint8Array,
    passId: Int32Array,
    arcMm: Float32Array,
    minArcSeparationMm: number,
    cellSizeMm: number,
    searchLimitMm: number,
): BeadNeighbourhood {
    const count = points.length;
    const distanceMm = new Float32Array(count).fill(searchLimitMm);
    const angleDeg = new Float32Array(count);
    const found = new Uint8Array(count);
    const segmentCount = Math.max(0, count - 1);

    if (segmentCount === 0) {
        return { distanceMm, angleDeg, found };
    }

    const cellSize = Math.max(1e-3, cellSizeMm);
    const invCell = 1 / cellSize;
    const maxRing = Math.max(1, Math.ceil(searchLimitMm * invCell));

    // --- index every deposited segment into the cells it passes through ---
    const cellKeyX: number[] = [];
    const cellKeyY: number[] = [];
    const cellKeyZ: number[] = [];
    const cellSegment: number[] = [];

    for (let k = 0; k < segmentCount; k++) {
        if (segmentDeposited[k] === 0) continue;
        const a = points[k];
        const b = points[k + 1];
        const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const steps = Math.max(1, Math.ceil((span * invCell) * 2));
        let lastX = Number.NaN;
        let lastY = Number.NaN;
        let lastZ = Number.NaN;
        for (let step = 0; step <= steps; step++) {
            const t = step / steps;
            const gx = Math.floor((a.x + (b.x - a.x) * t) * invCell);
            const gy = Math.floor((a.y + (b.y - a.y) * t) * invCell);
            const gz = Math.floor((a.z + (b.z - a.z) * t) * invCell);
            if (gx === lastX && gy === lastY && gz === lastZ) continue;
            lastX = gx; lastY = gy; lastZ = gz;
            cellKeyX.push(gx); cellKeyY.push(gy); cellKeyZ.push(gz);
            cellSegment.push(k);
        }
    }

    const entryCount = cellSegment.length;
    // Hashed grid rather than a dense one: a 220 mm bed at bead resolution
    // would be hundreds of millions of cells, nearly all empty.
    const tableSize = nextPowerOfTwo(Math.max(16, entryCount * 2));
    const mask = tableSize - 1;
    const bucketStart = new Int32Array(tableSize + 1);
    for (let i = 0; i < entryCount; i++) {
        bucketStart[hashCell(cellKeyX[i], cellKeyY[i], cellKeyZ[i]) & mask]++;
    }
    let running = 0;
    for (let b = 0; b < tableSize; b++) {
        const size = bucketStart[b];
        bucketStart[b] = running;
        running += size;
    }
    bucketStart[tableSize] = running;

    const cursor = Int32Array.from(bucketStart.subarray(0, tableSize));
    const bucketItems = new Int32Array(entryCount);
    const itemCellX = new Int32Array(entryCount);
    const itemCellY = new Int32Array(entryCount);
    const itemCellZ = new Int32Array(entryCount);
    for (let i = 0; i < entryCount; i++) {
        const slot = cursor[hashCell(cellKeyX[i], cellKeyY[i], cellKeyZ[i]) & mask]++;
        bucketItems[slot] = cellSegment[i];
        itemCellX[slot] = cellKeyX[i];
        itemCellY[slot] = cellKeyY[i];
        itemCellZ[slot] = cellKeyZ[i];
    }

    // --- query each deposited point against the segments around it ---
    // A segment sits in many cells; the stamp keeps it evaluated once.
    const stamp = new Int32Array(segmentCount).fill(-1);
    const searchLimitSq = searchLimitMm * searchLimitMm;

    for (let i = 0; i < count; i++) {
        const incoming = i === 0 ? 0 : i - 1;
        if (segmentDeposited[Math.min(incoming, segmentCount - 1)] === 0) {
            continue;
        }

        const px = points[i].x;
        const py = points[i].y;
        const pz = points[i].z;
        const queryCellX = Math.floor(px * invCell);
        const queryCellY = Math.floor(py * invCell);
        const queryCellZ = Math.floor(pz * invCell);
        let bestSq = searchLimitSq;
        let bestX = 0;
        let bestY = 0;
        let bestZ = 0;
        let hit = false;

        for (let ring = 0; ring <= maxRing; ring++) {
            // Everything outside the searched rings is at least
            // ring * cellSize away, so a closer hit is already the nearest.
            if (hit && bestSq <= (ring * cellSize) * (ring * cellSize)) {
                break;
            }

            for (let dx = -ring; dx <= ring; dx++) {
                for (let dy = -ring; dy <= ring; dy++) {
                    for (let dz = -ring; dz <= ring; dz++) {
                        // Only the shell: inner cells were covered already.
                        if (ring > 0
                            && Math.abs(dx) !== ring
                            && Math.abs(dy) !== ring
                            && Math.abs(dz) !== ring) {
                            continue;
                        }

                        const gx = queryCellX + dx;
                        const gy = queryCellY + dy;
                        const gz = queryCellZ + dz;
                        const bucket = hashCell(gx, gy, gz) & mask;
                        const end = bucketStart[bucket + 1];
                        for (let slot = bucketStart[bucket]; slot < end; slot++) {
                            // Hash collisions land foreign cells in this
                            // bucket; the stored coordinates settle it.
                            if (itemCellX[slot] !== gx || itemCellY[slot] !== gy || itemCellZ[slot] !== gz) continue;
                            const k = bucketItems[slot];
                            if (stamp[k] === i) continue;
                            stamp[k] = i;

                            // Only segments lying wholly on another pass.
                            if (passId[k] === passId[i] || passId[k + 1] === passId[i]) continue;

                            const a = points[k];
                            const b = points[k + 1];
                            const ex = b.x - a.x;
                            const ey = b.y - a.y;
                            const ez = b.z - a.z;
                            const lengthSq = ex * ex + ey * ey + ez * ez;
                            const t = lengthSq > 1e-18
                                ? Math.min(1, Math.max(0, ((px - a.x) * ex + (py - a.y) * ey + (pz - a.z) * ez) / lengthSq))
                                : 0;
                            const cx = a.x + ex * t;
                            const cy = a.y + ey * t;
                            const cz = a.z + ez * t;
                            const distSq = (cx - px) * (cx - px) + (cy - py) * (cy - py) + (cz - pz) * (cz - pz);
                            if (distSq >= bestSq) continue;

                            // The same stroke continuing past a seam is not a
                            // neighbouring pass, whatever its pass id says.
                            const arc = arcMm[k] + (arcMm[k + 1] - arcMm[k]) * t;
                            if (Math.abs(arc - arcMm[i]) < minArcSeparationMm) continue;

                            bestSq = distSq;
                            bestX = cx; bestY = cy; bestZ = cz;
                            hit = true;
                        }
                    }
                }
            }
        }

        if (!hit) {
            angleDeg[i] = 90;
            continue;
        }

        const distance = Math.sqrt(bestSq);
        const vertical = Math.abs(bestY - py);
        const horizontal = Math.hypot(bestX - px, bestZ - pz);
        distanceMm[i] = distance;
        angleDeg[i] = (Math.atan2(vertical, horizontal) * 180) / Math.PI;
        found[i] = 1;
    }

    return { distanceMm, angleDeg, found };
}

function hashCell(x: number, y: number, z: number): number {
    // Multiply by large primes and mix; the caller re-checks coordinates, so
    // collisions cost a few extra comparisons and nothing else.
    return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
}

function nextPowerOfTwo(value: number): number {
    let result = 1;
    while (result < value) {
        result *= 2;
    }
    return result;
}
