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
 * This is only practical because the model is a field rather than a mesh:
 * the normal is the gradient, projection is Newton on the distance value,
 * and both are a GPU point query away.
 */

import { clamp } from './math';
import { heightMmToSdfY, type VaseSlicerSettings } from './config';
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
     * width, before it counts as hanging beside its neighbour rather than
     * resting on it. 1.0 is the natural pitch and disables the test.
     */
    maxBeadAdvance: number;
    /**
     * Rise per revolution, as a fraction of the bead height, below which the
     * surface counts as flat rather than merely shallow. This is what leaves
     * a flat top open: a flat face rises by nothing however far the front
     * walks across it, while a dome keeps climbing all the way to its pole.
     */
    minRiseFraction: number;
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
    let stopReason: string | null = null;
    // Winding, watched so a front that runs past a pole and turns itself
    // inside out is caught. Perimeter alone cannot say: a vase with a neck
    // narrows and widens again, and marching should follow it.
    let seedArea = signedContourArea(contour);

    for (let index = 0; index < options.maxContours; index++) {
        pushLayer(layers, contour, settings);
        onContour?.(index, contour);

        const perimeter = contourPerimeter(contour);
        // Converged onto a pole: what is left is smaller than the bead that
        // would close it.
        if (perimeter < nominalPitch(options) * 2) {
            break;
        }

        const stepped = stepContour(sampler, settings, contour, options);
        if (stepped.overhangPoints > contour.length * 0.05) {
            overhangContours++;
        }

        let next = prepareContour(stepped.contour, options);
        if (next.length < 3) {
            break;
        }
        // Smoothing pulls points off the surface, so it is followed by
        // another projection rather than being the last word.
        next = smoothClosedContourTaubin(next, 1);
        next = projectOntoSurface(sampler, settings, next, options, 1);

        const nextPerimeter = contourPerimeter(next);

        // Most of the revolution would hang beside its neighbour rather than
        // rest on it. This is only a reason to stop on a closing front: a
        // closing front lays each bead over the hollow interior, so nothing
        // will ever come along to hold it up, and a flat top cannot be
        // printed as a single wall on three axes. On an opening front - the
        // shallow base of a sphere - the model still has surface to follow,
        // and whether that base is printable is a question about the model
        // rather than about the march.
        if (nextPerimeter <= perimeter && stepped.unsupportedPoints * 2 > contour.length) {
            stopReason = `a revolution would advance more than ${(options.maxBeadAdvance * 100).toFixed(0)}% of a bead width sideways, so it would hang beside the one below rather than rest on it`;
            break;
        }

        // Past a pole the front has nowhere left to go and turns itself
        // inside out: the winding flips, or the loop starts growing again
        // after it had been closing.
        if (signedContourArea(next) * seedArea <= 0) {
            stopReason = 'the front turned itself inside out, which means it had already closed';
            break;
        }
        // A revolution that barely climbs is walking across a flat face, not
        // up a shallow one. That is the honest end of a single-wall print:
        // there is nothing under a flat top to print onto. A dome keeps
        // rising all the way to its pole, so this leaves it alone.
        const rise = averageHeight(next) - averageHeight(contour);
        if (rise < options.beadHeight * options.minRiseFraction) {
            stopReason = 'the surface went flat, so the top is left open';
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

interface SteppedContour {
    contour: SlicePoint[];
    /** Points whose step ran onto a downward-facing surface. */
    overhangPoints: number;
    /** Points whose new bead would not rest on the previous revolution. */
    unsupportedPoints: number;
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
    // exceeds the permitted share of a bead width the new bead has nothing
    // under it.
    const maxHorizontalAdvance = options.beadWidth * options.maxBeadAdvance;
    let overhangPoints = 0;
    let unsupportedPoints = 0;

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

        const pitch = surfacePitchFor(options, uy);
        if (pitch * Math.sqrt(Math.max(0, 1 - uy * uy)) > maxHorizontalAdvance) {
            unsupportedPoints++;
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
        unsupportedPoints,
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
 */
export function surfacePitchFor(options: SurfaceMarchOptions, uy: number): number {
    const a = Math.max(1e-9, options.beadWidth * 0.5);
    const b = Math.max(1e-9, options.beadHeight * 0.5);
    const sin = Math.min(1, Math.abs(uy));
    const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
    return 2 / Math.sqrt(((cos / a) * (cos / a)) + ((sin / b) * (sin / b)));
}

/** The smallest step the march can take; used for tolerances and stop tests. */
function nominalPitch(options: SurfaceMarchOptions): number {
    return Math.min(options.beadWidth, options.beadHeight);
}
