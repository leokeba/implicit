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
import { Slicer, type ToolpathPoint, type VaseSlicerSettings } from './core/slicer';

class ImplicitSurfaceStudio {
    private renderer: Renderer;
    private slicer: Slicer;
    private controls: Controls;
    private preview: Preview;
    private slicerSettings: VaseSlicerSettings;
    private printerModels: PrinterModel[];
    private filamentProfiles: FilamentProfile[];
    private sceneOptions: SceneOption[];

    constructor() {
        this.renderer = new Renderer();
        this.slicer = new Slicer();
        this.controls = new Controls();
        this.preview = new Preview();
        this.slicerSettings = this.slicer.getDefaultVaseSettings();
        this.printerModels = loadPrinterModels();
        this.filamentProfiles = loadFilamentProfiles();
        this.sceneOptions = getAvailableScenes();

        if (this.printerModels.length > 0) {
            this.slicerSettings = applyPrinterModel(this.slicerSettings, this.printerModels[0]);
        }
        if (this.filamentProfiles.length > 0) {
            this.slicerSettings = applyFilamentProfile(this.slicerSettings, this.filamentProfiles[0]);
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
            }
        );
        this.renderer.init(this.preview.getCanvas());
        this.syncSceneSlicerUniforms();
        this.startRenderingLoop();
    }

    private startRenderingLoop(): void {
        const render = () => {
            this.renderer.render();
            this.preview.renderOverlayInScene(this.renderer.getCameraState());
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
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
        const printerSlug = this.slicerSettings.printerModelId.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase();
        return `implicit-vase-${printerSlug}-${stamp}.gcode`;
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