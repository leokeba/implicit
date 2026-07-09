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
import { CameraController } from './renderer/camera-controller';
import { ThemeClearColorSync } from './renderer/theme-clear-color';
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
    private needsRender: boolean;
    private reducedMotionQuery: MediaQueryList | null;
    private handleReducedMotionChange: (() => void) | null;
    private viewMode: number;
    private slicerUniformState: SceneSlicerUniformState;
    private raymarchParams: RaymarchParams;
    private viewportParams: ViewportParams;
    private animationParams: AnimationParams;
    private sceneControlDefinitions: SceneControlDefinition[];
    private sceneControlValues: SceneControlValueMap;
    private camera: CameraController;
    private theme: ThemeClearColorSync;

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
        this.needsRender = true;
        this.reducedMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        this.handleReducedMotionChange = () => {
            this.needsRender = true;
        };
        this.reducedMotionQuery?.addEventListener?.('change', this.handleReducedMotionChange);
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
        this.camera = new CameraController(
            () => this.viewportParams,
            () => {
                this.needsRender = true;
            },
        );
        this.theme = new ThemeClearColorSync(() => {
            this.needsRender = true;
        });
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
        this.camera.attach(canvas);
        this.theme.attach(this.gl);
        this.startTimeMs = performance.now();
        this.lastRenderTimeMs = 0;
        this.renderedFrameCount = 0;
        this.pausedDurationMs = 0;
        this.pauseStartedAtMs = 0;
        this.isPaused = false;
    }

    /** Releases GL resources and every listener registered by init(). */
    public dispose(): void {
        this.camera.detach();
        this.theme.detach();
        if (this.reducedMotionQuery && this.handleReducedMotionChange) {
            this.reducedMotionQuery.removeEventListener?.('change', this.handleReducedMotionChange);
        }
        if (this.gl) {
            if (this.program) {
                this.gl.deleteProgram(this.program);
            }
            if (this.positionBuffer) {
                this.gl.deleteBuffer(this.positionBuffer);
            }
        }
        this.program = null;
        this.positionBuffer = null;
        this.uniforms = null;
        this.gl = null;
        this.canvas = null;
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
        const cameraPos = this.camera.getPosition();
        const cameraTarget = this.camera.getTarget();
        const uniforms = this.uniforms;

        uniforms.set1f('uTime', (nowMs - this.startTimeMs - this.pausedDurationMs) * 0.001);
        uniforms.set1f('uFrameModulo', frameModulo);
        uniforms.set1f('uFramePeriod', framePeriod);
        uniforms.set2f('uResolution', this.canvas.width, this.canvas.height);
        uniforms.set3f('uCameraPos', cameraPos.x, cameraPos.y, cameraPos.z);
        uniforms.set3f('uCameraTarget', cameraTarget.x, cameraTarget.y, cameraTarget.z);
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
        uniforms.set1f('uUiLightTheme', this.theme.uiLightTheme());

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

        const basis = this.camera.getBasis();

        return {
            position: this.camera.getPosition(),
            forward: basis.forward,
            right: basis.right,
            up: basis.up,
            focalLength: this.raymarchParams.focalLength,
            viewportWidth: this.canvas.width,
            viewportHeight: this.canvas.height,
        };
    }

    public resetCameraView(): void {
        this.camera.reset();
    }

    private clampInt(value: number, min: number, max: number): number {
        const safe = Number.isFinite(value) ? Math.round(value) : min;
        return Math.max(min, Math.min(max, safe));
    }

    private clampFloat(value: number, min: number, max: number): number {
        const safe = Number.isFinite(value) ? value : min;
        return Math.max(min, Math.min(max, safe));
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
}

export default Renderer;
