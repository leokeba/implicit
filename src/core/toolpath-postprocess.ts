import ts from 'typescript';

import type { ToolpathPoint, VaseSlicerSettings } from './slicer';

export type ToolpathPostprocessLanguage = 'javascript' | 'typescript';

export interface ToolpathPostprocessConfig {
    enabled: boolean;
    scriptId: string;
    scriptName: string;
    language: ToolpathPostprocessLanguage;
    source: string;
    parameterValues?: Record<string, number>;
}

export interface PostprocessControlDefinition {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    section: string;
    description?: string;
}

export interface ToolpathPostprocessSummary {
    scriptId: string;
    scriptName: string;
    language: ToolpathPostprocessLanguage;
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
}

export interface ToolpathPostprocessPoint extends ToolpathPostprocessMutablePoint {
    e: number;
    metrics: ToolpathPostprocessPointMetrics;
}

export interface ToolpathPostprocessContext {
    settings: VaseSlicerSettings;
    controls: PostprocessControlDefinition[];
    params: Record<string, number>;
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

interface NormalizedToolpathPostprocessResult {
    points: ToolpathPoint[];
    notes: string[];
    durationMs: number;
}

type ToolpathTransform = (context: ToolpathPostprocessContext) => void | ToolpathPostprocessMutablePoint[] | ToolpathPostprocessResult;

interface PostprocessControlConfigFile {
    key?: unknown;
    label?: unknown;
    min?: unknown;
    max?: unknown;
    step?: unknown;
    default?: unknown;
    section?: unknown;
    description?: unknown;
}

const compiledTransformCache = new Map<string, ToolpathTransform>();

export function applyToolpathPostprocess(
    points: ToolpathPoint[],
    settings: VaseSlicerSettings,
    config: ToolpathPostprocessConfig | null | undefined,
): { points: ToolpathPoint[]; summary: ToolpathPostprocessSummary | null } {
    if (!config?.enabled) {
        return {
            points,
            summary: null,
        };
    }

    const source = config.source.trim();
    if (source.length === 0) {
        return {
            points,
            summary: null,
        };
    }

    const controls = parsePostprocessControlDefinitions(config.source);
    const parameterValues = buildPostprocessParameterValues(controls, config.parameterValues);
    const context = buildToolpathPostprocessContext(points, settings, controls, parameterValues);
    const startTime = performance.now();
    const normalized = runToolpathPostprocess(context, config);
    const durationMs = performance.now() - startTime;

    return {
        points: normalized.points,
        summary: {
            scriptId: config.scriptId,
            scriptName: config.scriptName,
            language: config.language,
            notes: normalized.notes,
            durationMs,
            inputPointCount: points.length,
            outputPointCount: normalized.points.length,
        },
    };
}

export function buildToolpathPostprocessContext(
    points: ToolpathPoint[],
    settings: VaseSlicerSettings,
    controls: PostprocessControlDefinition[] = [],
    parameterValues: Record<string, number> = {},
): ToolpathPostprocessContext {
    const layerSummaries: ToolpathPostprocessLayerSummary[] = [];
    const segmentPath = new Array<number>(points.length).fill(0);
    const segmentFilament = new Array<number>(points.length).fill(0);
    const spiralPath = new Array<number>(points.length).fill(0);
    const spiralFilament = new Array<number>(points.length).fill(0);
    const layerPath = new Array<number>(points.length).fill(0);
    const layerFilament = new Array<number>(points.length).fill(0);
    const layerPointIndex = new Array<number>(points.length).fill(0);

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

export function parsePostprocessControlDefinitions(source: string): PostprocessControlDefinition[] {
    const pattern = /^\s*\/\/\s*@control\s+(\{.+\})\s*$/gm;
    const controls: PostprocessControlDefinition[] = [];
    const seenKeys = new Set<string>();

    let match: RegExpExecArray | null = pattern.exec(source);
    while (match) {
        const parsed = safeParsePostprocessControlConfig(match[1] ?? '');
        if (!parsed || seenKeys.has(parsed.key)) {
            match = pattern.exec(source);
            continue;
        }

        seenKeys.add(parsed.key);
        controls.push(parsed);
        match = pattern.exec(source);
    }

    return controls;
}

export function buildPostprocessParameterValues(
    definitions: PostprocessControlDefinition[],
    values?: Record<string, number>,
): Record<string, number> {
    const nextValues: Record<string, number> = {};
    for (const definition of definitions) {
        const candidate = values?.[definition.key];
        nextValues[definition.key] = clampPostprocessControlValue(
            typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : definition.defaultValue,
            definition,
        );
    }

    return nextValues;
}

export function clampPostprocessControlValue(
    value: number,
    definition: Pick<PostprocessControlDefinition, 'min' | 'max'>,
): number {
    return Math.min(definition.max, Math.max(definition.min, value));
}

function runToolpathPostprocess(
    context: ToolpathPostprocessContext,
    config: ToolpathPostprocessConfig,
): NormalizedToolpathPostprocessResult {
    const transform = getCompiledTransform(config);
    const output = transform(context);
    const normalized = normalizeToolpathPostprocessOutput(output, context.points);
    const points = normalized.points.map((point, index) => normalizeReturnedPoint(point, index));
    validatePostprocessPoints(points, config);

    return {
        points,
        notes: normalized.notes,
        durationMs: 0,
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

function normalizeReturnedPoint(point: ToolpathPostprocessMutablePoint, index: number): ToolpathPoint {
    return {
        x: point.x,
        y: point.y,
        z: point.z,
        e: 0,
        layer: point.layer,
        speedMmPerSec: point.speedMmPerSec,
        extrusionScale: point.extrusionScale,
    };
}

function validatePostprocessPoints(points: ToolpathPoint[], config: ToolpathPostprocessConfig): void {
    if (points.length < 2) {
        throw new Error(`Postprocess script '${config.scriptName}' must return at least 2 points.`);
    }

    let previousLayer = -1;
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
            throw new Error(`Postprocess script '${config.scriptName}' returned a non-finite coordinate at point ${index}.`);
        }

        if (!Number.isInteger(point.layer) || point.layer < 0) {
            throw new Error(`Postprocess script '${config.scriptName}' returned an invalid layer index at point ${index}.`);
        }

        if (point.layer < previousLayer) {
            throw new Error(`Postprocess script '${config.scriptName}' reordered points across layers at point ${index}.`);
        }

        if (!Number.isFinite(point.speedMmPerSec) || point.speedMmPerSec <= 0) {
            throw new Error(`Postprocess script '${config.scriptName}' returned an invalid speed at point ${index}.`);
        }

        const extrusionScale = point.extrusionScale ?? 1;
        if (!Number.isFinite(extrusionScale) || extrusionScale < 0 || extrusionScale > 16) {
            throw new Error(`Postprocess script '${config.scriptName}' returned an invalid extrusionScale at point ${index}.`);
        }

        previousLayer = point.layer;
    }
}

function getCompiledTransform(config: ToolpathPostprocessConfig): ToolpathTransform {
    const cacheKey = `${config.language}:${hashString(config.source)}`;
    const cached = compiledTransformCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const compiledSource = transpileToolpathScript(config);
    const moduleRef: { exports: Record<string, unknown> } = { exports: {} };
    const factory = new Function('module', 'exports', compiledSource) as (module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => void;
    factory(moduleRef, moduleRef.exports);

    const transform = moduleRef.exports.transform;
    if (typeof transform !== 'function') {
        throw new Error(`Postprocess script '${config.scriptName}' must export a transform(context) function.`);
    }

    compiledTransformCache.set(cacheKey, transform as ToolpathTransform);
    return transform as ToolpathTransform;
}

function transpileToolpathScript(config: ToolpathPostprocessConfig): string {
    const result = ts.transpileModule(config.source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            allowJs: true,
            useDefineForClassFields: false,
        },
        fileName: config.language === 'typescript' ? `${config.scriptId || 'postprocess'}.ts` : `${config.scriptId || 'postprocess'}.js`,
        reportDiagnostics: true,
    });

    const diagnostics = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
    if (diagnostics.length > 0) {
        const message = diagnostics
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
            .join('\n');
        throw new Error(`Postprocess script '${config.scriptName}' failed to compile.\n${message}`);
    }

    return result.outputText;
}

function hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
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

function safeParsePostprocessControlConfig(rawPayload: string): PostprocessControlDefinition | null {
    try {
        const parsed = JSON.parse(rawPayload) as PostprocessControlConfigFile;
        const key = typeof parsed.key === 'string' ? normalizePostprocessControlKey(parsed.key) : '';
        if (!key) {
            return null;
        }

        const min = readFiniteNumber(parsed.min);
        const max = readFiniteNumber(parsed.max);
        const step = readFiniteNumber(parsed.step);
        if (min === null || max === null || step === null || max <= min || step <= 0) {
            return null;
        }

        const fallbackDefault = min + (max - min) * 0.5;
        const defaultValue = clampPostprocessControlValue(readFiniteNumber(parsed.default) ?? fallbackDefault, { min, max });
        return {
            key,
            label: typeof parsed.label === 'string' && parsed.label.trim().length > 0 ? parsed.label.trim() : toPostprocessLabel(key),
            min,
            max,
            step,
            defaultValue,
            section: typeof parsed.section === 'string' && parsed.section.trim().length > 0 ? parsed.section.trim() : 'Script Parameters',
            description: typeof parsed.description === 'string' && parsed.description.trim().length > 0 ? parsed.description.trim() : undefined,
        };
    } catch {
        return null;
    }
}

function normalizePostprocessControlKey(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .replace(/\s+(.)/g, (_, letter: string) => letter.toUpperCase())
        .replace(/\s/g, '')
        .replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

function toPostprocessLabel(value: string): string {
    return value
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ') || 'Parameter';
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}