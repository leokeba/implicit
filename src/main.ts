import { Controls, Preview } from './ui';
import { applyFilamentProfile, loadFilamentProfiles, type FilamentProfile } from './core/filament-profiles';
import { applyPrinterModel, loadPrinterModels, type PrinterModel } from './core/printer-models';
import Renderer, { type AnimationParams, type RaymarchParams, type ViewportParams } from './core/renderer';
import {
    getActiveSceneId,
    getAvailableScenes,
    getSceneDefaultParams,
    setActiveSceneById,
    type SceneOption,
    type SceneParamMap,
} from './core/shader-pipeline';
import {
    Slicer,
    type ToolpathPoint,
    type VaseSliceBenchmarkRun,
    type VaseSlicerSettings,
} from './core/slicer';

interface SlicerBenchmarkSummary {
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

const SCENE_DEFAULT_PARAM_ALIASES: Partial<Record<string, keyof VaseSlicerSettings>> = {
    nozzleDiameterMm: 'nozzleDiameter',
    layerHeightMm: 'layerHeight',
};

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

class ImplicitSurfaceStudio {
    private renderer: Renderer;
    private slicer: Slicer;
    private controls: Controls;
    private preview: Preview;
    private slicerSettings: VaseSlicerSettings;
    private printerModels: PrinterModel[];
    private filamentProfiles: FilamentProfile[];
    private sceneOptions: SceneOption[];
    private isSlicing: boolean;
    private renderFrameHandle: number | null;
    private numericSlicerSettingKeys: Set<keyof VaseSlicerSettings>;

    constructor() {
        this.renderer = new Renderer();
        this.slicer = new Slicer();
        this.controls = new Controls();
        this.preview = new Preview();
        this.slicerSettings = this.slicer.getDefaultVaseSettings();
        this.printerModels = loadPrinterModels();
        this.filamentProfiles = loadFilamentProfiles();
        this.sceneOptions = getAvailableScenes();
        this.isSlicing = false;
        this.renderFrameHandle = null;
        this.numericSlicerSettingKeys = new Set();

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
    }

    public init(): void {
        this.preview.init();
        this.controls.init(
            this.renderer.getViewMode(),
            (viewMode: number) => {
                this.renderer.setViewMode(viewMode);
                this.updateViewModeLabel(viewMode);
                this.setWorkspaceStatus(`Viewport mode: ${this.getViewModeLabel(viewMode)}.`);
            },
            this.sceneOptions,
            getActiveSceneId(),
            (sceneId: string) => {
                const previousSceneId = getActiveSceneId();
                if (sceneId === previousSceneId) {
                    return this.slicerSettings;
                }

                if (!setActiveSceneById(sceneId)) {
                    setShaderStatus('error', `Scene '${sceneId}' was not found.`);
                    return this.slicerSettings;
                }

                setShaderStatus('compiling', 'Compiling...');
                const result = this.renderer.hotReloadShaders({});
                if (!result.ok && result.message !== 'Renderer not initialized') {
                    setActiveSceneById(previousSceneId);
                    this.renderer.hotReloadShaders({});
                    setShaderStatus('error', result.message);
                    return this.slicerSettings;
                }

                this.applySceneDefaultParams(getSceneDefaultParams());
                this.syncSceneSlicerUniforms();
                this.updateActiveSceneLabel(sceneId);
                this.setWorkspaceStatus(`Scene loaded: ${this.getSceneLabel(sceneId)}.`);
                setShaderStatus('ok', `Loaded scene: ${sceneId}`);
                return this.slicerSettings;
            },
            this.renderer.getRaymarchParams(),
            (next: Partial<RaymarchParams>) => {
                this.renderer.updateRaymarchParams(next);
            },
            this.renderer.getViewportParams(),
            (next: Partial<ViewportParams>) => {
                this.renderer.updateViewportParams(next);
            },
            this.renderer.getAnimationParams(),
            (next: Partial<AnimationParams>) => {
                this.renderer.updateAnimationParams(next);
            },
            () => {
                this.renderer.resetCameraView();
                this.setWorkspaceStatus('Viewport reset to default orbit.');
            },
            this.printerModels,
            this.slicerSettings.printerModelId,
            (printerModelId: string) => {
                const nextModel = this.printerModels.find((model) => model.id === printerModelId);
                if (!nextModel) {
                    return this.slicerSettings;
                }

                this.slicerSettings = applyPrinterModel(this.slicerSettings, nextModel);
                this.syncSceneSlicerUniforms();
                this.setWorkspaceStatus(`Printer preset loaded: ${nextModel.name}.`);
                return this.slicerSettings;
            },
            this.filamentProfiles,
            this.slicerSettings.filamentProfileId,
            (filamentProfileId: string) => {
                const nextProfile = this.filamentProfiles.find((profile) => profile.id === filamentProfileId);
                if (!nextProfile) {
                    return this.slicerSettings;
                }

                this.slicerSettings = applyFilamentProfile(this.slicerSettings, nextProfile);
                this.syncSceneSlicerUniforms();
                this.setWorkspaceStatus(`Material preset loaded: ${nextProfile.name}.`);
                return this.slicerSettings;
            },
            this.slicerSettings,
            (next: Partial<VaseSlicerSettings>) => {
                this.slicerSettings = { ...this.slicerSettings, ...next };
                this.syncSceneSlicerUniforms();
            },
            () => {
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
            },
            (iterations: number, warmupRuns: number) => {
                return this.runWhilePreviewPaused(() => {
                    const benchmark = this.slicer.benchmarkVaseGcode(this.slicerSettings, iterations, warmupRuns);
                    this.preview.setToolpathOverlayWorldPoints(
                        this.convertToolpathToScenePoints(benchmark.lastResult.toolpath.points, benchmark.settings)
                    );
                    return this.summarizeBenchmarkRuns(benchmark.runs, benchmark.warmupRuns, benchmark.measuredRuns);
                });
            },
            (message: string) => {
                this.setWorkspaceStatus(message);
            }
        );
        this.renderer.init(this.preview.getCanvas());
        this.syncSceneSlicerUniforms();
        this.attachRenderLifecycleHandlers();
        this.initWorkspaceChrome();
        this.updateActiveSceneLabel(getActiveSceneId());
        this.updateViewModeLabel(this.renderer.getViewMode());
        this.updateRailTabState(this.controls.getActiveTabId());
        this.setWorkspaceStatus('Ready. Viewport and inspector are active.');
        this.updatePreviewRenderState();
    }

    private initWorkspaceChrome(): void {
        const resetButtons = document.querySelectorAll<HTMLButtonElement>('[data-reset-view]');
        resetButtons.forEach((button) => {
            button.addEventListener('click', () => {
                this.renderer.resetCameraView();
                this.setWorkspaceStatus('Viewport reset to default orbit.');
            });
        });

        const toggleButtons = document.querySelectorAll<HTMLButtonElement>('[data-toggle-inspector]');
        toggleButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const collapsed = document.body.classList.contains('inspector-collapsed');
                this.setInspectorCollapsed(!collapsed);
            });
        });

        const railButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
        railButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.tabTarget;
                if (!target) {
                    return;
                }

                this.setInspectorCollapsed(false);
                this.controls.selectTab(target);
            });
        });

        window.addEventListener('implicit:tab-change', (event: Event) => {
            const customEvent = event as CustomEvent<{ tabId?: string }>;
            if (!customEvent.detail?.tabId) {
                return;
            }

            this.updateRailTabState(customEvent.detail.tabId);
        });

        this.updateInspectorToggleButtons(false);
    }

    private setInspectorCollapsed(collapsed: boolean): void {
        document.body.classList.toggle('inspector-collapsed', collapsed);
        this.updateInspectorToggleButtons(collapsed);
        this.renderer.resize();
    }

    private updateInspectorToggleButtons(collapsed: boolean): void {
        const toggleButtons = document.querySelectorAll<HTMLButtonElement>('[data-toggle-inspector]');
        toggleButtons.forEach((button) => {
            const isViewportButton = button.id === 'viewport-toggle-inspector-button';
            button.textContent = collapsed
                ? (isViewportButton ? 'Show Panel' : 'Show Inspector')
                : (isViewportButton ? 'Hide Panel' : 'Hide Inspector');
            button.setAttribute('aria-expanded', String(!collapsed));
        });
    }

    private updateRailTabState(activeTabId: string): void {
        const railButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
        railButtons.forEach((button) => {
            const isActive = button.dataset.tabTarget === activeTabId;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    private updateActiveSceneLabel(sceneId: string): void {
        const label = document.getElementById('active-scene-label');
        if (!label) {
            return;
        }

        label.textContent = this.getSceneLabel(sceneId);
    }

    private getSceneLabel(sceneId: string): string {
        return this.sceneOptions.find((scene) => scene.id === sceneId)?.name ?? sceneId;
    }

    private updateViewModeLabel(viewMode: number): void {
        const label = document.getElementById('active-view-mode-label');
        if (!label) {
            return;
        }

        label.textContent = this.getViewModeLabel(viewMode);
    }

    private getViewModeLabel(viewMode: number): string {
        if (viewMode === 1) {
            return 'RGB Normals';
        }

        if (viewMode === 2) {
            return 'Glass';
        }

        return 'Shaded';
    }

    private setWorkspaceStatus(message: string): void {
        const statusElement = document.getElementById('workspace-status');
        if (!statusElement) {
            return;
        }

        statusElement.textContent = message;
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

type ShaderStatusMode = 'ready' | 'compiling' | 'ok' | 'error';

const MAX_SHADER_ERROR_CHARS = 6000;

function setShaderStatus(mode: ShaderStatusMode, message: string): void {
    const statusElement = document.getElementById('shader-status');
    if (!statusElement) {
        return;
    }

    const normalized = normalizeShaderStatusMessage(message);
    statusElement.className = `shader-status shader-status-${mode}`;
    statusElement.textContent = `Shader: ${compactShaderStatusMessage(normalized)}`;

    const statusContainer = statusElement.parentElement;
    if (!statusContainer) {
        return;
    }

    let detailElement = document.getElementById('shader-status-detail');
    if (!detailElement) {
        detailElement = document.createElement('pre');
        detailElement.id = 'shader-status-detail';
        detailElement.className = 'shader-status-detail';
        detailElement.setAttribute('aria-live', 'polite');
        statusContainer.appendChild(detailElement);
    }

    if (mode === 'error') {
        detailElement.textContent = normalized;
        return;
    }

    if (mode === 'compiling') {
        detailElement.textContent = 'Compiling active scene shaders...';
    } else {
        detailElement.textContent = 'No shader diagnostics.';
    }
}

const app = new ImplicitSurfaceStudio();
try {
    app.init();
    setShaderStatus('ready', 'Ready');
} catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize renderer';
    setShaderStatus('error', message);
    console.error('[Startup] Renderer initialization failed.', error);
}

window.addEventListener('shader-hmr-status', (event: Event) => {
    const customEvent = event as CustomEvent<{ mode?: ShaderStatusMode; message?: string }>;
    const mode = customEvent.detail?.mode;
    const message = customEvent.detail?.message;
    if (!mode || !message) {
        return;
    }

    setShaderStatus(mode, message);
});

function normalizeShaderStatusMessage(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) {
        return 'Unknown shader error';
    }

    if (trimmed.length <= MAX_SHADER_ERROR_CHARS) {
        return trimmed;
    }

    return `${trimmed.slice(0, MAX_SHADER_ERROR_CHARS)}\n\n...truncated`;
}

function compactShaderStatusMessage(message: string): string {
    const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || 'Shader status changed';
    const maxInlineLen = 88;
    if (firstLine.length <= maxInlineLen) {
        return firstLine;
    }

    return `${firstLine.slice(0, maxInlineLen - 1)}…`;
}

function slugifyForFilename(value: string, fallback: string): string {
    const normalized = value
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return normalized.length > 0 ? normalized : fallback;
}
