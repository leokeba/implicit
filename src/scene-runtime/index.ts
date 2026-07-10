import {
    inferOptionStep,
    parseNumericControlOptions,
    snapToNearestOptionValue,
} from '../core/control-options';
import type { SceneFieldDefinition, SceneFieldType } from '../core/shaders/types';
import type {
    FieldSpecInput,
    NormalizedPostprocessStep,
    PostprocessRef,
    PostprocessStepInput,
    PostprocessTransform,
    ScalarControlSpec,
    ScalarSpecInput,
    SceneManifest,
    SceneManifestInput,
} from './types';

export type {
    ToolpathPostprocessContext,
    ToolpathPostprocessLayerSummary,
    ToolpathPostprocessMutablePoint,
    ToolpathPostprocessPoint,
    ToolpathPostprocessPointMetrics,
    ToolpathPostprocessResult,
} from '../core/toolpath-postprocess';
export type { ToolpathSurface, ToolpathSurfaceSample } from '../core/slicer/surface';
export type {
    FieldSpecInput,
    FieldSpecObject,
    InlinePostprocessStepInput,
    NormalizedPostprocessStep,
    PostprocessRef,
    PostprocessStepInput,
    PostprocessTransform,
    PreprocessFn,
    PreprocessInput,
    PreprocessOutput,
    ScalarControlSpec,
    ScalarSpecInput,
    ScalarSpecObject,
    ScalarSpecTuple,
    SceneExportConfig,
    SceneManifest,
    SceneManifestInput,
    SceneSlicerConfigInput,
} from './types';

const SCENE_FIELD_TYPES: ReadonlySet<string> = new Set(['float', 'vec2', 'vec3', 'vec4']);

/** Keys of the slicer block that are preset references, not VaseSlicerSettings values. */
const SLICER_PRESET_KEYS = new Set(['printer', 'filament']);

export function defineScene(input: SceneManifestInput): SceneManifest {
    if (!input || typeof input !== 'object') {
        throw new Error('defineScene(...) expects a configuration object.');
    }

    const slicerInput = input.slicer ?? {};
    const slicer: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(slicerInput)) {
        if (SLICER_PRESET_KEYS.has(key) || value === undefined) {
            continue;
        }
        slicer[key] = value;
    }

    if (input.preprocess !== undefined && typeof input.preprocess !== 'function') {
        throw new Error('`preprocess` must be a function.');
    }

    return {
        __implicitSceneManifest: true,
        title: typeof input.title === 'string' && input.title.trim().length > 0 ? input.title.trim() : null,
        uniforms: normalizeScalarSpecs(input.uniforms, 'uniform'),
        params: normalizeScalarSpecs(input.params, 'param'),
        fields: normalizeFieldSpecs(input.fields),
        slicer: slicer as SceneManifest['slicer'],
        printer: readPresetRef(slicerInput.printer),
        filament: readPresetRef(slicerInput.filament),
        preprocess: input.preprocess ?? null,
        postprocess: normalizePostprocessSteps(input.postprocess),
        export: { ...(input.export ?? {}) },
    };
}

export function usePostprocess(script: string, params: Record<string, number> = {}): PostprocessRef {
    if (typeof script !== 'string' || script.trim().length === 0) {
        throw new Error('usePostprocess(script, params?) expects a script id or relative module path.');
    }

    return {
        kind: 'postprocess-ref',
        script: script.trim(),
        params: { ...params },
    };
}

/**
 * Normalizes a `controls` record exported by a postprocess script into
 * full control specs (same shorthands as manifest uniforms/params).
 */
export function normalizeControls(specs: Record<string, ScalarSpecInput> | undefined): ScalarControlSpec[] {
    return normalizeScalarSpecs(specs, 'param');
}

export function isSceneManifest(value: unknown): value is SceneManifest {
    return Boolean(value && typeof value === 'object' && (value as SceneManifest).__implicitSceneManifest === true);
}

/** Manifest used when a scene has no scene.ts (or an empty one). */
export function emptySceneManifest(): SceneManifest {
    return defineScene({});
}

function normalizeScalarSpecs(
    specs: Record<string, ScalarSpecInput> | undefined,
    kind: 'uniform' | 'param',
): ScalarControlSpec[] {
    if (!specs) {
        return [];
    }

    return Object.entries(specs).map(([key, spec]) => normalizeScalarSpec(key, spec, kind));
}

function normalizeScalarSpec(key: string, input: ScalarSpecInput, kind: 'uniform' | 'param'): ScalarControlSpec {
    const trimmedKey = key.trim();
    if (!trimmedKey || (kind === 'uniform' && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedKey))) {
        throw new Error(`Invalid ${kind} name '${key}'.`);
    }

    const spec = expandScalarSpec(trimmedKey, input, kind);
    const options = parseNumericControlOptions(spec.options);
    const hasOptions = options.length > 0;

    let min = readFiniteNumber(spec.min);
    let max = readFiniteNumber(spec.max);
    let step = readFiniteNumber(spec.step);

    if (hasOptions) {
        min = Math.min(...options.map((option) => option.value));
        max = Math.max(...options.map((option) => option.value));
        step = step ?? inferOptionStep(options);
    }

    const defaultValue = readFiniteNumber(spec.default);
    if (defaultValue === null) {
        throw new Error(`${capitalize(kind)} '${trimmedKey}' is missing a finite default value.`);
    }

    const hasControl = hasOptions || (min !== null && max !== null && max > min);
    if (!hasControl) {
        return {
            key: trimmedKey,
            label: spec.label?.trim() || deriveLabel(trimmedKey),
            defaultValue,
            min: defaultValue,
            max: defaultValue,
            step: 1,
            section: spec.section?.trim() || 'Scene Parameters',
            description: spec.description?.trim() || undefined,
            hasControl: false,
        };
    }

    if (min === null || max === null || max <= min) {
        throw new Error(`${capitalize(kind)} '${trimmedKey}' has an invalid range (min ${spec.min}, max ${spec.max}).`);
    }

    const resolvedStep = step !== null && step > 0 ? step : deriveStep(min, max);
    const clampedDefault = hasOptions
        ? snapToNearestOptionValue(defaultValue, options)
        : Math.min(max, Math.max(min, defaultValue));

    return {
        key: trimmedKey,
        label: spec.label?.trim() || deriveLabel(trimmedKey),
        defaultValue: clampedDefault,
        min,
        max,
        step: resolvedStep,
        section: spec.section?.trim() || 'Scene Parameters',
        description: spec.description?.trim() || undefined,
        options: hasOptions ? options : undefined,
        hasControl: true,
    };
}

function expandScalarSpec(key: string, input: ScalarSpecInput, kind: 'uniform' | 'param'): {
    default: number;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    section?: string;
    description?: string;
    options?: unknown;
} {
    if (typeof input === 'number') {
        return { default: input };
    }

    if (Array.isArray(input)) {
        const [defaultValue, min, max, step] = input;
        if (input.length < 3) {
            throw new Error(`${capitalize(kind)} '${key}' tuple must be [default, min, max, step?].`);
        }
        return { default: defaultValue, min, max, step };
    }

    if (input && typeof input === 'object') {
        return input;
    }

    throw new Error(`${capitalize(kind)} '${key}' must be a number, a [default, min, max, step?] tuple, or a spec object.`);
}

function normalizeFieldSpecs(specs: Record<string, FieldSpecInput> | undefined): SceneFieldDefinition[] {
    if (!specs) {
        return [];
    }

    return Object.entries(specs).map(([key, input]) => {
        const trimmedKey = key.trim();
        const spec = typeof input === 'string' ? { fn: input } : input;
        if (!trimmedKey || !spec || typeof spec.fn !== 'string' || spec.fn.trim().length === 0) {
            throw new Error(`Field '${key}' must name a GLSL function via 'fn'.`);
        }

        const type = spec.type ?? 'float';
        if (!SCENE_FIELD_TYPES.has(type)) {
            throw new Error(`Field '${trimmedKey}' has invalid type '${type}'.`);
        }

        const minValue = readFiniteNumber(spec.min) ?? -1;
        const maxValue = readFiniteNumber(spec.max) ?? 1;
        if (maxValue <= minValue) {
            throw new Error(`Field '${trimmedKey}' has an invalid range (min ${minValue}, max ${maxValue}).`);
        }

        return {
            key: trimmedKey,
            label: spec.label?.trim() || deriveLabel(trimmedKey),
            fn: spec.fn.trim(),
            type: type as SceneFieldType,
            minValue,
            maxValue,
            description: spec.description?.trim() || undefined,
        };
    });
}

function normalizePostprocessSteps(steps: PostprocessStepInput[] | undefined): NormalizedPostprocessStep[] {
    if (!steps) {
        return [];
    }

    if (!Array.isArray(steps)) {
        throw new Error('`postprocess` must be an array of steps.');
    }

    return steps.map((step, index) => {
        if (typeof step === 'function') {
            return { kind: 'inline' as const, name: `step ${index + 1}`, transform: step };
        }

        if (step && typeof step === 'object' && (step as PostprocessRef).kind === 'postprocess-ref') {
            const ref = step as PostprocessRef;
            return { ...ref, params: { ...ref.params } };
        }

        if (step && typeof step === 'object' && typeof (step as { transform?: unknown }).transform === 'function') {
            const inline = step as { name?: string; transform: PostprocessTransform };
            return {
                kind: 'inline' as const,
                name: typeof inline.name === 'string' && inline.name.trim().length > 0 ? inline.name.trim() : `step ${index + 1}`,
                transform: inline.transform,
            };
        }

        throw new Error(`Postprocess step ${index + 1} must be usePostprocess(...), a transform function, or { name, transform }.`);
    });
}

function readPresetRef(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function deriveLabel(key: string): string {
    const withoutUniformPrefix = key.replace(/^u(?=[A-Z])/, '');
    const withSpaces = withoutUniformPrefix
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();
    if (!withSpaces) {
        return key;
    }

    return withSpaces
        .split(/\s+/)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}

function deriveStep(min: number, max: number): number {
    const span = max - min;
    const rough = span / 100;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / magnitude;
    const nice = residual >= 5 ? 5 : residual >= 2 ? 2 : 1;
    return nice * magnitude;
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
