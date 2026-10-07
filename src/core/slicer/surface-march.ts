/**
 * Contours marched across the model surface instead of cut out of it by
 * planes.
 *
 * Planar slicing separates consecutive revolutions horizontally by
 * `layerHeight / tan(slope)`, which diverges as the surface flattens. On a
 * single-wall print there is no infill behind the wall, so past about 25
 * degrees of slope at a 0.2 mm layer height the revolutions simply stop
 * touching and the wall becomes a stack of rings. No layer height fixes
 * that: the quantity that fails is a ratio, and shrinking the numerator
 * never reaches zero.
 *
 * So the spacing is measured along the surface rather than up the Z axis.
 * Each contour is the previous one pushed one bead pitch "uphill" - tangent
 * to the surface, perpendicular to the contour - and projected back onto the
 * surface with Newton steps on the distance field. Consecutive revolutions
 * are then a bead apart at every slope, including zero, where the march
 * degenerates into a flat spiral and lays material side by side.
 *
 * A bead apart is not the same as a bead supported. The pitch below is the
 * distance at which two bead sections *touch*, which on a wall is also the
 * distance at which the new one *rests* on the last, because the last one is
 * underneath. On a downward-facing surface the same spacing puts the new bead
 * beside its neighbour at nearly the same height, over air, welded to it
 * along a sliver. So the step is additionally capped by how far it may move
 * sideways - `maxBeadAdvance` of a bead width - which forces the overlap the
 * weld needs. The march still follows the same surface; it just takes more,
 * shorter steps across the shallow parts of it, and lays proportionally less
 * material in each.
 *
 * This is only practical because the model is a field rather than a mesh:
 * the normal is the gradient, projection is Newton on the distance value,
 * and both are a GPU point query away.
 */

import { clamp } from './math';
import { getModelHeightMm, heightMmToSdfY, type VaseSlicerSettings } from './config';
import { contourPerimeter, dedupeClosedContour, signedContourArea } from './contours';
import { resampleClosedContour, smoothClosedContourTaubin } from './contour-postprocess';
import type { GpuFieldSampler } from './field-sampler-gpu';
import type { SliceContourLayer, SlicePoint } from './types';

export interface SurfaceMarchOptions {
    /**
     * Bead section in SDF units: `beadWidth` across the layer, `beadHeight`
     * between layers. The step taken is the distance at which two such
     * sections touch in the direction being stepped, so a vertical wall
     * advances by a layer height and a flat region by a line width - the
     * bead is always laid against the last one, whatever the slope.
     */
    beadWidth: number;
    beadHeight: number;
    /** Target spacing between contour points, in SDF units. */
    targetSegment: number;
    /** Hard cap on revolutions, so a front that never converges still ends. */
    maxContours: number;
    /** Newton projections applied after each step and after smoothing. */
    projectionIterations: number;
    /** Slope, in degrees below horizontal, that counts as an unsupported overhang. */
    overhangWarnDegrees: number;
    /**
     * How far a revolution may advance sideways, as a fraction of the bead
     * width. A step whose horizontal component would exceed this is shortened
     * until it does not, so the new bead keeps at least `1 - maxBeadAdvance`
     * of its width over the one below and has something to fuse to. 1.0 is
     * the natural pitch, where beads merely touch, and disables the clamp.
     */
    maxBeadAdvance: number;
    /**
     * Climb of a single step, as a fraction of the bead height, below which
     * that point counts as having stopped ascending. At the default bead this
     * is about one and a half degrees of slope - flat, not merely gentle.
     */
    minRiseFraction: number;
    /**
     * How near vertical a point's surface normal has to be, as its cosine,
     * for a step that no longer climbs to mean the front has walked onto the
     * top of the model.
     *
     * Both halves are needed. A step stops climbing wherever the front runs
     * along a surface rather than up it, which on a twisted shape happens all
     * over a perfectly printable wall - the contour there is far from level,
     * so "perpendicular to the contour, along the surface" points sideways.
     * What makes the top of a model different is that the surface under those
     * points faces up: they are standing on a shelf with nothing beyond it,
     * not on a wall they merely happen to be traversing.
     *
     * The same cosine, negated, marks the opposite case: a step that no
     * longer climbs on a surface facing *down* means the front has walked
     * out under an overhang and is laying beads beside each other over
     * air. A sloped underside is not this - there the step still rises, and
     * the sideways clamp keeps each bead half on the one before - so a
     * sphere's lower half marches on, and only a shelf stops it.
     */
    flatTopNormal: number;
    /**
     * Share of a revolution that has to reach the top of the model before the
     * march stops. Measured per point rather than as an average climb,
     * because a front meeting a flat top rolls over the rim a few points at a
     * time: by the time the mean has collapsed, several revolutions have
     * already crept inward across the top face, each one raggedly, since
     * which points crossed first is down to millimetre-scale wobble in the
     * front. The fraction is what keeps a lone horizontal patch - a ledge, a
     * noise crater - from ending an otherwise healthy march.
     */
    flatTopFraction: number;
    /**
     * Widest opening, in SDF units, that the march will spiral shut without
     * asking whether the surface is still rising. A front converging onto a
     * pole goes horizontal too - not because the face went flat but because
     * there is hardly any face left - and closing the last few millimetres
     * over air is what every vase-mode top does.
     */
    maxBridgedOpening: number;
}

export interface SurfaceMarchResult {
    layers: SliceContourLayer[];
    warnings: string[];
}

export function defaultSurfaceMarchOptions(settings: VaseSlicerSettings): SurfaceMarchOptions {
    const scale = Math.max(1e-6, settings.modelScale);
    return {
        beadWidth: settings.lineWidth / scale,
        beadHeight: settings.layerHeight / scale,
        targetSegment: settings.targetSegmentMm / scale,
        maxContours: 20000,
        projectionIterations: 3,
        overhangWarnDegrees: 5,
        maxBeadAdvance: settings.surfaceMaxBeadAdvance,
        minRiseFraction: 0.05,
        flatTopNormal: 0.9,
        flatTopFraction: 0.1,
        maxBridgedOpening: (settings.lineWidth * 8) / scale,
    };
}

/**
 * @param seed a closed contour already lying on the surface - normally the
 *        planar cross-section at the first layer height, which is where the
 *        model meets the bed.
 */
export function marchSurfaceContours(
    sampler: GpuFieldSampler,
    settings: VaseSlicerSettings,
    seed: SlicePoint[],
    options: SurfaceMarchOptions,
    onContour?: (index: number, contour: SlicePoint[]) => void,
): SurfaceMarchResult {
    const warnings: string[] = [];
    const layers: SliceContourLayer[] = [];

    let contour = prepareContour(seed, options);
    if (contour.length < 3) {
        throw new Error('Surface marching needs a seed contour of at least three points.');
    }

    // The step direction is normal x tangent, whose sign follows the
    // contour's winding. Fixing the winding once at the seed - where the
    // surface is reliably rising - keeps every later step pointing the same
    // way, including across the poles where "uphill" is nearly horizontal
    // and a per-step upward test would be ill-conditioned.
    contour = orientContourForAscent(sampler, settings, contour, options);

    let overhangContours = 0;
    let foldedContours = 0;
    let stopReason: string | null = null;
    // Winding, watched so a front that runs past a pole and turns itself
    // inside out is caught. Perimeter alone cannot say: a vase with a neck
    // narrows and widens again, and marching should follow it.
    let seedArea = signedContourArea(contour);
    const convergedPerimeter = 2 * Math.PI * options.beadWidth * options.maxBeadAdvance;
    // Planar slicing stops at the slice window or the printer's height,
    // whichever is lower; a march has to be told the same, or a model that
    // runs out through the top of the window climbs until the revolution cap.
    // Half a bead of slack, so a pole sitting exactly on the window's top
    // still closes instead of being cut a step short by projection noise.
    const ceilingY = heightMmToSdfY(getModelHeightMm(settings), settings) + (options.beadHeight * 0.5);

    for (let index = 0; index < options.maxContours; index++) {
        pushLayer(layers, contour, settings);
        onContour?.(index, contour);

        const perimeter = contourPerimeter(contour);
        // Converged onto a pole. The test has to be the step size, not some
        // vanishing epsilon: a front whose radius is already under one step
        // lands past the centre and turns itself inside out. Near a pole the
        // surface is shallow, so the step is whatever the sideways clamp
        // allows - and the test has to follow it down, or a clamped march
        // stops a step or two short and leaves a pinhole where a full-bead
        // one closed. What is left when this fires is a hole under a step
        // across, which the last revolution's own width covers.
        if (perimeter <= convergedPerimeter) {
            break;
        }

        const stepped = stepContour(sampler, settings, contour, options);
        if (stepped.overhangPoints > contour.length * 0.05) {
            overhangContours++;
        }

        // Part of the revolution has reached the top of the model and is
        // walking inward across it. That is the honest end of a single-wall
        // print: there is nothing under a flat top to print onto, and
        // continuing lays bead after bead out over the hollow.
        //
        // Except when there is hardly any opening left. A front converging
        // onto a pole goes horizontal for a different reason, and refusing to
        // close the last few millimetres would leave a dome with a hole in it
        // for no better reason than a flat top has.
        if (stepped.flatTopPoints > contour.length * options.flatTopFraction
            && perimeter / Math.PI > options.maxBridgedOpening) {
            stopReason = 'the surface went flat, so the top is left open';
            break;
        }
        // The mirror image: part of the revolution has walked out under a
        // flat underside. Nothing converges there - the march only climbs -
        // so there is no small-opening exception to make.
        if (stepped.undersidePoints > contour.length * options.flatTopFraction) {
            stopReason = 'the surface turned to face down, and there is nothing under it to print onto';
            break;
        }

        // Where the front curves towards its own step more tightly than the
        // step is long, neighbouring points cross and the front folds over
        // itself. Resampling would spread the fold's points out and carry it
        // along as a tangle; it is cut out here, before that.
        const trimmed = trimFrontFolds(stepped.contour, options);
        if (trimmed.folds > 0) {
            foldedContours++;
        }

        let next = prepareContour(trimmed.contour, options);
        if (next.length < 3) {
            break;
        }
        // Smoothing pulls points off the surface, so it is followed by
        // another projection rather than being the last word.
        next = smoothClosedContourTaubin(next, 1);
        next = projectOntoSurface(sampler, settings, next, options, 1);

        if (maxHeight(next) > ceilingY) {
            stopReason = 'the front reached the top of the slice window';
            break;
        }

        // Past a pole the front has nowhere left to go and turns itself
        // inside out: the winding flips, or the loop starts growing again
        // after it had been closing.
        //
        // On an opening already down to about a step this is the convergence
        // test above arriving a revolution late - the front landed past the
        // centre instead of inside the threshold - so it closed rather than
        // failed, and saying so would be a warning about a print that came
        // out right. Wider than that and the front really did run away.
        if (signedContourArea(next) * seedArea <= 0) {
            if (perimeter > convergedPerimeter * 3) {
                stopReason = 'the front turned itself inside out, which means it had already closed';
            }
            break;
        }

        seedArea = signedContourArea(next);
        contour = next;
    }

    if (layers.length >= options.maxContours) {
        warnings.push(`Surface marching hit its ${options.maxContours}-revolution cap before converging.`);
    } else if (stopReason) {
        warnings.push(`Surface marching stopped after ${layers.length} revolutions: ${stopReason}.`);
    }
    if (overhangContours > 0) {
        warnings.push(`${overhangContours} revolution${overhangContours === 1 ? '' : 's'} march onto a downward-facing surface, which has nothing beneath it to print onto.`);
    }
    if (foldedContours > 0) {
        warnings.push(`${foldedContours} revolution${foldedContours === 1 ? '' : 's'} folded over at a concave part of the surface; the folds were trimmed, so the bead spacing there is wider than the march intended.`);
    }

    return { layers, warnings };
}

function pushLayer(layers: SliceContourLayer[], contour: SlicePoint[], settings: VaseSlicerSettings): void {
    const meanY = averageHeight(contour);
    layers.push({
        sampleY: meanY,
        contour: contour.map((point) => ({ ...point })),
        printHeightMm: (meanY - settings.minY) * settings.modelScale,
    });
}

function prepareContour(contour: SlicePoint[], options: SurfaceMarchOptions): SlicePoint[] {
    const deduped = dedupeClosedContour(contour);
    if (deduped.length < 3) {
        return deduped;
    }
    // Point count follows the contour's own length, so a shrinking front near
    // a pole does not carry a fixed budget of points into a 1 mm loop.
    const count = clamp(Math.round(contourPerimeter(deduped) / options.targetSegment), 12, 4096);
    return resampleClosedContour(deduped, count);
}

/**
 * Cuts the small loops a stepped front makes wherever it curves towards its
 * own step - the swallowtails of an offset curve. Each point moves along
 * its own uphill direction, and where the front is concave those
 * directions converge; once the step is longer than the local radius of
 * curvature, neighbouring points pass each other and the polyline runs
 * through itself. Left alone, every later revolution inherits the loop and
 * prints it as a stitch of back-and-forth beads.
 *
 * The front lies on the surface, so a crossing is a pair of segments that
 * come within a hair of each other in three dimensions - no projection
 * plane is needed, and the test is the same on a vertical wall as across a
 * pole. Only nearby pairs are compared, since a fold is local: the loop
 * between the two crossing segments is dropped and the front rejoined
 * across the gap. A tolerance well under a segment keeps a genuinely sharp
 * concave corner, where segments draw close but never meet, out of it.
 *
 * What is cut is material the front would have laid twice. The bead spacing
 * across the trimmed gap is wider than one step, which is the usual price
 * of offsetting a concave curve and is reported as such.
 */
export function trimFrontFolds(contour: SlicePoint[], options: SurfaceMarchOptions): { contour: SlicePoint[]; folds: number } {
    const count = contour.length;
    if (count < 6) {
        return { contour, folds: 0 };
    }

    // A fold spans at most a few bead widths of the front: anything larger
    // is not a swallowtail but the whole loop turning inside out, which the
    // winding test handles.
    const window = Math.min(
        Math.floor((count - 1) / 2),
        clamp(Math.round((options.beadWidth * 24) / options.targetSegment), 8, 256),
    );
    const toleranceSq = (options.targetSegment * 0.1) ** 2;
    const removed = new Uint8Array(count);
    let folds = 0;

    for (let i = 0; i < count; i++) {
        if (removed[i]) {
            continue;
        }
        const a0 = contour[i];
        const a1 = contour[(i + 1) % count];
        // Ascending gap, so the first hit is the smallest loop through this
        // segment. Gap 1 shares a vertex and is skipped.
        for (let gap = 2; gap <= window; gap++) {
            const j = (i + gap) % count;
            const b0 = contour[j];
            const b1 = contour[(j + 1) % count];
            if (segmentDistanceSq(a0, a1, b0, b1) > toleranceSq) {
                continue;
            }
            for (let k = 1; k <= gap; k++) {
                removed[(i + k) % count] = 1;
            }
            folds++;
            break;
        }
    }

    if (folds === 0) {
        return { contour, folds: 0 };
    }

    const kept: SlicePoint[] = [];
    for (let i = 0; i < count; i++) {
        if (!removed[i]) {
            kept.push(contour[i]);
        }
    }
    // Trimming more than half the front means it is not folds being cut but
    // the front itself; leave it to the global tests rather than guess.
    if (kept.length < Math.max(3, count / 2)) {
        return { contour, folds: 0 };
    }
    return { contour: kept, folds };
}

/** Squared distance between the closest points of two segments (Ericson, 5.1.9). */
function segmentDistanceSq(p1: SlicePoint, q1: SlicePoint, p2: SlicePoint, q2: SlicePoint): number {
    const d1x = q1.x - p1.x; const d1y = q1.y - p1.y; const d1z = q1.z - p1.z;
    const d2x = q2.x - p2.x; const d2y = q2.y - p2.y; const d2z = q2.z - p2.z;
    const rx = p1.x - p2.x; const ry = p1.y - p2.y; const rz = p1.z - p2.z;
    const a = (d1x * d1x) + (d1y * d1y) + (d1z * d1z);
    const e = (d2x * d2x) + (d2y * d2y) + (d2z * d2z);
    const f = (d2x * rx) + (d2y * ry) + (d2z * rz);
    const epsilon = 1e-24;

    let s = 0;
    let t = 0;
    if (a <= epsilon && e <= epsilon) {
        return (rx * rx) + (ry * ry) + (rz * rz);
    }
    if (a <= epsilon) {
        t = clamp(f / e, 0, 1);
    } else {
        const c = (d1x * rx) + (d1y * ry) + (d1z * rz);
        if (e <= epsilon) {
            s = clamp(-c / a, 0, 1);
        } else {
            const b = (d1x * d2x) + (d1y * d2y) + (d1z * d2z);
            const denominator = (a * e) - (b * b);
            s = denominator !== 0 ? clamp(((b * f) - (c * e)) / denominator, 0, 1) : 0;
            t = ((b * s) + f) / e;
            if (t < 0) {
                t = 0;
                s = clamp(-c / a, 0, 1);
            } else if (t > 1) {
                t = 1;
                s = clamp((b - c) / a, 0, 1);
            }
        }
    }

    const cx = (p1.x + (d1x * s)) - (p2.x + (d2x * t));
    const cy = (p1.y + (d1y * s)) - (p2.y + (d2y * t));
    const cz = (p1.z + (d1z * s)) - (p2.z + (d2z * t));
    return (cx * cx) + (cy * cy) + (cz * cz);
}

interface SteppedContour {
    contour: SlicePoint[];
    /** Points whose step ran onto a downward-facing surface. */
    overhangPoints: number;
    /** Points that stopped climbing on an upward-facing surface. */
    flatTopPoints: number;
    /** Points that stopped climbing on a downward-facing surface. */
    undersidePoints: number;
}

function stepContour(
    sampler: GpuFieldSampler,
    settings: VaseSlicerSettings,
    contour: SlicePoint[],
    options: SurfaceMarchOptions,
): SteppedContour {
    const normals = sampleSurfaceNormals(sampler, settings, contour, options);
    const stepped: SlicePoint[] = new Array(contour.length);
    const overhangLimit = -Math.sin((options.overhangWarnDegrees * Math.PI) / 180);
    // A revolution advances horizontally by pitch * cos(slope); once that
    // exceeds the permitted share of a bead width the new bead hangs beside
    // the last one instead of sitting on it, so the step is shortened until
    // it does not.
    const maxHorizontalAdvance = options.beadWidth * options.maxBeadAdvance;
    const minRise = options.beadHeight * options.minRiseFraction;
    let overhangPoints = 0;
    let flatTopPoints = 0;
    let undersidePoints = 0;

    for (let i = 0; i < contour.length; i++) {
        const point = contour[i];
        const previous = contour[(i - 1 + contour.length) % contour.length];
        const next = contour[(i + 1) % contour.length];

        let tx = next.x - previous.x;
        let ty = next.y - previous.y;
        let tz = next.z - previous.z;
        const tangentLength = Math.hypot(tx, ty, tz);
        if (tangentLength < 1e-12) {
            stepped[i] = { ...point };
            continue;
        }
        tx /= tangentLength; ty /= tangentLength; tz /= tangentLength;

        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];

        // Uphill on the surface: perpendicular to both the surface normal and
        // the contour, so it stays on the surface and leaves the contour.
        let ux = (ny * tz) - (nz * ty);
        let uy = (nz * tx) - (nx * tz);
        let uz = (nx * ty) - (ny * tx);
        const upLength = Math.hypot(ux, uy, uz);
        if (upLength < 1e-9) {
            stepped[i] = { ...point };
            continue;
        }
        ux /= upLength; uy /= upLength; uz /= upLength;

        if (uy < overhangLimit) {
            overhangPoints++;
        }

        // Two pitches. `natural` is the distance at which the bead sections
        // touch, and it is what the stop tests read: whether the surface is
        // still rising is a question about the surface, and must not change
        // just because the step across it was shortened. `pitch` is what the
        // front actually moves - `natural` capped so the sideways component
        // leaves the required overlap on the revolution below.
        const natural = surfacePitchFor(options.beadWidth, options.beadHeight, uy);
        const horizontal = Math.sqrt(Math.max(0, 1 - uy * uy));
        const pitch = horizontal * natural > maxHorizontalAdvance
            ? maxHorizontalAdvance / horizontal
            : natural;
        if (uy * natural < minRise) {
            if (ny > options.flatTopNormal) {
                flatTopPoints++;
            } else if (ny < -options.flatTopNormal) {
                undersidePoints++;
            }
        }
        stepped[i] = {
            x: point.x + ux * pitch,
            y: point.y + uy * pitch,
            z: point.z + uz * pitch,
        };
    }

    return {
        contour: projectOntoSurface(sampler, settings, stepped, options, options.projectionIterations),
        overhangPoints,
        flatTopPoints,
        undersidePoints,
    };
}

/**
 * Newton on the distance field: a point off the surface is `f` away along the
 * gradient, so subtracting `f * grad / |grad|^2` lands on it. Two or three
 * passes converge to well under a micron for a sane SDF.
 */
function projectOntoSurface(
    sampler: GpuFieldSampler,
    settings: VaseSlicerSettings,
    contour: SlicePoint[],
    options: SurfaceMarchOptions,
    iterations: number,
): SlicePoint[] {
    let current = contour;
    for (let pass = 0; pass < iterations; pass++) {
        const gradients = sampleGradients(sampler, settings, current, options);
        const moved: SlicePoint[] = new Array(current.length);
        for (let i = 0; i < current.length; i++) {
            const point = current[i];
            const gx = gradients.gradient[i * 3];
            const gy = gradients.gradient[i * 3 + 1];
            const gz = gradients.gradient[i * 3 + 2];
            const lengthSq = (gx * gx) + (gy * gy) + (gz * gz);
            if (lengthSq < 1e-18) {
                moved[i] = { ...point };
                continue;
            }
            const step = gradients.distance[i] / lengthSq;
            moved[i] = {
                x: point.x - gx * step,
                y: point.y - gy * step,
                z: point.z - gz * step,
            };
        }
        current = moved;
    }
    return current;
}

function sampleSurfaceNormals(
    sampler: GpuFieldSampler,
    settings: VaseSlicerSettings,
    contour: SlicePoint[],
    options: SurfaceMarchOptions,
): Float32Array {
    const { gradient } = sampleGradients(sampler, settings, contour, options);
    for (let i = 0; i < contour.length; i++) {
        const gx = gradient[i * 3];
        const gy = gradient[i * 3 + 1];
        const gz = gradient[i * 3 + 2];
        const length = Math.hypot(gx, gy, gz);
        if (length > 1e-12) {
            gradient[i * 3] = gx / length;
            gradient[i * 3 + 1] = gy / length;
            gradient[i * 3 + 2] = gz / length;
        } else {
            gradient[i * 3] = 0;
            gradient[i * 3 + 1] = 1;
            gradient[i * 3 + 2] = 0;
        }
    }
    return gradient;
}

/** Tetrahedral offsets: gradient and value from four samples per point. */
const TETRAHEDRON: ReadonlyArray<readonly [number, number, number]> = [
    [1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, 1],
];

function sampleGradients(
    sampler: GpuFieldSampler,
    settings: VaseSlicerSettings,
    contour: SlicePoint[],
    options: SurfaceMarchOptions,
): { gradient: Float32Array; distance: Float32Array } {
    const count = contour.length;
    const h = nominalPitch(options) * 0.05;
    const probes = new Float32Array(count * TETRAHEDRON.length * 3);

    for (let i = 0; i < count; i++) {
        const point = contour[i];
        for (let k = 0; k < TETRAHEDRON.length; k++) {
            const offset = (i * TETRAHEDRON.length + k) * 3;
            probes[offset] = point.x + TETRAHEDRON[k][0] * h;
            probes[offset + 1] = point.y + TETRAHEDRON[k][1] * h;
            probes[offset + 2] = point.z + TETRAHEDRON[k][2] * h;
        }
    }

    // The encoding window tracks the step size, so resolution stays fine
    // where the front actually is rather than being spent on distant space.
    const range = Math.max(options.beadWidth * 8, h * 16);
    const sampled = sampler.sampleSceneDistances(probes, count * TETRAHEDRON.length, settings, range);

    const gradient = new Float32Array(count * 3);
    const distance = new Float32Array(count);
    // The tetrahedral sum of k_i * f(p + h k_i) comes to 4h times the
    // gradient, because sum(k_i k_i^T) is 4I for these four vectors. Newton
    // divides by |grad|^2, so leaving the 4h in would scale every projection
    // step by 1/4h - a factor of several hundred at a sane probe radius.
    const gradientScale = 1 / (4 * h);
    for (let i = 0; i < count; i++) {
        let gx = 0;
        let gy = 0;
        let gz = 0;
        let mean = 0;
        for (let k = 0; k < TETRAHEDRON.length; k++) {
            const value = sampled[i * TETRAHEDRON.length + k];
            gx += TETRAHEDRON[k][0] * value;
            gy += TETRAHEDRON[k][1] * value;
            gz += TETRAHEDRON[k][2] * value;
            mean += value;
        }
        gradient[i * 3] = gx * gradientScale;
        gradient[i * 3 + 1] = gy * gradientScale;
        gradient[i * 3 + 2] = gz * gradientScale;
        // The tetrahedron's mean is the value at the centre to second order.
        distance[i] = mean / TETRAHEDRON.length;
    }

    return { gradient, distance };
}

function orientContourForAscent(
    sampler: GpuFieldSampler,
    settings: VaseSlicerSettings,
    contour: SlicePoint[],
    options: SurfaceMarchOptions,
): SlicePoint[] {
    const stepped = stepContour(sampler, settings, contour, options);
    return averageHeight(stepped.contour) >= averageHeight(contour)
        ? contour
        : contour.slice().reverse();
}

function maxHeight(contour: SlicePoint[]): number {
    let highest = Number.NEGATIVE_INFINITY;
    for (const point of contour) {
        highest = Math.max(highest, point.y);
    }
    return highest;
}

function averageHeight(contour: SlicePoint[]): number {
    if (contour.length === 0) {
        return 0;
    }
    let total = 0;
    for (const point of contour) {
        total += point.y;
    }
    return total / contour.length;
}

/**
 * Height of the seed contour: the first layer's deposit height, which is
 * where the model meets the bed.
 */
export function surfaceSeedHeight(settings: VaseSlicerSettings): number {
    return heightMmToSdfY(settings.layerHeight, settings);
}

/**
 * Centre distance at which two bead sections touch when offset in a
 * direction whose vertical component is `uy` (a unit vector's elevation).
 * Width and height are passed in rather than read off the march options
 * because the toolpath builder asks the same question in millimetres.
 */
export function surfacePitchFor(beadWidth: number, beadHeight: number, uy: number): number {
    const a = Math.max(1e-9, beadWidth * 0.5);
    const b = Math.max(1e-9, beadHeight * 0.5);
    const sin = Math.min(1, Math.abs(uy));
    const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
    return 2 / Math.sqrt(((cos / a) * (cos / a)) + ((sin / b) * (sin / b)));
}

/** The smallest step the march can take; used for tolerances and stop tests. */
function nominalPitch(options: SurfaceMarchOptions): number {
    return Math.min(options.beadWidth, options.beadHeight);
}
