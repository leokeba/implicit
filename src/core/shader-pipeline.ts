import defaultSceneSource from '../shaders/scenes/defaultScene.glsl?raw';
import environmentSource from '../shaders/lib/environment.glsl?raw';
import materialsSource from '../shaders/lib/materials.glsl?raw';
import raymarchSource from '../shaders/lib/raymarch.glsl?raw';
import rendererFragmentTemplateSource from '../shaders/renderer.frag.glsl?raw';
import rendererVertexSource from '../shaders/renderer.vert.glsl?raw';
import sdfPrimitivesSource from '../shaders/lib/sdf-primitives.glsl?raw';
import slicerFragmentTemplateSource from '../shaders/slicer.frag.glsl?raw';
import slicerVertexSource from '../shaders/slicer.vert.glsl?raw';

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

let activeSources: ShaderSources = {
    rendererVertex: rendererVertexSource,
    rendererFragmentTemplate: rendererFragmentTemplateSource,
    slicerVertex: slicerVertexSource,
    slicerFragmentTemplate: slicerFragmentTemplateSource,
    scene: defaultSceneSource,
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
        scene: defaultSceneSource,
        raymarch: raymarchSource,
        sdfPrimitives: sdfPrimitivesSource,
        environment: environmentSource,
        materials: materialsSource,
    };
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
