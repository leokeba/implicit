import type { CameraState } from './renderer';
import type { ChannelDomain } from './toolpath-preview/domain';
import { ToolpathRenderer, type ToolpathRendererStyle } from './toolpath-preview/renderer';
import type { ToolpathChannel, ToolpathPreviewData } from './toolpath-preview/types';

/**
 * Owns the two stacked canvases of the viewport: the raymarched surface
 * underneath and the sliced toolpath on top. The toolpath layer is its own
 * WebGL context with its own depth buffer, so the path self-occludes; it does
 * not yet share depth with the surface below it.
 */
export class Preview {
    private canvas: HTMLCanvasElement | null = null;
    private overlayCanvas: HTMLCanvasElement | null = null;
    private overlayGl: WebGLRenderingContext | null = null;
    private previewHost: HTMLElement | null = null;
    private toolpathRenderer: ToolpathRenderer | null = null;
    private toolpathData: ToolpathPreviewData | null = null;
    private overlayError: string | null = null;
    private renderingActive = true;
    private overlayVisible = true;
    private readonly handleWindowResize = (): void => {
        this.syncOverlaySize();
    };
    private readonly handleContextLost = (event: Event): void => {
        event.preventDefault();
        this.overlayError = 'The toolpath preview lost its GPU context. Reload the page to restore it.';
        this.toolpathRenderer = null;
        this.overlayGl = null;
    };

    public init(): void {
        const previewHost = document.getElementById('preview');
        if (!previewHost) {
            return;
        }

        this.previewHost = previewHost;

        let canvas = previewHost.querySelector('canvas') as HTMLCanvasElement | null;
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = Math.max(640, previewHost.clientWidth || 640);
            canvas.height = Math.max(320, previewHost.clientHeight || 420);
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.display = 'block';
            previewHost.appendChild(canvas);
        }

        this.canvas = canvas;

        let overlayCanvas = previewHost.querySelector('.toolpath-overlay') as HTMLCanvasElement | null;
        if (!overlayCanvas) {
            overlayCanvas = document.createElement('canvas');
            overlayCanvas.className = 'toolpath-overlay';
            previewHost.appendChild(overlayCanvas);
        }

        this.overlayCanvas = overlayCanvas;
        overlayCanvas.addEventListener('webglcontextlost', this.handleContextLost);
        this.createToolpathRenderer(overlayCanvas);

        this.syncOverlaySize();
        this.syncOverlayVisibility();
        window.addEventListener('resize', this.handleWindowResize);
    }

    public dispose(): void {
        window.removeEventListener('resize', this.handleWindowResize);
        this.overlayCanvas?.removeEventListener('webglcontextlost', this.handleContextLost);
        this.toolpathRenderer?.dispose();
        this.toolpathRenderer = null;
        this.overlayGl = null;
    }

    public getCanvas(): HTMLCanvasElement {
        if (!this.canvas) {
            throw new Error('Preview canvas has not been initialized.');
        }

        return this.canvas;
    }

    public setToolpathData(data: ToolpathPreviewData | null): void {
        this.toolpathData = data && data.segmentCount > 0 ? data : null;
        this.toolpathRenderer?.setData(this.toolpathData);
    }

    public getToolpathData(): ToolpathPreviewData | null {
        return this.toolpathData;
    }

    public getToolpathChannels(): ToolpathChannel[] {
        return this.toolpathData?.channels ?? [];
    }

    public getActiveToolpathChannel(): ToolpathChannel | null {
        return this.toolpathRenderer?.getChannel() ?? null;
    }

    /** Returns false when the key names no channel in the current slice. */
    public setToolpathChannel(key: string): boolean {
        return this.toolpathRenderer?.setChannel(key) ?? false;
    }

    public setToolpathLayerRange(minLayer: number, maxLayer: number): void {
        this.toolpathRenderer?.setLayerRange(minLayer, maxLayer);
    }

    public setToolpathAutoScale(autoScale: boolean): void {
        this.toolpathRenderer?.setAutoScaleDomain(autoScale);
    }

    /** The ramp domain currently in use, which the legend has to label. */
    public getToolpathDomain(): ChannelDomain | null {
        return this.toolpathRenderer?.getDomain() ?? null;
    }

    public setToolpathTravelsVisible(visible: boolean): void {
        this.toolpathRenderer?.setShowTravels(visible);
    }

    public setToolpathStyle(style: Partial<ToolpathRendererStyle>): void {
        this.toolpathRenderer?.setStyle(style);
    }

    public hasToolpath(): boolean {
        return this.toolpathData !== null;
    }

    public getOverlayError(): string | null {
        return this.overlayError;
    }

    public setOverlayVisible(visible: boolean): void {
        this.overlayVisible = visible;
        this.syncOverlayVisibility();
    }

    public setRenderingActive(active: boolean): void {
        this.renderingActive = active;

        if (active) {
            this.syncOverlaySize();
        }

        this.syncOverlayVisibility();
    }

    public renderOverlayInScene(cameraState: CameraState | null): void {
        if (!this.toolpathRenderer || !this.overlayCanvas || !cameraState) {
            return;
        }
        if (!this.overlayVisible) {
            return;
        }

        this.syncOverlaySize();
        this.toolpathRenderer.render({
            ...cameraState,
            viewportWidth: this.overlayCanvas.width,
            viewportHeight: this.overlayCanvas.height,
        });
    }

    private createToolpathRenderer(canvas: HTMLCanvasElement): void {
        const attributes: WebGLContextAttributes = {
            alpha: true,
            depth: true,
            antialias: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
        };

        // WebGL2 first for native instancing; WebGL1 covers the rest through
        // ANGLE_instanced_arrays. The GLSL is ES 1.00 either way.
        const gl = (canvas.getContext('webgl2', attributes)
            ?? canvas.getContext('webgl', attributes)) as WebGLRenderingContext | null;

        if (!gl) {
            this.overlayError = 'WebGL is unavailable, so the toolpath cannot be previewed.';
            return;
        }

        try {
            this.toolpathRenderer = new ToolpathRenderer(gl);
            this.overlayGl = gl;
            this.overlayError = null;
        } catch (error) {
            this.overlayError = error instanceof Error ? error.message : String(error);
        }
    }

    /**
     * Matches the raymarch canvas's device-pixel sizing. Drawing the toolpath
     * at CSS resolution over a 2x surface is what made the old overlay look
     * thin and crawly on high-density displays.
     */
    private syncOverlaySize(): void {
        if (!this.previewHost || !this.overlayCanvas || !this.renderingActive) {
            return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.floor(this.previewHost.clientWidth * dpr));
        const height = Math.max(1, Math.floor(this.previewHost.clientHeight * dpr));
        if (this.overlayCanvas.width !== width || this.overlayCanvas.height !== height) {
            this.overlayCanvas.width = width;
            this.overlayCanvas.height = height;
        }

        this.overlayGl?.viewport(0, 0, width, height);
    }

    private syncOverlayVisibility(): void {
        if (!this.overlayCanvas) {
            return;
        }

        this.overlayCanvas.style.visibility = this.overlayVisible ? 'visible' : 'hidden';
    }
}
