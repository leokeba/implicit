import type { CameraState } from './renderer';

interface WorldPoint {
    x: number;
    y: number;
    z: number;
}

export class Preview {
    private canvas: HTMLCanvasElement | null;
    private overlayCanvas: HTMLCanvasElement | null;
    private overlayContext: CanvasRenderingContext2D | null;
    private previewHost: HTMLElement | null;
    private overlayWorldPoints: WorldPoint[];
    private renderingActive: boolean;
    private overlayVisible: boolean;
    private readonly handleWindowResize = (): void => {
        this.syncOverlaySize();
    };

    constructor() {
        this.canvas = null;
        this.overlayCanvas = null;
        this.overlayContext = null;
        this.previewHost = null;
        this.overlayWorldPoints = [];
        this.renderingActive = true;
        this.overlayVisible = true;
    }

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
        this.overlayContext = overlayCanvas.getContext('2d');

        this.syncOverlaySize();
        this.syncOverlayVisibility();
        window.addEventListener('resize', this.handleWindowResize);
    }

    /** Removes the window listener registered by init(). */
    public dispose(): void {
        window.removeEventListener('resize', this.handleWindowResize);
    }

    public getCanvas(): HTMLCanvasElement {
        if (!this.canvas) {
            throw new Error('Preview canvas has not been initialized.');
        }

        return this.canvas;
    }

    public setToolpathOverlayWorldPoints(points: WorldPoint[]): void {
        this.overlayWorldPoints = points;
        if (points.length === 0 && this.overlayContext && this.overlayCanvas) {
            this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }
    }

    public hasOverlayPoints(): boolean {
        return this.overlayWorldPoints.length > 1;
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

    private syncOverlaySize(): void {
        if (!this.previewHost || !this.overlayCanvas || !this.renderingActive) {
            return;
        }

        const width = Math.max(1, this.previewHost.clientWidth);
        const height = Math.max(1, this.previewHost.clientHeight);
        this.overlayCanvas.width = width;
        this.overlayCanvas.height = height;
    }

    public renderOverlayInScene(cameraState: CameraState | null): void {
        if (!this.overlayCanvas || !this.overlayContext) {
            return;
        }

        this.syncOverlaySize();

        const ctx = this.overlayContext;
        const width = this.overlayCanvas.width;
        const height = this.overlayCanvas.height;

        ctx.clearRect(0, 0, width, height);

        if (!this.overlayVisible) {
            return;
        }

        if (!cameraState) {
            return;
        }

        const points = this.overlayWorldPoints;
        if (points.length < 2) {
            return;
        }

        const sampleStep = Math.max(1, Math.ceil(points.length / 60000));
        const aspect = Math.max(1e-6, cameraState.viewportWidth / Math.max(1, cameraState.viewportHeight));
        const near = 0.02;

        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const point of points) {
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
        }

        let centerX = 0.0;
        let centerZ = 0.0;
        for (const point of points) {
            centerX += point.x;
            centerZ += point.z;
        }
        centerX /= points.length;
        centerZ /= points.length;

        const camAxisX = cameraState.position.x - centerX;
        const camAxisZ = cameraState.position.z - centerZ;

        ctx.lineWidth = 1.15;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        let prevScreen: { x: number; y: number; h: number } | null = null;
        for (let i = 0; i < points.length; i += sampleStep) {
            const point = points[i];

            const v = {
                x: point.x - cameraState.position.x,
                y: point.y - cameraState.position.y,
                z: point.z - cameraState.position.z,
            };

            const camX = dot3(v, cameraState.right);
            const camY = dot3(v, cameraState.up);
            const camZ = dot3(v, cameraState.forward);

            if (camZ <= near) {
                prevScreen = null;
                continue;
            }

            const uvx = (camX * cameraState.focalLength) / (camZ * aspect);
            const uvy = (camY * cameraState.focalLength) / camZ;
            const sx = (uvx * 0.5 + 0.5) * width;
            const sy = (1.0 - (uvy * 0.5 + 0.5)) * height;

            const h = (point.y - minY) / Math.max(1e-6, maxY - minY);
            const screen = { x: sx, y: sy, h };

            if (prevScreen) {
                const alpha = 0.22 + h * 0.58;
                ctx.strokeStyle = `rgba(25, 73, 58, ${alpha.toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(prevScreen.x, prevScreen.y);
                ctx.lineTo(screen.x, screen.y);
                ctx.stroke();
            }

            prevScreen = screen;
        }

        const label = 'Toolpath in scene';
        ctx.font = '600 12px "IBM Plex Sans", sans-serif';
        const labelWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(13, 24, 20, 0.72)';
        ctx.beginPath();
        ctx.roundRect(8, height - 32, labelWidth + 16, 24, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(140, 226, 186, 0.95)';
        ctx.fillText(label, 16, height - 16);
    }

    private syncOverlayVisibility(): void {
        if (!this.overlayCanvas) {
            return;
        }

        this.overlayCanvas.style.visibility = this.overlayVisible ? 'visible' : 'hidden';
    }
}

function dot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}