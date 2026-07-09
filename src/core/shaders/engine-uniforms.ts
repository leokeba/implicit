/**
 * Single registry for engine-owned uniforms (everything not declared by a
 * scene manifest). Each program's GLSL declaration block is generated from
 * these tables, so adding an engine uniform means: add it here, then bind it
 * where the program draws. The fragment templates carry an
 * `__ENGINE_UNIFORMS_GLSL__` placeholder that the shader pipeline fills in.
 */

export type EngineUniformType = 'float' | 'int' | 'vec2' | 'vec3';

export interface EngineUniform {
    name: string;
    type: EngineUniformType;
}

function u(type: EngineUniformType, name: string): EngineUniform {
    return { name, type };
}

/** Print-domain state shared by every program that evaluates the scene SDF. */
const SCENE_DOMAIN_UNIFORMS: EngineUniform[] = [
    u('float', 'uFrameModulo'),
    u('float', 'uFramePeriod'),
    u('float', 'uMinY'),
    u('float', 'uMaxY'),
    u('float', 'uScale'),
    u('float', 'uMaxRadius'),
    u('float', 'uNozzleDiameter'),
    u('float', 'uFlowRate'),
    u('float', 'uLayerHeight'),
    u('float', 'uLineWidth'),
    u('float', 'uFirstLayerLineWidth'),
];

export const RENDERER_ENGINE_UNIFORMS: EngineUniform[] = [
    u('vec2', 'uResolution'),
    u('float', 'uTime'),
    ...SCENE_DOMAIN_UNIFORMS,
    u('vec3', 'uCameraPos'),
    u('vec3', 'uCameraTarget'),
    u('int', 'uViewMode'),
    u('int', 'uMaxSteps'),
    u('float', 'uHitEpsilon'),
    u('float', 'uMaxDistance'),
    u('float', 'uFocalLength'),
    u('float', 'uStepScale'),
    u('float', 'uMinStep'),
    u('float', 'uNormalEpsilon'),
    u('int', 'uRefineSteps'),
    u('float', 'uUiLightTheme'),
];

export const SLICER_ENGINE_UNIFORMS: EngineUniform[] = [
    u('vec2', 'uTextureSize'),
    ...SCENE_DOMAIN_UNIFORMS,
    u('vec2', 'uSliceMin'),
    u('vec2', 'uSliceMax'),
    u('float', 'uSliceY'),
    u('float', 'uSliceYStep'),
    u('float', 'uSliceGridSize'),
    u('float', 'uDistanceRange'),
    u('float', 'uIsoSnapEpsilon'),
];

export const SCENE_FIELD_SAMPLER_ENGINE_UNIFORMS: EngineUniform[] = [
    u('vec2', 'uTextureSize'),
    ...SCENE_DOMAIN_UNIFORMS,
    u('float', 'uFieldMinValue'),
    u('float', 'uFieldMaxValue'),
];

export function buildEngineUniformBlock(uniforms: EngineUniform[]): string {
    return uniforms.map(({ type, name }) => `uniform ${type} ${name};`).join('\n');
}
