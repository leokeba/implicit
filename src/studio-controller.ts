import { applyFilamentProfile, loadFilamentProfiles, type FilamentProfile } from './core/filament-profiles';
import { applyPrinterModel, loadPrinterModels, type PrinterModel } from './core/printer-models';
import Renderer from './core/renderer';
import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
import {
    getActiveSceneId,
    getAvailableScenes,
    getSceneControlDefinitions,
    getSceneDocuments,
    getSceneDefaultParams,
    replaceSceneDocuments,
    setActiveSceneById,
    upsertSceneDocument,
    type SceneControlDefinition,
    type SceneControlValueMap,
    type SceneDocument,
    type SceneOption,
    type SceneParamMap,
} from './core/shader-pipeline';
import {
    Slicer,
    type VaseBaseToolpath,
    type SliceDebugSnapshot,
    type SliceProgressUpdate,
    type VaseSliceBenchmarkRun,
    type VaseSlicerSettings,
} from './core/slicer';
import type { ToolpathPostprocessConfig } from './core/toolpath-postprocess';
import { Preview } from './ui';
import { summarizeBenchmarkRuns } from './studio/benchmark-summary';
import { buildSlicerFilename, downloadTextFile } from './studio/file-export';
import { attachRenderLifecycleHandlers, shouldRenderPreview } from './studio/render-lifecycle';
import { convertToolpathToScenePoints } from './studio/toolpath-overlay';

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

export interface StudioSnapshot {
    viewMode: number;
    sceneId: string;
    sceneOptions: SceneOption[];
    raymarchParams: RaymarchParams;
    viewportParams: ViewportParams;
    animationParams: AnimationParams;
    slicerSettings: VaseSlicerSettings;
    printerModels: PrinterModel[];
    filamentProfiles: FilamentProfile[];
    sceneControlDefinitions: SceneControlDefinition[];
    sceneControlValues: SceneControlValueMap;
}

export interface SceneChangeResult {
    ok: boolean;
    sceneId: string;
    settings: VaseSlicerSettings;
    sceneControlDefinitions: SceneControlDefinition[];
    sceneControlValues: SceneControlValueMap;
    shaderMessage: string;
    workspaceStatus: string;
}

export interface PresetChangeResult {
    settings: VaseSlicerSettings;
    workspaceStatus: string;
}

export interface SceneRegistrySyncResult {
    ok: boolean;
    sceneId: string;
    sceneOptions: SceneOption[];
    sceneControlDefinitions: SceneControlDefinition[];
    sceneControlValues: SceneControlValueMap;
    settings: VaseSlicerSettings;
    shaderMessage: string;
}

export interface SceneSourceUpdateResult extends SceneRegistrySyncResult {
    sceneDocument: SceneDocument | null;
}

const SCENE_DEFAULT_PARAM_ALIASES: Partial<Record<string, keyof VaseSlicerSettings>> = {
    nozzleDiameterMm: 'nozzleDiameter',
    layerHeightMm: 'layerHeight',
};

const MAX_SHADER_ERROR_CHARS = 6000;

function resolveSceneDefaultTargetKey(
    paramName: string,
    numericSlicerSettingKeys: Set<keyof VaseSlicerSettings>
): keyof VaseSlicerSettings | null {
    const alias = SCENE_DEFAULT_PARAM_ALIASES[paramName];
    if (alias) {
        return alias;
    }

    const candidate = paramName as keyof VaseSlicerSettings;
    if (numericSlicerSettingKeys.has(candidate)) {
        return candidate;
    }

    return null;
}

export function normalizeShaderStatusMessage(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) {
        return 'Unknown shader error';
    }

    if (trimmed.length <= MAX_SHADER_ERROR_CHARS) {
        return trimmed;
    }

    return `${trimmed.slice(0, MAX_SHADER_ERROR_CHARS)}\n\n...truncated`;
}

export function compactShaderStatusMessage(message: string): string {
    const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || 'Shader status changed';
    const maxInlineLen = 88;
    if (firstLine.length <= maxInlineLen) {
        return firstLine;
    }

    return `${firstLine.slice(0, maxInlineLen - 1)}...`;
}

export class StudioController {
    private renderer: Renderer;
    private slicer: Slicer;
    private preview: Preview;
    private slicerSettings: VaseSlicerSettings;
    private printerModels: PrinterModel[];
    private filamentProfiles: FilamentProfile[];
    private sceneOptions: SceneOption[];
    private isSlicing: boolean;
    private renderFrameHandle: number | null;
    private numericSlicerSettingKeys: Set<keyof VaseSlicerSettings>;
    private initialized: boolean;
    private sceneControlDefinitions: SceneControlDefinition[];
    private sceneControlValues: SceneControlValueMap;
    private toolpathPostprocessConfig: ToolpathPostprocessConfig | null;
    private renderLifecycleCleanup: (() => void) | null;
    private cachedBaseToolpath: { cacheKey: string; baseToolpath: VaseBaseToolpath } | null;

    constructor() {
        this.renderer = new Renderer();
        this.slicer = new Slicer();
        this.preview = new Preview();
        this.slicerSettings = this.slicer.getDefaultVaseSettings();
        this.printerModels = loadPrinterModels();
        this.filamentProfiles = loadFilamentProfiles();
        this.sceneOptions = getAvailableScenes();
        this.isSlicing = false;
        this.renderFrameHandle = null;
        this.numericSlicerSettingKeys = new Set();
        this.initialized = false;
        this.sceneControlDefinitions = getSceneControlDefinitions();
        this.sceneControlValues = buildSceneControlValueMap(this.sceneControlDefinitions);
        this.toolpathPostprocessConfig = null;
        this.renderLifecycleCleanup = null;
        this.cachedBaseToolpath = null;

        if (this.filamentProfiles.length > 0) {
            this.slicerSettings = applyFilamentProfile(this.slicerSettings, this.filamentProfiles[0]);
        }
        if (this.printerModels.length > 0) {
            this.slicerSettings = applyPrinterModel(this.slicerSettings, this.printerModels[0]);
        }

        this.numericSlicerSettingKeys = new Set(
            Object.entries(this.slicerSettings)
                .filter((entry): entry is [keyof VaseSlicerSettings, number] => typeof entry[1] === 'number')
                .map(([key]) => key)
        );

        this.applySceneDefaultParams(getSceneDefaultParams());
        this.syncSceneControlState();
    }

    public init(): void {
        if (this.initialized) {
            return;
        }

        this.preview.init();
        this.renderer.init(this.preview.getCanvas());
        this.syncSceneSlicerUniforms();
        this.syncSceneControlState();
        this.renderLifecycleCleanup = attachRenderLifecycleHandlers(() => this.updatePreviewRenderState());
        this.updatePreviewRenderState();
        this.initialized = true;
    }

    public getSnapshot(): StudioSnapshot {
        return {
            viewMode: this.renderer.getViewMode(),
            sceneId: getActiveSceneId(),
            sceneOptions: [...this.sceneOptions],
            raymarchParams: this.renderer.getRaymarchParams(),
            viewportParams: this.renderer.getViewportParams(),
            animationParams: this.renderer.getAnimationParams(),
            slicerSettings: { ...this.slicerSettings },
            printerModels: [...this.printerModels],
            filamentProfiles: [...this.filamentProfiles],
            sceneControlDefinitions: this.sceneControlDefinitions.map((definition) => ({ ...definition })),
            sceneControlValues: { ...this.sceneControlValues },
        };
    }

    public getSceneLabel(sceneId: string): string {
        return this.sceneOptions.find((scene) => scene.id === sceneId)?.name ?? sceneId;
    }

    public getSceneDocuments(): SceneDocument[] {
        return getSceneDocuments();
    }

    public getViewModeLabel(viewMode: number): string {
        if (viewMode === 1) {
            return 'RGB Normals';
        }

        if (viewMode === 2) {
            return 'Glass';
        }

        if (viewMode === 3) {
            return 'Modifier Values';
        }

        return 'Shaded';
    }

    public setViewMode(viewMode: number): string {
        this.renderer.setViewMode(viewMode);
        return `Viewport mode: ${this.getViewModeLabel(viewMode)}.`;
    }

    public changeScene(sceneId: string): SceneChangeResult {
        const previousSceneId = getActiveSceneId();
        if (sceneId === previousSceneId) {
            return {
                ok: true,
                sceneId,
                settings: { ...this.slicerSettings },
                sceneControlDefinitions: this.sceneControlDefinitions.map((definition) => ({ ...definition })),
                sceneControlValues: { ...this.sceneControlValues },
                shaderMessage: 'Ready',
                workspaceStatus: `Scene already loaded: ${this.getSceneLabel(sceneId)}.`,
            };
        }

        if (!setActiveSceneById(sceneId)) {
            return {
                ok: false,
                sceneId: previousSceneId,
                settings: { ...this.slicerSettings },
                sceneControlDefinitions: this.sceneControlDefinitions.map((definition) => ({ ...definition })),
                sceneControlValues: { ...this.sceneControlValues },
                shaderMessage: `Scene '${sceneId}' was not found.`,
                workspaceStatus: `Scene load failed: ${sceneId}.`,
            };
        }

        const result = this.renderer.hotReloadShaders({});
        if (!result.ok && result.message !== 'Renderer not initialized') {
            setActiveSceneById(previousSceneId);
            this.renderer.hotReloadShaders({});
            return {
                ok: false,
                sceneId: previousSceneId,
                settings: { ...this.slicerSettings },
                sceneControlDefinitions: this.sceneControlDefinitions.map((definition) => ({ ...definition })),
                sceneControlValues: { ...this.sceneControlValues },
                shaderMessage: result.message,
                workspaceStatus: `Scene load failed: ${this.getSceneLabel(sceneId)}.`,
            };
        }

        this.refreshActiveSceneControls();
        this.applySceneDefaultParams(getSceneDefaultParams());
        this.syncSceneSlicerUniforms();
        this.syncSceneControlState();
        return {
            ok: true,
            sceneId,
            settings: { ...this.slicerSettings },
            sceneControlDefinitions: this.sceneControlDefinitions.map((definition) => ({ ...definition })),
            sceneControlValues: { ...this.sceneControlValues },
            shaderMessage: `Loaded scene: ${sceneId}`,
            workspaceStatus: `Scene loaded: ${this.getSceneLabel(sceneId)}.`,
        };
    }

    public syncSceneDocuments(documents: SceneDocument[]): SceneRegistrySyncResult {
        replaceSceneDocuments(documents);
        this.sceneOptions = getAvailableScenes();
        this.refreshActiveSceneControls();
        this.syncSceneControlState();

        const result = this.reloadRendererShaders();
        return {
            ok: result.ok,
            sceneId: getActiveSceneId(),
            sceneOptions: [...this.sceneOptions],
            sceneControlDefinitions: this.sceneControlDefinitions.map((definition) => ({ ...definition })),
            sceneControlValues: { ...this.sceneControlValues },
            settings: { ...this.slicerSettings },
            shaderMessage: result.message,
        };
    }

    public updateSceneDocumentSource(sceneId: string, source: string): SceneSourceUpdateResult {
        const sceneDocument = upsertSceneDocument({
            ...(getSceneDocuments().find((candidate) => candidate.id === sceneId) ?? {
                id: sceneId,
                name: this.getSceneLabel(sceneId),
                fileName: `${sceneId}.glsl`,
                source,
            }),
            source,
        });

        this.sceneOptions = getAvailableScenes();

        if (sceneDocument.id === getActiveSceneId()) {
            this.refreshActiveSceneControls(true);
            this.syncSceneControlState();
        }

        const result = sceneDocument.id === getActiveSceneId()
            ? this.reloadRendererShaders()
            : { ok: true, message: 'Scene document updated.' };

        return {
            ok: result.ok,
            sceneId: getActiveSceneId(),
            sceneOptions: [...this.sceneOptions],
            sceneControlDefinitions: this.sceneControlDefinitions.map((definition) => ({ ...definition })),
            sceneControlValues: { ...this.sceneControlValues },
            settings: { ...this.slicerSettings },
            shaderMessage: result.message,
            sceneDocument,
        };
    }

    public updateRaymarchParams(next: Partial<RaymarchParams>): void {
        this.renderer.updateRaymarchParams(next);
    }

    public updateViewportParams(next: Partial<ViewportParams>): void {
        this.renderer.updateViewportParams(next);
    }

    public updateAnimationParams(next: Partial<AnimationParams>): void {
        this.renderer.updateAnimationParams(next);
    }

    public updateSceneControlValue(controlKey: string, value: number): void {
        const definition = this.sceneControlDefinitions.find((candidate) => candidate.key === controlKey);
        if (!definition) {
            return;
        }

        this.sceneControlValues = {
            ...this.sceneControlValues,
            [definition.key]: clampSceneControlValue(value, definition),
        };
        this.syncSceneControlState();
    }

    public resetView(): string {
        this.renderer.resetCameraView();
        return 'Viewport reset to default orbit.';
    }

    public setToolpathOverlayVisible(visible: boolean): void {
        this.preview.setOverlayVisible(visible);
    }

    public getLastSliceDebugSnapshot(): SliceDebugSnapshot | null {
        return this.slicer.getLastSliceDebugSnapshot();
    }

    public changePrinterModel(printerModelId: string): PresetChangeResult {
        const nextModel = this.printerModels.find((model) => model.id === printerModelId);
        if (!nextModel) {
            return {
                settings: { ...this.slicerSettings },
                workspaceStatus: `Printer preset not found: ${printerModelId}.`,
            };
        }

        this.slicerSettings = applyPrinterModel(this.slicerSettings, nextModel);
        this.syncSceneSlicerUniforms();
        return {
            settings: { ...this.slicerSettings },
            workspaceStatus: `Printer preset loaded: ${nextModel.name}.`,
        };
    }

    public changeFilamentProfile(filamentProfileId: string): PresetChangeResult {
        const nextProfile = this.filamentProfiles.find((profile) => profile.id === filamentProfileId);
        if (!nextProfile) {
            return {
                settings: { ...this.slicerSettings },
                workspaceStatus: `Material preset not found: ${filamentProfileId}.`,
            };
        }

        this.slicerSettings = applyFilamentProfile(this.slicerSettings, nextProfile);
        this.syncSceneSlicerUniforms();
        return {
            settings: { ...this.slicerSettings },
            workspaceStatus: `Material preset loaded: ${nextProfile.name}.`,
        };
    }

    public updateSlicerParams(next: Partial<VaseSlicerSettings>): void {
        this.slicerSettings = { ...this.slicerSettings, ...next };
        this.syncSceneSlicerUniforms();
    }

    public setToolpathPostprocessConfig(config: ToolpathPostprocessConfig | null): void {
        this.toolpathPostprocessConfig = config ? { ...config } : null;
    }

    public async generateVaseGcode(
        onProgress?: (update: SliceProgressUpdate) => void
    ): Promise<{ filename: string; bytes: number; points: number }> {
        const artifact = await this.buildVaseGcodeArtifact('__adhoc__', onProgress);
        downloadTextFile(artifact.filename, artifact.gcode);
        return {
            filename: artifact.filename,
            bytes: artifact.bytes,
            points: artifact.points,
        };
    }

    public async buildVaseGcodeArtifact(
        cacheKey: string,
        onProgress?: (update: SliceProgressUpdate) => void
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number }> {
        return this.runWhilePreviewPausedAsync(async () => {
            const baseResult = await this.slicer.generateVaseBaseToolpathWithProgress(this.slicerSettings, onProgress);
            this.cachedBaseToolpath = {
                cacheKey,
                baseToolpath: {
                    ...baseResult.baseToolpath,
                    points: baseResult.baseToolpath.points.map((point) => ({ ...point })),
                },
            };
            const result = this.slicer.generateVaseGcodeFromBaseToolpath(
                baseResult.baseToolpath,
                this.slicerSettings,
                this.toolpathPostprocessConfig,
            );
            this.preview.setToolpathOverlayWorldPoints(
                convertToolpathToScenePoints(result.toolpath.points, this.slicerSettings)
            );
            const filename = buildSlicerFilename(this.slicerSettings, this.toolpathPostprocessConfig);
            return {
                filename,
                gcode: result.gcode,
                bytes: result.gcode.length,
                points: result.toolpath.points.length,
            };
        });
    }

    public async buildVaseGcodeArtifactFromCachedBase(
        cacheKey: string,
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number }> {
        return this.runWhilePreviewPausedAsync(async () => {
            if (!this.cachedBaseToolpath || this.cachedBaseToolpath.cacheKey !== cacheKey) {
                throw new Error('No cached slice is available. Generate toolpath first.');
            }

            const baseToolpath = {
                ...this.cachedBaseToolpath.baseToolpath,
                points: this.cachedBaseToolpath.baseToolpath.points.map((point) => ({ ...point })),
            };
            const result = this.slicer.generateVaseGcodeFromBaseToolpath(
                baseToolpath,
                this.slicerSettings,
                this.toolpathPostprocessConfig,
            );
            this.preview.setToolpathOverlayWorldPoints(
                convertToolpathToScenePoints(result.toolpath.points, this.slicerSettings)
            );
            const filename = buildSlicerFilename(this.slicerSettings, this.toolpathPostprocessConfig);
            return {
                filename,
                gcode: result.gcode,
                bytes: result.gcode.length,
                points: result.toolpath.points.length,
            };
        });
    }

    public benchmarkVaseGcode(iterations: number, warmupRuns: number): SlicerBenchmarkSummary {
        return this.runWhilePreviewPaused(() => {
            const benchmark = this.slicer.benchmarkVaseGcode(this.slicerSettings, iterations, warmupRuns, this.toolpathPostprocessConfig);
            this.preview.setToolpathOverlayWorldPoints(
                convertToolpathToScenePoints(benchmark.lastResult.toolpath.points, benchmark.settings)
            );
            return summarizeBenchmarkRuns(benchmark.runs, benchmark.warmupRuns, benchmark.measuredRuns);
        });
    }

    public resizeViewport(): void {
        this.renderer.resize();
    }

    private startRenderingLoop(): void {
        if (this.renderFrameHandle !== null) {
            return;
        }

        const render = (nowMs: number) => {
            if (!shouldRenderPreview(this.isSlicing)) {
                this.renderFrameHandle = null;
                return;
            }

            this.renderFrameHandle = requestAnimationFrame(render);
            if (this.renderer.render(nowMs)) {
                this.preview.renderOverlayInScene(this.renderer.getCameraState());
            }
        };
        this.renderFrameHandle = requestAnimationFrame(render);
    }

    private stopRenderingLoop(): void {
        if (this.renderFrameHandle === null) {
            return;
        }

        cancelAnimationFrame(this.renderFrameHandle);
        this.renderFrameHandle = null;
    }

    private updatePreviewRenderState(): void {
        const shouldRender = shouldRenderPreview(this.isSlicing);
        this.renderer.setPaused(!shouldRender);
        this.preview.setRenderingActive(shouldRender);
        if (shouldRender) {
            this.startRenderingLoop();
            return;
        }

        this.stopRenderingLoop();
    }

    private runWhilePreviewPaused<T>(action: () => T): T {
        this.isSlicing = true;
        this.updatePreviewRenderState();
        try {
            return action();
        } finally {
            this.isSlicing = false;
            this.updatePreviewRenderState();
        }
    }

    private async runWhilePreviewPausedAsync<T>(action: () => Promise<T>): Promise<T> {
        this.isSlicing = true;
        this.updatePreviewRenderState();
        try {
            return await action();
        } finally {
            this.isSlicing = false;
            this.updatePreviewRenderState();
        }
    }

    private applySceneDefaultParams(params: SceneParamMap): void {
        for (const [paramName, value] of Object.entries(params)) {
            if (typeof value !== 'number') {
                continue;
            }

            const targetKey = resolveSceneDefaultTargetKey(paramName, this.numericSlicerSettingKeys);
            if (!targetKey) {
                continue;
            }

            ((this.slicerSettings as unknown) as Record<string, unknown>)[targetKey] = value;
        }

        if (this.slicerSettings.maxY <= this.slicerSettings.minY) {
            this.slicerSettings.maxY = this.slicerSettings.minY + Math.max(0.001, this.slicerSettings.layerHeight);
        }
    }

    private syncSceneSlicerUniforms(): void {
        this.renderer.setSceneSlicerUniformState({
            minY: this.slicerSettings.minY,
            maxY: this.slicerSettings.maxY,
            modelScale: this.slicerSettings.modelScale,
            maxRadius: this.slicerSettings.maxRadius,
            nozzleDiameter: this.slicerSettings.nozzleDiameter,
            flowRate: this.slicerSettings.flowRate,
            layerHeight: this.slicerSettings.layerHeight,
        });
    }

    private refreshActiveSceneControls(preserveValues: boolean = false): void {
        const nextDefinitions = getSceneControlDefinitions();
        this.sceneControlDefinitions = nextDefinitions;
        this.sceneControlValues = buildSceneControlValueMap(
            nextDefinitions,
            preserveValues ? this.sceneControlValues : undefined
        );
    }

    private syncSceneControlState(): void {
        this.renderer.setSceneControlState(this.sceneControlDefinitions, this.sceneControlValues);
        this.slicer.setSceneControlState(this.sceneControlDefinitions, this.sceneControlValues);
    }

    private reloadRendererShaders(): { ok: boolean; message: string } {
        const result = this.renderer.hotReloadShaders({});
        if (!result.ok && result.message !== 'Renderer not initialized') {
            return result;
        }

        return {
            ok: true,
            message: result.ok ? result.message : 'Ready',
        };
    }

}

function buildSceneControlValueMap(
    definitions: SceneControlDefinition[],
    previousValues: SceneControlValueMap = {}
): SceneControlValueMap {
    const values: SceneControlValueMap = {};

    for (const definition of definitions) {
        values[definition.key] = clampSceneControlValue(previousValues[definition.key] ?? definition.defaultValue, definition);
    }

    return values;
}

function clampSceneControlValue(value: number, definition: SceneControlDefinition): number {
    const safe = Number.isFinite(value) ? value : definition.defaultValue;
    return Math.min(definition.max, Math.max(definition.min, safe));
}