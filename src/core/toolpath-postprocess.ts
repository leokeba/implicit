import type { ScalarControlSpec } from '../scene-runtime';
import type { ResolvedPipelineStep } from './postprocess-registry';
import { getSceneFieldDefinitions } from './shader-pipeline';
import type { SceneFieldDefinition, SceneFieldValue } from './shaders/types';
import type { ToolpathPoint, VaseSlicerSettings } from './slicer';

export interface ToolpathPipelineStepSummary {
    stepIndex: number;
    name: string;
    scriptId: string | null;
    notes: string[];
    durationMs: number;
    inputPointCount: number;
    outputPointCount: number;
}

export interface ToolpathPostprocessLayerSummary {
    layer: number;
    pointCount: number;
    startIndex: number;
    endIndex: number;
    pathLengthMm: number;
    filamentLengthMm: number;
    spiralStartPathMm: number;
    spiralEndPathMm: number;
    spiralStartFilamentMm: number;
    spiralEndFilamentMm: number;
}

export interface ToolpathPostprocessPointMetrics {
    pointIndex: number;
    layerPointIndex: number;
    shapeLayerIndex: number;
    segmentPathMm: number;
    segmentFilamentMm: number;
    layerPathMm: number;
    layerPathProgress: number;
    layerFilamentMm: number;
    layerFilamentProgress: number;
    shapeLayerProgress: number;
    spiralPathMm: number;
    spiralPathProgress: number;
    spiralFilamentMm: number;
    spiralFilamentProgress: number;
}

export interface ToolpathPostprocessMutablePoint {
    x: number;
    y: number;
    z: number;
    layer: number;
    speedMmPerSec: number;
    extrusionScale?: number;
    /**
     * GPU-sampled scene field values. Preserved across pipeline steps when a
     * step passes points through or mutates them in place; a step that
     * fabricates new points at new positions cannot supply meaningful values
     * and may omit them.
     */
    sceneFields?: Readonly<Record<string, SceneFieldValue>>;
}

export interface ToolpathPostprocessPoint extends ToolpathPostprocessMutablePoint {
    e: number;
    metrics: ToolpathPostprocessPointMetrics;
}

export interface ToolpathPostprocessContext {
    settings: VaseSlicerSettings;
    controls: ScalarControlSpec[];
    params: Record<string, number>;
    sceneFieldDefinitions: SceneFieldDefinition[];
    layers: ToolpathPostprocessLayerSummary[];
    totals: {
        pointCount: number;
        layerCount: number;
        pathLengthMm: number;
        filamentLengthMm: number;
        estimatedHeightMm: number;
    };
    points: ToolpathPostprocessPoint[];
}

export interface ToolpathPostprocessResult {
    points?: ToolpathPostprocessMutablePoint[];
    notes?: string[];
}

type ToolpathTransform = (context: ToolpathPostprocessContext) => void | ToolpathPostprocessMutablePoint[] | ToolpathPostprocessResult;

/**
 * Runs the scene's resolved postprocess pipeline over the raw spiral toolpath.
 * Steps run in order; each step sees the output of the previous one.
 * Failures throw with the step name so they surface in the UI.
 */
export function applyToolpathPipeline(
    points: ToolpathPoint[],
    settings: VaseSlicerSettings,
    steps: ResolvedPipelineStep[],
): { points: ToolpathPoint[]; summaries: ToolpathPipelineStepSummary[] } {
    let currentPoints = points;
    const summaries: ToolpathPipelineStepSummary[] = [];

    for (const step of steps) {
        if (!step.enabled) {
            continue;
        }

        if (step.error || !step.transform) {
            throw new Error(`Postprocess step '${step.name}' is not runnable: ${step.error ?? 'no transform resolved'}.`);
        }

        const context = buildToolpathPostprocessContext(currentPoints, settings, step.controls, step.params);
        const startTime = performance.now();
        const output = step.transform(context);
        const normalized = normalizeToolpathPostprocessOutput(output, context.points);
        const nextPoints = normalized.points.map((point) => normalizeReturnedPoint(point));
        validatePostprocessPoints(nextPoints, step.name);
        const durationMs = performance.now() - startTime;

        summaries.push({
            stepIndex: step.index,
            name: step.name,
            scriptId: step.scriptId,
            notes: normalized.notes,
            durationMs,
            inputPointCount: currentPoints.length,
            outputPointCount: nextPoints.length,
        });

        currentPoints = nextPoints;
    }

    return { points: currentPoints, summaries };
}

export function buildToolpathPostprocessContext(
    points: ToolpathPoint[],
    settings: VaseSlicerSettings,
    controls: ScalarControlSpec[] = [],
    parameterValues: Record<string, number> = {},
): ToolpathPostprocessContext {
    const sceneFieldDefinitions = getSceneFieldDefinitions();
    const layerSummaries: ToolpathPostprocessLayerSummary[] = [];
    const segmentPath = new Float64Array(points.length);
    const segmentFilament = new Float64Array(points.length);
    const spiralPath = new Float64Array(points.length);
    const spiralFilament = new Float64Array(points.length);
    const layerPath = new Float64Array(points.length);
    const layerFilament = new Float64Array(points.length);
    const layerPointIndex = new Int32Array(points.length);

    let currentLayer = -1;
    let layerStartIndex = 0;
    let currentLayerPath = 0;
    let currentLayerFilament = 0;
    let totalPath = 0;
    let totalFilament = 0;

    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        if (point.layer !== currentLayer) {
            if (currentLayer >= 0) {
                layerSummaries.push({
                    layer: currentLayer,
                    pointCount: index - layerStartIndex,
                    startIndex: layerStartIndex,
                    endIndex: index - 1,
                    pathLengthMm: currentLayerPath,
                    filamentLengthMm: currentLayerFilament,
                    spiralStartPathMm: spiralPath[layerStartIndex],
                    spiralEndPathMm: spiralPath[index - 1],
                    spiralStartFilamentMm: spiralFilament[layerStartIndex],
                    spiralEndFilamentMm: spiralFilament[index - 1],
                });
            }

            currentLayer = point.layer;
            layerStartIndex = index;
            currentLayerPath = 0;
            currentLayerFilament = 0;
        }

        if (index > 0) {
            const prev = points[index - 1];
            segmentPath[index] = distance3(prev, point);
            segmentFilament[index] = Math.max(0, point.e - prev.e);
        }

        totalPath += segmentPath[index];
        totalFilament += segmentFilament[index];
        currentLayerPath += segmentPath[index];
        currentLayerFilament += segmentFilament[index];

        spiralPath[index] = totalPath;
        spiralFilament[index] = totalFilament;
        layerPath[index] = currentLayerPath;
        layerFilament[index] = currentLayerFilament;
        layerPointIndex[index] = index - layerStartIndex;
    }

    if (points.length > 0 && currentLayer >= 0) {
        const lastIndex = points.length - 1;
        layerSummaries.push({
            layer: currentLayer,
            pointCount: points.length - layerStartIndex,
            startIndex: layerStartIndex,
            endIndex: lastIndex,
            pathLengthMm: currentLayerPath,
            filamentLengthMm: currentLayerFilament,
            spiralStartPathMm: spiralPath[layerStartIndex],
            spiralEndPathMm: spiralPath[lastIndex],
            spiralStartFilamentMm: spiralFilament[layerStartIndex],
            spiralEndFilamentMm: spiralFilament[lastIndex],
        });
    }

    const layerSummaryByLayer = new Map(layerSummaries.map((summary) => [summary.layer, summary]));
    const layerOrdinalByLayer = new Map(layerSummaries.map((summary, index) => [summary.layer, index]));
    const layerCount = layerSummaries.length;
    const contextPoints = points.map((point, index) => {
        const layerSummary = layerSummaryByLayer.get(point.layer);
        const layerOrdinal = layerOrdinalByLayer.get(point.layer) ?? 0;
        const layerPathTotal = layerSummary?.pathLengthMm ?? 0;
        const layerFilamentTotal = layerSummary?.filamentLengthMm ?? 0;
        const layerPathProgress = ratioOrZero(layerPath[index], layerPathTotal);
        const layerFilamentProgress = ratioOrZero(layerFilament[index], layerFilamentTotal);
        const intraLayerProgress = layerFilamentTotal > 1e-9 ? layerFilamentProgress : layerPathProgress;
        const normalizedLayerSpan = layerCount > 0 ? 1 / layerCount : 0;
        const shapeLayerProgress = Math.min(1, Math.max(0, (layerOrdinal * normalizedLayerSpan) + (intraLayerProgress * normalizedLayerSpan)));

        return {
            x: point.x,
            y: point.y,
            z: point.z,
            e: point.e,
            layer: point.layer,
            speedMmPerSec: point.speedMmPerSec,
            extrusionScale: point.extrusionScale,
            sceneFields: point.sceneFields ? { ...point.sceneFields } : undefined,
            metrics: {
                pointIndex: index,
                layerPointIndex: layerPointIndex[index],
                shapeLayerIndex: layerOrdinal,
                segmentPathMm: segmentPath[index],
                segmentFilamentMm: segmentFilament[index],
                layerPathMm: layerPath[index],
                layerPathProgress,
                layerFilamentMm: layerFilament[index],
                layerFilamentProgress,
                shapeLayerProgress,
                spiralPathMm: spiralPath[index],
                spiralPathProgress: ratioOrZero(spiralPath[index], totalPath),
                spiralFilamentMm: spiralFilament[index],
                spiralFilamentProgress: ratioOrZero(spiralFilament[index], totalFilament),
            },
        } satisfies ToolpathPostprocessPoint;
    });

    return {
        settings: { ...settings },
        controls: controls.map((control) => ({ ...control })),
        params: { ...parameterValues },
        sceneFieldDefinitions: sceneFieldDefinitions.map((definition) => ({ ...definition })),
        layers: layerSummaries,
        totals: {
            pointCount: points.length,
            layerCount: layerSummaries.length,
            pathLengthMm: totalPath,
            filamentLengthMm: totalFilament,
            estimatedHeightMm: points[points.length - 1]?.y ?? 0,
        },
        points: contextPoints,
    };
}

function normalizeToolpathPostprocessOutput(
    output: ReturnType<ToolpathTransform>,
    fallbackPoints: ToolpathPostprocessPoint[],
): { points: ToolpathPostprocessMutablePoint[]; notes: string[] } {
    if (Array.isArray(output)) {
        return {
            points: output,
            notes: [],
        };
    }

    if (!output) {
        return {
            points: fallbackPoints,
            notes: [],
        };
    }

    return {
        points: Array.isArray(output.points) ? output.points : fallbackPoints,
        notes: Array.isArray(output.notes)
            ? output.notes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
            : [],
    };
}

function normalizeReturnedPoint(point: ToolpathPostprocessMutablePoint): ToolpathPoint {
    return {
        x: point.x,
        y: point.y,
        z: point.z,
        e: 0,
        layer: point.layer,
        speedMmPerSec: point.speedMmPerSec,
        extrusionScale: point.extrusionScale,
        sceneFields: point.sceneFields,
    };
}

function validatePostprocessPoints(points: ToolpathPoint[], stepName: string): void {
    if (points.length < 2) {
        throw new Error(`Postprocess step '${stepName}' must return at least 2 points.`);
    }

    let previousLayer = -1;
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
            throw new Error(`Postprocess step '${stepName}' returned a non-finite coordinate at point ${index}.`);
        }

        if (!Number.isInteger(point.layer) || point.layer < 0) {
            throw new Error(`Postprocess step '${stepName}' returned an invalid layer index at point ${index}.`);
        }

        if (point.layer < previousLayer) {
            throw new Error(`Postprocess step '${stepName}' reordered points across layers at point ${index}.`);
        }

        if (!Number.isFinite(point.speedMmPerSec) || point.speedMmPerSec <= 0) {
            throw new Error(`Postprocess step '${stepName}' returned an invalid speed at point ${index}.`);
        }

        const extrusionScale = point.extrusionScale ?? 1;
        if (!Number.isFinite(extrusionScale) || extrusionScale < 0 || extrusionScale > 16) {
            throw new Error(`Postprocess step '${stepName}' returned an invalid extrusionScale at point ${index}.`);
        }

        previousLayer = point.layer;
    }
}

function ratioOrZero(value: number, total: number): number {
    if (!Number.isFinite(total) || total <= 1e-9) {
        return 0;
    }

    return Math.min(1, Math.max(0, value / total));
}

function distance3(a: Pick<ToolpathPoint, 'x' | 'y' | 'z'>, b: Pick<ToolpathPoint, 'x' | 'y' | 'z'>): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
