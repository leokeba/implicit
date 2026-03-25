import { Controls } from './ui/controls';
import { Preview } from './ui/preview';
import { applyFilamentProfile, loadFilamentProfiles, type FilamentProfile } from './core/filament-profiles';
import { applyPrinterModel, loadPrinterModels, type PrinterModel } from './core/printer-models';
import Renderer from './core/renderer';
import { Slicer, type ToolpathPoint, type VaseSlicerSettings } from './core/slicer';

class ImplicitSurfaceStudio {
    private renderer: Renderer;
    private slicer: Slicer;
    private controls: Controls;
    private preview: Preview;
    private slicerSettings: VaseSlicerSettings;
    private printerModels: PrinterModel[];
    private filamentProfiles: FilamentProfile[];

    constructor() {
        this.renderer = new Renderer();
        this.slicer = new Slicer();
        this.controls = new Controls();
        this.preview = new Preview();
        this.slicerSettings = this.slicer.getDefaultVaseSettings();
        this.printerModels = loadPrinterModels();
        this.filamentProfiles = loadFilamentProfiles();

        if (this.printerModels.length > 0) {
            this.slicerSettings = applyPrinterModel(this.slicerSettings, this.printerModels[0]);
        }
        if (this.filamentProfiles.length > 0) {
            this.slicerSettings = applyFilamentProfile(this.slicerSettings, this.filamentProfiles[0]);
        }
    }

    public init(): void {
        this.preview.init();
        this.renderer.init(this.preview.getCanvas());
        this.controls.init(
            this.renderer.getViewMode(),
            (viewMode: number) => {
                this.renderer.setViewMode(viewMode);
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
                return this.slicerSettings;
            },
            this.slicerSettings,
            (next) => {
                this.slicerSettings = { ...this.slicerSettings, ...next };
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

function setShaderStatus(mode: ShaderStatusMode, message: string): void {
    const statusElement = document.getElementById('shader-status');
    if (!statusElement) {
        return;
    }

    statusElement.className = `shader-status shader-status-${mode}`;
    statusElement.textContent = `Shader: ${message}`;
}

const app = new ImplicitSurfaceStudio();
app.init();
setShaderStatus('ready', 'Ready');

window.addEventListener('shader-hmr-status', (event: Event) => {
    const customEvent = event as CustomEvent<{ mode?: ShaderStatusMode; message?: string }>;
    const mode = customEvent.detail?.mode;
    const message = customEvent.detail?.message;
    if (!mode || !message) {
        return;
    }

    setShaderStatus(mode, message);
});