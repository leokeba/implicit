/**
 * Offsetting closed outlines in the bed plane, for the brim and the solid
 * bottom fill.
 *
 * The naive offset - move every edge sideways and join the ends - is only
 * right while the offset is smaller than every feature of the outline.
 * Past that, edges overrun each other: a short edge on a convex wiggle
 * flips over and makes a swallowtail, the walls of a narrow neck pass
 * through each other, a scalloped rim's bays fold back on themselves. The
 * raw curve then crosses itself, and printing it lays those crossings
 * twice. A marching-squares outline is full of small wiggles, so on a real
 * first layer this is the normal case, not the exception.
 *
 * So the raw offset is only the first step, and it is built to be exact:
 * every edge moved sideways, and every corner that opens a gap closed with
 * an arc around the vertex rather than a miter. The raw curve is then the
 * boundary of the reach of every edge and every vertex, and whether a
 * point of it belongs to the true offset can only change where it crosses
 * another part of itself - where it enters the reach of some other edge or
 * vertex. A miter would break that: its corner sticks out past the arc, and
 * another part of the curve can slip into the vertex's reach between the
 * two without crossing anything.
 *
 * The curve is cut at its crossings into pieces, each wholly in or wholly
 * out. At a crossing on the true offset the boundary always arrives on one
 * strand and leaves on the other, since each strand is entering the
 * other's reach on one side of the crossing and leaving it on the other. So
 * from any piece that clearly belongs - the offset distance from the
 * outline at every sample, which is the question that defines an offset -
 * switching strands at every crossing traces its whole loop, without
 * having to judge the short, borderline pieces next to the crossings one by
 * one. Each traced loop is then kept or dropped as a whole.
 *
 * Cutting the curve into loops at each crossing's second visit does not
 * work: two swallowtails that interleave cross in the order A, B, A, B, and
 * a loop cut at A still runs through B, where it changes from kept to
 * overrun.
 *
 * What comes back can be several loops: an inward offset of a dumbbell
 * splits into two islands, and an outward offset of a shape with a bottled
 * inlet keeps the inlet's chamber as a hole.
 *
 * Convention: a region is a set of loops with the region on their left -
 * outer boundaries counter-clockwise (positive area, y up), holes
 * clockwise. A positive distance grows the region, a negative one shrinks
 * it, and the result follows the same convention, so a region can be
 * offset again. Repeated small offsets are much cheaper than one large
 * one, because a raw offset tangles in proportion to how far it reaches
 * past the outline's features, and two erosions by a disk compose into one
 * by the sum of their radii.
 */

export interface Point2 {
    x: number;
    y: number;
}

export interface PolygonOffsetOptions {
    /**
     * Largest angle one segment of a rounded corner may turn, in radians.
     * The chord of a step dips below the offset distance by 1 - cos(step / 2)
     * of it, which has to stay well inside the 3% the validity test allows.
     */
    arcStepRadians?: number;
    /** Loops enclosing less than this area are dropped, in the outline's units squared. */
    minArea?: number;
    /**
     * Longest single offset step. A larger distance is reached in equal
     * steps no longer than this. The validity test allows 3% of the step, so
     * one large step over a noisy outline lets through a band of tangle that
     * wide; several small ones never form the tangle in the first place.
     */
    maxStep?: number;
}

/**
 * Offsets a single outline of either winding. The result follows the region
 * convention (outer loops counter-clockwise), ready for offsetRegion.
 */
export function offsetOutline(outline: Point2[], distance: number, options: PolygonOffsetOptions = {}): Point2[][] {
    const source = dedupeClosedLoop(outline);
    if (source.length < 3) {
        return [];
    }
    const area = signedArea(source);
    if (Math.abs(area) < 1e-12) {
        return [];
    }
    return offsetRegion([area > 0 ? source : source.slice().reverse()], distance, options);
}

/** Offsets a region given as loops in the region convention (see the module note). */
export function offsetRegion(region: Point2[][], distance: number, options: PolygonOffsetOptions = {}): Point2[][] {
    const loops = region.map(dedupeClosedLoop).filter((loop) => loop.length >= 3);
    if (loops.length === 0) {
        return [];
    }
    const minArea = Math.max(0, options.minArea ?? 0);
    if (Math.abs(distance) < 1e-9) {
        return loops.map((loop) => loop.map((point) => ({ ...point })));
    }

    const maxStep = options.maxStep ?? Number.POSITIVE_INFINITY;
    if (Math.abs(distance) > maxStep) {
        const steps = Math.ceil(Math.abs(distance) / maxStep);
        const step = distance / steps;
        let current = loops;
        for (let i = 0; i < steps && current.length > 0; i++) {
            current = offsetRegion(current, step, { ...options, maxStep: Number.POSITIVE_INFINITY });
        }
        return current;
    }

    const arcStep = Math.min(Math.PI / 6, Math.max(0.01, options.arcStepRadians ?? Math.PI / 12));
    const curves = loops.map((loop) => rawOffset(loop, distance, arcStep)).filter((curve) => curve.length >= 3);
    const reach = Math.abs(distance);
    const isClear = createClearanceTest(loops, reach * 0.97);

    const traced = traceOffsetLoops(curves, isClear)
        .map((loop) => ({ loop, area: signedArea(loop) }))
        .filter(({ loop, area }) => loop.length >= 3 && Math.abs(area) >= Math.max(minArea, 1e-12))
        .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

    // Topology bounds what an offset can make. Shrinking a region can split
    // an island in two but never opens a hole; growing it can open a hole
    // (an inlet pinching shut) but never makes a new island. So a shrink
    // keeps at most as many holes as it started with, and a growth at most
    // as many islands. Anything past that is a loop of overrun material
    // that happened to stay within the validity tolerance - and left in, a
    // spurious hole would grow with every further shrink.
    const inputIslands = loops.filter((loop) => signedArea(loop) > 0).length;
    const inputHoles = loops.length - inputIslands;
    let islandBudget = distance > 0 ? inputIslands : Number.POSITIVE_INFINITY;
    let holeBudget = distance < 0 ? inputHoles : Number.POSITIVE_INFINITY;
    const kept: Point2[][] = [];
    for (const { loop, area } of traced) {
        if (area > 0 ? islandBudget-- > 0 : holeBudget-- > 0) {
            kept.push(loop);
        }
    }
    return kept;
}

/**
 * Drops vertices closer than `minSegment` along the loop, so interior fill
 * is not printed at outline resolution. Skipping vertices can cut a corner
 * across a narrow loop, so the result is checked and the input returned
 * unchanged if the shortcut made it cross itself.
 */
export function decimateClosedLoop(loop: Point2[], minSegment: number): Point2[] {
    if (loop.length < 8 || minSegment <= 0) {
        return loop;
    }

    const decimated: Point2[] = [loop[0]];
    let accumulated = 0;
    for (let i = 1; i < loop.length; i++) {
        accumulated += Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y);
        if (accumulated >= minSegment) {
            decimated.push(loop[i]);
            accumulated = 0;
        }
    }

    if (decimated.length < 4 || findCrossings([decimated]).length > 0) {
        return loop;
    }
    return decimated;
}

/** Number of points where a closed loop crosses itself. */
export function countSelfIntersections(loop: Point2[]): number {
    return loop.length < 4 ? 0 : findCrossings([loop]).length;
}

export function signedArea(points: Point2[]): number {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += (a.x * b.y) - (b.x * a.y);
    }
    return area * 0.5;
}

// ---------------------------------------------------------------------------
// Raw offset.
// ---------------------------------------------------------------------------

/**
 * Every edge moved `distance` to its right (outward, in the region
 * convention), joined at each vertex. Where the move opens a gap between
 * neighbouring edges the gap is closed with an arc around the vertex; where
 * it makes them overlap they are cut at their crossing, or, when they do
 * not reach each other, left overlapping for the crossing pass to sort out.
 */
function rawOffset(loop: Point2[], distance: number, arcStep: number): Point2[] {
    const count = loop.length;
    const tangents: Point2[] = new Array(count);
    const normals: Point2[] = new Array(count);
    for (let i = 0; i < count; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % count];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const tx = (b.x - a.x) / length;
        const ty = (b.y - a.y) / length;
        tangents[i] = { x: tx, y: ty };
        normals[i] = { x: ty, y: -tx };
    }

    const out: Point2[] = [];
    const push = (x: number, y: number) => {
        const previous = out[out.length - 1];
        if (!previous || Math.hypot(previous.x - x, previous.y - y) > 1e-9) {
            out.push({ x, y });
        }
    };

    for (let i = 0; i < count; i++) {
        const previousEdge = (i - 1 + count) % count;
        const vertex = loop[i];
        const tPrev = tangents[previousEdge];
        const tNext = tangents[i];
        const nPrev = normals[previousEdge];
        const nNext = normals[i];

        // End of the previous edge's offset, start of this edge's.
        const endPrevX = vertex.x + nPrev.x * distance;
        const endPrevY = vertex.y + nPrev.y * distance;
        const startNextX = vertex.x + nNext.x * distance;
        const startNextY = vertex.y + nNext.y * distance;

        const cross = (tPrev.x * tNext.y) - (tPrev.y * tNext.x);
        const dot = (tPrev.x * tNext.x) + (tPrev.y * tNext.y);
        if (Math.abs(cross) < 1e-9 && dot > 0) {
            push(endPrevX, endPrevY);
            continue;
        }
        if (1 + dot < 1e-9) {
            // A full U-turn: no join is meaningful, and the crossing pass
            // sorts out whatever the two ends do.
            push(endPrevX, endPrevY);
            push(startNextX, startNextY);
            continue;
        }

        // A left turn opens a gap on the right, so it is a gap when growing
        // and an overlap when shrinking.
        const opensGap = cross * Math.sign(distance) > 0;
        const sweep = Math.atan2(cross, dot);
        if (opensGap && Math.abs(sweep) <= arcStep) {
            // A turn no larger than one arc step: the miter point sticks out
            // past the arc by no more than one step's chord dips inside it,
            // and it is one vertex instead of two. Without this, growing a
            // ring that is already all arcs doubles its vertices every step.
            const scale = distance / (1 + dot);
            push(vertex.x + (nPrev.x + nNext.x) * scale, vertex.y + (nPrev.y + nNext.y) * scale);
            continue;
        }
        if (opensGap) {
            const steps = Math.max(1, Math.ceil(Math.abs(sweep) / arcStep));
            const startAngle = Math.atan2(nPrev.y * distance, nPrev.x * distance);
            const radius = Math.abs(distance);
            for (let step = 0; step <= steps; step++) {
                const angle = startAngle + (sweep * step) / steps;
                push(vertex.x + Math.cos(angle) * radius, vertex.y + Math.sin(angle) * radius);
            }
            continue;
        }

        // The edges overlap. The intersection of the two offset lines -
        // along the bisector of the normals, at distance / cos(half the
        // turn) - is where they cross, if they are long enough to reach it.
        const miterScale = distance / (1 + dot);
        const miterX = vertex.x + (nPrev.x + nNext.x) * miterScale;
        const miterY = vertex.y + (nPrev.y + nNext.y) * miterScale;
        const previousStart = loop[previousEdge];
        const next = loop[(i + 1) % count];
        const alongPrev = projectionParameter(
            miterX, miterY,
            previousStart.x + nPrev.x * distance, previousStart.y + nPrev.y * distance,
            endPrevX, endPrevY,
        );
        const alongNext = projectionParameter(
            miterX, miterY,
            startNextX, startNextY,
            next.x + nNext.x * distance, next.y + nNext.y * distance,
        );
        if (alongPrev >= 0 && alongPrev <= 1 && alongNext >= 0 && alongNext <= 1) {
            push(miterX, miterY);
        } else {
            push(endPrevX, endPrevY);
            push(startNextX, startNextY);
        }
    }

    return dedupeClosedLoop(out);
}

function projectionParameter(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = (dx * dx) + (dy * dy);
    return lengthSq < 1e-24 ? 0 : (((px - ax) * dx) + ((py - ay) * dy)) / lengthSq;
}

// ---------------------------------------------------------------------------
// Crossings.
// ---------------------------------------------------------------------------

/** One end of a crossing: which curve, which segment, how far along it. */
interface CrossingEnd {
    curve: number;
    segment: number;
    t: number;
}

interface Crossing {
    a: CrossingEnd;
    b: CrossingEnd;
    point: Point2;
}

/**
 * Uniform grid over a set of segments, sized so a cell holds a couple of
 * them, for finding which segments come near a point or each other without
 * comparing every pair.
 */
class SegmentGrid {
    readonly cell: number;
    private readonly minX: number;
    private readonly minY: number;
    private readonly columns: number;
    readonly bins = new Map<number, number[]>();
    readonly starts: Point2[];
    readonly ends: Point2[];

    constructor(starts: Point2[], ends: Point2[], minimumCell: number) {
        this.starts = starts;
        this.ends = ends;
        const count = starts.length;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let totalLength = 0;
        for (let i = 0; i < count; i++) {
            const a = starts[i];
            const b = ends[i];
            minX = Math.min(minX, a.x, b.x);
            minY = Math.min(minY, a.y, b.y);
            maxX = Math.max(maxX, a.x, b.x);
            maxY = Math.max(maxY, a.y, b.y);
            totalLength += Math.hypot(b.x - a.x, b.y - a.y);
        }
        const span = Math.max(maxX - minX, maxY - minY, 1e-9);
        // About two segments per cell, never finer than the caller needs,
        // and never more cells than a few per segment, so one very long
        // segment does not explode the grid.
        const maxCellsPerSide = Math.max(1, Math.ceil(Math.sqrt(count * 4)));
        this.cell = Math.max((totalLength / Math.max(1, count)) * 2, minimumCell, span / maxCellsPerSide, 1e-9);
        this.minX = minX;
        this.minY = minY;
        this.columns = Math.floor((maxX - minX) / this.cell) + 1;

        for (let i = 0; i < count; i++) {
            const a = starts[i];
            const b = ends[i];
            const c0 = this.column(Math.min(a.x, b.x));
            const c1 = this.column(Math.max(a.x, b.x));
            const r0 = this.row(Math.min(a.y, b.y));
            const r1 = this.row(Math.max(a.y, b.y));
            for (let row = r0; row <= r1; row++) {
                for (let column = c0; column <= c1; column++) {
                    const key = this.key(row, column);
                    const bin = this.bins.get(key);
                    if (bin) {
                        bin.push(i);
                    } else {
                        this.bins.set(key, [i]);
                    }
                }
            }
        }
    }

    column(x: number): number {
        return Math.max(0, Math.min(this.columns - 1, Math.floor((x - this.minX) / this.cell)));
    }

    row(y: number): number {
        return Math.floor((y - this.minY) / this.cell);
    }

    key(row: number, column: number): number {
        return (row * this.columns) + column;
    }

    keyOf(x: number, y: number): number {
        return this.key(this.row(y), this.column(x));
    }
}

/**
 * Every proper crossing between segments of a set of closed curves,
 * adjacent segments of the same curve excepted. A crossing is reported only
 * from the grid cell that contains it, which counts each one exactly once
 * however many cells its two segments share.
 */
function findCrossings(curves: Point2[][]): Crossing[] {
    const starts: Point2[] = [];
    const ends: Point2[] = [];
    const owners: CrossingEnd[] = [];
    curves.forEach((curve, curveIndex) => {
        for (let i = 0; i < curve.length; i++) {
            starts.push(curve[i]);
            ends.push(curve[(i + 1) % curve.length]);
            owners.push({ curve: curveIndex, segment: i, t: 0 });
        }
    });
    if (starts.length < 4) {
        return [];
    }

    const grid = new SegmentGrid(starts, ends, 0);
    const crossings: Crossing[] = [];
    const epsilon = 1e-9;
    for (const [key, bin] of grid.bins) {
        for (let p = 0; p < bin.length; p++) {
            const i = bin[p];
            const a = starts[i];
            const b = ends[i];
            const ownerI = owners[i];
            const lengthI = curves[ownerI.curve].length;
            for (let q = p + 1; q < bin.length; q++) {
                const j = bin[q];
                const ownerJ = owners[j];
                if (ownerI.curve === ownerJ.curve) {
                    const gap = Math.abs(ownerI.segment - ownerJ.segment);
                    if (gap <= 1 || gap === lengthI - 1) {
                        continue;
                    }
                }
                const c = starts[j];
                const d = ends[j];
                const rx = b.x - a.x;
                const ry = b.y - a.y;
                const sx = d.x - c.x;
                const sy = d.y - c.y;
                const denominator = (rx * sy) - (ry * sx);
                if (Math.abs(denominator) < 1e-18) {
                    continue;
                }
                const qx = c.x - a.x;
                const qy = c.y - a.y;
                const ti = ((qx * sy) - (qy * sx)) / denominator;
                const tj = ((qx * ry) - (qy * rx)) / denominator;
                if (ti <= epsilon || ti >= 1 - epsilon || tj <= epsilon || tj >= 1 - epsilon) {
                    continue;
                }
                const point = { x: a.x + rx * ti, y: a.y + ry * ti };
                if (grid.keyOf(point.x, point.y) !== key) {
                    continue;
                }
                crossings.push({
                    a: { curve: ownerI.curve, segment: ownerI.segment, t: ti },
                    b: { curve: ownerJ.curve, segment: ownerJ.segment, t: tj },
                    point,
                });
            }
        }
    }

    return crossings;
}

// ---------------------------------------------------------------------------
// Pieces.
// ---------------------------------------------------------------------------

interface Piece {
    /** Crossing occurrence the piece starts at, as node * 2 + visit; -1 for a curve with no crossings. */
    from: number;
    /** Crossing occurrence it ends at. */
    to: number;
    /** From the start crossing up to, not including, the end crossing. */
    points: Point2[];
    /** The end crossing's point, for sampling the last segment. */
    end: Point2;
    /** Samples taken and how many of them cleared the outline. */
    samples: number;
    clear: number;
}

/**
 * Cuts the raw curves at their crossings and traces the loops of the true
 * offset through them (see the module note).
 */
function traceOffsetLoops(curves: Point2[][], isClear: (x: number, y: number) => boolean): Point2[][] {
    const crossings = findCrossings(curves);

    // Crossings along each segment, so each curve can be walked with its
    // crossings in order.
    const onSegment = new Map<string, Array<{ t: number; node: number }>>();
    crossings.forEach((crossing, node) => {
        for (const end of [crossing.a, crossing.b]) {
            const key = `${end.curve}:${end.segment}`;
            const list = onSegment.get(key);
            if (list) {
                list.push({ t: end.t, node });
            } else {
                onSegment.set(key, [{ t: end.t, node }]);
            }
        }
    });

    // Each crossing is passed twice, once on each strand. Visits are
    // numbered in walk order, which is all the strand switch needs: a piece
    // arriving on one visit continues on the piece leaving the other.
    const visitCount = new Uint8Array(crossings.length);
    const pieces: Piece[] = [];
    const loops: Point2[][] = [];
    curves.forEach((curve, curveIndex) => {
        const walk: Array<{ point: Point2; occurrence: number }> = [];
        for (let i = 0; i < curve.length; i++) {
            walk.push({ point: curve[i], occurrence: -1 });
            const list = onSegment.get(`${curveIndex}:${i}`);
            if (list) {
                list.sort((p, q) => p.t - q.t);
                for (const entry of list) {
                    walk.push({ point: crossings[entry.node].point, occurrence: (entry.node * 2) + visitCount[entry.node]++ });
                }
            }
        }

        const first = walk.findIndex((item) => item.occurrence >= 0);
        if (first < 0) {
            const whole: Piece = { from: -1, to: -1, points: curve, end: curve[0], samples: 0, clear: 0 };
            samplePiece(whole, isClear);
            if (whole.clear * 2 > whole.samples) {
                loops.push(curve);
            }
            return;
        }
        // Start at a crossing so no piece straddles the curve's arbitrary
        // first vertex.
        const ordered = [...walk.slice(first), ...walk.slice(0, first)];
        let current: Piece = { from: ordered[0].occurrence, to: -1, points: [ordered[0].point], end: ordered[0].point, samples: 0, clear: 0 };
        for (let k = 1; k <= ordered.length; k++) {
            const item = ordered[k % ordered.length];
            if (item.occurrence < 0) {
                current.points.push(item.point);
                continue;
            }
            current.to = item.occurrence;
            current.end = item.point;
            pieces.push(current);
            if (k === ordered.length) {
                break;
            }
            current = { from: item.occurrence, to: -1, points: [item.point], end: item.point, samples: 0, clear: 0 };
        }
    });

    const leaving = new Map<number, Piece>();
    for (const piece of pieces) {
        leaving.set(piece.from, piece);
        samplePiece(piece, isClear);
    }

    // Seeds: pieces every sample of which clears the outline, longest first,
    // so each loop is traced from the piece least likely to be misjudged.
    const seeds = pieces
        .filter((piece) => piece.samples > 0 && piece.clear === piece.samples)
        .sort((a, b) => b.points.length - a.points.length);
    const traced = new Set<Piece>();
    for (const seed of seeds) {
        if (traced.has(seed)) {
            continue;
        }
        const loop: Point2[] = [];
        let samples = 0;
        let clear = 0;
        let piece: Piece | undefined = seed;
        let closed = false;
        for (let guard = 0; piece && guard <= pieces.length; guard++) {
            traced.add(piece);
            loop.push(...piece.points);
            samples += piece.samples;
            clear += piece.clear;
            // Switch strands: the other visit of the crossing this piece ends at.
            piece = leaving.get(piece.to ^ 1);
            if (piece === seed) {
                closed = true;
                break;
            }
            if (piece && traced.has(piece)) {
                break;
            }
        }
        // The seed vouches for where the trace starts; the vote over the
        // whole loop is what stops a misjudged seed from keeping a loop of
        // overrun material.
        if (closed && clear * 2 > samples) {
            loops.push(dedupeClosedLoop(loop));
        }
    }

    return loops;
}

/**
 * Tests segment midpoints rather than vertices, because a piece's ends are
 * crossings and sit exactly on the line between kept and overrun.
 */
function samplePiece(piece: Piece, isClear: (x: number, y: number) => boolean): void {
    const points = piece.points;
    // A closed curve's last segment returns to its first point, an open
    // piece's runs to its end crossing: either way one segment per point.
    const segments = points.length;
    const samples = Math.min(segments, 9);
    let clear = 0;
    for (let s = 0; s < samples; s++) {
        const index = Math.floor((s * segments) / samples);
        const a = points[index];
        const b = index + 1 < points.length ? points[index + 1] : piece.end;
        if (isClear((a.x + b.x) * 0.5, (a.y + b.y) * 0.5)) {
            clear++;
        }
    }
    piece.samples = samples;
    piece.clear = clear;
}

/**
 * Builds the test "is this point at least `threshold` from every edge of
 * the region", over a grid fine enough that only the neighbouring cells can
 * hold an edge that close.
 */
function createClearanceTest(region: Point2[][], threshold: number): (x: number, y: number) => boolean {
    const starts: Point2[] = [];
    const ends: Point2[] = [];
    for (const loop of region) {
        for (let i = 0; i < loop.length; i++) {
            starts.push(loop[i]);
            ends.push(loop[(i + 1) % loop.length]);
        }
    }
    const grid = new SegmentGrid(starts, ends, threshold);
    const thresholdSq = threshold * threshold;
    return (x: number, y: number): boolean => {
        const reach = Math.ceil(threshold / grid.cell);
        const row = grid.row(y);
        const column = grid.column(x);
        for (let dr = -reach; dr <= reach; dr++) {
            for (let dc = -reach; dc <= reach; dc++) {
                // Keys past the first or last column alias into the
                // neighbouring row; that only adds candidates, each of
                // which is measured exactly.
                const bin = grid.bins.get(grid.key(row + dr, column + dc));
                if (!bin) {
                    continue;
                }
                for (const index of bin) {
                    const a = starts[index];
                    const b = ends[index];
                    const t = Math.max(0, Math.min(1, projectionParameter(x, y, a.x, a.y, b.x, b.y)));
                    const dx = x - (a.x + (b.x - a.x) * t);
                    const dy = y - (a.y + (b.y - a.y) * t);
                    if ((dx * dx) + (dy * dy) < thresholdSq) {
                        return false;
                    }
                }
            }
        }
        return true;
    };
}

function dedupeClosedLoop(points: Point2[]): Point2[] {
    const out: Point2[] = [];
    for (const point of points) {
        const previous = out[out.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6) {
            out.push(point);
        }
    }
    while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) {
        out.pop();
    }
    return out;
}
