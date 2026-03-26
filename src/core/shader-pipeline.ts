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
