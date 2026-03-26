import {
    composeSlicerFragmentSource,
    getSlicerProgramSignature,
    getSlicerVertexSource,
} from './shader-pipeline';

export interface VaseSlicerSettings {
    printerModelId: string;
    printerModelName: string;
    filamentProfileId: string;
    filamentProfileName: string;
    minY: number;
    maxY: number;
    modelScale: number;
    bedWidthMm: number;
    bedDepthMm: number;
    maxPrintHeightMm: number;
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
    printSpeedMmPerSec: number;
    travelSpeedMmPerSec: number;
    nozzleTempC: number;
    bedTempC: number;
    fanPercent: number;
    flowRate: number;
    brimWidthMm: number;
    brimGapMm: number;
    startGcode: string;
    endGcode: string;
}

export interface ToolpathPoint {
    x: number;
    y: number;
    z: number;
    e: number;
    speedMmPerSec: number;
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
            printerModelId: 'generic-220',
            printerModelName: 'Generic 220 x 220',
            filamentProfileId: 'pla-generic',
            filamentProfileName: 'Generic PLA',
            minY: -1,
            maxY: 1,
            modelScale: 50,
            bedWidthMm: 220,
            bedDepthMm: 220,
            maxPrintHeightMm: 250,
            nozzleDiameter: 0.4,
            layerHeight: 0.2,
            pointsPerLayer: 640,
            maxRadius: 1.1,
            radialSteps: 640,
            hitEpsilon: 0.0014,
            centerX: 110,
            centerZ: 110,
            lineWidth: 0.42,
            filamentDiameter: 1.75,
            printSpeedMmPerSec: 35,
            travelSpeedMmPerSec: 120,
            nozzleTempC: 215,
            bedTempC: 55,
            fanPercent: 100,
            flowRate: 1.0,
            brimWidthMm: 5,
            brimGapMm: 0,
            startGcode: getDefaultStartGcode().join('\n'),
            endGcode: getDefaultEndGcode().join('\n'),
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
        merged.bedWidthMm = clamp(merged.bedWidthMm, 50, 1000);
        merged.bedDepthMm = clamp(merged.bedDepthMm, 50, 1000);
        merged.maxPrintHeightMm = clamp(merged.maxPrintHeightMm, 10, 1000);
        merged.nozzleDiameter = clamp(merged.nozzleDiameter, 0.2, 1.2);
        merged.layerHeight = clamp(merged.layerHeight, 0.05, 1.0);
        merged.pointsPerLayer = clampInt(merged.pointsPerLayer, 48, 2048);
        merged.maxRadius = clamp(merged.maxRadius, 0.1, 3.0);
        merged.radialSteps = clampInt(merged.radialSteps, 32, 512);
        merged.hitEpsilon = clamp(merged.hitEpsilon, 0.0001, 0.02);
        merged.lineWidth = clamp(merged.lineWidth, 0.2, 1.2);
        merged.filamentDiameter = clamp(merged.filamentDiameter, 1.0, 3.0);
        merged.printSpeedMmPerSec = clamp(merged.printSpeedMmPerSec, 5, 200);
        merged.travelSpeedMmPerSec = clamp(merged.travelSpeedMmPerSec, 10, 300);
        merged.flowRate = clamp(merged.flowRate, 0.01, 5.0);
        merged.brimWidthMm = clamp(merged.brimWidthMm, 0, 30);
        merged.brimGapMm = clamp(merged.brimGapMm, 0, 5);
        if (merged.maxY <= merged.minY) {
            merged.maxY = merged.minY + merged.layerHeight;
        }

        return merged;
    }

    private sampleRadiusFieldGpu(settings: VaseSlicerSettings): number[][] {
        const modelHeightMm = this.getModelHeightMm(settings);
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
        this.setUniform1f('uScale', settings.modelScale);
        this.setUniform1f('uLayerHeight', settings.layerHeight);
        this.setUniform1f('uMaxRadius', settings.maxRadius);
        this.setUniform1f('uNozzleDiameter', settings.nozzleDiameter);
        this.setUniform1f('uFlowRate', settings.flowRate);
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
        const modelHeightMm = this.getModelHeightMm(settings);

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
            const globalProgress = i / Math.max(1, totalPoints - 1);

            const angle = (k / perLayer) * Math.PI * 2.0;

            const r0 = radiusMap[layer][k] ?? 0;
            const r1 = radiusMap[nextLayer][k] ?? r0;
            const radiusSdf = r0 * (1.0 - frac) + r1 * frac;
            const radius = radiusSdf * settings.modelScale;

            const x = settings.centerX + Math.cos(angle) * radius;
            const z = settings.centerZ + Math.sin(angle) * radius;
            const y = globalProgress * modelHeightMm;

            if (i > 0) {
                const segment = Math.hypot(x - prevX, y - prevY, z - prevZ);
                eAcc += segment * extrusionPerMm;
            }

            points.push({
                x,
                y,
                z,
                e: eAcc,
                speedMmPerSec: settings.printSpeedMmPerSec,
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
        const emitOrcaMetadata = shouldEmitOrcaMetadata(settings);

        if (emitOrcaMetadata) {
            lines.push(...buildOrcaMetadataHeader(toolpath, settings));
        }

        lines.push('; Implicit vase-mode toolpath');
        lines.push('; Generated by Implicit');
        lines.push(`; Layers: ${toolpath.layerCount}`);
        lines.push(`; Points per layer: ${toolpath.pointsPerLayer}`);
        lines.push(`; Model scale (mm/SDF-unit): ${settings.modelScale.toFixed(2)}`);
        lines.push(`; Printer: ${settings.printerModelName} (${settings.printerModelId})`);
        lines.push(`; Filament: ${settings.filamentProfileName} (${settings.filamentProfileId})`);
        lines.push(`; Bed size (mm): ${settings.bedWidthMm.toFixed(1)} x ${settings.bedDepthMm.toFixed(1)}`);
        lines.push(`; Max print height (mm): ${settings.maxPrintHeightMm.toFixed(1)}`);
        lines.push(`; Nozzle diameter (mm): ${settings.nozzleDiameter.toFixed(2)}`);
        lines.push(`; Line width (mm): ${settings.lineWidth.toFixed(3)}`);
        lines.push(`; Layer height (mm): ${settings.layerHeight.toFixed(3)}`);
        lines.push(`; Print speed (mm/s): ${settings.printSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Travel speed (mm/s): ${settings.travelSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Brim width (mm): ${settings.brimWidthMm.toFixed(2)}`);
        lines.push(`; Brim gap (mm): ${settings.brimGapMm.toFixed(2)}`);
        lines.push(`; Extrusion/mm: ${calculateExtrusionPerMm(settings).toFixed(5)}`);
        lines.push(`; Estimated height (mm): ${toolpath.estimatedHeight.toFixed(3)}`);
        const startLines = parseGcodeLines(settings.startGcode, getDefaultStartGcode());
        for (const line of startLines) {
            lines.push(expandGcodeTemplate(line, settings));
        }
        // Force relative extrusion for exported toolpaths so each move carries only its local extrusion delta.
        lines.push('M83');
        appendBrimGcode(lines, toolpath, settings, Math.max(0.2, p0.y), calculateExtrusionPerMm(settings));
        lines.push('; FEATURE: Travel');
        lines.push(`G0 F${mmPerSecToFeedrate(settings.travelSpeedMmPerSec).toFixed(0)} X${p0.x.toFixed(3)} Y${p0.z.toFixed(3)} Z${Math.max(0.2, p0.y).toFixed(3)}`);
        lines.push('G1 F900 E1.2000');
        lines.push('G92 E0');

        let currentLayer = 0;
        lines.push(';LAYER_CHANGE');
        lines.push(';LAYER:0');
        lines.push(`;Z:${Math.max(0.0, p0.y).toFixed(3)}`);
        lines.push('; FEATURE: Outer wall');
        lines.push(';TYPE:Outer wall');

        for (let i = 1; i < toolpath.points.length; i++) {
            const point = toolpath.points[i];
            const prevPoint = toolpath.points[i - 1];
            const layer = Math.floor(i / toolpath.pointsPerLayer);
            if (layer !== currentLayer) {
                currentLayer = layer;
                lines.push(';LAYER_CHANGE');
                lines.push(`;LAYER:${layer}`);
                lines.push(`;Z:${Math.max(0.0, point.y).toFixed(3)}`);
                lines.push('; FEATURE: Outer wall');
                lines.push(';TYPE:Outer wall');
            }

            lines.push(
                `G1 F${mmPerSecToFeedrate(point.speedMmPerSec).toFixed(0)} X${point.x.toFixed(3)} Y${point.z.toFixed(3)} Z${Math.max(0.0, point.y).toFixed(3)} E${Math.max(0, point.e - prevPoint.e).toFixed(5)}`
            );
        }

        lines.push('G1 F1200 E-1.20000');
        lines.push('; FEATURE: Travel');
        lines.push('G0 F6000 Z' + Math.max(0.0, toolpath.points[toolpath.points.length - 1].y).toFixed(3));

        const endLines = parseGcodeLines(settings.endGcode, getDefaultEndGcode());
        for (const line of endLines) {
            lines.push(expandGcodeTemplate(line, settings));
        }

        if (emitOrcaMetadata) {
            lines.push('; EXECUTABLE_BLOCK_END');
        }

        return lines.join('\n');
    }

    private getModelHeightMm(settings: VaseSlicerSettings): number {
        const unclampedHeight = Math.max(0.01, (settings.maxY - settings.minY) * settings.modelScale);
        return Math.max(0.01, Math.min(unclampedHeight, settings.maxPrintHeightMm));
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
    return settings.flowRate * (beadArea / filamentArea);
}

function mmPerSecToFeedrate(mmPerSec: number): number {
    return mmPerSec * 60.0;
}

function appendBrimGcode(
    lines: string[],
    toolpath: VaseToolpath,
    settings: VaseSlicerSettings,
    firstLayerZ: number,
    extrusionPerMm: number
): void {
    const lineWidth = Math.max(0.01, settings.lineWidth);
    const brimLoops = Math.floor(settings.brimWidthMm / lineWidth);
    const brimGap = Math.max(0, settings.brimGapMm);
    if (brimLoops <= 0 || toolpath.pointsPerLayer < 3) {
        return;
    }

    const firstLayer = toolpath.points.slice(0, toolpath.pointsPerLayer);
    if (firstLayer.length < 3) {
        return;
    }

    const printFeed = mmPerSecToFeedrate(settings.printSpeedMmPerSec).toFixed(0);
    const travelFeed = mmPerSecToFeedrate(settings.travelSpeedMmPerSec).toFixed(0);

    lines.push('; FEATURE: Brim');
    let isFirstBrimLoop = true;
    for (let loopIndex = brimLoops; loopIndex >= 1; loopIndex--) {
        const offset = lineWidth + brimGap + (loopIndex - 1) * lineWidth;
        const loop = buildBrimLoop(firstLayer, settings.centerX, settings.centerZ, offset);
        if (loop.length < 3) {
            continue;
        }

        const start = loop[0];
        lines.push(';TYPE:Brim');
        lines.push(`G0 F${travelFeed} X${start.x.toFixed(3)} Y${start.y.toFixed(3)} Z${firstLayerZ.toFixed(3)}`);
        if (isFirstBrimLoop) {
            lines.push('G1 F900 E0.6000');
            isFirstBrimLoop = false;
        }

        let previous = start;
        for (let i = 1; i < loop.length; i++) {
            const point = loop[i];
            const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
            if (distance > 0) {
                lines.push(`G1 F${printFeed} X${point.x.toFixed(3)} Y${point.y.toFixed(3)} E${(distance * extrusionPerMm).toFixed(5)}`);
            }
            previous = point;
        }

        const closingDistance = Math.hypot(start.x - previous.x, start.y - previous.y);
        if (closingDistance > 0) {
            lines.push(`G1 F${printFeed} X${start.x.toFixed(3)} Y${start.y.toFixed(3)} E${(closingDistance * extrusionPerMm).toFixed(5)}`);
        }
    }

    lines.push('G1 F1200 E-0.60000');
    lines.push('G92 E0');
}

function buildBrimLoop(
    source: ToolpathPoint[],
    centerX: number,
    centerY: number,
    offsetMm: number
): Array<{ x: number; y: number }> {
    return source.map((point) => {
        const dx = point.x - centerX;
        const dy = point.z - centerY;
        const length = Math.hypot(dx, dy);
        if (length < 1e-6) {
            return { x: point.x, y: point.z };
        }

        const nx = dx / length;
        const ny = dy / length;
        return {
            x: point.x + nx * offsetMm,
            y: point.z + ny * offsetMm,
        };
    });
}

function shouldEmitOrcaMetadata(settings: VaseSlicerSettings): boolean {
    return settings.printerModelId === 'bambu-p1s';
}

function buildOrcaMetadataHeader(toolpath: VaseToolpath, settings: VaseSlicerSettings): string[] {
    const generatedAt = formatLocalTimestamp(new Date());
    const bedWidth = Math.round(settings.bedWidthMm);
    const bedDepth = Math.round(settings.bedDepthMm);
    const maxHeight = Math.round(settings.maxPrintHeightMm);
    const estimatedPrintSeconds = estimatePrintTimeSeconds(toolpath);
    const estimatedPrintText = formatDuration(estimatedPrintSeconds);
    const startGcodeCfg = escapeConfigValue(settings.startGcode);
    const endGcodeCfg = escapeConfigValue(settings.endGcode);
    const travelSpeedMmPerSec = Math.round(settings.travelSpeedMmPerSec);
    const printSpeedMmPerSec = Math.round(settings.printSpeedMmPerSec);
    const brimWidthMm = Math.max(0, settings.brimWidthMm);
    const brimGapMm = Math.max(0, settings.brimGapMm);
    const brimType = brimWidthMm > 0 ? 'auto_brim' : 'no_brim';

    return [
        '; HEADER_BLOCK_START',
        `; generated by OrcaSlicer 2.3.1 on ${generatedAt}`,
        `; model printing time: ${estimatedPrintText}; total estimated time: ${estimatedPrintText}`,
        `; estimated first layer printing time (normal mode) = ${Math.max(1, Math.round(estimatedPrintSeconds * 0.08))}s`,
        `; total layer number: ${toolpath.layerCount}`,
        '; model label id: 195',
        `; filament_density: 1.24`,
        `; filament_diameter: ${settings.filamentDiameter.toFixed(2)}`,
        `; max_z_height: ${toolpath.estimatedHeight.toFixed(2)}`,
        '; HEADER_BLOCK_END',
        '',
        '; CONFIG_BLOCK_START',
        '; accel_to_decel_enable = 1',
        '; accel_to_decel_factor = 50%',
        '; activate_air_filtration = 0',
        '; activate_chamber_temp_control = 0',
        '; adaptive_bed_mesh_margin = 0',
        '; adaptive_pressure_advance = 0',
        '; adaptive_pressure_advance_bridges = 0',
        '; adaptive_pressure_advance_overhangs = 0',
        '; additional_cooling_fan_speed = 70',
        '; align_infill_direction_to_model = 0',
        '; auxiliary_fan = 1',
        '; bbl_use_printhost = 0',
        '; bed_mesh_max = 99999,99999',
        '; bed_mesh_min = -99999,-99999',
        '; bed_mesh_probe_distance = 50,50',
        `; brim_type = ${brimType}`,
        `; brim_width = ${brimWidthMm.toFixed(2)}`,
        `; brim_object_gap = ${brimGapMm.toFixed(2)}`,
        '; close_fan_the_first_x_layers = 1',
        '; complete_print_exhaust_fan_speed = 70',
        '; curr_bed_type = High Temp Plate',
        '; default_acceleration = 10000',
        '; default_jerk = 0',
        '; detect_overhang_wall = 1',
        '; disable_m73 = 0',
        '; dont_slow_down_outer_wall = 0',
        '; draft_shield = disabled',
        '; during_print_exhaust_fan_speed = 70',
        '; elefant_foot_compensation = 0.15',
        '; emit_machine_limits_to_gcode = 1',
        '; enable_arc_fitting = 1',
        '; enable_overhang_speed = 1',
        '; fan_max_speed = 100',
        '; fan_min_speed = 100',
        '; fan_speedup_overhangs = 1',
        '; filament_colour = #26A69A',
        '; filament_cost = 20',
        '; travel_acceleration = 10000',
        '; first_layer_acceleration = 500',
        '; bridge_acceleration = 50%',
        '; gcode_comments = 0',
        '; gcode_label_objects = 1',
        '; gcode_flavor = marlin',
        '; has_scarf_joint_seam = 0',
        '; host_type = octoprint',
        '; hot_plate_temp = 55',
        '; hot_plate_temp_initial_layer = 55',
        '; infill_direction = 45',
        '; infill_wall_overlap = 15%',
        '; initial_layer_infill_speed = 105',
        '; initial_layer_line_width = 0.5',
        '; initial_layer_print_height = 0.2',
        '; initial_layer_travel_speed = 100%',
        '; inner_wall_acceleration = 10000',
        '; inner_wall_line_width = 0.45',
        '; inner_wall_speed = 300',
        '; layer_change_gcode = ',
        '; long_retractions_when_cut = 0',
        '; printer_vendor = Bambu Lab',
        '; printer_model = Bambu Lab P1S',
        '; printer_settings_id = Bambu Lab P1S 0.4 nozzle',
        '; print_settings_id = Implicit Vase Mode',
        `; filament_settings_id = ${settings.filamentProfileName}`,
        '; printer_structure = corexy',
        '; printer_technology = FFF',
        '; printer_variant = 0.4',
        '; machine_max_speed_x = 500,200',
        '; machine_max_speed_y = 500,200',
        '; machine_max_speed_z = 20,20',
        '; machine_max_speed_e = 30,30',
        '; machine_max_acceleration_x = 20000,20000',
        '; machine_max_acceleration_y = 20000,20000',
        '; machine_max_acceleration_z = 500,200',
        '; machine_max_acceleration_e = 5000,5000',
        '; machine_max_jerk_x = 9,9',
        '; machine_max_jerk_y = 9,9',
        '; machine_max_jerk_z = 3,3',
        '; machine_max_jerk_e = 2.5,2.5',
        '; machine_load_filament_time = 29',
        '; machine_max_acceleration_extruding = 20000,20000',
        '; machine_max_acceleration_retracting = 5000,5000',
        '; machine_max_acceleration_travel = 9000,9000',
        '; machine_pause_gcode = M400 U1',
        `; machine_start_gcode = ${startGcodeCfg}`,
        `; machine_end_gcode = ${endGcodeCfg}`,
        '; machine_tool_change_time = 0',
        '; machine_unload_filament_time = 28',
        '; max_layer_height = 0.28',
        '; min_layer_height = 0.08',
        '; min_bead_width = 85%',
        '; nozzle_height = 4.2',
        `; nozzle_diameter = ${settings.nozzleDiameter.toFixed(2)}`,
        `; filament_diameter = ${settings.filamentDiameter.toFixed(2)}`,
        '; filament_density = 1.24',
        '; filament_type = PLA',
        '; filament_vendor = Generic',
        '; filament_flow_ratio = 1',
        '; filament_max_volumetric_speed = 12',
        '; filament_start_gcode = ',
        '; filament_end_gcode = ',
        '; nozzle_temperature_range_high = 240',
        '; nozzle_temperature_range_low = 190',
        '; print_flow_ratio = 1',
        `; nozzle_temperature = ${settings.nozzleTempC.toFixed(0)}`,
        `; nozzle_temperature_initial_layer = ${settings.nozzleTempC.toFixed(0)}`,
        `; first_layer_temperature = ${settings.nozzleTempC.toFixed(0)}`,
        `; bed_temperature = ${settings.bedTempC.toFixed(0)}`,
        `; first_layer_bed_temperature = ${settings.bedTempC.toFixed(0)}`,
        `; layer_height = ${settings.layerHeight.toFixed(2)}`,
        `; line_width = ${settings.lineWidth.toFixed(2)}`,
        `; first_layer_bed_temperature = ${settings.bedTempC.toFixed(0)}`,
        '; overhang_fan_speed = 100',
        '; overhang_fan_threshold = 50%',
        '; outer_wall_acceleration = 5000',
        '; outer_wall_line_width = 0.42',
        '; outer_wall_speed = 200',
        '; pressure_advance = 0.02',
        '; print_compatible_printers = "Bambu Lab P1S 0.4 nozzle"',
        '; print_order = default',
        '; print_sequence = by layer',
        '; printable_height = 250',
        '; pressure_advance = 0.02',
        '; reduce_crossing_wall = 0',
        '; retract_length_toolchange = 2',
        '; retraction_length = 0.8',
        '; retraction_speed = 30',
        '; seam_position = aligned',
        '; silent_mode = 0',
        '; single_extruder_multi_material = 1',
        '; skirt_loops = 0',
        '; skirt_distance = 2',
        '; slicing_mode = regular',
        '; slow_down_for_layer_cooling = 1',
        '; slow_down_layer_time = 8',
        '; wall_loops = 1',
        '; top_shell_layers = 0',
        '; bottom_shell_layers = 3',
        '; sparse_infill_density = 0%',
        '; sparse_infill_pattern = crosshatch',
        '; sparse_infill_line_width = 0.45',
        '; sparse_infill_speed = 270',
        '; support_type = normal(auto)',
        '; enable_support = 0',
        '; support_threshold_angle = 30',
        '; support_top_z_distance = 0.2',
        '; support_bottom_z_distance = 0.2',
        '; support_object_xy_distance = 0.35',
        '; textured_cool_plate_temp = 40',
        '; textured_cool_plate_temp_initial_layer = 40',
        '; textured_plate_temp = 55',
        '; textured_plate_temp_initial_layer = 55',
        '; timelapse_type = 0',
        '; top_surface_pattern = monotonicline',
        '; travel_jerk = 12',
        '; travel_speed_z = 0',
        '; wall_direction = auto',
        '; wall_generator = classic',
        '; wall_sequence = inner wall/outer wall',
        '; wipe = 1',
        '; wipe_distance = 1',
        '; z_hop = 0.4',
        '; z_hop_types = Auto Lift',
        '; z_offset = 0',
        `; printable_area = 0x0,${bedWidth}x0,${bedWidth}x${bedDepth},0x${bedDepth}`,
        `; printable_height = ${maxHeight}`,
        '; spiral_mode = 1',
        '; spiral_mode_smooth = 0',
        '; spiral_mode_max_xy_smoothing = 200%',
        `; print_speed = ${printSpeedMmPerSec}`,
        `; outer_wall_speed = ${printSpeedMmPerSec}`,
        `; travel_speed = ${travelSpeedMmPerSec}`,
        `; initial_layer_speed = ${Math.max(10, Math.round(printSpeedMmPerSec * 0.5))}`,
        '; use_relative_e_distances = 1',
        '; wipe = 1',
        '; timelapse_type = 0',
        '; start_end_points = 30x-3,54x245',
        '; CONFIG_BLOCK_END',
        '',
        `; external perimeters extrusion width = ${settings.lineWidth.toFixed(2)}mm`,
        '; perimeters extrusion width = 0.45mm',
        '; infill extrusion width = 0.45mm',
        '; solid infill extrusion width = 0.42mm',
        '; top infill extrusion width = 0.42mm',
        '; first layer extrusion width = 0.50mm',
        '',
        '; EXECUTABLE_BLOCK_START',
    ];
}

function estimatePrintTimeSeconds(toolpath: VaseToolpath): number {
    if (toolpath.points.length < 2) {
        return 0;
    }

    let seconds = 0;
    for (let i = 1; i < toolpath.points.length; i++) {
        const a = toolpath.points[i - 1];
        const b = toolpath.points[i];
        const distance = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const speed = Math.max(1e-6, b.speedMmPerSec);
        seconds += distance / speed;
    }

    return Math.max(0, Math.round(seconds));
}

function formatDuration(totalSeconds: number): string {
    const clamped = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(clamped / 3600);
    const minutes = Math.floor((clamped % 3600) / 60);
    const seconds = clamped % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function escapeConfigValue(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\r\n/g, '\\n')
        .replace(/\n/g, '\\n');
}

function formatLocalTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} at ${hours}:${minutes}:${seconds}`;
}

function getDefaultStartGcode(): string[] {
    return [
        'G90',
        'M82',
        'G21',
        'M104 S{nozzleTempC}',
        'M140 S{bedTempC}',
        'M190 S{bedTempC}',
        'M109 S{nozzleTempC}',
        'G28',
        'G92 E0',
        'M106 S{fanPwm}',
    ];
}

function getDefaultEndGcode(): string[] {
    return [
        'M104 S0',
        'M140 S0',
        'M107',
        'M84',
    ];
}

function parseGcodeLines(template: string, fallback: string[]): string[] {
    const lines = template
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    return lines.length > 0 ? lines : fallback;
}

function expandGcodeTemplate(line: string, settings: VaseSlicerSettings): string {
    const tokenValues: Record<string, string> = {
        nozzleTempC: settings.nozzleTempC.toFixed(0),
        bedTempC: settings.bedTempC.toFixed(0),
        fanPwm: String(Math.round((settings.fanPercent / 100) * 255)),
        fanPercent: settings.fanPercent.toFixed(0),
        printFeedrate: mmPerSecToFeedrate(settings.printSpeedMmPerSec).toFixed(0),
        travelFeedrate: mmPerSecToFeedrate(settings.travelSpeedMmPerSec).toFixed(0),
        bedCenterX: settings.centerX.toFixed(3),
        bedCenterY: settings.centerZ.toFixed(3),
        bedWidthMm: settings.bedWidthMm.toFixed(1),
        bedDepthMm: settings.bedDepthMm.toFixed(1),
        maxPrintHeightMm: settings.maxPrintHeightMm.toFixed(1),
    };

    return line.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
        return tokenValues[token] ?? match;
    });
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