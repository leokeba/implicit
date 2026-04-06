import { Controls } from './ui/controls';
import { Preview } from './ui/preview';
import { applyFilamentProfile, loadFilamentProfiles, type FilamentProfile } from './core/filament-profiles';
import { applyPrinterModel, loadPrinterModels, type PrinterModel } from './core/printer-models';
import Renderer from './core/renderer';
import {
    getActiveSceneId,
    getAvailableScenes,
    getSceneSlicerDefaults,
    setActiveSceneById,
    type SceneOption,
    type SceneSlicerDefaults,
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

        if (this.filamentProfiles.length > 0) {
            this.slicerSettings = applyFilamentProfile(this.slicerSettings, this.filamentProfiles[0]);
        }
        if (this.printerModels.length > 0) {
            this.slicerSettings = applyPrinterModel(this.slicerSettings, this.printerModels[0]);
        }

        this.applySceneSlicerDefaults(getSceneSlicerDefaults());
    }

    public init(): void {
        this.preview.init();
        this.controls.init(
            this.renderer.getViewMode(),
            (viewMode: number) => {
                this.renderer.setViewMode(viewMode);
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

                this.applySceneSlicerDefaults(getSceneSlicerDefaults());
                this.syncSceneSlicerUniforms();
                setShaderStatus('ok', `Loaded scene: ${sceneId}`);
                return this.slicerSettings;
            },
            this.renderer.getRaymarchParams(),
            (next) => {
                this.renderer.updateRaymarchParams(next);
            },
            this.renderer.getViewportParams(),
            (next) => {
                this.renderer.updateViewportParams(next);
            },
            this.renderer.getAnimationParams(),
            (next) => {
                this.renderer.updateAnimationParams(next);
            },
            this.printerModels,
            this.slicerSettings.printerModelId,
            (printerModelId) => {
                const nextModel = this.printerModels.find((model) => model.id === printerModelId);
                if (!nextModel) {
                    return this.slicerSettings;
                }

                this.slicerSettings = applyPrinterModel(this.slicerSettings, nextModel);
                this.syncSceneSlicerUniforms();
                return this.slicerSettings;
            },
            this.filamentProfiles,
            this.slicerSettings.filamentProfileId,
            (filamentProfileId) => {
                const nextProfile = this.filamentProfiles.find((profile) => profile.id === filamentProfileId);
                if (!nextProfile) {
                    return this.slicerSettings;
                }

                this.slicerSettings = applyFilamentProfile(this.slicerSettings, nextProfile);
                this.syncSceneSlicerUniforms();
                return this.slicerSettings;
            },
            this.slicerSettings,
            (next) => {
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
            (iterations, warmupRuns) => {
                return this.runWhilePreviewPaused(() => {
                    const benchmark = this.slicer.benchmarkVaseGcode(this.slicerSettings, iterations, warmupRuns);
                    this.preview.setToolpathOverlayWorldPoints(
                        this.convertToolpathToScenePoints(benchmark.lastResult.toolpath.points, benchmark.settings)
                    );
                    return this.summarizeBenchmarkRuns(benchmark.runs, benchmark.warmupRuns, benchmark.measuredRuns);
                });
            }
        );
        this.renderer.init(this.preview.getCanvas());
        this.syncSceneSlicerUniforms();
        this.attachRenderLifecycleHandlers();
        this.updatePreviewRenderState();
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

    private applySceneSlicerDefaults(defaults: SceneSlicerDefaults): void {
        if (typeof defaults.minY === 'number') {
            this.slicerSettings.minY = defaults.minY;
        }
        if (typeof defaults.maxY === 'number') {
            this.slicerSettings.maxY = defaults.maxY;
        }
        if (typeof defaults.modelScale === 'number') {
            this.slicerSettings.modelScale = defaults.modelScale;
        }
        if (typeof defaults.maxRadius === 'number') {
            this.slicerSettings.maxRadius = defaults.maxRadius;
        }
        if (typeof defaults.nozzleDiameterMm === 'number') {
            this.slicerSettings.nozzleDiameter = defaults.nozzleDiameterMm;
        }
        if (typeof defaults.flowRate === 'number') {
            this.slicerSettings.flowRate = defaults.flowRate;
        }
        if (typeof defaults.layerHeightMm === 'number') {
            this.slicerSettings.layerHeight = defaults.layerHeightMm;
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
        detailElement.hidden = true;
        statusContainer.appendChild(detailElement);
    }

    if (mode === 'error') {
        detailElement.hidden = false;
        detailElement.textContent = normalized;
    } else {
        detailElement.hidden = true;
        detailElement.textContent = '';
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
