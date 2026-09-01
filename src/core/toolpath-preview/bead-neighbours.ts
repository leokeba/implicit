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
 * The search deliberately ignores near neighbours along the path: what is
 * being asked is "where is the adjacent pass", not "where is the next point".
 *
 * The deposited bead is a continuous line, not the points that define it, and
 * move merging leaves those points millimetres apart on straight runs. So
 * long segments are densified into the lookup grid: measuring point to point
 * would report a void wherever the neighbouring pass simply had no vertex
 * nearby, which on a merged toolpath is most of it.
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
 * @param minPathSeparation how far apart two points must be along the path
 *        before they count as different passes.
 */
export function measureBeadNeighbourhood(
    points: ToolpathPoint[],
    isDeposited: Uint8Array,
    minPathSeparation: number,
    cellSizeMm: number,
    searchLimitMm: number,
): BeadNeighbourhood {
    const count = points.length;
    const distanceMm = new Float32Array(count);
    const angleDeg = new Float32Array(count);
    const found = new Uint8Array(count);

    if (count === 0) {
        return { distanceMm, angleDeg, found };
    }

    const cellSize = Math.max(1e-3, cellSizeMm);
    const invCell = 1 / cellSize;
    const maxRing = Math.max(1, Math.ceil(searchLimitMm * invCell));

    // Lookup entries: every deposited point, plus interpolated stand-ins
    // along any segment longer than a cell so a long merged move still
    // occupies the grid over its whole length. Each entry keeps the path
    // index it came from, which is what the separation test needs.
    const entryX: number[] = [];
    const entryY: number[] = [];
    const entryZ: number[] = [];
    const entryPath: number[] = [];

    for (let i = 0; i < count; i++) {
        if (isDeposited[i] === 0) continue;
        entryX.push(points[i].x);
        entryY.push(points[i].y);
        entryZ.push(points[i].z);
        entryPath.push(i);

        if (i + 1 >= count || isDeposited[i + 1] === 0) continue;
        const next = points[i + 1];
        const span = Math.hypot(next.x - points[i].x, next.y - points[i].y, next.z - points[i].z);
        const steps = Math.floor(span * invCell);
        for (let k = 1; k <= steps; k++) {
            const t = k / (steps + 1);
            entryX.push(points[i].x + (next.x - points[i].x) * t);
            entryY.push(points[i].y + (next.y - points[i].y) * t);
            entryZ.push(points[i].z + (next.z - points[i].z) * t);
            // Attributed to the nearer end, so the separation test stays
            // meaningful for a stand-in that belongs to no single point.
            entryPath.push(t < 0.5 ? i : i + 1);
        }
    }

    const entryCount = entryX.length;
    const cellX = new Int32Array(entryCount);
    const cellY = new Int32Array(entryCount);
    const cellZ = new Int32Array(entryCount);
    for (let i = 0; i < entryCount; i++) {
        cellX[i] = Math.floor(entryX[i] * invCell);
        cellY[i] = Math.floor(entryY[i] * invCell);
        cellZ[i] = Math.floor(entryZ[i] * invCell);
    }

    // Hashed grid rather than a dense one: a 220 mm bed at bead resolution
    // would be hundreds of millions of cells, nearly all empty.
    const tableSize = nextPowerOfTwo(Math.max(16, entryCount * 2));
    const mask = tableSize - 1;
    const bucketStart = new Int32Array(tableSize + 1);
    for (let i = 0; i < entryCount; i++) {
        bucketStart[hashCell(cellX[i], cellY[i], cellZ[i]) & mask]++;
    }
    let running = 0;
    for (let b = 0; b < tableSize; b++) {
        const size = bucketStart[b];
        bucketStart[b] = running;
        running += size;
    }
    bucketStart[tableSize] = running;

    const cursor = Int32Array.from(bucketStart.subarray(0, tableSize));
    const bucketItems = new Int32Array(running);
    for (let i = 0; i < entryCount; i++) {
        bucketItems[cursor[hashCell(cellX[i], cellY[i], cellZ[i]) & mask]++] = i;
    }

    const searchLimitSq = searchLimitMm * searchLimitMm;

    for (let i = 0; i < count; i++) {
        if (isDeposited[i] === 0) {
            distanceMm[i] = searchLimitMm;
            continue;
        }

        const px = points[i].x;
        const py = points[i].y;
        const pz = points[i].z;
        const queryCellX = Math.floor(px * invCell);
        const queryCellY = Math.floor(py * invCell);
        const queryCellZ = Math.floor(pz * invCell);
        let bestSq = searchLimitSq;
        let bestIndex = -1;

        for (let ring = 0; ring <= maxRing; ring++) {
            // Everything outside the searched rings is at least
            // ring * cellSize away, so a closer hit is already the nearest.
            if (bestIndex >= 0 && bestSq <= (ring * cellSize) * (ring * cellSize)) {
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
                            const j = bucketItems[slot];
                            // Hash collisions land foreign cells in this
                            // bucket; the stored coordinates settle it.
                            if (cellX[j] !== gx || cellY[j] !== gy || cellZ[j] !== gz) continue;
                            if (Math.abs(entryPath[j] - i) < minPathSeparation) continue;

                            const ddx = entryX[j] - px;
                            const ddy = entryY[j] - py;
                            const ddz = entryZ[j] - pz;
                            const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
                            if (distSq < bestSq) {
                                bestSq = distSq;
                                bestIndex = j;
                            }
                        }
                    }
                }
            }
        }

        if (bestIndex < 0) {
            distanceMm[i] = searchLimitMm;
            angleDeg[i] = 90;
            continue;
        }

        const distance = Math.sqrt(bestSq);
        const dy = Math.abs(entryY[bestIndex] - py);
        const horizontal = Math.hypot(entryX[bestIndex] - px, entryZ[bestIndex] - pz);
        distanceMm[i] = distance;
        angleDeg[i] = (Math.atan2(dy, horizontal) * 180) / Math.PI;
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
