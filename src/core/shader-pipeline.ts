import defaultSceneSource from '../shaders/scenes/defaultScene.glsl?raw';
import environmentSource from '../shaders/lib/environment.glsl?raw';
import materialsSource from '../shaders/lib/materials.glsl?raw';
import raymarchSource from '../shaders/lib/raymarch.glsl?raw';
import rendererFragmentTemplateSource from '../shaders/renderer.frag.glsl?raw';
import rendererVertexSource from '../shaders/renderer.vert.glsl?raw';
import sdfPrimitivesSource from '../shaders/lib/sdf-primitives.glsl?raw';
import slicerFragmentTemplateSource from '../shaders/slicer.frag.glsl?raw';
import slicerVertexSource from '../shaders/slicer.vert.glsl?raw';
import utilsSource from '../shaders/lib/utils.glsl?raw';
import { parseSceneControlDefinitions, parseSceneDefaultParams, readSceneNumberParam } from './shaders/scene-parser';
import type {
    SceneControlDefinition,
    SceneControlValueMap,
    SceneDocument,
    SceneOption,
    SceneParamMap,
    SceneSlicerDefaults,
} from './shaders/types';
export type {
    SceneControlDefinition,
    SceneControlValueMap,
    SceneDocument,
    SceneOption,
    SceneParamMap,
    SceneParamValue,
    SceneSlicerDefaults,
} from './shaders/types';

const sceneSourceModules = import.meta.glob('../shaders/scenes/*.glsl', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

const sceneHotDependencyPaths = Object.keys(
    import.meta.glob('../shaders/scenes/*.glsl', {
        query: '?raw',
        import: 'default',
    })
);

export interface ShaderSourceUpdates {
    rendererVertex?: string;
    rendererFragmentTemplate?: string;
    slicerVertex?: string;
    slicerFragmentTemplate?: string;
    scene?: string;
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
    scene: string;
    raymarch: string;
    sdfPrimitives: string;
    environment: string;
    materials: string;
    utils: string;
}

interface SceneEntry extends SceneDocument {
    controls: SceneControlDefinition[];
}

interface ShaderPipelineRuntimeState {
    activeSceneId?: string;
}

const ACTIVE_SCENE_STORAGE_KEY = 'implicit.activeScene.v1';

const sceneEntries: SceneEntry[] = buildSceneEntries({
    ...sceneSourceModules,
});
if (sceneEntries.length === 0) {
    sceneEntries.push({
        id: 'defaultScene',
        name: 'Default Scene',
        fileName: 'defaultScene.glsl',
        source: defaultSceneSource,
        controls: parseSceneControlDefinitions(defaultSceneSource),
    });
}

const runtimeState: ShaderPipelineRuntimeState = ((globalThis as any).__implicitShaderPipelineState as ShaderPipelineRuntimeState | undefined) ?? {};
(globalThis as any).__implicitShaderPipelineState = runtimeState;

let activeSceneId: string = resolveInitialActiveSceneId();
runtimeState.activeSceneId = activeSceneId;

let activeSources: ShaderSources = {
    rendererVertex: rendererVertexSource,
    rendererFragmentTemplate: rendererFragmentTemplateSource,
    slicerVertex: slicerVertexSource,
    slicerFragmentTemplate: slicerFragmentTemplateSource,
    scene: getSceneSourceById(activeSceneId),
    raymarch: raymarchSource,
    sdfPrimitives: sdfPrimitivesSource,
    environment: environmentSource,
    materials: materialsSource,
    utils: utilsSource,
};

export function getImportedShaderSources(): ShaderSourceUpdates {
    return {
        rendererVertex: rendererVertexSource,
        rendererFragmentTemplate: rendererFragmentTemplateSource,
        slicerVertex: slicerVertexSource,
        slicerFragmentTemplate: slicerFragmentTemplateSource,
        scene: getSceneSourceById(activeSceneId),
        raymarch: raymarchSource,
        sdfPrimitives: sdfPrimitivesSource,
        environment: environmentSource,
        materials: materialsSource,
        utils: utilsSource,
    };
}

export function getAvailableScenes(): SceneOption[] {
    return sceneEntries.map((scene) => ({ id: scene.id, name: scene.name }));
}

export function getSceneDocuments(): SceneDocument[] {
    return sceneEntries.map((scene) => ({
        id: scene.id,
        name: scene.name,
        fileName: scene.fileName,
        source: scene.source,
    }));
}

export function getActiveSceneId(): string {
    return activeSceneId;
}

export function getActiveSceneFileName(): string | null {
    const entry = resolveSceneEntryById(activeSceneId);
    return entry?.fileName ?? null;
}

export function getSceneControlDefinitions(sceneId: string = activeSceneId): SceneControlDefinition[] {
    const entry = resolveSceneEntryById(sceneId);
    return entry?.controls.map((control) => ({ ...control })) ?? [];
}

export function replaceSceneDocuments(documents: SceneDocument[]): SceneDocument[] {
    const nextEntries = buildSceneEntries(
        Object.fromEntries(
            documents.map((document) => [document.fileName, document.source])
        )
    );

    if (nextEntries.length === 0) {
        return getSceneDocuments();
    }

    sceneEntries.length = 0;
    sceneEntries.push(...nextEntries);

    const resolvedActive = resolveSceneEntryById(activeSceneId) ?? sceneEntries[0];
    activeSceneId = resolvedActive?.id ?? activeSceneId;
    runtimeState.activeSceneId = activeSceneId;
    activeSources = {
        ...activeSources,
        scene: getSceneSourceById(activeSceneId),
    };

    return getSceneDocuments();
}

export function upsertSceneDocument(document: SceneDocument): SceneDocument {
    const normalized = normalizeSceneDocument(document);
    const existing = resolveSceneEntryById(normalized.id);

    if (existing) {
        existing.id = normalized.id;
        existing.name = normalized.name;
        existing.fileName = normalized.fileName;
        existing.source = normalized.source;
        existing.controls = parseSceneControlDefinitions(normalized.source);
    } else {
        sceneEntries.push({
            ...normalized,
            controls: parseSceneControlDefinitions(normalized.source),
        });
        sceneEntries.sort((left, right) => left.name.localeCompare(right.name));
    }

    if (normalizeSceneId(activeSceneId) === normalizeSceneId(normalized.id)) {
        activeSceneId = normalized.id;
        runtimeState.activeSceneId = normalized.id;
        activeSources = {
            ...activeSources,
            scene: normalized.source,
        };
    }

    return {
        id: normalized.id,
        name: normalized.name,
        fileName: normalized.fileName,
        source: normalized.source,
    };
}

export function updateSceneSourceById(sceneId: string, source: string): boolean {
    const entry = resolveSceneEntryById(sceneId);
    if (!entry) {
        return false;
    }

    entry.source = source;
    entry.controls = parseSceneControlDefinitions(source);
    if (entry.id === activeSceneId) {
        activeSources = {
            ...activeSources,
            scene: source,
        };
    }

    return true;
}

export function setActiveSceneById(sceneId: string): boolean {
    const nextEntry = resolveSceneEntryById(sceneId);
    if (!nextEntry) {
        return false;
    }

    activeSceneId = nextEntry.id;
    runtimeState.activeSceneId = nextEntry.id;
    storeActiveSceneId(nextEntry.id);
    activeSources = {
        ...activeSources,
        scene: nextEntry.source,
    };
    return true;
}

export function applyShaderSourceUpdates(updates: ShaderSourceUpdates): void {
    activeSources = {
        rendererVertex: updates.rendererVertex ?? activeSources.rendererVertex,
        rendererFragmentTemplate: updates.rendererFragmentTemplate ?? activeSources.rendererFragmentTemplate,
        slicerVertex: updates.slicerVertex ?? activeSources.slicerVertex,
        slicerFragmentTemplate: updates.slicerFragmentTemplate ?? activeSources.slicerFragmentTemplate,
        scene: updates.scene ?? activeSources.scene,
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
    return activeSources.rendererFragmentTemplate
        .replace('__SDF_PRIMITIVES_GLSL__', activeSources.sdfPrimitives)
        .replace('__UTILS_GLSL__', activeSources.utils)
        .replace('__SCENE_GLSL__', activeSources.scene)
        .replace('__RAYMARCH_GLSL__', activeSources.raymarch)
        .replace('__ENVIRONMENT_GLSL__', activeSources.environment)
        .replace('__MATERIALS_GLSL__', activeSources.materials);
}

export function getSlicerVertexSource(): string {
    return activeSources.slicerVertex;
}

export function composeSlicerFragmentSource(): string {
    return activeSources.slicerFragmentTemplate
        .replace('__SDF_PRIMITIVES_GLSL__', activeSources.sdfPrimitives)
        .replace('__UTILS_GLSL__', activeSources.utils)
        .replace('__SCENE_GLSL__', activeSources.scene);
}

export function getSlicerProgramSignature(): string {
    return `${activeSources.slicerVertex}::${composeSlicerFragmentSource()}`;
}

export function getSceneDefaultParams(): SceneParamMap {
    return parseSceneDefaultParams(activeSources.scene);
}

export function getSceneSlicerDefaults(): SceneSlicerDefaults {
    const params = getSceneDefaultParams();
    const defaults: SceneSlicerDefaults = {};

    const minY = readSceneNumberParam(params, ['minY']);
    const maxY = readSceneNumberParam(params, ['maxY']);
    const modelScale = readSceneNumberParam(params, ['modelScale'], true);
    const maxRadius = readSceneNumberParam(params, ['maxRadius'], true);
    const nozzleDiameterMm = readSceneNumberParam(params, ['nozzleDiameterMm', 'nozzleDiameter'], true);
    const flowRate = readSceneNumberParam(params, ['flowRate'], true);
    const layerHeightMm = readSceneNumberParam(params, ['layerHeightMm', 'layerHeight'], true);

    if (typeof minY === 'number') {
        defaults.minY = minY;
    }
    if (typeof maxY === 'number') {
        defaults.maxY = maxY;
    }
    if (typeof modelScale === 'number') {
        defaults.modelScale = modelScale;
    }
    if (typeof maxRadius === 'number') {
        defaults.maxRadius = maxRadius;
    }
    if (typeof nozzleDiameterMm === 'number') {
        defaults.nozzleDiameterMm = nozzleDiameterMm;
    }
    if (typeof flowRate === 'number') {
        defaults.flowRate = flowRate;
    }
    if (typeof layerHeightMm === 'number') {
        defaults.layerHeightMm = layerHeightMm;
    }

    return defaults;
}

function buildSceneEntries(modules: Record<string, string | { default: string }>): SceneEntry[] {
    const deduped = new Map<string, SceneEntry>();

    Object.entries(modules)
        .map(([path, module]) => {
            const filename = path.split('/').pop() ?? '';
            const id = filename.replace(/\.glsl(?:\?raw)?$/i, '');
            const name = toSceneLabel(id);
            const source = typeof module === 'string'
                ? module
                : typeof module.default === 'string'
                    ? module.default
                    : '';
            return {
                id,
                name,
                fileName: filename,
                source,
                controls: parseSceneControlDefinitions(source),
            };
        })
        .filter((entry) => entry.id.length > 0)
        .forEach((entry) => {
            const existing = deduped.get(entry.id);
            if (!existing || (existing.source.length === 0 && entry.source.length > 0)) {
                deduped.set(entry.id, entry);
            }
        });

    return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSceneDocument(document: SceneDocument): SceneDocument {
    const fileName = normalizeSceneFileName(document.fileName || document.id);
    const fallbackId = fileName.replace(/\.glsl$/i, '');
    const id = document.id.trim().length > 0 ? document.id.trim() : fallbackId;

    return {
        id,
        name: document.name.trim().length > 0 ? document.name.trim() : toSceneLabel(id),
        fileName,
        source: document.source,
    };
}

function normalizeSceneFileName(value: string): string {
    const sanitized = value
        .trim()
        .replace(/[\\/]+/g, '_')
        .replace(/^\.+/, '')
        .replace(/\s+/g, ' ');
    if (sanitized.toLowerCase().endsWith('.glsl')) {
        return sanitized;
    }

    return `${sanitized || 'scene'}.glsl`;
}

function getSceneSourceById(sceneId: string): string {
    const entry = resolveSceneEntryById(sceneId);
    if (entry) {
        return entry.source;
    }

    const fallback = sceneEntries[0];
    return fallback?.source ?? '';
}

function resolveSceneEntryById(sceneId: string): SceneEntry | undefined {
    const normalizedTarget = normalizeSceneId(sceneId);
    if (!normalizedTarget) {
        return undefined;
    }

    return sceneEntries.find((scene) => normalizeSceneId(scene.id) === normalizedTarget);
}

function normalizeSceneId(sceneId: string): string {
    return sceneId
        .trim()
        .replace(/\.glsl$/i, '')
        .replace(/[-\s]+/g, '_')
        .toLowerCase();
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
    const fromRuntime = runtimeState.activeSceneId;
    const fromSession = readStoredActiveSceneId();
    const fromDefault = sceneEntries[0]?.id;
    const candidate = fromRuntime ?? fromSession ?? fromDefault ?? 'defaultScene';
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

if (import.meta.hot && sceneHotDependencyPaths.length > 0) {
    import.meta.hot.accept(sceneHotDependencyPaths, (nextModules) => {
        const modules = Array.isArray(nextModules) ? nextModules : [nextModules];
        const byId = new Map(sceneEntries.map((entry) => [entry.id, entry]));

        for (let index = 0; index < sceneHotDependencyPaths.length; index += 1) {
            const path = sceneHotDependencyPaths[index];
            if (!path) {
                continue;
            }

            const filename = path.split('/').pop() ?? '';
            const id = filename.replace(/\.glsl(?:\?raw)?$/i, '');
            if (!id) {
                continue;
            }

            const moduleValue = modules[index] as string | { default?: string } | undefined;
            const source = typeof moduleValue === 'string'
                ? moduleValue
                : typeof moduleValue?.default === 'string'
                    ? moduleValue.default
                    : '';

            const existing = byId.get(id);
            if (existing) {
                existing.fileName = filename;
                existing.source = source;
                existing.name = toSceneLabel(id);
                existing.controls = parseSceneControlDefinitions(source);
            } else {
                byId.set(id, {
                    id,
                    name: toSceneLabel(id),
                    fileName: filename,
                    source,
                    controls: parseSceneControlDefinitions(source),
                });
            }
        }

        sceneEntries.length = 0;
        sceneEntries.push(...Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name)));

        const activeEntry = resolveSceneEntryById(activeSceneId);
        if (activeEntry) {
            activeSources = {
                ...activeSources,
                scene: activeEntry.source,
            };
        }
    });
}
