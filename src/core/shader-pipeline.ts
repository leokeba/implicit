import type { SceneManifest } from '../scene-runtime';
import { evaluateSceneManifest } from './scene-manifest';
import {
    buildEngineUniformBlock,
    RENDERER_ENGINE_UNIFORMS,
    SCENE_FIELD_SAMPLER_ENGINE_UNIFORMS,
    SLICER_ENGINE_UNIFORMS,
} from './shaders/engine-uniforms';
import type {
    SceneControlDefinition,
    SceneFieldDefinition,
    SceneOption,
} from './shaders/types';

import environmentSource from '../shaders/lib/environment.glsl?raw';
import materialsSource from '../shaders/lib/materials.glsl?raw';
import raymarchSource from '../shaders/lib/raymarch.glsl?raw';
import rendererFragmentTemplateSource from '../shaders/renderer.frag.glsl?raw';
import rendererVertexSource from '../shaders/renderer.vert.glsl?raw';
import sceneFieldSampleFragmentTemplateSource from '../shaders/scene-field-sample.frag.glsl?raw';
import sceneFieldSampleVertexSource from '../shaders/scene-field-sample.vert.glsl?raw';
import sdfPrimitivesSource from '../shaders/lib/sdf-primitives.glsl?raw';
import slicerFragmentTemplateSource from '../shaders/slicer.frag.glsl?raw';
import slicerVertexSource from '../shaders/slicer.vert.glsl?raw';
import utilsSource from '../shaders/lib/utils.glsl?raw';

export type {
    SceneControlDefinition,
    SceneControlValueMap,
    SceneFieldDefinition,
    SceneFieldType,
    SceneFieldValue,
    SceneOption,
} from './shaders/types';

export const SCENE_GLSL_FILE = 'scene.glsl';

/** All sources of one scene folder, keyed by file name (scene.glsl, scene.ts, helpers...). */
export type SceneFiles = Record<string, string>;

export interface SceneBundle {
    id: string;
    name: string;
    files: SceneFiles;
}

interface SceneEntry {
    id: string;
    name: string;
    files: SceneFiles;
    manifest: SceneManifest;
    manifestError: string | null;
}

const ACTIVE_SCENE_STORAGE_KEY = 'implicit.activeScene.v1';

const bundledSceneModules = import.meta.glob('../scenes/*/*', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

export interface ShaderSourceUpdates {
    rendererVertex?: string;
    rendererFragmentTemplate?: string;
    slicerVertex?: string;
    slicerFragmentTemplate?: string;
    raymarch?: string;
    sdfPrimitives?: string;
    environment?: string;
    materials?: string;
    utils?: string;
}

interface ShaderSources {
    rendererVertex: string;
    rendererFragmentTemplate: string;
    slicerVertex: string;
    slicerFragmentTemplate: string;
    raymarch: string;
    sdfPrimitives: string;
    environment: string;
    materials: string;
    utils: string;
}

const sceneEntries: SceneEntry[] = buildSceneEntriesFromModules(bundledSceneModules);

let activeSceneId: string = resolveInitialActiveSceneId();

let activeSources: ShaderSources = {
    rendererVertex: rendererVertexSource,
    rendererFragmentTemplate: rendererFragmentTemplateSource,
    slicerVertex: slicerVertexSource,
    slicerFragmentTemplate: slicerFragmentTemplateSource,
    raymarch: raymarchSource,
    sdfPrimitives: sdfPrimitivesSource,
    environment: environmentSource,
    materials: materialsSource,
    utils: utilsSource,
};

export function getAvailableScenes(): SceneOption[] {
    return sceneEntries.map((scene) => ({ id: scene.id, name: scene.name }));
}

export function getSceneBundles(): SceneBundle[] {
    return sceneEntries.map(toSceneBundle);
}

export function getActiveSceneId(): string {
    return activeSceneId;
}

export function getActiveSceneManifest(): SceneManifest {
    return requireActiveEntry().manifest;
}

export function getActiveSceneManifestError(): string | null {
    return requireActiveEntry().manifestError;
}

export function getActiveSceneFiles(): SceneFiles {
    return { ...requireActiveEntry().files };
}

export function getSceneControlDefinitions(sceneId: string = activeSceneId): SceneControlDefinition[] {
    const entry = resolveSceneEntryById(sceneId);
    if (!entry) {
        return [];
    }

    return entry.manifest.uniforms.map((spec) => ({
        key: spec.key,
        label: spec.label,
        uniform: spec.key,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        defaultValue: spec.defaultValue,
        section: spec.section,
        description: spec.description,
        options: spec.options,
        hasControl: spec.hasControl,
    }));
}

export function getSceneFieldDefinitions(sceneId: string = activeSceneId): SceneFieldDefinition[] {
    const entry = resolveSceneEntryById(sceneId);
    return entry?.manifest.fields.map((field) => ({ ...field })) ?? [];
}

/**
 * Cross-checks the manifest's uniform declarations against scene.glsl.
 * A declared-but-unreferenced uniform is otherwise silently dropped by the
 * GLSL compiler (its location resolves to null), so the author gets no
 * signal that a control does nothing.
 */
export function getSceneUniformContractWarnings(sceneId: string = activeSceneId): string[] {
    const entry = resolveSceneEntryById(sceneId);
    if (!entry) {
        return [];
    }

    const glsl = entry.files[SCENE_GLSL_FILE] ?? '';
    const warnings: string[] = [];
    for (const spec of entry.manifest.uniforms) {
        const usage = new RegExp(`\\b${spec.key}\\b`);
        if (!usage.test(glsl)) {
            warnings.push(`Uniform '${spec.key}' is declared in scene.ts but never referenced in scene.glsl; its control has no effect.`);
        }
    }

    return warnings;
}

export function replaceSceneBundles(bundles: SceneBundle[]): SceneBundle[] {
    const nextEntries = bundles
        .filter((bundle) => bundle.id.trim().length > 0)
        .map((bundle) => buildSceneEntry(bundle.id, bundle.files));

    if (nextEntries.length === 0) {
        return getSceneBundles();
    }

    sceneEntries.length = 0;
    sceneEntries.push(...sortSceneEntries(nextEntries));

    const resolvedActive = resolveSceneEntryById(activeSceneId) ?? sceneEntries[0];
    activeSceneId = resolvedActive?.id ?? activeSceneId;

    return getSceneBundles();
}

export function upsertSceneFile(sceneId: string, fileName: string, source: string): SceneBundle {
    const existing = resolveSceneEntryById(sceneId);
    const files: SceneFiles = existing ? { ...existing.files, [fileName]: source } : { [fileName]: source };
    const nextEntry = buildSceneEntry(existing?.id ?? sceneId.trim(), files);

    if (existing) {
        const index = sceneEntries.indexOf(existing);
        sceneEntries[index] = nextEntry;
    } else {
        sceneEntries.push(nextEntry);
        sortSceneEntriesInPlace();
    }

    return toSceneBundle(nextEntry);
}

export function setActiveSceneById(sceneId: string): boolean {
    const nextEntry = resolveSceneEntryById(sceneId);
    if (!nextEntry) {
        return false;
    }

    activeSceneId = nextEntry.id;
    storeActiveSceneId(nextEntry.id);
    return true;
}

export function applyShaderSourceUpdates(updates: ShaderSourceUpdates): void {
    activeSources = {
        rendererVertex: updates.rendererVertex ?? activeSources.rendererVertex,
        rendererFragmentTemplate: updates.rendererFragmentTemplate ?? activeSources.rendererFragmentTemplate,
        slicerVertex: updates.slicerVertex ?? activeSources.slicerVertex,
        slicerFragmentTemplate: updates.slicerFragmentTemplate ?? activeSources.slicerFragmentTemplate,
        raymarch: updates.raymarch ?? activeSources.raymarch,
        sdfPrimitives: updates.sdfPrimitives ?? activeSources.sdfPrimitives,
        environment: updates.environment ?? activeSources.environment,
        materials: updates.materials ?? activeSources.materials,
        utils: updates.utils ?? activeSources.utils,
    };
}

export function getRendererVertexSource(): string {
    return activeSources.rendererVertex;
}

export function composeRendererFragmentSource(): string {
    const entry = requireActiveEntry();
    // The Modifier Values view visualizes exactly one field; by convention it
    // is the manifest's first. All declared fields are still sampled for
    // postprocess scripts — this choice only affects the debug view.
    const activeField = entry.manifest.fields[0] ?? null;
    return substituteTokens(activeSources.rendererFragmentTemplate, {
        __ENGINE_UNIFORMS_GLSL__: buildEngineUniformBlock(RENDERER_ENGINE_UNIFORMS),
        __SDF_PRIMITIVES_GLSL__: activeSources.sdfPrimitives,
        __UTILS_GLSL__: activeSources.utils,
        __SCENE_GLSL__: composeSceneGlsl(entry),
        __RAYMARCH_GLSL__: activeSources.raymarch,
        __ENVIRONMENT_GLSL__: activeSources.environment,
        __MATERIALS_GLSL__: activeSources.materials,
        __MODIFIER_VIEW_GLSL__: buildModifierViewSource(activeField),
    });
}

export function getSlicerVertexSource(): string {
    return activeSources.slicerVertex;
}

export function composeSlicerFragmentSource(): string {
    return substituteTokens(activeSources.slicerFragmentTemplate, {
        __ENGINE_UNIFORMS_GLSL__: buildEngineUniformBlock(SLICER_ENGINE_UNIFORMS),
        __SDF_PRIMITIVES_GLSL__: activeSources.sdfPrimitives,
        __UTILS_GLSL__: activeSources.utils,
        __SCENE_GLSL__: composeSceneGlsl(requireActiveEntry()),
    });
}

export function getSceneFieldSamplerVertexSource(): string {
    return sceneFieldSampleVertexSource;
}

export function composeSceneFieldSamplerFragmentSource(field: SceneFieldDefinition, componentIndex: number): string {
    return substituteTokens(sceneFieldSampleFragmentTemplateSource, {
        __ENGINE_UNIFORMS_GLSL__: buildEngineUniformBlock(SCENE_FIELD_SAMPLER_ENGINE_UNIFORMS),
        __SDF_PRIMITIVES_GLSL__: activeSources.sdfPrimitives,
        __UTILS_GLSL__: activeSources.utils,
        __SCENE_GLSL__: composeSceneGlsl(requireActiveEntry()),
        __FIELD_COMPONENT_GLSL__: buildSceneFieldComponentSource(field, componentIndex),
    });
}

/**
 * The same point sampler, pointed at the scene's own distance function.
 *
 * Surface marching needs `mapScene` at arbitrary positions rather than on a
 * plane grid, and that is exactly what the scene-field sampler already does
 * for a named field - so it is reused verbatim with `mapScene` substituted
 * for the field body, rather than growing a second point-sampling path.
 */
export function composeScenePointDistanceFragmentSource(): string {
    return substituteTokens(sceneFieldSampleFragmentTemplateSource, {
        __ENGINE_UNIFORMS_GLSL__: buildEngineUniformBlock(SCENE_FIELD_SAMPLER_ENGINE_UNIFORMS),
        __SDF_PRIMITIVES_GLSL__: activeSources.sdfPrimitives,
        __UTILS_GLSL__: activeSources.utils,
        __SCENE_GLSL__: composeSceneGlsl(requireActiveEntry()),
        __FIELD_COMPONENT_GLSL__: 'float sampleSceneFieldComponent(vec3 p) { return mapScene(p); }',
    });
}

export function getSlicerProgramSignature(): string {
    return `${activeSources.slicerVertex}::${composeSlicerFragmentSource()}`;
}

/**
 * Fills every placeholder token exactly once and fails loudly when a template
 * is missing one — a mangled template surfaces as a readable status message
 * instead of an opaque GLSL compile error about an unsubstituted token.
 */
function substituteTokens(template: string, replacements: Record<string, string>): string {
    let source = template;
    for (const [token, replacement] of Object.entries(replacements)) {
        const index = source.indexOf(token);
        if (index === -1) {
            throw new Error(`Shader template is missing the ${token} placeholder.`);
        }
        source = source.slice(0, index) + replacement + source.slice(index + token.length);
    }
    return source;
}

function composeSceneGlsl(entry: SceneEntry): string {
    const glsl = entry.files[SCENE_GLSL_FILE] ?? '';
    const uniformBlock = buildSceneUniformBlock(entry.manifest);
    // Marker comments delimit the author's scene.glsl inside the composed
    // source so compile errors can be reported with scene-relative line
    // numbers (see core/gl/program.ts). They travel with the source through
    // worker postMessage and hot reload, so no side-channel is needed.
    const markedGlsl = `// __SCENE_GLSL_BEGIN__\n${glsl}\n// __SCENE_GLSL_END__`;
    return uniformBlock.length > 0 ? `${uniformBlock}\n\n${markedGlsl}` : markedGlsl;
}

function buildSceneUniformBlock(manifest: SceneManifest): string {
    return manifest.uniforms
        .map((spec) => `uniform float ${spec.key};`)
        .join('\n');
}

function buildSceneEntriesFromModules(modules: Record<string, string>): SceneEntry[] {
    const filesByScene = new Map<string, SceneFiles>();

    for (const [modulePath, source] of Object.entries(modules)) {
        const segments = modulePath.split('/');
        const fileName = segments.pop() ?? '';
        const sceneId = segments.pop() ?? '';
        if (!sceneId || !fileName) {
            continue;
        }

        const files = filesByScene.get(sceneId) ?? {};
        files[fileName] = typeof source === 'string' ? source : '';
        filesByScene.set(sceneId, files);
    }

    return sortSceneEntries(
        Array.from(filesByScene.entries()).map(([sceneId, files]) => buildSceneEntry(sceneId, files))
    );
}

function buildSceneEntry(sceneId: string, files: SceneFiles): SceneEntry {
    const evaluation = evaluateSceneManifest(sceneId, files);
    return {
        id: sceneId,
        name: evaluation.manifest.title ?? toSceneLabel(sceneId),
        files,
        manifest: evaluation.manifest,
        manifestError: evaluation.error,
    };
}

function toSceneBundle(entry: SceneEntry): SceneBundle {
    return {
        id: entry.id,
        name: entry.name,
        files: { ...entry.files },
    };
}

function sortSceneEntries(entries: SceneEntry[]): SceneEntry[] {
    return entries.slice().sort((left, right) => left.name.localeCompare(right.name));
}

function sortSceneEntriesInPlace(): void {
    sceneEntries.sort((left, right) => left.name.localeCompare(right.name));
}

function requireActiveEntry(): SceneEntry {
    const entry = resolveSceneEntryById(activeSceneId) ?? sceneEntries[0];
    if (!entry) {
        throw new Error('No scenes are available. Add a folder under src/scenes/<id>/ with a scene.glsl.');
    }

    return entry;
}

function buildSceneFieldComponentSource(field: SceneFieldDefinition, componentIndex: number): string {
    const fnCall = `${field.fn}(p)`;
    switch (field.type) {
        case 'float':
            return `float sampleSceneFieldComponent(vec3 p) { return ${fnCall}; }`;
        case 'vec2':
            return `float sampleSceneFieldComponent(vec3 p) { vec2 value = ${fnCall}; return ${componentSwizzle(componentIndex, 2)}; }`;
        case 'vec3':
            return `float sampleSceneFieldComponent(vec3 p) { vec3 value = ${fnCall}; return ${componentSwizzle(componentIndex, 3)}; }`;
        case 'vec4':
            return `float sampleSceneFieldComponent(vec3 p) { vec4 value = ${fnCall}; return ${componentSwizzle(componentIndex, 4)}; }`;
        default:
            return 'float sampleSceneFieldComponent(vec3 p) { return 0.0; }';
    }
}

function buildModifierViewSource(field: SceneFieldDefinition | null): string {
    if (!field) {
        return [
            'float sampleModifierViewValue(vec3 p) {',
            '    return 0.0;',
            '}',
            '',
            'float normalizeModifierViewValue(float value) {',
            '    return clamp(value, 0.0, 1.0);',
            '}',
        ].join('\n');
    }

    const valueExpr = buildFieldScalarExpression(field, 'p');
    const minValue = Number.isFinite(field.minValue) ? field.minValue : 0;
    const maxValue = Number.isFinite(field.maxValue) ? field.maxValue : 1;

    return [
        `float sampleModifierViewValue(vec3 p) {`,
        `    ${valueExpr}`,
        `}`,
        '',
        'float normalizeModifierViewValue(float value) {',
        `    float minValue = ${minValue.toFixed(6)};`,
        `    float maxValue = ${maxValue.toFixed(6)};`,
        '    float span = max(1e-6, maxValue - minValue);',
        '    return clamp((value - minValue) / span, 0.0, 1.0);',
        '}',
    ].join('\n');
}

function buildFieldScalarExpression(field: SceneFieldDefinition, argName: string): string {
    const fnCall = `${field.fn}(${argName})`;
    switch (field.type) {
        case 'vec2':
            return `vec2 value = ${fnCall}; return value.x;`;
        case 'vec3':
            return `vec3 value = ${fnCall}; return value.x;`;
        case 'vec4':
            return `vec4 value = ${fnCall}; return value.x;`;
        case 'float':
        default:
            return `return ${fnCall};`;
    }
}

function componentSwizzle(componentIndex: number, componentCount: number): string {
    const clampedIndex = Math.max(0, Math.min(componentCount - 1, Math.floor(componentIndex)));
    switch (clampedIndex) {
        case 0:
            return 'value.x';
        case 1:
            return 'value.y';
        case 2:
            return 'value.z';
        case 3:
            return 'value.w';
        default:
            return '0.0';
    }
}

function resolveSceneEntryById(sceneId: string): SceneEntry | undefined {
    const target = sceneId.trim();
    if (!target) {
        return undefined;
    }

    return sceneEntries.find((scene) => scene.id === target);
}

function toSceneLabel(sceneId: string): string {
    const withSpaces = sceneId
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();
    if (!withSpaces) {
        return 'Scene';
    }

    return withSpaces
        .split(/\s+/)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}

function resolveInitialActiveSceneId(): string {
    // sessionStorage keeps the selection across reloads and across HMR
    // re-evaluations of this module.
    const fromSession = readStoredActiveSceneId();
    const fromDefault = sceneEntries[0]?.id;
    const candidate = fromSession ?? fromDefault ?? 'defaultScene';
    const entry = resolveSceneEntryById(candidate);
    return entry?.id ?? (sceneEntries[0]?.id ?? 'defaultScene');
}

function readStoredActiveSceneId(): string | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    try {
        const value = window.sessionStorage.getItem(ACTIVE_SCENE_STORAGE_KEY);
        return value ?? undefined;
    } catch {
        return undefined;
    }
}

function storeActiveSceneId(sceneId: string): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.sessionStorage.setItem(ACTIVE_SCENE_STORAGE_KEY, sceneId);
    } catch {
        // Ignore storage write failures.
    }
}
