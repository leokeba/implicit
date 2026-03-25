import {
    applyShaderSourceUpdates,
    composeRendererFragmentSource,
    getImportedShaderSources,
    getRendererVertexSource,
    type ShaderSourceUpdates,
} from './shader-pipeline';

export interface ShaderReloadResult {
    ok: boolean;
    message: string;
}

type ShaderStatusMode = 'compiling' | 'ok' | 'error';

export interface RaymarchParams {
    maxSteps: number;
    hitEpsilon: number;
    maxDistance: number;
    focalLength: number;
    stepScale: number;
    minStep: number;
    normalEpsilon: number;
    refineSteps: number;
}

export interface ViewportParams {
    orbitSensitivity: number;
    panSensitivity: number;
    zoomSensitivity: number;
    dollySensitivity: number;
}

export interface CameraState {
    position: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
    right: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    focalLength: number;
    viewportWidth: number;
    viewportHeight: number;
}

class Renderer {
    private gl: WebGLRenderingContext | null;
    private canvas: HTMLCanvasElement | null;
    private program: WebGLProgram | null;
    private positionBuffer: WebGLBuffer | null;
    private timeLocation: WebGLUniformLocation | null;
    private resolutionLocation: WebGLUniformLocation | null;
    private cameraPosLocation: WebGLUniformLocation | null;
    private cameraTargetLocation: WebGLUniformLocation | null;
    private viewModeLocation: WebGLUniformLocation | null;
    private maxStepsLocation: WebGLUniformLocation | null;
    private hitEpsilonLocation: WebGLUniformLocation | null;
    private maxDistanceLocation: WebGLUniformLocation | null;
    private focalLengthLocation: WebGLUniformLocation | null;
    private stepScaleLocation: WebGLUniformLocation | null;
    private minStepLocation: WebGLUniformLocation | null;
    private normalEpsilonLocation: WebGLUniformLocation | null;
    private refineStepsLocation: WebGLUniformLocation | null;
    private startTimeMs: number;
    private orbitYaw: number;
    private orbitPitch: number;
    private orbitDistance: number;
    private isPointerDown: boolean;
    private pointerMode: 'orbit' | 'pan' | 'dolly' | null;
    private lastPointerX: number;
    private lastPointerY: number;
    private targetX: number;
    private targetY: number;
    private targetZ: number;
    private viewMode: number;
    private raymarchParams: RaymarchParams;
    private viewportParams: ViewportParams;

    constructor() {
        activeRenderers.add(this);
        this.gl = null;
        this.canvas = null;
        this.program = null;
        this.positionBuffer = null;
        this.timeLocation = null;
        this.resolutionLocation = null;
        this.cameraPosLocation = null;
        this.cameraTargetLocation = null;
        this.viewModeLocation = null;
        this.maxStepsLocation = null;
        this.hitEpsilonLocation = null;
        this.maxDistanceLocation = null;
        this.focalLengthLocation = null;
        this.stepScaleLocation = null;
        this.minStepLocation = null;
        this.normalEpsilonLocation = null;
        this.refineStepsLocation = null;
        this.startTimeMs = 0;
        const savedState = this.readStoredCameraState();
        this.orbitYaw = savedState.yaw;
        this.orbitPitch = savedState.pitch;
        this.orbitDistance = savedState.distance;
        this.targetX = savedState.targetX;
        this.targetY = savedState.targetY;
        this.targetZ = savedState.targetZ;
        this.isPointerDown = false;
        this.pointerMode = null;
        this.lastPointerX = 0;
        this.lastPointerY = 0;
        this.viewMode = 0;
        this.raymarchParams = {
            maxSteps: 128,
            hitEpsilon: 0.001,
            maxDistance: 30.0,
            focalLength: 1.7,
            stepScale: 0.7,
            minStep: 0.001,
            normalEpsilon: 0.0012,
            refineSteps: 6,
        };
        this.viewportParams = {
            orbitSensitivity: 0.01,
            panSensitivity: 1.0,
            zoomSensitivity: 0.0015,
            dollySensitivity: 0.004,
        };
    }

    public init(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl');

        if (!this.gl) {
            this.gl = canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
        }

        if (!this.gl) {
            throw new Error('WebGL is not available in this browser.');
        }

        this.program = this.createProgram(getRendererVertexSource(), composeRendererFragmentSource());
        this.positionBuffer = this.gl.createBuffer();
        this.cacheUniformLocations();

        if (!this.positionBuffer) {
            throw new Error('Failed to create fullscreen quad buffer.');
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            new Float32Array([
                -1.0, -1.0,
                1.0, -1.0,
                -1.0, 1.0,
                1.0, 1.0,
            ]),
            this.gl.STATIC_DRAW
        );

        this.resize();
        this.attachInteractionHandlers(canvas);
        this.gl.clearColor(0.06, 0.08, 0.14, 1.0);
        this.startTimeMs = performance.now();
    }

    public hotReloadShaders(updates: ShaderSourceUpdates): ShaderReloadResult {
        applyShaderSourceUpdates(updates);

        if (!this.gl) {
            return {
                ok: false,
                message: 'Renderer not initialized',
            };
        }

        try {
            const nextProgram = this.createProgram(getRendererVertexSource(), composeRendererFragmentSource());
            const previousProgram = this.program;
            this.program = nextProgram;
            this.cacheUniformLocations();
            if (previousProgram) {
                this.gl.deleteProgram(previousProgram);
            }
            console.info('[HMR] Shader program reloaded successfully.');
            return {
                ok: true,
                message: 'Updated',
            };
        } catch (error) {
            console.error('[HMR] Shader reload failed, keeping previous program.', error);
            return {
                ok: false,
                message: error instanceof Error ? error.message : 'Compile failed',
            };
        }
    }

    public render(): void {
        if (!this.gl || !this.canvas || !this.program || !this.positionBuffer) {
            return;
        }

        this.resize();

        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);

        const positionLocation = gl.getAttribLocation(this.program, 'aPosition');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        if (this.timeLocation) {
            gl.uniform1f(this.timeLocation, (performance.now() - this.startTimeMs) * 0.001);
        }

        if (this.resolutionLocation) {
            gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        }

        if (this.cameraPosLocation) {
            const cameraPos = this.getCameraPosition();
            gl.uniform3f(this.cameraPosLocation, cameraPos.x, cameraPos.y, cameraPos.z);
        }

        if (this.cameraTargetLocation) {
            gl.uniform3f(this.cameraTargetLocation, this.targetX, this.targetY, this.targetZ);
        }

        if (this.viewModeLocation) {
            gl.uniform1i(this.viewModeLocation, this.viewMode);
        }

        if (this.maxStepsLocation) {
            gl.uniform1i(this.maxStepsLocation, this.raymarchParams.maxSteps);
        }

        if (this.hitEpsilonLocation) {
            gl.uniform1f(this.hitEpsilonLocation, this.raymarchParams.hitEpsilon);
        }

        if (this.maxDistanceLocation) {
            gl.uniform1f(this.maxDistanceLocation, this.raymarchParams.maxDistance);
        }

        if (this.focalLengthLocation) {
            gl.uniform1f(this.focalLengthLocation, this.raymarchParams.focalLength);
        }

        if (this.stepScaleLocation) {
            gl.uniform1f(this.stepScaleLocation, this.raymarchParams.stepScale);
        }

        if (this.minStepLocation) {
            gl.uniform1f(this.minStepLocation, this.raymarchParams.minStep);
        }

        if (this.normalEpsilonLocation) {
            gl.uniform1f(this.normalEpsilonLocation, this.raymarchParams.normalEpsilon);
        }

        if (this.refineStepsLocation) {
            gl.uniform1i(this.refineStepsLocation, this.raymarchParams.refineSteps);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    public setViewMode(mode: number): void {
        if (mode === 1 || mode === 2) {
            this.viewMode = mode;
            return;
        }

        this.viewMode = 0;
    }

    public getViewMode(): number {
        return this.viewMode;
    }

    public getRaymarchParams(): RaymarchParams {
        return { ...this.raymarchParams };
    }

    public updateRaymarchParams(next: Partial<RaymarchParams>): void {
        this.raymarchParams = {
            maxSteps: this.clampInt(next.maxSteps ?? this.raymarchParams.maxSteps, 8, 512),
            hitEpsilon: this.clampFloat(next.hitEpsilon ?? this.raymarchParams.hitEpsilon, 0.0001, 0.02),
            maxDistance: this.clampFloat(next.maxDistance ?? this.raymarchParams.maxDistance, 1.0, 200.0),
            focalLength: this.clampFloat(next.focalLength ?? this.raymarchParams.focalLength, 0.2, 5.0),
            stepScale: this.clampFloat(next.stepScale ?? this.raymarchParams.stepScale, 0.1, 1.0),
            minStep: this.clampFloat(next.minStep ?? this.raymarchParams.minStep, 0.00001, 0.05),
            normalEpsilon: this.clampFloat(next.normalEpsilon ?? this.raymarchParams.normalEpsilon, 0.00005, 0.05),
            refineSteps: this.clampInt(next.refineSteps ?? this.raymarchParams.refineSteps, 0, 12),
        };
    }

    public getViewportParams(): ViewportParams {
        return { ...this.viewportParams };
    }

    public updateViewportParams(next: Partial<ViewportParams>): void {
        this.viewportParams = {
            orbitSensitivity: this.clampFloat(next.orbitSensitivity ?? this.viewportParams.orbitSensitivity, 0.001, 0.06),
            panSensitivity: this.clampFloat(next.panSensitivity ?? this.viewportParams.panSensitivity, 0.2, 5.0),
            zoomSensitivity: this.clampFloat(next.zoomSensitivity ?? this.viewportParams.zoomSensitivity, 0.0002, 0.02),
            dollySensitivity: this.clampFloat(next.dollySensitivity ?? this.viewportParams.dollySensitivity, 0.0005, 0.04),
        };
    }

    public getCameraState(): CameraState | null {
        if (!this.canvas) {
            return null;
        }

        const basis = this.getCameraBasis();
        const position = this.getCameraPosition();

        return {
            position,
            forward: basis.forward,
            right: basis.right,
            up: basis.up,
            focalLength: this.raymarchParams.focalLength,
            viewportWidth: this.canvas.width,
            viewportHeight: this.canvas.height,
        };
    }

    private attachInteractionHandlers(canvas: HTMLCanvasElement): void {
        canvas.style.cursor = 'grab';

        canvas.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
        });

        canvas.addEventListener('dblclick', () => {
            this.resetCamera();
        });

        canvas.addEventListener('mousedown', (event: MouseEvent) => {
            if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
                return;
            }

            this.isPointerDown = true;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
            if (event.button === 1) {
                this.pointerMode = 'dolly';
            } else {
                this.pointerMode = event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
            }
            canvas.style.cursor = 'grabbing';
        });

        window.addEventListener('mouseup', () => {
            this.isPointerDown = false;
            this.pointerMode = null;
            canvas.style.cursor = 'grab';
        });

        window.addEventListener('mousemove', (event: MouseEvent) => {
            if (!this.isPointerDown || !this.canvas) {
                return;
            }

            const dx = event.clientX - this.lastPointerX;
            const dy = event.clientY - this.lastPointerY;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;

            if (this.pointerMode === 'pan') {
                const basis = this.getCameraBasis();
                const panScale = (this.orbitDistance / Math.max(this.canvas.clientHeight, 1)) * this.viewportParams.panSensitivity;
                this.targetX += (-basis.right.x * dx + basis.up.x * dy) * panScale;
                this.targetY += (-basis.right.y * dx + basis.up.y * dy) * panScale;
                this.targetZ += (-basis.right.z * dx + basis.up.z * dy) * panScale;
                this.storeCameraState();
                return;
            }

            if (this.pointerMode === 'dolly') {
                this.orbitDistance *= Math.exp(dy * this.viewportParams.dollySensitivity);
                this.orbitDistance = Math.max(1.0, Math.min(16.0, this.orbitDistance));
                this.storeCameraState();
                return;
            }

            this.orbitYaw += dx * this.viewportParams.orbitSensitivity;
            this.orbitPitch -= dy * this.viewportParams.orbitSensitivity;

            const pitchLimit = 1.35;
            this.orbitPitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.orbitPitch));
            this.storeCameraState();
        });

        canvas.addEventListener('wheel', (event: WheelEvent) => {
            event.preventDefault();
            this.orbitDistance *= Math.exp(event.deltaY * this.viewportParams.zoomSensitivity);
            this.orbitDistance = Math.max(1.0, Math.min(16.0, this.orbitDistance));
            this.storeCameraState();
        }, { passive: false });

        window.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key.toLowerCase() === 'f') {
                this.resetCamera();
            }
        });
    }

    private readStoredCameraState(): {
        yaw: number;
        pitch: number;
        distance: number;
        targetX: number;
        targetY: number;
        targetZ: number;
    } {
        const fallback = {
            yaw: 0.45,
            pitch: 0.25,
            distance: 3.0,
            targetX: 0.0,
            targetY: 0.0,
            targetZ: 0.0,
        };

        try {
            const raw = sessionStorage.getItem(CAMERA_STATE_STORAGE_KEY);
            if (!raw) {
                return fallback;
            }

            const parsed = JSON.parse(raw) as {
                yaw?: number;
                pitch?: number;
                distance?: number;
                targetX?: number;
                targetY?: number;
                targetZ?: number;
            };
            if (
                typeof parsed.yaw !== 'number' ||
                typeof parsed.pitch !== 'number' ||
                typeof parsed.distance !== 'number'
            ) {
                return fallback;
            }

            return {
                yaw: parsed.yaw,
                pitch: Math.max(-1.35, Math.min(1.35, parsed.pitch)),
                distance: Math.max(1.5, Math.min(8.0, parsed.distance)),
                targetX: typeof parsed.targetX === 'number' ? parsed.targetX : 0.0,
                targetY: typeof parsed.targetY === 'number' ? parsed.targetY : 0.0,
                targetZ: typeof parsed.targetZ === 'number' ? parsed.targetZ : 0.0,
            };
        } catch {
            return fallback;
        }
    }

    private storeCameraState(): void {
        try {
            sessionStorage.setItem(
                CAMERA_STATE_STORAGE_KEY,
                JSON.stringify({
                    yaw: this.orbitYaw,
                    pitch: this.orbitPitch,
                    distance: this.orbitDistance,
                    targetX: this.targetX,
                    targetY: this.targetY,
                    targetZ: this.targetZ,
                })
            );
        } catch {
            // Ignore storage errors (private mode/storage restrictions).
        }
    }

    private resetCamera(): void {
        this.orbitYaw = 0.45;
        this.orbitPitch = 0.25;
        this.orbitDistance = 3.0;
        this.targetX = 0.0;
        this.targetY = 0.0;
        this.targetZ = 0.0;
        this.storeCameraState();
    }

    private clampInt(value: number, min: number, max: number): number {
        const safe = Number.isFinite(value) ? Math.round(value) : min;
        return Math.max(min, Math.min(max, safe));
    }

    private clampFloat(value: number, min: number, max: number): number {
        const safe = Number.isFinite(value) ? value : min;
        return Math.max(min, Math.min(max, safe));
    }

    private getCameraPosition(): { x: number; y: number; z: number } {
        const basis = this.getCameraBasis();
        return {
            x: this.targetX + basis.forward.x * -this.orbitDistance,
            y: this.targetY + basis.forward.y * -this.orbitDistance,
            z: this.targetZ + basis.forward.z * -this.orbitDistance,
        };
    }

    private getCameraBasis(): {
        forward: { x: number; y: number; z: number };
        right: { x: number; y: number; z: number };
        up: { x: number; y: number; z: number };
    } {
        const cp = Math.cos(this.orbitPitch);
        const forward = {
            x: cp * Math.sin(this.orbitYaw),
            y: Math.sin(this.orbitPitch),
            z: cp * Math.cos(this.orbitYaw),
        };

        const upWorld = { x: 0.0, y: 1.0, z: 0.0 };
        const right = normalize3(cross3(upWorld, forward));
        const up = normalize3(cross3(forward, right));

        return {
            forward,
            right,
            up,
        };
    }

    private createShader(type: number, source: string): WebGLShader {
        if (!this.gl) {
            throw new Error('WebGL context is not initialized.');
        }

        const shader = this.gl.createShader(type);
        if (!shader) {
            throw new Error('Failed to create shader object.');
        }

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const error = this.gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
            this.gl.deleteShader(shader);
            throw new Error(error);
        }

        return shader;
    }

    private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
        if (!this.gl) {
            throw new Error('WebGL context is not initialized.');
        }

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        const program = this.gl.createProgram();

        if (!program) {
            throw new Error('Failed to create shader program.');
        }

        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        this.gl.deleteShader(vertexShader);
        this.gl.deleteShader(fragmentShader);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            const error = this.gl.getProgramInfoLog(program) || 'Unknown program link error';
            this.gl.deleteProgram(program);
            throw new Error(error);
        }

        return program;
    }

    private cacheUniformLocations(): void {
        if (!this.gl || !this.program) {
            return;
        }

        this.timeLocation = this.gl.getUniformLocation(this.program, 'uTime');
        this.resolutionLocation = this.gl.getUniformLocation(this.program, 'uResolution');
        this.cameraPosLocation = this.gl.getUniformLocation(this.program, 'uCameraPos');
        this.cameraTargetLocation = this.gl.getUniformLocation(this.program, 'uCameraTarget');
        this.viewModeLocation = this.gl.getUniformLocation(this.program, 'uViewMode');
        this.maxStepsLocation = this.gl.getUniformLocation(this.program, 'uMaxSteps');
        this.hitEpsilonLocation = this.gl.getUniformLocation(this.program, 'uHitEpsilon');
        this.maxDistanceLocation = this.gl.getUniformLocation(this.program, 'uMaxDistance');
        this.focalLengthLocation = this.gl.getUniformLocation(this.program, 'uFocalLength');
        this.stepScaleLocation = this.gl.getUniformLocation(this.program, 'uStepScale');
        this.minStepLocation = this.gl.getUniformLocation(this.program, 'uMinStep');
        this.normalEpsilonLocation = this.gl.getUniformLocation(this.program, 'uNormalEpsilon');
        this.refineStepsLocation = this.gl.getUniformLocation(this.program, 'uRefineSteps');
    }

    public resize(): void {
        if (!this.gl || !this.canvas) {
            return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const displayWidth = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
        const displayHeight = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));

        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
        }

        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
}

export default Renderer;
const activeRenderers: Set<Renderer> = ((globalThis as any).__implicitActiveRenderers as Set<Renderer> | undefined) ?? new Set<Renderer>();
(globalThis as any).__implicitActiveRenderers = activeRenderers;

function emitShaderStatus(mode: ShaderStatusMode, message: string): void {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(
        new CustomEvent('shader-hmr-status', {
            detail: { mode, message },
        })
    );
}

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        emitShaderStatus('compiling', 'Compiling...');

        const updates = getImportedShaderSources();
        let anySuccess = false;
        let lastError = 'Compile failed';

        activeRenderers.forEach((renderer) => {
            const result = renderer.hotReloadShaders(updates);
            if (result.ok) {
                anySuccess = true;
            } else {
                lastError = result.message;
            }
        });

        if (anySuccess || activeRenderers.size === 0) {
            emitShaderStatus('ok', 'Updated');
            return;
        }

        emitShaderStatus('error', lastError);
    });
}

const CAMERA_STATE_STORAGE_KEY = 'implicit.camera.orbit.v1';

function cross3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function normalize3(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-8) {
        return { x: 1.0, y: 0.0, z: 0.0 };
    }

    return {
        x: v.x / len,
        y: v.y / len,
        z: v.z / len,
    };
}