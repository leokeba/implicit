import {
    composeSlicerFragmentSource,
    getSlicerProgramSignature,
    getSlicerVertexSource,
} from './shader-pipeline';

export interface VaseSlicerSettings {
    minY: number;
    maxY: number;
    modelScale: number;
    nozzleDiameter: number;
    layerHeight: number;
    pointsPerLayer: number;
    maxRadius: number;
    radialSteps: number;
    hitEpsilon: number;
    centerX: number;
    centerZ: number;
    lineWidth: number;
    filamentDiameter: number;
    printSpeedMmPerMin: number;
    travelSpeedMmPerMin: number;
    nozzleTempC: number;
    bedTempC: number;
    fanPercent: number;
    extrusionMultiplier: number;
}

export interface ToolpathPoint {
    x: number;
    y: number;
    z: number;
    e: number;
    f: number;
}

export interface VaseToolpath {
    points: ToolpathPoint[];
    layerCount: number;
    pointsPerLayer: number;
    estimatedHeight: number;
}

export interface VaseSliceResult {
    settings: VaseSlicerSettings;
    toolpath: VaseToolpath;
    gcode: string;
}

export class Slicer {
    private gl: WebGLRenderingContext | null;
    private framebuffer: WebGLFramebuffer | null;
    private renderTargetTexture: WebGLTexture | null;
    private program: WebGLProgram | null;
    private positionBuffer: WebGLBuffer | null;
    private offscreenCanvas: HTMLCanvasElement;
    private programSignature: string;

    constructor() {
        this.gl = null;
        this.framebuffer = null;
        this.renderTargetTexture = null;
        this.program = null;
        this.positionBuffer = null;
        this.offscreenCanvas = document.createElement('canvas');
        this.programSignature = '';
    }

    public getDefaultVaseSettings(): VaseSlicerSettings {
        return {
            minY: -1.45,
            maxY: 1.45,
            modelScale: 45,
            nozzleDiameter: 0.4,
            layerHeight: 0.22,
            pointsPerLayer: 640,
            maxRadius: 0.75,
            radialSteps: 192,
            hitEpsilon: 0.0014,
            centerX: 110,
            centerZ: 110,
            lineWidth: 0.44,
            filamentDiameter: 1.75,
            printSpeedMmPerMin: 2100,
            travelSpeedMmPerMin: 7200,
            nozzleTempC: 215,
            bedTempC: 55,
            fanPercent: 100,
            extrusionMultiplier: 100.0,
        };
    }

    public generateVaseGcode(next: Partial<VaseSlicerSettings>): VaseSliceResult {
        const settings = this.getMergedSettings(next);
        const radiusMap = this.sampleRadiusFieldGpu(settings);
        const toolpath = this.buildSpiralToolpath(radiusMap, settings);
        const gcode = this.buildGcode(toolpath, settings);

        return {
            settings,
            toolpath,
            gcode,
        };
    }

    private getMergedSettings(next: Partial<VaseSlicerSettings>): VaseSlicerSettings {
        const base = this.getDefaultVaseSettings();
        const merged = { ...base, ...next };
        merged.modelScale = clamp(merged.modelScale, 1, 400);
        merged.nozzleDiameter = clamp(merged.nozzleDiameter, 0.2, 1.2);
        merged.layerHeight = clamp(merged.layerHeight, 0.05, 1.0);
        merged.pointsPerLayer = clampInt(merged.pointsPerLayer, 48, 2048);
        merged.maxRadius = clamp(merged.maxRadius, 0.1, 3.0);
        merged.radialSteps = clampInt(merged.radialSteps, 32, 512);
        merged.hitEpsilon = clamp(merged.hitEpsilon, 0.0001, 0.02);
        merged.lineWidth = clamp(merged.lineWidth, 0.2, 1.2);
        merged.filamentDiameter = clamp(merged.filamentDiameter, 1.0, 3.0);
        merged.printSpeedMmPerMin = clamp(merged.printSpeedMmPerMin, 300, 8000);
        merged.travelSpeedMmPerMin = clamp(merged.travelSpeedMmPerMin, 1000, 15000);
        merged.extrusionMultiplier = clamp(merged.extrusionMultiplier, 1.0, 500.0);
        if (merged.maxY <= merged.minY) {
            merged.maxY = merged.minY + merged.layerHeight;
        }

        return merged;
    }

    private sampleRadiusFieldGpu(settings: VaseSlicerSettings): number[][] {
        const modelHeightMm = Math.max(0.01, (settings.maxY - settings.minY) * settings.modelScale);
        const layerCount = Math.max(2, Math.floor(modelHeightMm / settings.layerHeight) + 1);
        const width = settings.pointsPerLayer;
        const height = layerCount;

        this.ensureGpuResources(width, height);

        if (!this.gl || !this.program || !this.positionBuffer || !this.framebuffer || !this.renderTargetTexture) {
            throw new Error('Failed to initialize GPU slicing resources.');
        }

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

        const positionLocation = gl.getAttribLocation(this.program, 'aPosition');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        this.setUniform2f('uTextureSize', width, height);
        this.setUniform1f('uMinY', settings.minY);
        this.setUniform1f('uMaxY', settings.maxY);
        this.setUniform1f('uMaxRadius', settings.maxRadius);
        this.setUniform1i('uRadialSteps', settings.radialSteps);
        this.setUniform1f('uHitEpsilon', settings.hitEpsilon);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        const radiusMap: number[][] = [];
        for (let y = 0; y < height; y++) {
            const row: number[] = [];
            for (let x = 0; x < width; x++) {
                const idx = ((y * width) + x) * 4;
                const alpha = pixels[idx + 3];
                if (alpha < 1) {
                    row.push(0);
                    continue;
                }

                const high = pixels[idx];
                const low = pixels[idx + 1];
                const packed = high * 256 + low;
                const normalized = packed / 65535;
                row.push(normalized * settings.maxRadius);
            }
            radiusMap.push(row);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return radiusMap;
    }

    private buildSpiralToolpath(radiusMap: number[][], settings: VaseSlicerSettings): VaseToolpath {
        const layers = radiusMap.length;
        const perLayer = settings.pointsPerLayer;
        const totalPoints = layers * perLayer;
        const modelHeightMm = Math.max(0.01, (settings.maxY - settings.minY) * settings.modelScale);

        const extrusionPerMm = calculateExtrusionPerMm(settings);

        const points: ToolpathPoint[] = [];
        let eAcc = 0;
        let prevX = 0;
        let prevY = 0;
        let prevZ = 0;

        for (let i = 0; i < totalPoints; i++) {
            const layer = Math.floor(i / perLayer);
            const nextLayer = Math.min(layer + 1, layers - 1);
            const k = i % perLayer;
            const frac = k / perLayer;

            const angle = (k / perLayer) * Math.PI * 2.0;

            const r0 = radiusMap[layer][k] ?? 0;
            const r1 = radiusMap[nextLayer][k] ?? r0;
            const radiusSdf = r0 * (1.0 - frac) + r1 * frac;
            const radius = radiusSdf * settings.modelScale;

            const x = settings.centerX + Math.cos(angle) * radius;
            const z = settings.centerZ + Math.sin(angle) * radius;
            const y = ((layer + frac) / Math.max(1, layers - 1)) * modelHeightMm;

            if (i > 0) {
                const segment = Math.hypot(x - prevX, y - prevY, z - prevZ);
                eAcc += segment * extrusionPerMm;
            }

            points.push({
                x,
                y,
                z,
                e: eAcc,
                f: settings.printSpeedMmPerMin,
            });

            prevX = x;
            prevY = y;
            prevZ = z;
        }

        return {
            points,
            layerCount: layers,
            pointsPerLayer: perLayer,
            estimatedHeight: modelHeightMm,
        };
    }

    private buildGcode(toolpath: VaseToolpath, settings: VaseSlicerSettings): string {
        if (toolpath.points.length < 2) {
            throw new Error('Vase slicing produced no valid path.');
        }

        const lines: string[] = [];
        const p0 = toolpath.points[0];

        lines.push('; Implicit vase-mode toolpath');
        lines.push('; Generated by Implicit');
        lines.push(`; Layers: ${toolpath.layerCount}`);
        lines.push(`; Points per layer: ${toolpath.pointsPerLayer}`);
        lines.push(`; Model scale (mm/SDF-unit): ${settings.modelScale.toFixed(2)}`);
        lines.push(`; Nozzle diameter (mm): ${settings.nozzleDiameter.toFixed(2)}`);
        lines.push(`; Line width (mm): ${settings.lineWidth.toFixed(3)}`);
        lines.push(`; Layer height (mm): ${settings.layerHeight.toFixed(3)}`);
        lines.push(`; Extrusion/mm: ${calculateExtrusionPerMm(settings).toFixed(5)}`);
        lines.push(`; Estimated height (mm): ${toolpath.estimatedHeight.toFixed(3)}`);
        lines.push('G90');
        lines.push('M82');
        lines.push('G21');
        lines.push(`M104 S${settings.nozzleTempC.toFixed(0)}`);
        lines.push(`M140 S${settings.bedTempC.toFixed(0)}`);
        lines.push('M190 S' + settings.bedTempC.toFixed(0));
        lines.push('M109 S' + settings.nozzleTempC.toFixed(0));
        lines.push('G28');
        lines.push('G92 E0');
        lines.push(`M106 S${Math.round((settings.fanPercent / 100) * 255)}`);
        lines.push(`G0 F${settings.travelSpeedMmPerMin.toFixed(0)} X${p0.x.toFixed(3)} Y${p0.z.toFixed(3)} Z${Math.max(0.2, p0.y).toFixed(3)}`);
        lines.push('G1 F900 E1.2000');
        lines.push('G92 E0');

        for (let i = 1; i < toolpath.points.length; i++) {
            const point = toolpath.points[i];
            lines.push(
                `G1 F${point.f.toFixed(0)} X${point.x.toFixed(3)} Y${point.z.toFixed(3)} Z${Math.max(0.0, point.y).toFixed(3)} E${point.e.toFixed(5)}`
            );
        }

        lines.push('G1 F1200 E' + Math.max(0, toolpath.points[toolpath.points.length - 1].e - 1.2).toFixed(5));
        lines.push('G0 F6000 Z' + (toolpath.estimatedHeight + 8.0).toFixed(3));
        lines.push('M104 S0');
        lines.push('M140 S0');
        lines.push('M107');
        lines.push('M84');

        return lines.join('\n');
    }

    private ensureGpuResources(width: number, height: number): void {
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;

        if (!this.gl) {
            this.gl = this.offscreenCanvas.getContext('webgl', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: true,
            });
        }

        if (!this.gl) {
            throw new Error('WebGL is not available for slicer generation.');
        }

        const gl = this.gl;

        const nextSignature = getSlicerProgramSignature();
        if (!this.program || this.programSignature !== nextSignature) {
            const nextProgram = this.createProgram(gl, getSlicerVertexSource(), composeSlicerFragmentSource());
            if (this.program) {
                gl.deleteProgram(this.program);
            }
            this.program = nextProgram;
            this.programSignature = nextSignature;
        }

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

        if (!this.framebuffer) {
            this.framebuffer = gl.createFramebuffer();
        }
        if (!this.renderTargetTexture) {
            this.renderTargetTexture = gl.createTexture();
        }

        if (!this.framebuffer || !this.renderTargetTexture) {
            throw new Error('Failed to allocate slicer framebuffer resources.');
        }

        gl.bindTexture(gl.TEXTURE_2D, this.renderTargetTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    private createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
        const vs = this.createShader(gl, gl.VERTEX_SHADER, vertexSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

        const program = gl.createProgram();
        if (!program) {
            throw new Error('Failed to create slicer shader program.');
        }

        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program) || 'Unknown slicer program link error';
            gl.deleteProgram(program);
            throw new Error(info);
        }

        return program;
    }

    private createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
        const shader = gl.createShader(type);
        if (!shader) {
            throw new Error('Failed to create slicer shader.');
        }

        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader) || 'Unknown slicer shader compile error';
            gl.deleteShader(shader);
            throw new Error(info);
        }

        return shader;
    }

    private setUniform1f(name: string, value: number): void {
        if (!this.gl || !this.program) {
            return;
        }
        const loc = this.gl.getUniformLocation(this.program, name);
        if (loc !== null) {
            this.gl.uniform1f(loc, value);
        }
    }

    private setUniform1i(name: string, value: number): void {
        if (!this.gl || !this.program) {
            return;
        }
        const loc = this.gl.getUniformLocation(this.program, name);
        if (loc !== null) {
            this.gl.uniform1i(loc, value);
        }
    }

    private setUniform2f(name: string, x: number, y: number): void {
        if (!this.gl || !this.program) {
            return;
        }
        const loc = this.gl.getUniformLocation(this.program, name);
        if (loc !== null) {
            this.gl.uniform2f(loc, x, y);
        }
    }
}

function calculateExtrusionPerMm(settings: VaseSlicerSettings): number {
    const lineWidth = Math.max(settings.lineWidth, settings.nozzleDiameter);
    const layerHeight = Math.min(settings.layerHeight, lineWidth);

    // Stadium profile gives a better bead area estimate than a pure rectangle.
    const beadArea = lineWidth > layerHeight
        ? (layerHeight * (lineWidth - layerHeight)) + (Math.PI * Math.pow(layerHeight * 0.5, 2))
        : (Math.PI * lineWidth * layerHeight * 0.25);

    const filamentArea = Math.PI * Math.pow(settings.filamentDiameter * 0.5, 2);
    return settings.extrusionMultiplier * (beadArea / filamentArea);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, Math.round(value)));
}