import type { NumericControlOption } from '../core/control-options';
import type { SceneFieldDefinition, SceneFieldType } from '../core/shaders/types';
import type { VaseSlicerSettings } from '../core/slicer';
import type {
    ToolpathPostprocessContext,
    ToolpathPostprocessMutablePoint,
    ToolpathPostprocessResult,
} from '../core/toolpath-postprocess';

/** [default, min, max, step?] */
export type ScalarSpecTuple = [number, number, number] | [number, number, number, number];

export interface ScalarSpecObject {
    default: number;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    section?: string;
    description?: string;
    options?: Array<number | string | NumericControlOption>;
}

/**
 * A bare number declares a fixed value with no inspector control.
 * A tuple or object with min/max gets a slider.
 */
export type ScalarSpecInput = number | ScalarSpecTuple | ScalarSpecObject;

export interface FieldSpecObject {
    fn: string;
    type?: SceneFieldType;
    min?: number;
    max?: number;
    label?: string;
    description?: string;
}

/** A bare string is shorthand for `{ fn: name }`. */
export type FieldSpecInput = string | FieldSpecObject;

export interface SceneSlicerConfigInput extends Partial<VaseSlicerSettings> {
    /** Printer model preset id, e.g. 'prusa-mk4s'. */
    printer?: string;
    /** Filament profile preset id, e.g. 'petg-generic'. */
    filament?: string;
}

export interface PreprocessInput {
    params: Record<string, number>;
    uniforms: Record<string, number>;
    /** Settings resolved so far: defaults -> presets -> static slicer block. */
    slicer: VaseSlicerSettings;
}

export interface PreprocessOutput {
    slicer?: Partial<VaseSlicerSettings>;
    uniforms?: Record<string, number>;
}

export type PreprocessFn = (input: PreprocessInput) => PreprocessOutput | void;

export type PostprocessTransform = (
    context: ToolpathPostprocessContext,
) => void | ToolpathPostprocessMutablePoint[] | ToolpathPostprocessResult;

/** Reference to a generic script (by id) or scene-local module (by relative path). */
export interface PostprocessRef {
    kind: 'postprocess-ref';
    script: string;
    params: Record<string, number>;
}

export interface InlinePostprocessStepInput {
    name?: string;
    transform: PostprocessTransform;
}

export type PostprocessStepInput = PostprocessRef | InlinePostprocessStepInput | PostprocessTransform;

export type NormalizedPostprocessStep =
    | PostprocessRef
    | { kind: 'inline'; name: string; transform: PostprocessTransform };

export interface SceneExportConfig {
    /**
     * Extra filename segment, templated with scene params:
     * '{paramKey}' inserts the value, plus {part}/{part1}/{count} helpers
     * driven by partIndex/partCount params when present.
     */
    filenameSuffix?: string;
}

export interface SceneManifestInput {
    title?: string;
    uniforms?: Record<string, ScalarSpecInput>;
    fields?: Record<string, FieldSpecInput>;
    params?: Record<string, ScalarSpecInput>;
    slicer?: SceneSlicerConfigInput;
    preprocess?: PreprocessFn;
    postprocess?: PostprocessStepInput[];
    export?: SceneExportConfig;
}

/** Normalized scalar input (uniform or param) with derived UI metadata. */
export interface ScalarControlSpec {
    key: string;
    label: string;
    defaultValue: number;
    min: number;
    max: number;
    step: number;
    section: string;
    description?: string;
    options?: NumericControlOption[];
    /** False when the author gave a bare number: fixed value, no slider. */
    hasControl: boolean;
}

export interface SceneManifest {
    /** Brand marker so evaluators can recognize a defineScene result. */
    readonly __implicitSceneManifest: true;
    title: string | null;
    /** Ordered uniform specs; key is the exact GLSL uniform identifier. */
    uniforms: ScalarControlSpec[];
    /** Ordered script-side parameter specs. */
    params: ScalarControlSpec[];
    fields: SceneFieldDefinition[];
    slicer: Partial<VaseSlicerSettings>;
    printer: string | null;
    filament: string | null;
    preprocess: PreprocessFn | null;
    postprocess: NormalizedPostprocessStep[];
    export: SceneExportConfig;
}
