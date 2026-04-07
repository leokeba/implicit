import { applyFilamentProfile, loadFilamentProfiles, type FilamentProfile } from './core/filament-profiles';
import { applyPrinterModel, loadPrinterModels, type PrinterModel } from './core/printer-models';
import Renderer from './core/renderer';
import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
import {
    getActiveSceneId,
    getAvailableScenes,
    getSceneControlDefinitions,
    getSceneDefaultParams,
    setActiveSceneById,
    type SceneControlDefinition,
    type SceneControlValueMap,
    type SceneOption,
    type SceneParamMap,
} from './core/shader-pipeline';
import {
    Slicer,
    type ToolpathPoint,
    type VaseSliceBenchmarkRun,
    type VaseSlicerSettings,
} from './core/slicer';
import { Preview } from './ui';

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
        this.attachRenderLifecycleHandlers();
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

    public getViewModeLabel(viewMode: number): string {
        if (viewMode === 1) {
            return 'RGB Normals';
        }

        if (viewMode === 2) {
            return 'Glass';
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

    public generateVaseGcode(): { filename: string; bytes: number; points: number } {
        return this.runWhilePreviewPaused(() => {
            const result = this.slicer.generateVaseGcode(this.slicerSettings);
            this.preview.setToolpathOverlayWorldPoints(
                this.convertToolpathToScenePoints(result.toolpath.points, this.slicerSettings)
            );
            const filename = this.buildSlicerFilename();
            this.downloadTextFile(filename, result.gcode);
            return {
                filename,
                bytes: result.gcode.length,
                points: result.toolpath.points.length,
            };
        });
    }

    public benchmarkVaseGcode(iterations: number, warmupRuns: number): SlicerBenchmarkSummary {
        return this.runWhilePreviewPaused(() => {
            const benchmark = this.slicer.benchmarkVaseGcode(this.slicerSettings, iterations, warmupRuns);
            this.preview.setToolpathOverlayWorldPoints(
                this.convertToolpathToScenePoints(benchmark.lastResult.toolpath.points, benchmark.settings)
            );
            return this.summarizeBenchmarkRuns(benchmark.runs, benchmark.warmupRuns, benchmark.measuredRuns);
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
            if (!this.shouldRenderPreview()) {
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

    private attachRenderLifecycleHandlers(): void {
        const refresh = () => {
            this.updatePreviewRenderState();
        };

        document.addEventListener('visibilitychange', refresh);
        document.addEventListener('freeze', refresh as EventListener);
        document.addEventListener('resume', refresh as EventListener);
        window.addEventListener('focus', refresh);
        window.addEventListener('blur', refresh);
        window.addEventListener('pageshow', refresh);
        window.addEventListener('pagehide', refresh);
    }

    private shouldRenderPreview(): boolean {
        if (this.isSlicing) {
            return false;
        }

        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            return false;
        }

        if (typeof document !== 'undefined' && !document.hasFocus()) {
            return false;
        }

        return true;
    }

    private updatePreviewRenderState(): void {
        const shouldRender = this.shouldRenderPreview();
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

    private convertToolpathToScenePoints(
        points: ToolpathPoint[],
        settings: VaseSlicerSettings
    ): Array<{ x: number; y: number; z: number }> {
        const invScale = 1.0 / Math.max(1e-6, settings.modelScale);
        return points.map((point) => ({
            x: (point.x - settings.centerX) * invScale,
            y: settings.minY + point.y * invScale,
            z: (point.z - settings.centerZ) * invScale,
        }));
    }

    private buildSlicerFilename(): string {
        const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
        const modelSlug = slugifyForFilename(getActiveSceneId(), 'model');
        const printerSlug = slugifyForFilename(this.slicerSettings.printerModelId, 'printer');
        return `${modelSlug}-${printerSlug}-${stamp}.gcode`;
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

    private refreshActiveSceneControls(): void {
        this.sceneControlDefinitions = getSceneControlDefinitions();
        this.sceneControlValues = buildSceneControlValueMap(this.sceneControlDefinitions);
    }

    private syncSceneControlState(): void {
        this.renderer.setSceneControlState(this.sceneControlDefinitions, this.sceneControlValues);
        this.slicer.setSceneControlState(this.sceneControlDefinitions, this.sceneControlValues);
    }

    private downloadTextFile(filename: string, text: string): void {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    }

    private summarizeBenchmarkRuns(runs: VaseSliceBenchmarkRun[], warmupRuns: number, measuredRuns: number): SlicerBenchmarkSummary {
        if (runs.length === 0) {
            throw new Error('Benchmark completed without any runs.');
        }

        const measured = runs.filter((run) => !run.isWarmup);
        if (measured.length === 0) {
            throw new Error('Benchmark completed without any measured runs.');
        }

        let totalMs = 0;
        let totalContourSamplingMs = 0;
        let totalToolpathBuildMs = 0;
        let totalGcodeBuildMs = 0;
        let minMs = Number.POSITIVE_INFINITY;
        let maxMs = 0;

        for (const run of measured) {
            totalMs += run.timings.totalMs;
            totalContourSamplingMs += run.timings.contourSamplingMs;
            totalToolpathBuildMs += run.timings.toolpathBuildMs;
            totalGcodeBuildMs += run.timings.gcodeBuildMs;
            minMs = Math.min(minMs, run.timings.totalMs);
            maxMs = Math.max(maxMs, run.timings.totalMs);
        }

        const lastRun = runs[runs.length - 1];
        const sortedTotals = measured
            .map((run) => run.timings.totalMs)
            .sort((a, b) => a - b);
        const middleIndex = Math.floor(sortedTotals.length / 2);
        const medianMs = sortedTotals.length % 2 === 0
            ? (sortedTotals[middleIndex - 1] + sortedTotals[middleIndex]) * 0.5
            : sortedTotals[middleIndex];

        return {
            totalRuns: runs.length,
            measuredRuns,
            warmupRuns,
            averageMs: totalMs / measured.length,
            medianMs,
            minMs,
            maxMs,
            spreadMs: maxMs - minMs,
            averageContourSamplingMs: totalContourSamplingMs / measured.length,
            averageToolpathBuildMs: totalToolpathBuildMs / measured.length,
            averageGcodeBuildMs: totalGcodeBuildMs / measured.length,
            points: lastRun.pointCount,
            layers: lastRun.layerCount,
            bytes: lastRun.gcodeBytes,
        };
    }
}

function slugifyForFilename(value: string, fallback: string): string {
    const normalized = value
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return normalized.length > 0 ? normalized : fallback;
}

function buildSceneControlValueMap(definitions: SceneControlDefinition[]): SceneControlValueMap {
    const values: SceneControlValueMap = {};

    for (const definition of definitions) {
        values[definition.key] = clampSceneControlValue(definition.defaultValue, definition);
    }

    return values;
}

function clampSceneControlValue(value: number, definition: SceneControlDefinition): number {
    const safe = Number.isFinite(value) ? value : definition.defaultValue;
    return Math.min(definition.max, Math.max(definition.min, safe));
}