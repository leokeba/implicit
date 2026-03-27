import defaultSceneSource from '../shaders/scenes/defaultScene.glsl?raw';
import environmentSource from '../shaders/lib/environment.glsl?raw';
import materialsSource from '../shaders/lib/materials.glsl?raw';
import raymarchSource from '../shaders/lib/raymarch.glsl?raw';
import rendererFragmentTemplateSource from '../shaders/renderer.frag.glsl?raw';
import rendererVertexSource from '../shaders/renderer.vert.glsl?raw';
import sdfPrimitivesSource from '../shaders/lib/sdf-primitives.glsl?raw';
import slicerFragmentTemplateSource from '../shaders/slicer.frag.glsl?raw';
import slicerVertexSource from '../shaders/slicer.vert.glsl?raw';

const sceneSourceModules = (
    import.meta.glob as unknown as (pattern: string, options: { as: 'raw'; eager: true }) => Record<string, string>
)('../shaders/scenes/*.glsl', {
    as: 'raw',
    eager: true,
});

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
}

export interface SceneSlicerDefaults {
    minY?: number;
    maxY?: number;
    modelScale?: number;
    maxRadius?: number;
    nozzleDiameterMm?: number;
    flowRate?: number;
    layerHeightMm?: number;
}

export interface SceneOption {
    id: string;
    name: string;
}

interface SceneEntry extends SceneOption {
    source: string;
}

const sceneEntries: SceneEntry[] = buildSceneEntries(sceneSourceModules);
if (sceneEntries.length === 0) {
    sceneEntries.push({ id: 'defaultScene', name: 'Default Scene', source: defaultSceneSource });
}
let activeSceneId: string = sceneEntries[0]?.id ?? 'defaultScene';

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
    };
}

export function getAvailableScenes(): SceneOption[] {
    return sceneEntries.map((scene) => ({ id: scene.id, name: scene.name }));
}

export function getActiveSceneId(): string {
    return activeSceneId;
}

export function setActiveSceneById(sceneId: string): boolean {
    const nextEntry = resolveSceneEntryById(sceneId);
    if (!nextEntry) {
        return false;
    }

    activeSceneId = nextEntry.id;
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
    };
}

export function getRendererVertexSource(): string {
    return activeSources.rendererVertex;
}

export function composeRendererFragmentSource(): string {
    return activeSources.rendererFragmentTemplate
    .replace('__SDF_PRIMITIVES_GLSL__', activeSources.sdfPrimitives)
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
        .replace('__SCENE_GLSL__', activeSources.scene);
}

export function getSlicerProgramSignature(): string {
    return `${activeSources.slicerVertex}::${composeSlicerFragmentSource()}`;
}

export function getSceneSlicerDefaults(): SceneSlicerDefaults {
    return parseSceneSlicerDefaults(activeSources.scene);
}

function parseSceneSlicerDefaults(sceneSource: string): SceneSlicerDefaults {
    const defaults: SceneSlicerDefaults = {};
    const readPositive = (macroName: string): number | undefined => {
        const parsed = readDefineNumber(sceneSource, macroName);
        if (typeof parsed !== 'number' || parsed <= 0) {
            return undefined;
        }
        return parsed;
    };

    const minY = readDefineNumber(sceneSource, 'SCENE_DEFAULT_MIN_Y');
    const maxY = readDefineNumber(sceneSource, 'SCENE_DEFAULT_MAX_Y');
    const modelScale = readPositive('SCENE_DEFAULT_MODEL_SCALE');
    const maxRadius = readPositive('SCENE_DEFAULT_MAX_RADIUS');
    const nozzleDiameterMm = readPositive('SCENE_DEFAULT_NOZZLE_DIAMETER_MM');
    const flowRate = readPositive('SCENE_DEFAULT_FLOW_RATE');
    const layerHeightMm = readPositive('SCENE_DEFAULT_LAYER_HEIGHT_MM');

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

function readDefineNumber(source: string, macroName: string): number | undefined {
    const escapedName = macroName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`#define\\s+${escapedName}\\s+([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)`));
    if (!match?.[1]) {
        return undefined;
    }

    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return parsed;
}

function buildSceneEntries(modules: Record<string, string>): SceneEntry[] {
    return Object.entries(modules)
        .map(([path, source]) => {
            const filename = path.split('/').pop() ?? '';
            const id = filename.replace(/\.glsl(?:\?raw)?$/i, '');
            const name = toSceneLabel(id);
            return { id, name, source };
        })
        .filter((entry) => entry.id.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
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
