/**
 * WebGL renderer for the sliced toolpath.
 *
 * Geometry is uploaded once per slice and drawn as instanced ribbons, so the
 * frame cost is one draw call regardless of path length - no per-frame
 * projection in JS, and no decimation. The depth buffer does the rest: front
 * beads occlude the ones behind them, which is what makes the path read as a
 * printed object instead of a wireframe.
 *
 * The context is injected rather than created here. Today it belongs to a
 * transparent canvas stacked over the raymarch viewport; handing it the
 * raymarcher's own context instead is all that stands between this and true
 * occlusion against the implicit surface.
 */

import { createProgram } from '../gl/program';
import type { CameraState } from '../renderer/types';
import fragmentSource from '../../shaders/toolpath.frag.glsl?raw';
import vertexSource from '../../shaders/toolpath.vert.glsl?raw';
import { RAMP_TEXTURE_SIZE, buildRampTexels } from './color-ramps';
import { measureChannelDomain, type ChannelDomain } from './domain';
import { META_STRIDE_FLOATS, type ToolpathChannel, type ToolpathPreviewData } from './types';

const NEAR_PLANE = 0.01;
const FAR_PLANE = 400.0;
const FLOATS_TO_BYTES = 4;

/** Instancing, resolved from WebGL2 natives or the WebGL1 extension. */
interface InstancingApi {
    vertexAttribDivisor(index: number, divisor: number): void;
    drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void;
}

interface AttributeLocations {
    corner: number;
    start: number;
    end: number;
    meta: number;
    value: number;
}

export interface ToolpathRendererStyle {
    /** Multiplies the physical bead width. 1 draws beads at true size. */
    widthScale: number;
    /** Travel width relative to its own (already thin) bead. */
    travelWidthScale: number;
    /** Lower bound on drawn width in device pixels. */
    minPixelWidth: number;
    /** 0 disables shading entirely, leaving flat ramp colour. */
    shadeStrength: number;
    lightTheme: boolean;
}

const DEFAULT_STYLE: ToolpathRendererStyle = {
    widthScale: 1,
    travelWidthScale: 1,
    minPixelWidth: 1.5,
    shadeStrength: 1,
    lightTheme: false,
};

export class ToolpathRenderer {
    private readonly gl: WebGLRenderingContext;
    private readonly instancing: InstancingApi;
    private readonly program: WebGLProgram;
    private readonly attributes: AttributeLocations;
    private readonly uniforms: Record<string, WebGLUniformLocation | null>;
    private readonly cornerBuffer: WebGLBuffer;
    private readonly rampTexture: WebGLTexture;

    private positionBuffer: WebGLBuffer | null = null;
    private metaBuffer: WebGLBuffer | null = null;
    private valueBuffer: WebGLBuffer | null = null;

    private data: ToolpathPreviewData | null = null;
    private channel: ToolpathChannel | null = null;
    private style: ToolpathRendererStyle = { ...DEFAULT_STYLE };
    private showTravels = true;
    private layerRangeMin = 0;
    private layerRangeMax = Number.MAX_SAFE_INTEGER;
    private autoScaleDomain = true;
    private domain: ChannelDomain = { min: 0, max: 1 };

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
        this.instancing = resolveInstancing(gl);
        this.program = createProgram(gl, vertexSource, fragmentSource);

        this.attributes = {
            corner: gl.getAttribLocation(this.program, 'aCorner'),
            start: gl.getAttribLocation(this.program, 'aStart'),
            end: gl.getAttribLocation(this.program, 'aEnd'),
            meta: gl.getAttribLocation(this.program, 'aMeta'),
            value: gl.getAttribLocation(this.program, 'aValue'),
        };

        this.uniforms = {};
        for (const name of [
            'uCameraPos', 'uCameraRight', 'uCameraUp', 'uCameraForward',
            'uFocalLength', 'uAspect', 'uViewportHeight', 'uNear', 'uFar',
            'uValueMin', 'uValueMax', 'uWidthScale', 'uTravelWidthScale',
            'uMinPixelWidth', 'uShowTravels',
            'uRamp', 'uLightDir', 'uTravelColor', 'uShadeStrength',
        ]) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }

        const cornerBuffer = gl.createBuffer();
        const rampTexture = gl.createTexture();
        if (!cornerBuffer || !rampTexture) {
            throw new Error('Failed to allocate toolpath renderer resources.');
        }

        this.cornerBuffer = cornerBuffer;
        this.rampTexture = rampTexture;

        // Triangle strip across the ribbon: (along, side).
        gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]),
            gl.STATIC_DRAW,
        );

        gl.bindTexture(gl.TEXTURE_2D, rampTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /** Uploads a new slice. Passing null releases the GPU buffers. */
    public setData(data: ToolpathPreviewData | null): void {
        this.data = data;
        this.releaseDataBuffers();
        // Layer indices from the previous slice mean nothing against a new
        // layer count, so a new upload always starts showing everything.
        this.layerRangeMin = 0;
        this.layerRangeMax = Number.MAX_SAFE_INTEGER;

        if (!data || data.segmentCount === 0) {
            this.channel = null;
            return;
        }

        const gl = this.gl;
        this.positionBuffer = uploadBuffer(gl, data.positions);
        this.metaBuffer = uploadBuffer(gl, data.meta);
        this.valueBuffer = gl.createBuffer();

        const wanted = this.channel?.key;
        const next = data.channels.find((candidate) => candidate.key === wanted) ?? data.channels[0] ?? null;
        this.channel = null;
        if (next) {
            this.setChannel(next.key);
        }
    }

    /** Selects the colour channel by key; unknown keys are ignored. */
    public setChannel(key: string): boolean {
        const channel = this.data?.channels.find((candidate) => candidate.key === key);
        if (!channel || !this.valueBuffer) {
            return false;
        }
        if (this.channel?.key === key) {
            return true;
        }

        this.channel = channel;

        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.valueBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, channel.values, gl.STATIC_DRAW);

        gl.bindTexture(gl.TEXTURE_2D, this.rampTexture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, RAMP_TEXTURE_SIZE, 1, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, buildRampTexels(channel),
        );
        this.refreshDomain();
        return true;
    }

    private refreshDomain(): void {
        const data = this.data;
        const channel = this.channel;
        if (!data || !channel) {
            this.domain = { min: 0, max: 1 };
            return;
        }

        if (!this.autoScaleDomain) {
            this.domain = { min: channel.min, max: channel.max };
            return;
        }

        const range = this.resolveDrawRange(data);
        this.domain = measureChannelDomain(
            { kind: channel.kind, neutral: channel.neutral, categoryCount: channel.categories?.length },
            channel.values,
            data.excludedFromDomain,
            range.first,
            range.count,
        );
    }

    public getChannel(): ToolpathChannel | null {
        return this.channel;
    }

    public setLayerRange(minLayer: number, maxLayer: number): void {
        this.layerRangeMin = minLayer;
        this.layerRangeMax = maxLayer;
        this.refreshDomain();
    }

    /**
     * When on, the ramp spans only the layers currently drawn. Off pins it to
     * the whole toolpath, so colours stay comparable while scrubbing.
     */
    public setAutoScaleDomain(autoScale: boolean): void {
        this.autoScaleDomain = autoScale;
        this.refreshDomain();
    }

    /** The domain actually in use, which the legend must label. */
    public getDomain(): ChannelDomain {
        return this.domain;
    }

    public setShowTravels(showTravels: boolean): void {
        this.showTravels = showTravels;
    }

    public setStyle(style: Partial<ToolpathRendererStyle>): void {
        this.style = { ...this.style, ...style };
    }

    public hasData(): boolean {
        return (this.data?.segmentCount ?? 0) > 0;
    }

    public render(camera: CameraState): void {
        const gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const data = this.data;
        if (!data || data.segmentCount === 0 || !this.channel) {
            return;
        }
        if (!this.positionBuffer || !this.metaBuffer || !this.valueBuffer) {
            return;
        }

        const range = this.resolveDrawRange(data);
        if (range.count <= 0) {
            return;
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.useProgram(this.program);

        this.bindAttributes(range.first);
        this.bindUniforms(camera);

        this.instancing.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, range.count);
    }

    public dispose(): void {
        const gl = this.gl;
        this.releaseDataBuffers();
        gl.deleteBuffer(this.cornerBuffer);
        gl.deleteTexture(this.rampTexture);
        gl.deleteProgram(this.program);
    }

    /**
     * Segments are layer-ordered, so a layer range is a contiguous slice of
     * the instance buffers - clipping is an attribute offset, not a per-frame
     * rebuild or a shader discard.
     */
    private resolveDrawRange(data: ToolpathPreviewData): { first: number; count: number } {
        const starts = data.layerSegmentStarts;
        const lastLayer = Math.max(0, data.layerCount - 1);
        const low = Math.min(Math.max(0, this.layerRangeMin), lastLayer);
        const high = Math.min(Math.max(low, this.layerRangeMax), lastLayer);
        const first = starts[low] ?? 0;
        const end = starts[high + 1] ?? data.segmentCount;
        return { first, count: Math.max(0, end - first) };
    }

    private bindAttributes(first: number): void {
        const gl = this.gl;
        const { corner, start, end, meta, value } = this.attributes;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
        gl.enableVertexAttribArray(corner);
        gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
        this.instancing.vertexAttribDivisor(corner, 0);

        // aStart and aEnd read the same point buffer one point apart, so a
        // segment costs no duplicated geometry.
        const pointStride = 3 * FLOATS_TO_BYTES;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(start);
        gl.vertexAttribPointer(start, 3, gl.FLOAT, false, pointStride, first * pointStride);
        this.instancing.vertexAttribDivisor(start, 1);
        gl.enableVertexAttribArray(end);
        gl.vertexAttribPointer(end, 3, gl.FLOAT, false, pointStride, (first + 1) * pointStride);
        this.instancing.vertexAttribDivisor(end, 1);

        const metaStride = META_STRIDE_FLOATS * FLOATS_TO_BYTES;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.metaBuffer);
        gl.enableVertexAttribArray(meta);
        gl.vertexAttribPointer(meta, 4, gl.FLOAT, false, metaStride, first * metaStride);
        this.instancing.vertexAttribDivisor(meta, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.valueBuffer);
        gl.enableVertexAttribArray(value);
        gl.vertexAttribPointer(value, 1, gl.FLOAT, false, FLOATS_TO_BYTES, first * FLOATS_TO_BYTES);
        this.instancing.vertexAttribDivisor(value, 1);
    }

    private bindUniforms(camera: CameraState): void {
        const gl = this.gl;
        const aspect = Math.max(1e-6, camera.viewportWidth / Math.max(1, camera.viewportHeight));

        gl.uniform3f(this.uniforms.uCameraPos, camera.position.x, camera.position.y, camera.position.z);
        gl.uniform3f(this.uniforms.uCameraRight, camera.right.x, camera.right.y, camera.right.z);
        gl.uniform3f(this.uniforms.uCameraUp, camera.up.x, camera.up.y, camera.up.z);
        gl.uniform3f(this.uniforms.uCameraForward, camera.forward.x, camera.forward.y, camera.forward.z);
        gl.uniform1f(this.uniforms.uFocalLength, camera.focalLength);
        gl.uniform1f(this.uniforms.uAspect, aspect);
        gl.uniform1f(this.uniforms.uViewportHeight, Math.max(1, camera.viewportHeight));
        gl.uniform1f(this.uniforms.uNear, NEAR_PLANE);
        gl.uniform1f(this.uniforms.uFar, FAR_PLANE);
        gl.uniform1f(this.uniforms.uValueMin, this.domain.min);
        gl.uniform1f(this.uniforms.uValueMax, this.domain.max);
        gl.uniform1f(this.uniforms.uWidthScale, this.style.widthScale);
        gl.uniform1f(this.uniforms.uTravelWidthScale, this.style.travelWidthScale);
        gl.uniform1f(this.uniforms.uMinPixelWidth, this.style.minPixelWidth);
        gl.uniform1f(this.uniforms.uShowTravels, this.showTravels ? 1 : 0);
        gl.uniform1f(this.uniforms.uShadeStrength, this.style.shadeStrength);

        // Key light rides with the camera so the toolpath is never lit from
        // behind while orbiting.
        const light = normalize3(
            camera.right.x * 0.4 + camera.up.x * 0.75 - camera.forward.x,
            camera.right.y * 0.4 + camera.up.y * 0.75 - camera.forward.y,
            camera.right.z * 0.4 + camera.up.z * 0.75 - camera.forward.z,
        );
        gl.uniform3f(this.uniforms.uLightDir, light[0], light[1], light[2]);

        const travelColor = this.style.lightTheme ? [0.55, 0.58, 0.64] : [0.42, 0.45, 0.52];
        gl.uniform3f(this.uniforms.uTravelColor, travelColor[0], travelColor[1], travelColor[2]);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.rampTexture);
        gl.uniform1i(this.uniforms.uRamp, 0);
    }

    private releaseDataBuffers(): void {
        const gl = this.gl;
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
        if (this.metaBuffer) gl.deleteBuffer(this.metaBuffer);
        if (this.valueBuffer) gl.deleteBuffer(this.valueBuffer);
        this.positionBuffer = null;
        this.metaBuffer = null;
        this.valueBuffer = null;
    }
}

function uploadBuffer(gl: WebGLRenderingContext, data: Float32Array): WebGLBuffer {
    const buffer = gl.createBuffer();
    if (!buffer) {
        throw new Error('Failed to allocate a toolpath vertex buffer.');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
}

function resolveInstancing(gl: WebGLRenderingContext): InstancingApi {
    const gl2 = gl as WebGLRenderingContext & Partial<WebGL2RenderingContext>;
    if (typeof gl2.vertexAttribDivisor === 'function' && typeof gl2.drawArraysInstanced === 'function') {
        return {
            vertexAttribDivisor: (index, divisor) => gl2.vertexAttribDivisor!(index, divisor),
            drawArraysInstanced: (mode, first, count, instanceCount) =>
                gl2.drawArraysInstanced!(mode, first, count, instanceCount),
        };
    }

    const extension = gl.getExtension('ANGLE_instanced_arrays');
    if (!extension) {
        throw new Error('Toolpath preview requires instanced drawing (WebGL2 or ANGLE_instanced_arrays).');
    }

    return {
        vertexAttribDivisor: (index, divisor) => extension.vertexAttribDivisorANGLE(index, divisor),
        drawArraysInstanced: (mode, first, count, instanceCount) =>
            extension.drawArraysInstancedANGLE(mode, first, count, instanceCount),
    };
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
    const length = Math.hypot(x, y, z);
    return length > 1e-9 ? [x / length, y / length, z / length] : [0, 1, 0];
}
