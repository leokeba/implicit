import { clampInt, lerp } from './math';
import { heightMmToSdfY, type VaseSlicerSettings } from './config';
import type { SliceContourLayer, SlicePoint } from './types';
import { contourPerimeter, dedupeClosedContour } from './contours';

/**
 * Post-processing of raw extracted contours into printable layers: density
 * resampling, Taubin smoothing, seam alignment across layers, and adaptive
 * layer-height decimation. Pure geometry — independent of how the contours
 * were sampled or extracted.
 */

export interface FinalizedContourLayers {
    layers: SliceContourLayer[];
    warnings: string[];
    /** Contour point count derived from targetSegmentMm and the largest layer perimeter. */
    pointsPerLayer: number;
}

/**
 * Turns raw per-layer contours into printable layers. Derives the per-layer
 * point count from the largest perimeter (single quality knob: segments come
 * out near targetSegmentMm on every layer) and returns it so the caller can
 * propagate it to downstream consumers and G-code metadata.
 */
export function finalizeContourLayers(
    rawLayers: SliceContourLayer[],
    settings: VaseSlicerSettings,
    initialWarnings: string[],
): FinalizedContourLayers {
    let warnings = initialWarnings;
    if (rawLayers.length < 2) {
        throw new Error('Contour sampling produced too few valid slices (need at least 2 layers).');
    }

    let maxPerimeterMm = 0;
    for (const layer of rawLayers) {
        maxPerimeterMm = Math.max(maxPerimeterMm, contourPerimeter(layer.contour) * settings.modelScale);
    }
    const pointsPerLayer = clampInt(Math.ceil(maxPerimeterMm / settings.targetSegmentMm), 48, 4096);

    // Planar slicing samples the field at the middle of a layer but deposits
    // the bead at its top, so the contour's own height is rewritten here from
    // sample height to deposit height. Every point of a layer gets the same
    // one; that flatness is what makes these layers planar, and it is the
    // only thing a surface-marched contour would do differently.
    const layers: SliceContourLayer[] = rawLayers.map((layer, index) => {
        const printHeightMm = settings.layerHeight * (index + 1);
        const depositY = heightMmToSdfY(printHeightMm, settings);
        const contour = buildPrintableContour(layer.contour, pointsPerLayer);
        for (const point of contour) {
            point.y = depositY;
        }
        return { sampleY: layer.sampleY, contour, printHeightMm };
    });

    if (settings.enableContourAlignment) {
        alignContourLayers(layers);
    }

    const adaptiveLayers = decimateContourLayersForAdaptiveHeight(layers, settings);
    if (adaptiveLayers.length < layers.length) {
        warnings = [...warnings, `Adaptive layer height merged ${layers.length - adaptiveLayers.length} of ${layers.length} layers (max ${settings.maxLayerHeightMm.toFixed(2)} mm).`];
    }

    return { layers: adaptiveLayers, warnings, pointsPerLayer };
}

/**
 * Finalizes contours that already lie on the surface with their own heights.
 *
 * Unlike the planar path this must not touch `y`: the marched contour's
 * height *is* the geometry. All it does is give every revolution the same
 * point count - which the spiral builder needs to blend them index by index -
 * and align the seams.
 */
export function finalizeMarchedContourLayers(
    marchedLayers: SliceContourLayer[],
    settings: VaseSlicerSettings,
    initialWarnings: string[],
): FinalizedContourLayers {
    if (marchedLayers.length < 2) {
        throw new Error('Surface marching produced too few revolutions (need at least 2).');
    }

    let maxPerimeterMm = 0;
    for (const layer of marchedLayers) {
        maxPerimeterMm = Math.max(maxPerimeterMm, contourPerimeter(layer.contour) * settings.modelScale);
    }
    const pointsPerLayer = clampInt(Math.ceil(maxPerimeterMm / settings.targetSegmentMm), 48, 4096);

    const layers: SliceContourLayer[] = marchedLayers.map((layer) => ({
        sampleY: layer.sampleY,
        contour: resampleClosedContour(dedupeClosedContour(layer.contour), pointsPerLayer),
        printHeightMm: layer.printHeightMm,
    }));

    if (settings.enableContourAlignment) {
        alignContourLayers(layers);
    }

    return { layers, warnings: initialWarnings, pointsPerLayer };
}

export function buildPrintableContour(contour: SlicePoint[], pointsPerLayer: number): SlicePoint[] {
    const denseCount = clampInt(
        Math.max(pointsPerLayer, contour.length * 2),
        pointsPerLayer,
        4096,
    );
    const denseContour = resampleClosedContour(contour, denseCount);
    const smoothedContour = smoothClosedContourTaubin(denseContour, 2);
    return resampleClosedContour(smoothedContour, pointsPerLayer);
}

export function resampleClosedContour(points: SlicePoint[], count: number): SlicePoint[] {
    const source = dedupeClosedContour(points);
    if (source.length < 3) {
        return source;
    }

    const perimeter = contourPerimeter(source);
    if (perimeter <= 1e-8) {
        return source;
    }

    const cumulative: number[] = [0];
    for (let i = 0; i < source.length; i++) {
        const current = source[i];
        const next = source[(i + 1) % source.length];
        cumulative.push(cumulative[cumulative.length - 1] + Math.hypot(next.x - current.x, next.y - current.y, next.z - current.z));
    }

    const resampled: SlicePoint[] = [];
    let segmentIndex = 0;
    for (let i = 0; i < count; i++) {
        const targetDistance = (perimeter * i) / count;
        while (segmentIndex < source.length - 1 && cumulative[segmentIndex + 1] < targetDistance) {
            segmentIndex++;
        }

        const segmentStart = source[segmentIndex % source.length];
        const segmentEnd = source[(segmentIndex + 1) % source.length];
        const segmentLength = cumulative[segmentIndex + 1] - cumulative[segmentIndex];
        const localT = segmentLength <= 1e-8 ? 0 : (targetDistance - cumulative[segmentIndex]) / segmentLength;
        resampled.push({
            x: lerp(segmentStart.x, segmentEnd.x, localT),
            y: lerp(segmentStart.y, segmentEnd.y, localT),
            z: lerp(segmentStart.z, segmentEnd.z, localT),
        });
    }

    return resampled;
}

export function smoothClosedContourTaubin(points: SlicePoint[], iterations: number): SlicePoint[] {
    let current = dedupeClosedContour(points);
    if (current.length < 4 || iterations <= 0) {
        return current;
    }

    for (let iteration = 0; iteration < iterations; iteration++) {
        current = smoothClosedContourPass(current, 0.45);
        current = smoothClosedContourPass(current, -0.47);
    }

    return current;
}

function smoothClosedContourPass(points: SlicePoint[], factor: number): SlicePoint[] {
    const smoothed: SlicePoint[] = [];
    for (let index = 0; index < points.length; index++) {
        const previous = points[(index - 1 + points.length) % points.length];
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const laplacianX = 0.5 * (previous.x + next.x) - current.x;
        const laplacianY = 0.5 * (previous.y + next.y) - current.y;
        const laplacianZ = 0.5 * (previous.z + next.z) - current.z;
        smoothed.push({
            x: current.x + laplacianX * factor,
            y: current.y + laplacianY * factor,
            z: current.z + laplacianZ * factor,
        });
    }

    return smoothed;
}

/** Anchor layer 0's seam, then rotate each layer to track the seam below it. */
export function alignContourLayers(layers: SliceContourLayer[]): void {
    if (layers.length === 0) {
        return;
    }

    layers[0].contour = anchorContourStart(layers[0].contour);
    let previousShift = 0;
    for (let layerIndex = 1; layerIndex < layers.length; layerIndex++) {
        const previous = layers[layerIndex - 1].contour;
        const next = layers[layerIndex].contour;
        const shift = findBestContourShift(previous, next, previousShift);
        layers[layerIndex].contour = rotateContour(next, shift);
        previousShift = shift;
    }
}

/**
 * Greedy vertical decimation for adaptive layer heights: consecutive
 * contours are merged into one thicker revolution wherever the helix's
 * linear interpolation reproduces the dropped contours within a fraction of
 * a line width. Flat bottom layers (plus their helix anchor) are protected.
 */
export function decimateContourLayersForAdaptiveHeight(
    layers: SliceContourLayer[],
    settings: VaseSlicerSettings,
): SliceContourLayer[] {
    const maxThickness = settings.maxLayerHeightMm;
    if (maxThickness <= settings.layerHeight + 1e-6) {
        return layers;
    }

    const protectedCount = Math.max(1, Math.min(settings.bottomLayers, layers.length - 1));
    if (layers.length <= protectedCount + 2) {
        return layers;
    }

    const toleranceUnits = (settings.lineWidth * 0.2) / Math.max(settings.modelScale, 1e-6);
    const kept: SliceContourLayer[] = layers.slice(0, protectedCount);
    let anchor = protectedCount - 1;

    while (anchor < layers.length - 1) {
        let end = anchor + 1;
        while (end + 1 < layers.length) {
            const next = end + 1;
            const anchorHeight = layers[anchor].printHeightMm ?? 0;
            const nextHeight = layers[next].printHeightMm ?? 0;
            if (nextHeight - anchorHeight > maxThickness + 1e-9) {
                break;
            }
            if (!contourRunWithinTolerance(layers, anchor, next, toleranceUnits)) {
                break;
            }
            end = next;
        }
        kept.push(layers[end]);
        anchor = end;
    }

    return kept;
}

/** True when every contour strictly between a and b lies within tolerance of the a->b interpolation. */
function contourRunWithinTolerance(
    layers: SliceContourLayer[],
    a: number,
    b: number,
    toleranceUnits: number,
): boolean {
    const heightA = layers[a].printHeightMm ?? 0;
    const heightB = layers[b].printHeightMm ?? 0;
    const span = heightB - heightA;
    if (span <= 1e-9) {
        return false;
    }

    const contourA = layers[a].contour;
    const contourB = layers[b].contour;
    const toleranceSq = toleranceUnits * toleranceUnits;
    for (let j = a + 1; j < b; j++) {
        const contourJ = layers[j].contour;
        if (contourJ.length !== contourA.length || contourB.length !== contourA.length) {
            return false;
        }
        const t = ((layers[j].printHeightMm ?? 0) - heightA) / span;
        const stride = Math.max(1, Math.floor(contourJ.length / 96));
        for (let k = 0; k < contourJ.length; k += stride) {
            const x = lerp(contourA[k].x, contourB[k].x, t);
            const z = lerp(contourA[k].z, contourB[k].z, t);
            const dx = contourJ[k].x - x;
            const dz = contourJ[k].z - z;
            if ((dx * dx) + (dz * dz) > toleranceSq) {
                return false;
            }
        }
    }
    return true;
}

function anchorContourStart(points: SlicePoint[]): SlicePoint[] {
    if (points.length === 0) {
        return points;
    }

    let anchorIndex = 0;
    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        const anchor = points[anchorIndex];
        if (point.x > anchor.x || (point.x === anchor.x && point.z > anchor.z)) {
            anchorIndex = i;
        }
    }

    return rotateContour(points, anchorIndex);
}

function rotateContour(points: SlicePoint[], shift: number): SlicePoint[] {
    if (points.length === 0) {
        return points;
    }

    const normalizedShift = ((shift % points.length) + points.length) % points.length;
    return points.map((_, index) => points[(index + normalizedShift) % points.length]);
}

function findBestContourShift(previous: SlicePoint[], next: SlicePoint[], seedShift = 0): number {
    if (previous.length === 0 || next.length === 0 || previous.length !== next.length) {
        return 0;
    }

    const localSampleStride = Math.max(1, Math.floor(previous.length / 64));
    const localRadius = Math.max(8, Math.floor(previous.length / 24));
    const normalizedSeed = normalizeContourShift(seedShift, next.length);

    let bestShift = normalizedSeed;
    let bestScore = scoreContourShift(previous, next, normalizedSeed, localSampleStride);

    for (let delta = -localRadius; delta <= localRadius; delta++) {
        const shift = normalizeContourShift(normalizedSeed + delta, next.length);
        const score = scoreContourShift(previous, next, shift, localSampleStride);
        if (score < bestScore) {
            bestScore = score;
            bestShift = shift;
        }
    }

    const averageSpacing = contourPerimeter(previous) / Math.max(1, previous.length);
    const averageScore = bestScore / Math.ceil(previous.length / localSampleStride);
    if (averageScore <= averageSpacing * 3.0) {
        return bestShift;
    }

    const coarseSampleStride = Math.max(1, Math.floor(previous.length / 96));
    const coarseStride = Math.max(1, Math.floor(previous.length / 48));
    bestScore = Number.POSITIVE_INFINITY;

    for (let shift = 0; shift < next.length; shift += coarseStride) {
        const score = scoreContourShift(previous, next, shift, coarseSampleStride);
        if (score < bestScore) {
            bestScore = score;
            bestShift = shift;
        }
    }

    for (let delta = -coarseStride; delta <= coarseStride; delta++) {
        const shift = normalizeContourShift(bestShift + delta, next.length);
        const score = scoreContourShift(previous, next, shift, coarseSampleStride);
        if (score < bestScore) {
            bestScore = score;
            bestShift = shift;
        }
    }

    return bestShift;
}

function scoreContourShift(previous: SlicePoint[], next: SlicePoint[], shift: number, stride: number): number {
    let score = 0;
    for (let index = 0; index < previous.length; index += stride) {
        const a = previous[index];
        const b = next[(index + shift) % next.length];
        score += Math.hypot(a.x - b.x, a.z - b.z);
    }
    return score;
}

function normalizeContourShift(shift: number, length: number): number {
    return ((shift % length) + length) % length;
}
