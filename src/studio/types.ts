import type { FilamentProfile } from '../core/filament-profiles';
import type { PrinterModel } from '../core/printer-models';
import type { AnimationParams, RaymarchParams, ViewportParams } from '../core/renderer';
import type { SceneControlDefinition, SceneOption } from '../core/shader-pipeline';
import type { VaseSlicerSettings } from '../core/slicer';
import type { ToolpathChannelSummary } from '../core/toolpath-preview/types';
import type { ScalarControlSpec } from '../scene-runtime';

/**
 * View/result contracts between the studio controller and the UI layer.
 * Kept separate from the controller so ui/ and studio/ modules can depend
 * on the types without importing the orchestrator itself.
 */

export interface SlicerBenchmarkSummary {
    totalRuns: number;
    measuredRuns: number;
    warmupRuns: number;
    averageMs: number;
    medianMs: number;
    minMs: number;
    maxMs: number;
    spreadMs: number;
    averageContourSamplingMs: number;
    averageToolpathBuildMs: number;
    averageGcodeBuildMs: number;
    points: number;
    layers: number;
    bytes: number;
}

export type ShaderStatusMode = 'ready' | 'compiling' | 'ok' | 'error';

/** Sparse session-only overrides applied on top of the file-derived configuration. */
export interface SceneOverrides {
    slicer: Partial<VaseSlicerSettings>;
    uniforms: Record<string, number>;
    params: Record<string, number>;
    stepParams: Record<number, Record<string, number>>;
    disabledSteps: number[];
    printerId: string | null;
    filamentId: string | null;
}

export interface PipelineStepView {
    index: number;
    name: string;
    scriptId: string | null;
    enabled: boolean;
    controls: ScalarControlSpec[];
    params: Record<string, number>;
    overriddenParamKeys: string[];
    error: string | null;
}

export interface SceneConfigView {
    settings: VaseSlicerSettings;
    uniformControls: SceneControlDefinition[];
    uniformValues: Record<string, number>;
    paramControls: ScalarControlSpec[];
    paramValues: Record<string, number>;
    pipeline: PipelineStepView[];
    overriddenSlicerKeys: string[];
    overriddenUniformKeys: string[];
    overriddenParamKeys: string[];
    overrideCount: number;
    printerOverridden: boolean;
    filamentOverridden: boolean;
    manifestError: string | null;
    preprocessError: string | null;
}

export interface StudioSnapshot {
    viewMode: number;
    sceneId: string;
    sceneOptions: SceneOption[];
    raymarchParams: RaymarchParams;
    viewportParams: ViewportParams;
    animationParams: AnimationParams;
    printerModels: PrinterModel[];
    filamentProfiles: FilamentProfile[];
    config: SceneConfigView;
}

export interface SceneChangeResult {
    ok: boolean;
    sceneId: string;
    config: SceneConfigView;
    shaderMessage: string;
    workspaceStatus: string;
}

export interface SlicerSettingsUpdateResult {
    settings: VaseSlicerSettings;
    validationMessage: string | null;
}

export interface SceneRegistrySyncResult {
    ok: boolean;
    sceneId: string;
    sceneOptions: SceneOption[];
    config: SceneConfigView;
    shaderMessage: string;
}

export interface PresetChangeResult {
    config: SceneConfigView;
    workspaceStatus: string;
}

/** Viewport-facing description of the toolpath currently in the preview. */
export interface ToolpathPreviewView {
    channels: ToolpathChannelSummary[];
    activeChannelKey: string | null;
    /**
     * The ramp domain actually being drawn. Follows the visible layer range
     * while auto-scaling is on, so it can differ from the active channel's
     * whole-toolpath min/max.
     */
    domainMin: number;
    domainMax: number;
    autoScaleDomain: boolean;
    layerCount: number;
    segmentCount: number;
    travelSegmentCount: number;
    /** Set when the preview's GPU layer could not start; null when healthy. */
    error: string | null;
}
