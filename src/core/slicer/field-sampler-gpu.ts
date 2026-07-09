import { createProgram } from '../gl/program';
import { UniformBinder } from '../gl/uniforms';
import { buildSceneControlValueMap } from '../control-options';
import {
    composeSceneFieldSamplerFragmentSource,
    composeSlicerFragmentSource,
    getSceneFieldDefinitions,
    getSceneFieldSamplerVertexSource,
    getSlicerProgramSignature,
    getSlicerVertexSource,
    type SceneControlDefinition,
    type SceneControlValueMap,
    type SceneFieldDefinition,
    type SceneFieldValue,
} from '../shader-pipeline';
import { clampInt, yieldToMainThread } from './math';
import type { VaseSlicerSettings } from './config';
import type { ToolpathPoint } from './types';
import type { FieldBatch, FieldBatchRequest, FieldSampler, PendingFieldBatch } from './field-sampler';

const SLICE_BATCH_SIZE = 16;
const MAX_SLICE_GRID_SIZE = 2048;

interface SlicerProgramSources {
    vertex: string;
    fragment: string;
    signature: string;
}

/**
 * A GPU batch whose draw + readback have been issued but not yet consumed.
 * On WebGL2 the pixels land in a PIXEL_PACK_BUFFER guarded by a fence so the
 * CPU can extract the previous batch while this one renders; on WebGL1 the
 * synchronous readback already happened at issue time.
 */
interface GpuPendingBatch {
    firstSampleY: number;
    sliceYStep: number;
    batchLayerCount: number;
    gridSize: number;
    distanceRange: number;
    byteLength: number;
    pbo: WebGLBuffer | null;
    fence: WebGLSync | null;
    pixels: Uint8Array | null;
}

/**
 * Samples the scene's signed-distance field by rendering slice batches into
 * an offscreen framebuffer. Also hosts the toolpath scene-field sampler,
 * which shares the same GL context and render target.
 */
export class GpuFieldSampler implements FieldSampler {
    private gl: WebGLRenderingContext | null = null;
    private framebuffer: WebGLFramebuffer | null = null;
    private renderTargetTexture: WebGLTexture | null = null;
    private program: WebGLProgram | null = null;
    private positionBuffer: WebGLBuffer | null = null;
    private offscreenCanvas: HTMLCanvasElement | OffscreenCanvas;
    private programSignature = '';
    private programSourcesOverride: SlicerProgramSources | null = null;
    private uniforms: UniformBinder | null = null;
    private positionLocation = -1;
    private maxTextureSize = 0;
    private renderTargetWidth = 0;
    private renderTargetHeight = 0;
    private sceneControlDefinitions: SceneControlDefinition[] = [];
    private sceneControlValues: SceneControlValueMap = {};

    constructor() {
        // In a worker there is no DOM; OffscreenCanvas provides the GL host.
        this.offscreenCanvas = typeof document !== 'undefined'
            ? document.createElement('canvas')
            : new OffscreenCanvas(4, 4);
    }

    public setSceneControlState(definitions: SceneControlDefinition[], values: SceneControlValueMap): void {
        this.sceneControlDefinitions = definitions.map((definition) => ({ ...definition }));
        this.sceneControlValues = buildSceneControlValueMap(this.sceneControlDefinitions, values);
    }

    /**
     * Inject pre-composed shader sources (worker mode). Outside a worker the
     * sources come from the live scene registry on every ensure call.
     */
    public setProgramSourcesOverride(vertex: string, fragment: string, signature: string): void {
        this.programSourcesOverride = { vertex, fragment, signature };
    }

    public maxGridSize(): number {
        return clampInt(Math.min(this.getMaxTextureSize(), MAX_SLICE_GRID_SIZE), 32, MAX_SLICE_GRID_SIZE);
    }

    public batchCapacity(gridSize: number): number {
        const maxTextureSize = Math.max(1, this.getMaxTextureSize());
        const maxBatchByTexture = Math.max(1, Math.floor(maxTextureSize / Math.max(1, gridSize)));
        return Math.max(1, Math.min(SLICE_BATCH_SIZE, maxBatchByTexture));
    }

    public sampleBatch(settings: VaseSlicerSettings, request: FieldBatchRequest): FieldBatch[] {
        return this.issueBatch(settings, request).read();
    }

    public issueBatch(settings: VaseSlicerSettings, request: FieldBatchRequest): PendingFieldBatch {
        const pending = this.issueDraw(settings, request);
        return {
            wait: () => this.waitForPending(pending),
            read: () => this.readPending(pending),
        };
    }

    private issueDraw(settings: VaseSlicerSettings, request: FieldBatchRequest): GpuPendingBatch {
        const { bounds, gridSize, firstSampleY, sliceYStep, batchLayerCount } = request;
        const width = gridSize;
        const height = gridSize * batchLayerCount;
        const distanceRange = Math.max(
            settings.hitEpsilon * 8.0,
            Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
        );

        this.ensureRenderTarget(width, height);
        this.ensureSlicerProgram();
        this.ensureQuadBuffer();

        if (!this.gl || !this.program || !this.uniforms || !this.positionBuffer || !this.framebuffer || !this.renderTargetTexture) {
            throw new Error('Failed to initialize GPU contour slicing resources.');
        }
        const uniforms = this.uniforms;

        const gl = this.gl;
        gl.viewport(0, 0, width, height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.renderTargetTexture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('Slicer framebuffer is incomplete.');
        }

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);

        if (this.positionLocation < 0) {
            throw new Error('Failed to resolve slicer vertex attribute location.');
        }
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        uniforms.set2f('uTextureSize', width, height);
        uniforms.set1f('uFrameModulo', 0.0);
        uniforms.set1f('uFramePeriod', 120.0);
        uniforms.set1f('uMinY', settings.minY);
        uniforms.set1f('uMaxY', settings.maxY);
        uniforms.set1f('uScale', settings.modelScale);
        uniforms.set1f('uMaxRadius', settings.maxRadius);
        uniforms.set1f('uNozzleDiameter', settings.nozzleDiameter);
        uniforms.set1f('uFlowRate', settings.flowRate);
        uniforms.set1f('uLayerHeight', settings.layerHeight);
        uniforms.set1f('uLineWidth', settings.lineWidth);
        uniforms.set1f('uFirstLayerLineWidth', settings.firstLayerLineWidth);
        uniforms.set2f('uSliceMin', bounds.minX, bounds.minZ);
        uniforms.set2f('uSliceMax', bounds.maxX, bounds.maxZ);
        uniforms.set1f('uSliceY', firstSampleY);
        uniforms.set1f('uSliceYStep', sliceYStep);
        uniforms.set1f('uSliceGridSize', gridSize);
        uniforms.set1f('uDistanceRange', distanceRange);
        uniforms.set1f('uIsoSnapEpsilon', settings.hitEpsilon * settings.sliceIsoSnapFactor);

        for (const control of this.sceneControlDefinitions) {
            uniforms.set1f(control.uniform, this.sceneControlValues[control.key] ?? control.defaultValue);
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const byteLength = width * height * 4;
        const pendingBase = {
            firstSampleY,
            sliceYStep,
            batchLayerCount,
            gridSize,
            distanceRange,
            byteLength,
        };

        const gl2 = this.getGl2();
        if (gl2) {
            // Enqueue the readback into a pixel-pack buffer and fence it; the
            // caller can extract the previous batch while the GPU works.
            const pbo = gl2.createBuffer();
            if (pbo) {
                gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, pbo);
                gl2.bufferData(gl2.PIXEL_PACK_BUFFER, byteLength, gl2.STREAM_READ);
                gl2.readPixels(0, 0, width, height, gl2.RGBA, gl2.UNSIGNED_BYTE, 0);
                gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
                const fence = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
                gl2.flush();
                gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
                return { ...pendingBase, pbo, fence, pixels: null };
            }
        }

        const pixels = new Uint8Array(byteLength);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { ...pendingBase, pbo: null, fence: null, pixels };
    }

    /** Non-blocking fence poll; resolves when the batch's readback is ready. */
    private async waitForPending(pending: GpuPendingBatch): Promise<void> {
        const gl2 = this.getGl2();
        if (!gl2 || !pending.fence) {
            return;
        }

        for (;;) {
            const status = gl2.clientWaitSync(pending.fence, 0, 0);
            if (status === gl2.WAIT_FAILED) {
                this.disposePending(gl2, pending);
                throw new Error('GPU sync failed while sampling the slice field.');
            }
            if (status === gl2.ALREADY_SIGNALED || status === gl2.CONDITION_SATISFIED) {
                return;
            }
            await yieldToMainThread();
        }
    }

    private disposePending(gl2: WebGL2RenderingContext, pending: GpuPendingBatch): void {
        if (pending.pbo) {
            gl2.deleteBuffer(pending.pbo);
            pending.pbo = null;
        }
        if (pending.fence) {
            gl2.deleteSync(pending.fence);
            pending.fence = null;
        }
    }

    private readPending(pending: GpuPendingBatch): FieldBatch[] {
        let pixels = pending.pixels;
        if (!pixels) {
            const gl2 = this.getGl2();
            if (!gl2 || !pending.pbo) {
                throw new Error('Slicer batch readback state is inconsistent.');
            }
            pixels = new Uint8Array(pending.byteLength);
            gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, pending.pbo);
            gl2.getBufferSubData(gl2.PIXEL_PACK_BUFFER, 0, pixels);
            gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
            this.disposePending(gl2, pending);
        }

        return decodeSliceBatchFields(
            pixels,
            pending.gridSize,
            pending.gridSize,
            pending.batchLayerCount,
            pending.distanceRange,
            pending.firstSampleY,
            pending.sliceYStep,
        );
    }

    // ------------------------------------------------------------------
    // Scene-field sampling along a toolpath (postprocess script inputs).
    // ------------------------------------------------------------------

    /** Samples the manifest's scene fields at every toolpath point and attaches the values. */
    public attachSceneFieldsToPoints(points: ToolpathPoint[], settings: VaseSlicerSettings): void {
        if (points.length === 0) {
            return;
        }

        const fieldDefinitions = getSceneFieldDefinitions();
        if (fieldDefinitions.length === 0) {
            return;
        }

        const sampledFields = this.sampleSceneFields(points, settings, fieldDefinitions);
        for (let index = 0; index < points.length; index++) {
            const pointFields = sampledFields[index];
            if (pointFields && Object.keys(pointFields).length > 0) {
                points[index].sceneFields = pointFields;
            }
        }
    }

    private sampleSceneFields(
        points: ToolpathPoint[],
        settings: VaseSlicerSettings,
        fieldDefinitions: SceneFieldDefinition[],
    ): Array<Record<string, SceneFieldValue>> {
        const perPointFields = Array.from({ length: points.length }, () => ({} as Record<string, SceneFieldValue>));

        for (const field of fieldDefinitions) {
            const componentCount = getSceneFieldComponentCount(field);
            const componentSamples = new Array<number[]>(componentCount);

            for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
                componentSamples[componentIndex] = this.sampleSceneFieldComponent(points, settings, field, componentIndex);
            }

            for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
                const components = componentSamples.map((samples) => samples[pointIndex] ?? 0);
                perPointFields[pointIndex][field.key] = buildSceneFieldValue(field, components);
            }
        }

        return perPointFields;
    }

    private sampleSceneFieldComponent(
        points: ToolpathPoint[],
        settings: VaseSlicerSettings,
        field: SceneFieldDefinition,
        componentIndex: number,
    ): number[] {
        const maxBatchSize = Math.max(1, this.getMaxTextureSize());
        const samples = new Array<number>(points.length).fill(field.minValue);

        for (let startIndex = 0; startIndex < points.length; startIndex += maxBatchSize) {
            const batchCount = Math.min(maxBatchSize, points.length - startIndex);
            const batchPoints = points.slice(startIndex, startIndex + batchCount);
            const batchSamples = this.renderSceneFieldComponentBatch(batchPoints, settings, field, componentIndex);

            for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
                samples[startIndex + batchIndex] = batchSamples[batchIndex] ?? field.minValue;
            }
        }

        return samples;
    }

    private renderSceneFieldComponentBatch(
        points: ToolpathPoint[],
        settings: VaseSlicerSettings,
        field: SceneFieldDefinition,
        componentIndex: number,
    ): number[] {
        const pointCount = points.length;
        if (pointCount === 0) {
            return [];
        }

        const width = Math.min(pointCount, Math.max(1, this.getMaxTextureSize()));
        const height = Math.max(1, Math.ceil(pointCount / width));

        this.ensureRenderTarget(width, height);

        if (!this.gl || !this.framebuffer || !this.renderTargetTexture) {
            throw new Error('Failed to initialize GPU scene field sampling resources.');
        }

        const gl = this.gl;
        const program = createProgram(
            gl,
            getSceneFieldSamplerVertexSource(),
            composeSceneFieldSamplerFragmentSource(field, componentIndex),
        );

        const pointBuffer = gl.createBuffer();
        if (!pointBuffer) {
            gl.deleteProgram(program);
            throw new Error('Failed to allocate scene field point buffer.');
        }

        try {
            const packedPoints = new Float32Array(pointCount * 4);
            for (let index = 0; index < pointCount; index++) {
                const point = worldPointToScenePoint(points[index], settings);
                const offset = index * 4;
                packedPoints[offset] = point.x;
                packedPoints[offset + 1] = point.y;
                packedPoints[offset + 2] = point.z;
                packedPoints[offset + 3] = index;
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, packedPoints, gl.STATIC_DRAW);

            gl.viewport(0, 0, width, height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.renderTargetTexture, 0);

            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('Scene field sampler framebuffer is incomplete.');
            }

            gl.useProgram(program);

            const pointPositionLocation = gl.getAttribLocation(program, 'aPointPosition');
            const pointIndexLocation = gl.getAttribLocation(program, 'aPointIndex');
            if (pointPositionLocation < 0 || pointIndexLocation < 0) {
                throw new Error(`Scene field sampler for '${field.label}' is missing required vertex attributes.`);
            }

            gl.enableVertexAttribArray(pointPositionLocation);
            gl.vertexAttribPointer(pointPositionLocation, 3, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(pointIndexLocation);
            gl.vertexAttribPointer(pointIndexLocation, 1, gl.FLOAT, false, 16, 12);

            setProgramUniform2f(gl, program, 'uTextureSize', width, height);
            setProgramUniform1f(gl, program, 'uFrameModulo', 0.0);
            setProgramUniform1f(gl, program, 'uFramePeriod', 120.0);
            setProgramUniform1f(gl, program, 'uMinY', settings.minY);
            setProgramUniform1f(gl, program, 'uMaxY', settings.maxY);
            setProgramUniform1f(gl, program, 'uScale', settings.modelScale);
            setProgramUniform1f(gl, program, 'uMaxRadius', settings.maxRadius);
            setProgramUniform1f(gl, program, 'uNozzleDiameter', settings.nozzleDiameter);
            setProgramUniform1f(gl, program, 'uFlowRate', settings.flowRate);
            setProgramUniform1f(gl, program, 'uLayerHeight', settings.layerHeight);
            setProgramUniform1f(gl, program, 'uLineWidth', settings.lineWidth);
            setProgramUniform1f(gl, program, 'uFirstLayerLineWidth', settings.firstLayerLineWidth);
            setProgramUniform1f(gl, program, 'uFieldMinValue', field.minValue);
            setProgramUniform1f(gl, program, 'uFieldMaxValue', field.maxValue);
            applySceneControlUniforms(gl, program, this.sceneControlDefinitions, this.sceneControlValues);

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.POINTS, 0, pointCount);

            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            gl.disableVertexAttribArray(pointPositionLocation);
            gl.disableVertexAttribArray(pointIndexLocation);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.useProgram(null);

            return decodeSceneFieldComponentBatch(pixels, pointCount, field.minValue, field.maxValue);
        } finally {
            gl.deleteBuffer(pointBuffer);
            gl.deleteProgram(program);
        }
    }

    // ------------------------------------------------------------------
    // GL resource management.
    // ------------------------------------------------------------------

    private ensureRenderTarget(width: number, height: number): void {
        const gl = this.getOrCreateGl();

        if (!this.framebuffer) {
            this.framebuffer = gl.createFramebuffer();
        }
        if (!this.renderTargetTexture) {
            this.renderTargetTexture = gl.createTexture();
        }

        if (!this.framebuffer || !this.renderTargetTexture) {
            throw new Error('Failed to allocate slicer framebuffer resources.');
        }

        if (this.renderTargetWidth === width && this.renderTargetHeight === height) {
            return;
        }

        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
        gl.bindTexture(gl.TEXTURE_2D, this.renderTargetTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.renderTargetWidth = width;
        this.renderTargetHeight = height;
    }

    private ensureSlicerProgram(): void {
        const gl = this.getOrCreateGl();

        const sources: SlicerProgramSources = this.programSourcesOverride ?? {
            vertex: getSlicerVertexSource(),
            fragment: composeSlicerFragmentSource(),
            signature: getSlicerProgramSignature(),
        };
        if (!this.program || this.programSignature !== sources.signature) {
            const nextProgram = createProgram(gl, sources.vertex, sources.fragment);
            if (this.program) {
                gl.deleteProgram(this.program);
            }
            this.program = nextProgram;
            this.programSignature = sources.signature;
            this.uniforms = new UniformBinder(gl, nextProgram);
            this.positionLocation = gl.getAttribLocation(this.program, 'aPosition');
        }
    }

    private ensureQuadBuffer(): void {
        const gl = this.getOrCreateGl();
        if (!this.positionBuffer) {
            this.positionBuffer = gl.createBuffer();
            if (!this.positionBuffer) {
                throw new Error('Failed to create slicer quad buffer.');
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([
                    -1, -1,
                    1, -1,
                    -1, 1,
                    1, 1,
                ]),
                gl.STATIC_DRAW
            );
        }
    }

    private getOrCreateGl(): WebGLRenderingContext {
        if (!this.gl) {
            const attributes: WebGLContextAttributes = {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                // Everything renders to an FBO; the default framebuffer is never read.
                preserveDrawingBuffer: false,
            };
            this.gl = (this.offscreenCanvas.getContext('webgl2', attributes)
                ?? this.offscreenCanvas.getContext('webgl', attributes)) as WebGLRenderingContext | null;
        }

        if (!this.gl) {
            throw new Error('WebGL is not available for slicer generation.');
        }

        if (this.maxTextureSize <= 0) {
            this.maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
        }

        return this.gl;
    }

    private getGl2(): WebGL2RenderingContext | null {
        return typeof WebGL2RenderingContext !== 'undefined' && this.gl instanceof WebGL2RenderingContext
            ? this.gl
            : null;
    }

    private getMaxTextureSize(): number {
        const gl = this.getOrCreateGl();
        if (this.maxTextureSize <= 0) {
            this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        }
        return this.maxTextureSize;
    }

}

function decodeSliceBatchFields(
    pixels: Uint8Array,
    width: number,
    gridSize: number,
    batchLayerCount: number,
    distanceRange: number,
    firstSampleY: number,
    sliceYStep: number,
): FieldBatch[] {
    const results: FieldBatch[] = [];
    const decodeScale = (2.0 * distanceRange) / 65535;
    for (let batchIndex = 0; batchIndex < batchLayerCount; batchIndex++) {
        const field = new Float32Array(gridSize * gridSize);
        let idx = batchIndex * gridSize * width * 4;
        for (let out = 0; out < field.length; out++, idx += 4) {
            const alpha = pixels[idx + 3];
            field[out] = alpha < 1
                ? distanceRange
                : (((pixels[idx] * 256) + pixels[idx + 1]) * decodeScale) - distanceRange;
        }
        results.push({
            sampleY: firstSampleY + (sliceYStep * batchIndex),
            field,
        });
    }

    return results;
}

function getSceneFieldComponentCount(field: SceneFieldDefinition): number {
    switch (field.type) {
        case 'vec2':
            return 2;
        case 'vec3':
            return 3;
        case 'vec4':
            return 4;
        case 'float':
        default:
            return 1;
    }
}

function buildSceneFieldValue(field: SceneFieldDefinition, components: number[]): SceneFieldValue {
    switch (field.type) {
        case 'vec2':
            return [components[0] ?? 0, components[1] ?? 0];
        case 'vec3':
            return [components[0] ?? 0, components[1] ?? 0, components[2] ?? 0];
        case 'vec4':
            return [components[0] ?? 0, components[1] ?? 0, components[2] ?? 0, components[3] ?? 0];
        case 'float':
        default:
            return components[0] ?? 0;
    }
}

function decodeSceneFieldComponentBatch(
    pixels: Uint8Array,
    pointCount: number,
    minValue: number,
    maxValue: number,
): number[] {
    const decoded = new Array<number>(pointCount).fill(minValue);
    const span = Math.max(1e-6, maxValue - minValue);

    for (let index = 0; index < pointCount; index++) {
        const pixelOffset = index * 4;
        const alpha = pixels[pixelOffset + 3] ?? 0;
        if (alpha < 1) {
            continue;
        }

        const packed = ((pixels[pixelOffset] ?? 0) * 256) + (pixels[pixelOffset + 1] ?? 0);
        const normalized = packed / 65535;
        decoded[index] = minValue + (normalized * span);
    }

    return decoded;
}

function setProgramUniform1f(
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    name: string,
    value: number,
): void {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) {
        gl.uniform1f(location, value);
    }
}

function setProgramUniform2f(
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    name: string,
    x: number,
    y: number,
): void {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) {
        gl.uniform2f(location, x, y);
    }
}

function applySceneControlUniforms(
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    definitions: SceneControlDefinition[],
    values: SceneControlValueMap,
): void {
    for (const control of definitions) {
        setProgramUniform1f(gl, program, control.uniform, values[control.key] ?? control.defaultValue);
    }
}

function worldPointToScenePoint(point: ToolpathPoint, settings: VaseSlicerSettings): { x: number; y: number; z: number } {
    return {
        x: (point.x - settings.centerX) / settings.modelScale,
        y: settings.minY + (point.y / settings.modelScale),
        z: (point.z - settings.centerZ) / settings.modelScale,
    };
}
