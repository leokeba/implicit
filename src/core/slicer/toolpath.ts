import { clamp, distance3, lerp, pointLineDistance3, turnAngleDegrees } from './math';
import type { VaseSlicerSettings } from './config';
import type { SliceContourLayer, SlicePoint, ToolpathPoint, VaseBaseToolpath } from './types';

/**
 * Spiral toolpath construction and refinement from finalized contour layers.
 * Pure geometry over settings + contours; sampling and G-code emission live
 * in their own modules.
 */

/** Build the base spiral for the configured slicer mode. */
export function buildSpiralBaseToolpath(
    contourLayers: SliceContourLayer[],
    settings: VaseSlicerSettings,
): VaseBaseToolpath {
    return settings.slicerMode === 'cylindrical'
        ? buildCylindricalSpiralBaseToolpath(contourLayers, settings)
        : buildInterpolatedSpiralBaseToolpath(contourLayers, settings);
}

function buildCylindricalSpiralBaseToolpath(
    contourLayers: SliceContourLayer[],
    settings: VaseSlicerSettings,
): VaseBaseToolpath {
    let bridgedRayCount = 0;
    let bridgedLayerCount = 0;
    const cylindricalLayers: SliceContourLayer[] = contourLayers.map((layer, layerIndex) => {
        const sampled = sampleCylindricalContour(layer.contour, settings.pointsPerLayer, layerIndex);
        if (sampled.contour.length !== settings.pointsPerLayer) {
            throw new Error(`Cylindrical slicer failed to sample layer ${layerIndex + 1}.`);
        }
        if (sampled.bridgedRays > 0) {
            bridgedRayCount += sampled.bridgedRays;
            bridgedLayerCount += 1;
        }

        return {
            sampleY: layer.sampleY,
            contour: sampled.contour,
            printHeightMm: layer.printHeightMm,
        };
    });

    const baseToolpath = buildInterpolatedSpiralBaseToolpath(cylindricalLayers, settings);
    if (bridgedLayerCount > 0) {
        baseToolpath.warnings = [
            `Cylindrical mode bridged reentrant geometry on ${bridgedRayCount} ray${bridgedRayCount === 1 ? '' : 's'} across ${bridgedLayerCount} layer${bridgedLayerCount === 1 ? '' : 's'} - the radial resample keeps only the outermost surface. Use planar mode for exact contours.`,
        ];
    }
    return baseToolpath;
}

function buildInterpolatedSpiralBaseToolpath(
    contourLayers: SliceContourLayer[],
    settings: VaseSlicerSettings,
): VaseBaseToolpath {
    const layers = contourLayers.length;
    const perLayer = settings.pointsPerLayer;
    // The helix tops out at the last contour's deposit height, which stays
    // at or below the model height because the layer count is floored. No
    // Y clamping: a clamped tail would flatten part of the last revolution
    // at the top and then get traced again by the cap (double extrusion at
    // the rim).
    const printedHeightMm = contourLayers[layers - 1]?.printHeightMm ?? (settings.layerHeight * layers);

    const firstLayerExtrusionPerMm = calculateExtrusionPerMm(settings, settings.firstLayerLineWidth);
    const extrusionPerMm = calculateExtrusionPerMm(settings, settings.lineWidth);

    const points: ToolpathPoint[] = [];
    let eAcc = 0;
    let prevX = 0;
    let prevY = 0;
    let prevZ = 0;

    // The first flatLayerCount layers stay flat (layer 0 for adhesion,
    // plus any solid bottom layers); the rest form a single continuous
    // helix: each sample step advances Y by layerHeight/perLayer and the
    // contour blend by 1/perLayer, so the wrap from k=perLayer-1 of
    // revolution N to k=0 of revolution N+1 is a uniform perimeter step
    // with no flat-Y segment and no XZ jump-back.
    const flatLayerCount = Math.max(1, Math.min(settings.bottomLayers, layers - 1));
    // Per-contour deposit heights; uniform spacing unless adaptive layer
    // height decimation merged revolutions upstream.
    const heights = contourLayers.map((layer, index) => layer.printHeightMm ?? (settings.layerHeight * (index + 1)));
    const totalPoints = layers * perLayer;
    for (let n = 0; n < totalPoints; n++) {
        const layerIndex = Math.floor(n / perLayer);
        const k = n % perLayer;

        let sampleX: number;
        let sampleZ: number;
        let y: number;
        let segmentExtrusionPerMm: number;
        let layerThicknessMm = settings.layerHeight;

        if (layerIndex < flatLayerCount) {
            const contour = contourLayers[layerIndex].contour;
            const point = contour[k] ?? contour[contour.length - 1];
            sampleX = point.x;
            sampleZ = point.z;
            y = heights[layerIndex];
            segmentExtrusionPerMm = layerIndex === 0 ? firstLayerExtrusionPerMm : extrusionPerMm;
        } else {
            // spiralT advances by 1/perLayer per sample; virtualT places the
            // helix in contour space starting from the last flat layer's
            // contour, ending at virtualT = layers-1 (Y = layerHeight*layers).
            const spiralT = (n - (flatLayerCount * perLayer) + 1) / perLayer;
            const virtualT = (flatLayerCount - 1) + spiralT;
            const layerLow = Math.min(Math.max(0, Math.floor(virtualT)), layers - 2);
            const layerHigh = Math.min(layerLow + 1, layers - 1);
            const blend = virtualT - layerLow;
            const lowContour = contourLayers[layerLow].contour;
            const highContour = contourLayers[layerHigh].contour;
            const lowPoint = lowContour[k] ?? lowContour[lowContour.length - 1];
            const highPoint = highContour[k] ?? highContour[highContour.length - 1];
            sampleX = lerp(lowPoint.x, highPoint.x, blend);
            sampleZ = lerp(lowPoint.z, highPoint.z, blend);
            y = lerp(heights[layerLow], heights[layerHigh], blend);
            layerThicknessMm = Math.max(settings.layerHeight, heights[layerHigh] - heights[layerLow]);
            segmentExtrusionPerMm = layerIndex === flatLayerCount && flatLayerCount === 1
                ? lerp(firstLayerExtrusionPerMm, extrusionPerMm, blend)
                : extrusionPerMm;
        }

        const x = settings.centerX + (sampleX * settings.modelScale);
        const z = settings.centerZ + (sampleZ * settings.modelScale);

        if (points.length > 0) {
            const segment = Math.hypot(x - prevX, y - prevY, z - prevZ);
            eAcc += segment * segmentExtrusionPerMm;
        }

        points.push({
            x,
            y,
            z,
            e: eAcc,
            speedMmPerSec: layerIndex === 0 ? settings.firstLayerPrintSpeedMmPerSec : settings.printSpeedMmPerSec,
            layer: layerIndex,
            layerThicknessMm,
        });

        prevX = x;
        prevY = y;
        prevZ = z;
    }

    // Top cap: one revolution at constant top Y, tracing the actual top
    // contour (not the helix-interpolated last revolution, which would pull
    // the path back toward the previous layer). Extrusion ramps from full
    // down to 0 across the revolution so the print finishes evenly without
    // a dimple. The cap is tagged with its own layer index so
    // applyMinimumLayerTime treats it as a single revolution and gives it
    // the same speed as the helix layer below — not 2× faster from sharing
    // a group.
    if (layers >= 2 && perLayer >= 3) {
        const topContour = contourLayers[layers - 1].contour;
        const topY = printedHeightMm;
        const topLayerIndex = layers;
        const topThicknessMm = Math.max(
            settings.layerHeight,
            printedHeightMm - (contourLayers[layers - 2]?.printHeightMm ?? (printedHeightMm - settings.layerHeight)),
        );
        const divisor = Math.max(1, perLayer - 1);
        for (let k = 0; k < perLayer; k++) {
            const sample = topContour[k] ?? topContour[topContour.length - 1];
            const x = settings.centerX + (sample.x * settings.modelScale);
            const z = settings.centerZ + (sample.z * settings.modelScale);
            const progress = k / divisor;
            const extrusionScale = Math.max(0, Math.pow(1 - progress, 1.2));
            const segment = Math.hypot(x - prevX, topY - prevY, z - prevZ);
            eAcc += segment * extrusionPerMm * extrusionScale;
            points.push({
                x,
                y: topY,
                z,
                e: eAcc,
                speedMmPerSec: settings.printSpeedMmPerSec,
                layer: topLayerIndex,
                extrusionScale,
                layerThicknessMm: topThicknessMm,
            });
            prevX = x;
            prevY = topY;
            prevZ = z;
        }
    }

    return {
        points,
        layerCount: layers,
        pointsPerLayer: perLayer,
        estimatedHeight: printedHeightMm,
    };
}

function sampleCylindricalContour(
    contour: SlicePoint[],
    pointCount: number,
    layerIndex: number,
): { contour: SlicePoint[]; bridgedRays: number } {
    const radial: SlicePoint[] = [];
    const step = (Math.PI * 2.0) / Math.max(1, pointCount);
    let bridgedRays = 0;

    for (let i = 0; i < pointCount; i++) {
        const angle = i * step;
        const directionX = Math.cos(angle);
        const directionZ = Math.sin(angle);
        const intersection = rayIntersectContourOuter(contour, directionX, directionZ);
        if (!intersection) {
            throw new Error(
                `Cylindrical mode requires the slice contour to enclose the center axis. Layer ${layerIndex + 1}: the ray at ${((angle * 180) / Math.PI).toFixed(0)} deg found no boundary - re-center the model or use planar mode.`
            );
        }
        // An enclosing contour crosses an outbound ray an odd number of
        // times; three or more means reentrant geometry that the
        // outermost-hit resample silently bridges.
        if (intersection.crossings >= 3) {
            bridgedRays++;
        }
        radial.push(intersection.point);
    }

    return { contour: radial, bridgedRays };
}

function rayIntersectContourOuter(
    contour: SlicePoint[],
    directionX: number,
    directionZ: number,
): { point: SlicePoint; crossings: number } | null {
    let bestDistance = -1;
    let crossings = 0;

    for (let i = 0; i < contour.length; i++) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        const edgeX = b.x - a.x;
        const edgeZ = b.z - a.z;
        const cross = (directionX * edgeZ) - (directionZ * edgeX);
        if (Math.abs(cross) < 1e-8) {
            continue;
        }

        const t = ((a.x * edgeZ) - (a.z * edgeX)) / cross;
        const u = ((a.x * directionZ) - (a.z * directionX)) / cross;
        if (t < 0 || u < 0 || u > 1) {
            continue;
        }

        crossings++;
        if (t > bestDistance) {
            bestDistance = t;
        }
    }

    if (bestDistance < 0) {
        return null;
    }

    return {
        point: {
            x: directionX * bestDistance,
            z: directionZ * bestDistance,
        },
        crossings,
    };
}

export function optimizeToolpath(points: ToolpathPoint[], settings: VaseSlicerSettings): ToolpathPoint[] {
    if (!settings.enableMoveMerging) {
        return points;
    }

    if (points.length < 4) {
        return points;
    }

    const reduced: ToolpathPoint[] = [];
    let cursor = 0;
    while (cursor < points.length) {
        const layer = points[cursor].layer;
        let end = cursor + 1;
        while (end < points.length && points[end].layer === layer) {
            end++;
        }

        const layerPoints = points.slice(cursor, end);
        const simplified = simplifyLayerMoves(layerPoints, settings);
        reduced.push(...simplified);
        cursor = end;
    }

    return reduced;
}

function simplifyLayerMoves(points: ToolpathPoint[], settings: VaseSlicerSettings): ToolpathPoint[] {
    if (points.length <= 3) {
        return points;
    }

    const minMoveMm = settings.moveMergeMinMoveMm;
    const maxDeviationMm = settings.moveMergeMaxDeviationMm;
    const maxTurnDeg = settings.moveMergeMaxTurnDeg;
    const keepStride = settings.moveMergeKeepStride;

    const out: ToolpathPoint[] = [points[0]];
    // Points dropped since the last kept point. Every merge decision
    // re-checks all of them against the candidate chord so accumulated
    // deviation stays bounded by maxDeviationMm relative to the original
    // path, not just to the local point triple.
    const dropped: ToolpathPoint[] = [];

    for (let i = 1; i < points.length - 1; i++) {
        const prev = out[out.length - 1];
        const cur = points[i];
        const next = points[i + 1];

        const a = distance3(prev, cur);
        const b = distance3(cur, next);
        const chord = distance3(prev, next);
        const turnDeg = turnAngleDegrees(prev, cur, next);
        const deviation = chord > 1e-6 ? pointLineDistance3(cur, prev, next) : 0;
        const isTinyMove = a <= minMoveMm && b <= minMoveMm;
        const isSmoothEnough = deviation <= maxDeviationMm && turnDeg <= maxTurnDeg;

        const speedStable =
            Math.abs(prev.speedMmPerSec - cur.speedMmPerSec) <= 1e-3 &&
            Math.abs(cur.speedMmPerSec - next.speedMmPerSec) <= 1e-3;
        const prevExtrusionScale = prev.extrusionScale ?? 1;
        const curExtrusionScale = cur.extrusionScale ?? 1;
        const nextExtrusionScale = next.extrusionScale ?? 1;
        const extrusionStable =
            Math.abs(prevExtrusionScale - curExtrusionScale) <= 1e-4 &&
            Math.abs(curExtrusionScale - nextExtrusionScale) <= 1e-4;

        let canMerge =
            (isTinyMove || isSmoothEnough) &&
            speedStable &&
            extrusionStable &&
            dropped.length < keepStride;

        if (canMerge && dropped.length > 0) {
            // Tiny-move runs may legitimately wander up to the tiny-move
            // radius itself; smooth runs are held to the deviation limit.
            const chordBound = isTinyMove && !isSmoothEnough
                ? Math.max(maxDeviationMm, minMoveMm * 0.5)
                : maxDeviationMm;
            for (const droppedPoint of dropped) {
                if (pointLineDistance3(droppedPoint, prev, next) > chordBound) {
                    canMerge = false;
                    break;
                }
            }
        }

        if (canMerge) {
            dropped.push(cur);
            continue;
        }

        out.push(cur);
        dropped.length = 0;
    }

    out.push(points[points.length - 1]);
    return out;
}

export function recomputeExtrusion(points: ToolpathPoint[], settings: VaseSlicerSettings): void {
    if (points.length === 0) {
        return;
    }

    const firstLayerExtrusionPerMm = calculateExtrusionPerMm(settings, settings.firstLayerLineWidth);
    const extrusionPerMm = calculateExtrusionPerMm(settings, settings.lineWidth);
    let cachedThicknessMm = settings.layerHeight;
    let cachedThickExtrusionPerMm = extrusionPerMm;
    const transitionProgress = new Array<number>(points.length).fill(0);

    let layerStart = 0;
    while (layerStart < points.length) {
        const layer = points[layerStart].layer;
        let layerEnd = layerStart + 1;
        while (layerEnd < points.length && points[layerEnd].layer === layer) {
            layerEnd++;
        }

        const divisor = Math.max(1, layerEnd - layerStart - 1);
        for (let index = layerStart; index < layerEnd; index++) {
            transitionProgress[index] = (index - layerStart) / divisor;
        }

        layerStart = layerEnd;
    }

    points[0].e = 0;
    let eAcc = 0;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const point = points[i];
        const segment = distance3(prev, point);
        const layerProgress = transitionProgress[i];
        const extrusionScale = clamp(point.extrusionScale ?? 1, 0, 16);
        const thicknessMm = point.layerThicknessMm ?? settings.layerHeight;
        if (thicknessMm !== cachedThicknessMm) {
            cachedThicknessMm = thicknessMm;
            cachedThickExtrusionPerMm = calculateExtrusionPerMm(settings, settings.lineWidth, thicknessMm);
        }
        const segmentExtrusionPerMm = point.layer === 0
            ? firstLayerExtrusionPerMm
            : (point.layer === 1 && settings.bottomLayers <= 1
                ? lerp(firstLayerExtrusionPerMm, cachedThickExtrusionPerMm, layerProgress)
                : cachedThickExtrusionPerMm);
        eAcc += segment * segmentExtrusionPerMm * extrusionScale;
        point.e = eAcc;
    }
}

export function applyMinimumLayerTime(points: ToolpathPoint[], settings: VaseSlicerSettings): void {
    const minLayerTimeSec = settings.minLayerTimeSec;
    if (points.length < 2 || minLayerTimeSec <= 0) {
        return;
    }

    const minAllowedSpeedMmPerSec = 1.0;
    let layerStart = 0;
    while (layerStart < points.length) {
        const layer = points[layerStart].layer;
        let layerEnd = layerStart + 1;
        while (layerEnd < points.length && points[layerEnd].layer === layer) {
            layerEnd++;
        }

        if (layer === 0) {
            layerStart = layerEnd;
            continue;
        }

        const baseSpeedMmPerSec = settings.printSpeedMmPerSec;
        let layerPathLengthMm = 0;
        for (let i = layerStart + 1; i < layerEnd; i++) {
            layerPathLengthMm += distance3(points[i - 1], points[i]);
        }

        const maxSpeedForMinTime = layerPathLengthMm / minLayerTimeSec;
        const targetSpeedMmPerSec = clamp(
            Math.min(baseSpeedMmPerSec, maxSpeedForMinTime),
            minAllowedSpeedMmPerSec,
            baseSpeedMmPerSec,
        );

        for (let i = layerStart; i < layerEnd; i++) {
            points[i].speedMmPerSec = targetSpeedMmPerSec;
        }

        layerStart = layerEnd;
    }
}

export function calculateExtrusionPerMm(settings: VaseSlicerSettings, targetLineWidth?: number, layerHeightMm?: number): number {
    const requestedLineWidth = typeof targetLineWidth === 'number' ? targetLineWidth : settings.lineWidth;
    const lineWidth = Math.max(requestedLineWidth, settings.nozzleDiameter);
    const layerHeight = Math.min(layerHeightMm ?? settings.layerHeight, lineWidth);

    // Stadium profile gives a better bead area estimate than a pure rectangle.
    const beadArea = lineWidth > layerHeight
        ? (layerHeight * (lineWidth - layerHeight)) + (Math.PI * Math.pow(layerHeight * 0.5, 2))
        : (Math.PI * lineWidth * layerHeight * 0.25);

    const filamentArea = Math.PI * Math.pow(settings.filamentDiameter * 0.5, 2);
    return settings.flowRate * (beadArea / filamentArea);
}
