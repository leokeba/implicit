import {
    applyShaderSourceUpdates,
    composeRendererFragmentSource,
    getRendererVertexSource,
    type SceneControlDefinition,
    type SceneControlValueMap,
    type ShaderSourceUpdates,
} from './shader-pipeline';
import { buildSceneControlValueMap } from './control-options';
import { createProgram } from './gl/program';
import { UniformBinder } from './gl/uniforms';
import type {
    AnimationParams,
    CameraState,
    RaymarchParams,
    SceneSlicerUniformState,
    ViewportParams,
} from './renderer/types';
export type {
    AnimationParams,
    CameraState,
    RaymarchParams,
    SceneSlicerUniformState,
    ViewportParams,
} from './renderer/types';

export interface ShaderReloadResult {
    ok: boolean;
    message: string;
}

class Renderer {
    private gl: WebGLRenderingContext | null;
    private canvas: HTMLCanvasElement | null;
    private program: WebGLProgram | null;
    private positionBuffer: WebGLBuffer | null;
    private uniforms: UniformBinder | null;
    private startTimeMs: number;
    private lastRenderTimeMs: number;
    private renderedFrameCount: number;
    private pausedDurationMs: number;
    private pauseStartedAtMs: number;
    private isPaused: boolean;
    private orbitYaw: number;
    private orbitPitch: number;
    private orbitDistance: number;
    private isPointerDown: boolean;
    private pointerMode: 'orbit' | 'pan' | 'dolly' | null;
    private lastPointerX: number;
    private lastPointerY: number;
    private activePointers: Map<number, { x: number; y: number }>;
    private pinchDistance: number | null;
    private needsRender: boolean;
    private reducedMotionQuery: MediaQueryList | null;
    private targetX: number;
    private targetY: number;
    private targetZ: number;
    private viewMode: number;
    private slicerUniformState: SceneSlicerUniformState;
    private raymarchParams: RaymarchParams;
    private viewportParams: ViewportParams;
    private animationParams: AnimationParams;
    private sceneControlDefinitions: SceneControlDefinition[];
    private sceneControlValues: SceneControlValueMap;
    private themeMediaQuery: MediaQueryList | null;
    private handleThemeChange: (() => void) | null;
    private uiLightTheme: number;

    constructor() {
        this.gl = null;
        this.canvas = null;
        this.program = null;
        this.positionBuffer = null;
        this.uniforms = null;
        this.startTimeMs = 0;
        this.lastRenderTimeMs = 0;
        this.renderedFrameCount = 0;
        this.pausedDurationMs = 0;
        this.pauseStartedAtMs = 0;
        this.isPaused = false;
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
        this.activePointers = new Map();
        this.pinchDistance = null;
        this.needsRender = true;
        this.reducedMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this.reducedMotionQuery?.addEventListener?.('change', () => {
            this.needsRender = true;
        });
        this.viewMode = 0;
        this.slicerUniformState = {
            minY: -1.0,
            maxY: 1.0,
            modelScale: 50.0,
            maxRadius: 1.1,
            nozzleDiameter: 0.4,
            flowRate: 1.0,
            layerHeight: 0.2,
            lineWidth: 0.42,
            firstLayerLineWidth: 0.5,
        };
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
        this.animationParams = {
            targetFrameRate: 0,
            framePeriod: 120,
        };
        this.sceneControlDefinitions = [];
        this.sceneControlValues = {};
        this.themeMediaQuery = null;
        this.handleThemeChange = null;
        this.uiLightTheme = 0;
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

        this.program = createProgram(this.gl, getRendererVertexSource(), composeRendererFragmentSource());
        this.positionBuffer = this.gl.createBuffer();
        this.uniforms = new UniformBinder(this.gl, this.program);

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
        this.applyThemeClearColor();
        this.registerThemeClearColorSync();
        this.startTimeMs = performance.now();
        this.lastRenderTimeMs = 0;
        this.renderedFrameCount = 0;
        this.pausedDurationMs = 0;
        this.pauseStartedAtMs = 0;
        this.isPaused = false;
    }

    public setPaused(paused: boolean, nowMs: number = performance.now()): void {
        if (this.isPaused === paused) {
            return;
        }

        this.isPaused = paused;
        this.needsRender = true;
        if (paused) {
            this.pauseStartedAtMs = nowMs;
            return;
        }

        if (this.pauseStartedAtMs > 0) {
            this.pausedDurationMs += Math.max(0, nowMs - this.pauseStartedAtMs);
        }
        this.pauseStartedAtMs = 0;
        this.lastRenderTimeMs = 0;
    }

    public hotReloadShaders(updates: ShaderSourceUpdates): ShaderReloadResult {
        applyShaderSourceUpdates(updates);
        this.needsRender = true;

        if (!this.gl) {
            return {
                ok: false,
                message: 'Renderer not initialized',
            };
        }

        try {
            const nextProgram = createProgram(this.gl, getRendererVertexSource(), composeRendererFragmentSource());
            const previousProgram = this.program;
            this.program = nextProgram;
            this.uniforms = new UniformBinder(this.gl, nextProgram);
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

    public render(nowMs: number = performance.now()): boolean {
        if (!this.gl || !this.canvas || !this.program || !this.positionBuffer || !this.uniforms) {
            return false;
        }

        if (this.isPaused) {
            return false;
        }

        if (!this.shouldRenderAt(nowMs)) {
            return false;
        }

        this.resize();

        // Static scenes only re-render when state changed (camera, uniforms,
        // size, theme). A scene counts as animated when the compiled program
        // actually reads uTime/uFrameModulo (unused uniforms are stripped, so
        // a null location means the scene ignores them). Reduced-motion users
        // get the static path: animation freezes unless they interact.
        const sceneIsAnimated = this.uniforms.has('uTime') || this.uniforms.has('uFrameModulo');
        const reduceMotion = this.reducedMotionQuery?.matches ?? false;
        if ((!sceneIsAnimated || reduceMotion) && !this.needsRender) {
            return false;
        }
        this.needsRender = false;

        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);

        const positionLocation = gl.getAttribLocation(this.program, 'aPosition');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        const framePeriod = this.animationParams.framePeriod;
        const frameModulo = this.renderedFrameCount % framePeriod;
        const cameraPos = this.getCameraPosition();
        const uniforms = this.uniforms;

        uniforms.set1f('uTime', (nowMs - this.startTimeMs - this.pausedDurationMs) * 0.001);
        uniforms.set1f('uFrameModulo', frameModulo);
        uniforms.set1f('uFramePeriod', framePeriod);
        uniforms.set2f('uResolution', this.canvas.width, this.canvas.height);
        uniforms.set3f('uCameraPos', cameraPos.x, cameraPos.y, cameraPos.z);
        uniforms.set3f('uCameraTarget', this.targetX, this.targetY, this.targetZ);
        uniforms.set1i('uViewMode', this.viewMode);
        uniforms.set1i('uMaxSteps', this.raymarchParams.maxSteps);
        uniforms.set1f('uHitEpsilon', this.raymarchParams.hitEpsilon);
        uniforms.set1f('uMaxDistance', this.raymarchParams.maxDistance);
        uniforms.set1f('uFocalLength', this.raymarchParams.focalLength);
        uniforms.set1f('uStepScale', this.raymarchParams.stepScale);
        uniforms.set1f('uMinStep', this.raymarchParams.minStep);
        uniforms.set1f('uNormalEpsilon', this.raymarchParams.normalEpsilon);
        uniforms.set1i('uRefineSteps', this.raymarchParams.refineSteps);
        uniforms.set1f('uLayerHeight', this.slicerUniformState.layerHeight);
        uniforms.set1f('uMinY', this.slicerUniformState.minY);
        uniforms.set1f('uMaxY', this.slicerUniformState.maxY);
        uniforms.set1f('uScale', this.slicerUniformState.modelScale);
        uniforms.set1f('uMaxRadius', this.slicerUniformState.maxRadius);
        uniforms.set1f('uNozzleDiameter', this.slicerUniformState.nozzleDiameter);
        uniforms.set1f('uFlowRate', this.slicerUniformState.flowRate);
        uniforms.set1f('uLineWidth', this.slicerUniformState.lineWidth);
        uniforms.set1f('uFirstLayerLineWidth', this.slicerUniformState.firstLayerLineWidth);
        uniforms.set1f('uUiLightTheme', this.uiLightTheme);

        for (const control of this.sceneControlDefinitions) {
            uniforms.set1f(control.uniform, this.sceneControlValues[control.key] ?? control.defaultValue);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.renderedFrameCount += 1;
        return true;
    }

    public setViewMode(mode: number): void {
        if (mode === 1 || mode === 2 || mode === 3) {
            this.viewMode = mode;
            this.needsRender = true;
            return;
        }

        this.viewMode = 0;
        this.needsRender = true;
    }

    public getViewMode(): number {
        return this.viewMode;
    }

    public setSceneSlicerUniformState(next: Partial<SceneSlicerUniformState>): void {
        this.slicerUniformState = {
            minY: this.clampFloat(next.minY ?? this.slicerUniformState.minY, -5.0, 5.0),
            maxY: this.clampFloat(next.maxY ?? this.slicerUniformState.maxY, -5.0, 5.0),
            modelScale: this.clampFloat(next.modelScale ?? this.slicerUniformState.modelScale, 1.0, 400.0),
            maxRadius: this.clampFloat(next.maxRadius ?? this.slicerUniformState.maxRadius, 0.1, 3.0),
            nozzleDiameter: this.clampFloat(next.nozzleDiameter ?? this.slicerUniformState.nozzleDiameter, 0.2, 1.2),
            flowRate: this.clampFloat(next.flowRate ?? this.slicerUniformState.flowRate, 0.01, 5.0),
            layerHeight: this.clampFloat(next.layerHeight ?? this.slicerUniformState.layerHeight, 0.05, 1.0),
            lineWidth: this.clampFloat(next.lineWidth ?? this.slicerUniformState.lineWidth, 0.2, 1.2),
            firstLayerLineWidth: this.clampFloat(next.firstLayerLineWidth ?? this.slicerUniformState.firstLayerLineWidth, 0.2, 1.2),
        };

        if (this.slicerUniformState.maxY <= this.slicerUniformState.minY) {
            this.slicerUniformState.maxY = this.slicerUniformState.minY + this.slicerUniformState.layerHeight;
        }

        this.needsRender = true;
    }

    public setSceneControlState(definitions: SceneControlDefinition[], values: SceneControlValueMap): void {
        // Uniform locations only change with the program; a scene change that
        // alters the control set also recompiles, which rebuilds the binder.
        this.sceneControlDefinitions = definitions.map((definition) => ({ ...definition }));
        this.sceneControlValues = buildSceneControlValueMap(this.sceneControlDefinitions, values);
        this.needsRender = true;
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
        this.needsRender = true;
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

    public getAnimationParams(): AnimationParams {
        return { ...this.animationParams };
    }

    public updateAnimationParams(next: Partial<AnimationParams>): void {
        this.animationParams = {
            targetFrameRate: this.clampInt(next.targetFrameRate ?? this.animationParams.targetFrameRate, 0, 120),
            framePeriod: this.clampInt(next.framePeriod ?? this.animationParams.framePeriod, 1, 4096),
        };
        this.needsRender = true;
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

    public resetCameraView(): void {
        this.resetCamera();
    }

    private attachInteractionHandlers(canvas: HTMLCanvasElement): void {
        canvas.style.cursor = 'grab';

        canvas.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
        });

        canvas.addEventListener('dblclick', () => {
            this.resetCamera();
        });

        // Pointer Events cover mouse, touch, and pen with one code path.
        // Two simultaneous touch pointers drive pinch-dolly plus pan.
        canvas.style.touchAction = 'none';

        canvas.addEventListener('pointerdown', (event: PointerEvent) => {
            if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1 && event.button !== 2) {
                return;
            }

            try {
                canvas.setPointerCapture(event.pointerId);
            } catch {
                // The pointer may already be gone (e.g. touch lifted mid-gesture).
            }
            this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (this.activePointers.size === 2) {
                this.pinchDistance = this.currentPinchDistance();
                this.pointerMode = null;
                return;
            }

            this.isPointerDown = true;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
            if (event.pointerType === 'mouse' && event.button === 1) {
                this.pointerMode = 'dolly';
            } else {
                this.pointerMode = (event.pointerType === 'mouse' && event.button === 2) || event.shiftKey ? 'pan' : 'orbit';
            }
            canvas.style.cursor = 'grabbing';
        });

        const releasePointer = (event: PointerEvent): void => {
            this.activePointers.delete(event.pointerId);
            this.pinchDistance = null;

            if (this.activePointers.size === 1) {
                // Pinch ended with one finger still down: continue as orbit from there.
                const remaining = [...this.activePointers.values()][0];
                this.lastPointerX = remaining.x;
                this.lastPointerY = remaining.y;
                this.isPointerDown = true;
                this.pointerMode = 'orbit';
                return;
            }

            this.isPointerDown = false;
            this.pointerMode = null;
            canvas.style.cursor = 'grab';
        };
        canvas.addEventListener('pointerup', releasePointer);
        canvas.addEventListener('pointercancel', releasePointer);

        canvas.addEventListener('pointermove', (event: PointerEvent) => {
            if (!this.canvas || !this.activePointers.has(event.pointerId)) {
                return;
            }

            this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (this.activePointers.size === 2) {
                const distance = this.currentPinchDistance();
                if (this.pinchDistance !== null && distance > 0 && this.pinchDistance > 0) {
                    this.orbitDistance *= this.pinchDistance / distance;
                    this.orbitDistance = Math.max(1.0, Math.min(16.0, this.orbitDistance));
                    this.storeCameraState();
                }
                this.pinchDistance = distance;
                return;
            }

            if (!this.isPointerDown) {
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
            if (event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }
            const target = event.target;
            if (target instanceof HTMLElement && (
                target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || target instanceof HTMLSelectElement
                || target.isContentEditable
            )) {
                return;
            }
            this.resetCamera();
        });
    }

    private currentPinchDistance(): number {
        const points = [...this.activePointers.values()];
        if (points.length < 2) {
            return 0;
        }
        return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
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
        this.needsRender = true;
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

    private shouldRenderAt(nowMs: number): boolean {
        const targetFrameRate = this.animationParams.targetFrameRate;
        if (targetFrameRate <= 0) {
            this.lastRenderTimeMs = nowMs;
            return true;
        }

        if (this.lastRenderTimeMs <= 0) {
            this.lastRenderTimeMs = nowMs;
            return true;
        }

        const minFrameIntervalMs = 1000 / targetFrameRate;
        if ((nowMs - this.lastRenderTimeMs) < minFrameIntervalMs) {
            return false;
        }

        this.lastRenderTimeMs = nowMs;
        return true;
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
            this.needsRender = true;
        }

        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    /** Mark the next frame dirty; static scenes skip rendering otherwise. */
    public requestRender(): void {
        this.needsRender = true;
    }

    private registerThemeClearColorSync(): void {
        if (typeof window === 'undefined' || this.handleThemeChange) {
            return;
        }

        this.themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.handleThemeChange = () => {
            this.applyThemeClearColor();
        };

        if (typeof this.themeMediaQuery.addEventListener === 'function') {
            this.themeMediaQuery.addEventListener('change', this.handleThemeChange);
            return;
        }

        this.themeMediaQuery.addListener(this.handleThemeChange);
    }

    private applyThemeClearColor(): void {
        this.needsRender = true;
        const isDarkTheme = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.uiLightTheme = isDarkTheme ? 0 : 1;

        if (!this.gl) {
            return;
        }

        const [r, g, b] = this.resolveThemeClearColor();
        this.gl.clearColor(r, g, b, 1.0);
    }

    private resolveThemeClearColor(): [number, number, number] {
        if (typeof window === 'undefined') {
            return [0.06, 0.08, 0.14];
        }

        const rootStyle = window.getComputedStyle(document.documentElement);
        const colorToken = rootStyle.getPropertyValue('--surface-canvas').trim();
        const parsed = this.parseCssColorToRgb(colorToken);
        if (parsed) {
            return parsed;
        }

        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        return isDark ? [0.06, 0.08, 0.14] : [0.86, 0.9, 0.94];
    }

    private parseCssColorToRgb(colorValue: string): [number, number, number] | null {
        if (!colorValue) {
            return null;
        }

        const hexMatch = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(colorValue);
        if (hexMatch) {
            const rawHex = hexMatch[1];
            const hex = rawHex.length === 3
                ? rawHex.split('').map((ch) => `${ch}${ch}`).join('')
                : rawHex;

            const intValue = Number.parseInt(hex, 16);
            const red = ((intValue >> 16) & 255) / 255;
            const green = ((intValue >> 8) & 255) / 255;
            const blue = (intValue & 255) / 255;
            return [red, green, blue];
        }

        const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(colorValue);
        if (!rgbMatch) {
            return null;
        }

        const channels = rgbMatch[1]
            .split(',')
            .map((part) => Number.parseFloat(part.trim()))
            .filter((value) => Number.isFinite(value));

        if (channels.length < 3) {
            return null;
        }

        return [
            Math.max(0, Math.min(255, channels[0])) / 255,
            Math.max(0, Math.min(255, channels[1])) / 255,
            Math.max(0, Math.min(255, channels[2])) / 255,
        ];
    }
}

export default Renderer;
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

