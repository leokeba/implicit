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
    firstLayerLineWidth: number;
    filamentDiameter: number;
    firstLayerPrintSpeedMmPerSec: number;
    printSpeedMmPerSec: number;
    travelSpeedMmPerSec: number;
    nozzleTempC: number;
    bedTempC: number;
    fanPercent: number;
    flowRate: number;
    moveMergeMinMoveMm: number;
    moveMergeMaxDeviationMm: number;
    moveMergeMaxTurnDeg: number;
    moveMergeKeepStride: number;
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
    layer: number;
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

export interface VaseSlicePhaseTimings {
    contourSamplingMs: number;
    toolpathBuildMs: number;
    gcodeBuildMs: number;
    totalMs: number;
}

export interface VaseSliceBenchmarkRun {
    runIndex: number;
    isWarmup: boolean;
    timings: VaseSlicePhaseTimings;
    pointCount: number;
    layerCount: number;
    gcodeBytes: number;
}

export interface VaseSliceBenchmarkResult {
    settings: VaseSlicerSettings;
    warmupRuns: number;
    measuredRuns: number;
    lastResult: VaseSliceResult;
    runs: VaseSliceBenchmarkRun[];
}

interface VaseSliceExecution extends VaseSliceResult {
    timings: VaseSlicePhaseTimings;
}

interface SliceBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

interface SlicePoint {
    x: number;
    z: number;
}

interface SliceContourLayer {
    sampleY: number;
    contour: SlicePoint[];
}

interface SliceContourCandidate {
    contour: SlicePoint[];
    area: number;
    perimeter: number;
}

interface SliceSegmentVertex {
    key: string;
    point: SlicePoint;
}

type SliceSegment = [SliceSegmentVertex, SliceSegmentVertex];

const SLICE_BATCH_SIZE = 16;

interface SliceGpuBatchResult {
    sampleY: number;
    field: number[][];
}

export class Slicer {
    private gl: WebGLRenderingContext | null;
    private framebuffer: WebGLFramebuffer | null;
    private renderTargetTexture: WebGLTexture | null;
    private program: WebGLProgram | null;
    private positionBuffer: WebGLBuffer | null;
    private offscreenCanvas: HTMLCanvasElement;
    private programSignature: string;
    private uniformLocations: Map<string, WebGLUniformLocation | null>;
    private positionLocation: number;
    private maxTextureSize: number;

    constructor() {
        this.gl = null;
        this.framebuffer = null;
        this.renderTargetTexture = null;
        this.program = null;
        this.positionBuffer = null;
        this.offscreenCanvas = document.createElement('canvas');
        this.programSignature = '';
        this.uniformLocations = new Map();
        this.positionLocation = -1;
        this.maxTextureSize = 0;
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
            radialSteps: 256,
            hitEpsilon: 0.0014,
            centerX: 110,
            centerZ: 110,
            lineWidth: 0.42,
            firstLayerLineWidth: 0.5,
            filamentDiameter: 1.75,
            firstLayerPrintSpeedMmPerSec: 20,
            printSpeedMmPerSec: 35,
            travelSpeedMmPerSec: 120,
            nozzleTempC: 215,
            bedTempC: 55,
            fanPercent: 100,
            flowRate: 1.0,
            moveMergeMinMoveMm: 0.10,
            moveMergeMaxDeviationMm: 0.025,
            moveMergeMaxTurnDeg: 4.0,
            moveMergeKeepStride: 12,
            brimWidthMm: 5,
            brimGapMm: 0.1,
            startGcode: getDefaultStartGcode().join('\n'),
            endGcode: getDefaultEndGcode().join('\n'),
        };
    }

    public generateVaseGcode(next: Partial<VaseSlicerSettings>): VaseSliceResult {
        const settings = this.getMergedSettings(next);
        const result = this.executeVaseSlice(settings);
        return {
            settings: result.settings,
            toolpath: result.toolpath,
            gcode: result.gcode,
        };
    }

    public benchmarkVaseGcode(next: Partial<VaseSlicerSettings>, iterations: number, warmupRuns = 1): VaseSliceBenchmarkResult {
        const settings = this.getMergedSettings(next);
        const measuredRunCount = clampInt(iterations, 1, 20);
        const warmupRunCount = clampInt(warmupRuns, 0, 10);
        const totalRunCount = measuredRunCount + warmupRunCount;
        const runs: VaseSliceBenchmarkRun[] = [];
        let lastResult: VaseSliceResult | null = null;

        for (let runIndex = 0; runIndex < totalRunCount; runIndex++) {
            const result = this.executeVaseSlice(settings);
            lastResult = {
                settings: result.settings,
                toolpath: result.toolpath,
                gcode: result.gcode,
            };
            runs.push({
                runIndex,
                isWarmup: runIndex < warmupRunCount,
                timings: result.timings,
                pointCount: result.toolpath.points.length,
                layerCount: result.toolpath.layerCount,
                gcodeBytes: result.gcode.length,
            });
        }

        if (!lastResult) {
            throw new Error('Benchmark did not produce a slicer result.');
        }

        return {
            settings,
            warmupRuns: warmupRunCount,
            measuredRuns: measuredRunCount,
            lastResult,
            runs,
        };
    }

    private executeVaseSlice(settings: VaseSlicerSettings): VaseSliceExecution {
        const startTime = performance.now();
        const contourLayers = this.sampleSliceContoursGpu(settings);
        const contourSamplingEndTime = performance.now();
        const toolpath = this.buildSpiralToolpath(contourLayers, settings);
        const toolpathEndTime = performance.now();
        const gcode = this.buildGcode(toolpath, settings);
        const endTime = performance.now();

        return {
            settings,
            toolpath,
            gcode,
            timings: {
                contourSamplingMs: contourSamplingEndTime - startTime,
                toolpathBuildMs: toolpathEndTime - contourSamplingEndTime,
                gcodeBuildMs: endTime - toolpathEndTime,
                totalMs: endTime - startTime,
            },
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
        merged.firstLayerLineWidth = clamp(merged.firstLayerLineWidth, 0.2, 1.2);
        merged.filamentDiameter = clamp(merged.filamentDiameter, 1.0, 3.0);
        merged.printSpeedMmPerSec = clamp(merged.printSpeedMmPerSec, 5, 200);
        merged.firstLayerPrintSpeedMmPerSec = clamp(merged.firstLayerPrintSpeedMmPerSec, 5, merged.printSpeedMmPerSec);
        merged.travelSpeedMmPerSec = clamp(merged.travelSpeedMmPerSec, 10, 300);
        merged.flowRate = clamp(merged.flowRate, 0.01, 5.0);
        merged.moveMergeMinMoveMm = clamp(merged.moveMergeMinMoveMm, 0.005, 1.0);
        merged.moveMergeMaxDeviationMm = clamp(merged.moveMergeMaxDeviationMm, 0.001, 0.5);
        merged.moveMergeMaxTurnDeg = clamp(merged.moveMergeMaxTurnDeg, 0.5, 45);
        merged.moveMergeKeepStride = clampInt(merged.moveMergeKeepStride, 1, 200);
        merged.brimWidthMm = clamp(merged.brimWidthMm, 0, 30);
        merged.brimGapMm = clamp(merged.brimGapMm, 0, 5);
        if (merged.maxY <= merged.minY) {
            merged.maxY = merged.minY + merged.layerHeight;
        }

        return merged;
    }

    private sampleSliceContoursGpu(settings: VaseSlicerSettings): SliceContourLayer[] {
        const modelHeightMm = this.getModelHeightMm(settings);
        const layerCount = Math.max(2, Math.floor(modelHeightMm / settings.layerHeight) + 1);
        const requestedGridSize = clampInt(settings.radialSteps, 32, 512);
        const gridSize = clampInt(Math.max(requestedGridSize, Math.ceil(settings.pointsPerLayer * 0.5)), 32, 512) + 1;
        const bounds = this.getSliceBounds(settings);
        const layers: SliceContourLayer[] = [];
        const batchCapacity = this.getSliceBatchCapacity(gridSize);

        for (let layerIndex = 0; layerIndex < layerCount; layerIndex += batchCapacity) {
            const batchLayerCount = Math.min(batchCapacity, layerCount - layerIndex);
            const batchResults = this.sampleSignedDistanceFieldGpuBatch(settings, bounds, gridSize, layerCount, layerIndex, batchLayerCount);

            for (const batchResult of batchResults) {
                const field = batchResult.field;
                const sampleY = batchResult.sampleY;
            const contourSelection = selectPrimaryContour(
                extractContoursFromField(field, bounds),
                bounds,
                gridSize,
                settings,
            );

            if (!contourSelection.ok) {
                const sliceHeightMm = Math.max(settings.layerHeight, (sampleY - settings.minY) * settings.modelScale);
                throw new Error(
                    `Spiral mode requires exactly one closed contour per slice. Layer ${layers.length + 1} at Z ${sliceHeightMm.toFixed(2)} mm produced ${contourSelection.contourCount}${contourSelection.detail ? ` (${contourSelection.detail})` : ''}.`
                );
            }

            layers.push({
                sampleY,
                contour: this.buildPrintableContour(contourSelection.contour, settings),
            });
            }
        }

        if (layers.length < 2) {
            throw new Error('Planar contour slicer produced too few valid slices.');
        }

        this.alignContourLayers(layers);
        return layers;
    }

    private sampleSignedDistanceFieldGpuBatch(
        settings: VaseSlicerSettings,
        bounds: SliceBounds,
        gridSize: number,
        layerCount: number,
        layerStartIndex: number,
        batchLayerCount: number,
    ): SliceGpuBatchResult[] {
        const width = gridSize;
        const height = gridSize * batchLayerCount;
        const distanceRange = Math.max(
            settings.hitEpsilon * 8.0,
            Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
        );
        const firstSampleY = this.getSliceSampleY(settings, layerCount, layerStartIndex);
        const nextSampleY = layerStartIndex + 1 < layerCount
            ? this.getSliceSampleY(settings, layerCount, layerStartIndex + 1)
            : firstSampleY;
        const sliceYStep = nextSampleY - firstSampleY;

        this.ensureGpuResources(width, height);

        if (!this.gl || !this.program || !this.positionBuffer || !this.framebuffer || !this.renderTargetTexture) {
            throw new Error('Failed to initialize GPU contour slicing resources.');
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

        if (this.positionLocation < 0) {
            throw new Error('Failed to resolve slicer vertex attribute location.');
        }
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        this.setUniform2f('uTextureSize', width, height);
        this.setUniform1f('uFrameModulo', 0.0);
        this.setUniform1f('uFramePeriod', 120.0);
        this.setUniform1f('uMinY', settings.minY);
        this.setUniform1f('uMaxY', settings.maxY);
        this.setUniform1f('uScale', settings.modelScale);
        this.setUniform1f('uMaxRadius', settings.maxRadius);
        this.setUniform1f('uNozzleDiameter', settings.nozzleDiameter);
        this.setUniform1f('uFlowRate', settings.flowRate);
        this.setUniform1f('uLayerHeight', settings.layerHeight);
        this.setUniform2f('uSliceMin', bounds.minX, bounds.minZ);
        this.setUniform2f('uSliceMax', bounds.maxX, bounds.maxZ);
        this.setUniform1f('uSliceY', firstSampleY);
        this.setUniform1f('uSliceYStep', sliceYStep);
        this.setUniform1f('uSliceGridSize', gridSize);
        this.setUniform1f('uDistanceRange', distanceRange);
        this.setUniform1f('uHitEpsilon', settings.hitEpsilon);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return this.decodeSliceBatchFields(pixels, width, gridSize, batchLayerCount, distanceRange, firstSampleY, sliceYStep);
    }

    private buildSpiralToolpath(contourLayers: SliceContourLayer[], settings: VaseSlicerSettings): VaseToolpath {
        const layers = contourLayers.length;
        const perLayer = settings.pointsPerLayer;

        const firstLayerExtrusionPerMm = calculateExtrusionPerMm(settings, settings.firstLayerLineWidth);
        const extrusionPerMm = calculateExtrusionPerMm(settings, settings.lineWidth);

        const points: ToolpathPoint[] = [];
        let eAcc = 0;
        let prevX = 0;
        let prevY = 0;
        let prevZ = 0;

        for (let layerIndex = 0; layerIndex < layers; layerIndex++) {
            const contour = contourLayers[layerIndex].contour;
            const nextContour = contourLayers[Math.min(layerIndex + 1, layers - 1)].contour;
            const baseY = this.sampleYToPrintHeightMm(contourLayers[layerIndex].sampleY, settings);
            const nextY = this.sampleYToPrintHeightMm(contourLayers[Math.min(layerIndex + 1, layers - 1)].sampleY, settings);

            for (let k = 0; k < perLayer; k++) {
                const blend = k / perLayer;
                const currentPoint = contour[k] ?? contour[contour.length - 1];
                const nextPoint = nextContour[k] ?? nextContour[nextContour.length - 1];
                const sampleX = lerp(currentPoint.x, nextPoint.x, blend);
                const sampleZ = lerp(currentPoint.z, nextPoint.z, blend);
                const y = lerp(baseY, nextY, blend);
                const x = settings.centerX + (sampleX * settings.modelScale);
                const z = settings.centerZ + (sampleZ * settings.modelScale);

                if (points.length > 0) {
                    const segment = Math.hypot(x - prevX, y - prevY, z - prevZ);
                    const segmentExtrusionPerMm = layerIndex === 0 ? firstLayerExtrusionPerMm : extrusionPerMm;
                    eAcc += segment * segmentExtrusionPerMm;
                }

                points.push({
                    x,
                    y,
                    z,
                    e: eAcc,
                    speedMmPerSec: layerIndex === 0 ? settings.firstLayerPrintSpeedMmPerSec : settings.printSpeedMmPerSec,
                    layer: layerIndex,
                });

                prevX = x;
                prevY = y;
                prevZ = z;
            }
        }

        const optimizedPoints = this.optimizeToolpath(points, settings);
        this.recomputeExtrusion(optimizedPoints, settings);

        return {
            points: optimizedPoints,
            layerCount: layers,
            pointsPerLayer: perLayer,
            estimatedHeight: this.getModelHeightMm(settings),
        };
    }

    private alignContourLayers(layers: SliceContourLayer[]): void {
        if (layers.length === 0) {
            return;
        }

        layers[0].contour = anchorContourStart(layers[0].contour);
        let previousShift = 0;
        for (let layerIndex = 1; layerIndex < layers.length; layerIndex++) {
            const previous = layers[layerIndex - 1].contour;
            const next = layers[layerIndex].contour;
            const shift = findBestContourShift(previous, next, previousShift);
            layers[layerIndex].contour = rotateContour(next, shift);
            previousShift = shift;
        }
    }

    private getSliceBounds(settings: VaseSlicerSettings): SliceBounds {
        const extent = Math.max(settings.maxRadius, settings.hitEpsilon * 8.0);
        return {
            minX: -extent,
            maxX: extent,
            minZ: -extent,
            maxZ: extent,
        };
    }

    private getSliceSampleY(settings: VaseSlicerSettings, layerCount: number, layerIndex: number): number {
        const height = settings.maxY - settings.minY;
        const t = (layerIndex + 0.5) / layerCount;
        return settings.minY + (height * t);
    }

    private sampleYToPrintHeightMm(sampleY: number, settings: VaseSlicerSettings): number {
        return Math.max(settings.layerHeight, (sampleY - settings.minY) * settings.modelScale);
    }

    private buildPrintableContour(contour: SlicePoint[], settings: VaseSlicerSettings): SlicePoint[] {
        const denseCount = clampInt(
            Math.max(settings.pointsPerLayer, contour.length * 2),
            settings.pointsPerLayer,
            4096,
        );
        const denseContour = resampleClosedContour(contour, denseCount);
        const smoothedContour = smoothClosedContourTaubin(denseContour, 2);
        return resampleClosedContour(smoothedContour, settings.pointsPerLayer);
    }

    private optimizeToolpath(points: ToolpathPoint[], settings: VaseSlicerSettings): ToolpathPoint[] {
        if (points.length < 4) {
            return points;
        }

        const reduced: ToolpathPoint[] = [];
        let cursor = 0;
        while (cursor < points.length) {
            const layer = points[cursor].layer;
            let end = cursor + 1;
            while (end < points.length && points[end].layer === layer) {
                end++;
            }

            const layerPoints = points.slice(cursor, end);
            const simplified = this.simplifyLayerMoves(layerPoints, settings, layer);
            reduced.push(...simplified);
            cursor = end;
        }

        return reduced;
    }

    private simplifyLayerMoves(points: ToolpathPoint[], settings: VaseSlicerSettings, layer: number): ToolpathPoint[] {
        if (points.length <= 3) {
            return points;
        }

        const minMoveMm = settings.moveMergeMinMoveMm;
        const maxDeviationMm = settings.moveMergeMaxDeviationMm;
        const maxTurnDeg = settings.moveMergeMaxTurnDeg;
        const keepStride = settings.moveMergeKeepStride;

        const out: ToolpathPoint[] = [points[0]];
        let skipped = 0;

        for (let i = 1; i < points.length - 1; i++) {
            const prev = out[out.length - 1];
            const cur = points[i];
            const next = points[i + 1];

            const a = distance3(prev, cur);
            const b = distance3(cur, next);
            const chord = distance3(prev, next);
            const turnDeg = turnAngleDegrees(prev, cur, next);
            const deviation = chord > 1e-6 ? pointLineDistance3(cur, prev, next) : 0;
            const isTinyMove = a <= minMoveMm && b <= minMoveMm;
            const isSmoothEnough = deviation <= maxDeviationMm && turnDeg <= maxTurnDeg;

            const canMerge =
                (isTinyMove || isSmoothEnough) &&
                skipped < keepStride;

            if (canMerge) {
                skipped++;
                continue;
            }

            out.push(cur);
            skipped = 0;
        }

        out.push(points[points.length - 1]);
        return out;
    }

    private recomputeExtrusion(points: ToolpathPoint[], settings: VaseSlicerSettings): void {
        if (points.length === 0) {
            return;
        }

        const firstLayerExtrusionPerMm = calculateExtrusionPerMm(settings, settings.firstLayerLineWidth);
        const extrusionPerMm = calculateExtrusionPerMm(settings, settings.lineWidth);

        points[0].e = 0;
        let eAcc = 0;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const point = points[i];
            const segment = distance3(prev, point);
            const segmentExtrusionPerMm = point.layer === 0 ? firstLayerExtrusionPerMm : extrusionPerMm;
            eAcc += segment * segmentExtrusionPerMm;
            point.e = eAcc;
        }
    }

    private buildGcode(toolpath: VaseToolpath, settings: VaseSlicerSettings): string {
        if (toolpath.points.length < 2) {
            throw new Error('Vase slicing produced no valid path.');
        }

        const lines: string[] = [];
        const p0 = toolpath.points[0];
        const configuredFanPwm = percentToPwm(settings.fanPercent);
        const emitOrcaMetadata = shouldEmitOrcaMetadata(settings);
        const filamentMeta = inferFilamentMetadata(settings);

        if (emitOrcaMetadata) {
            lines.push(...buildOrcaMetadataHeader(toolpath, settings, filamentMeta));
        }

        lines.push('; Implicit vase-mode toolpath');
        lines.push('; Generated by Implicit');
        lines.push(`; Layers: ${toolpath.layerCount}`);
        lines.push(`; Points per layer: ${toolpath.pointsPerLayer}`);
        lines.push(`; Model scale (mm/SDF-unit): ${settings.modelScale.toFixed(2)}`);
        lines.push(`; Printer: ${settings.printerModelName} (${settings.printerModelId})`);
        lines.push(`; Filament: ${settings.filamentProfileName} (${settings.filamentProfileId})`);
        lines.push(`; Filament type: ${filamentMeta.type}`);
        lines.push(`; Filament density (g/cm3): ${filamentMeta.densityGcm3.toFixed(2)}`);
        lines.push(`; Filament cost (per kg): ${filamentMeta.costPerKg.toFixed(2)}`);
        lines.push(`; Bed size (mm): ${settings.bedWidthMm.toFixed(1)} x ${settings.bedDepthMm.toFixed(1)}`);
        lines.push(`; Max print height (mm): ${settings.maxPrintHeightMm.toFixed(1)}`);
        lines.push(`; Nozzle diameter (mm): ${settings.nozzleDiameter.toFixed(2)}`);
        lines.push(`; Nozzle temperature (C): ${settings.nozzleTempC.toFixed(0)}`);
        lines.push(`; Bed temperature (C): ${settings.bedTempC.toFixed(0)}`);
        lines.push(`; Fan speed (%): ${settings.fanPercent.toFixed(0)}`);
        lines.push(`; Line width (mm): ${settings.lineWidth.toFixed(3)}`);
        lines.push(`; First layer line width (mm): ${settings.firstLayerLineWidth.toFixed(3)}`);
        lines.push(`; Layer height (mm): ${settings.layerHeight.toFixed(3)}`);
        lines.push(`; First layer print speed (mm/s): ${settings.firstLayerPrintSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Print speed (mm/s): ${settings.printSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Travel speed (mm/s): ${settings.travelSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Brim width (mm): ${settings.brimWidthMm.toFixed(2)}`);
        lines.push(`; Brim gap (mm): ${settings.brimGapMm.toFixed(2)}`);
        lines.push(`; First layer extrusion/mm: ${calculateExtrusionPerMm(settings, settings.firstLayerLineWidth).toFixed(5)}`);
        lines.push(`; Extrusion/mm: ${calculateExtrusionPerMm(settings, settings.lineWidth).toFixed(5)}`);
        lines.push(`; Estimated height (mm): ${toolpath.estimatedHeight.toFixed(3)}`);
        const rawPathPoints = toolpath.layerCount * toolpath.pointsPerLayer;
        const mergedPathPoints = toolpath.points.length;
        const removedPathPoints = Math.max(0, rawPathPoints - mergedPathPoints);
        const mergeReductionPct = rawPathPoints > 0 ? (removedPathPoints / rawPathPoints) * 100 : 0;
        lines.push(`; Move merge: ${removedPathPoints} points removed (${mergeReductionPct.toFixed(1)}%)`);
        const startLines = parseGcodeLines(settings.startGcode, getDefaultStartGcode());
        for (const line of startLines) {
            lines.push(expandGcodeTemplate(line, settings));
        }
        // Normalize motion/extrusion modes regardless of custom start G-code state.
        lines.push('G21');
        lines.push('G90');
        // Force relative extrusion for exported toolpaths so each move carries only its local extrusion delta.
        lines.push('M83');
        // Keep first layer fan off for adhesion, then restore configured fan after layer 0.
        lines.push('M106 S0');
        const emittedBrim = appendBrimGcode(
            lines,
            toolpath,
            settings,
            Math.max(settings.layerHeight, p0.y),
            calculateExtrusionPerMm(settings, settings.firstLayerLineWidth)
        );
        lines.push('; FEATURE: Travel');
        lines.push(`G0 F${mmPerSecToFeedrate(settings.travelSpeedMmPerSec).toFixed(0)} X${p0.x.toFixed(3)} Y${p0.z.toFixed(3)} Z${Math.max(settings.layerHeight, p0.y).toFixed(3)}`);
        if (!emittedBrim) {
            // Mirror Orca's small restore pulse only when no brim path already primed the nozzle.
            lines.push('G1 F900 E0.8000');
            lines.push('G92 E0');
        }

        let currentLayer = p0.layer;
        lines.push('; CHANGE_LAYER');
        lines.push(`; Z_HEIGHT: ${Math.max(0.0, p0.y).toFixed(3)}`);
        lines.push(`; LAYER_HEIGHT: ${settings.layerHeight.toFixed(3)}`);
        lines.push(';LAYER_CHANGE');
        lines.push(';LAYER:0');
        lines.push(`;Z:${Math.max(0.0, p0.y).toFixed(3)}`);
        lines.push('; FEATURE: Outer wall');
        lines.push(';TYPE:Outer wall');

        for (let i = 1; i < toolpath.points.length; i++) {
            const point = toolpath.points[i];
            const prevPoint = toolpath.points[i - 1];
            const layer = point.layer;
            if (layer !== currentLayer) {
                currentLayer = layer;
                lines.push('; CHANGE_LAYER');
                lines.push(`; Z_HEIGHT: ${Math.max(0.0, point.y).toFixed(3)}`);
                lines.push(`; LAYER_HEIGHT: ${settings.layerHeight.toFixed(3)}`);
                lines.push(';LAYER_CHANGE');
                lines.push(`;LAYER:${layer}`);
                lines.push(`;Z:${Math.max(0.0, point.y).toFixed(3)}`);
                if (layer === 1) {
                    lines.push(`M106 S${configuredFanPwm}`);
                }
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
        if (this.maxTextureSize <= 0) {
            this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        }

        const nextSignature = getSlicerProgramSignature();
        if (!this.program || this.programSignature !== nextSignature) {
            const nextProgram = this.createProgram(gl, getSlicerVertexSource(), composeSlicerFragmentSource());
            if (this.program) {
                gl.deleteProgram(this.program);
            }
            this.program = nextProgram;
            this.programSignature = nextSignature;
            this.uniformLocations.clear();
            this.positionLocation = gl.getAttribLocation(this.program, 'aPosition');
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

    private getSliceBatchCapacity(gridSize: number): number {
        const maxTextureSize = Math.max(1, this.maxTextureSize || 4096);
        const maxBatchByTexture = Math.max(1, Math.floor(maxTextureSize / Math.max(1, gridSize)));
        return Math.max(1, Math.min(SLICE_BATCH_SIZE, maxBatchByTexture));
    }

    private decodeSliceBatchFields(
        pixels: Uint8Array,
        width: number,
        gridSize: number,
        batchLayerCount: number,
        distanceRange: number,
        firstSampleY: number,
        sliceYStep: number,
    ): SliceGpuBatchResult[] {
        const results: SliceGpuBatchResult[] = [];
        for (let batchIndex = 0; batchIndex < batchLayerCount; batchIndex++) {
            const field: number[][] = [];
            const rowOffset = batchIndex * gridSize;
            for (let y = 0; y < gridSize; y++) {
                const row: number[] = [];
                const sourceRow = rowOffset + y;
                for (let x = 0; x < width; x++) {
                    const idx = ((sourceRow * width) + x) * 4;
                    const alpha = pixels[idx + 3];
                    if (alpha < 1) {
                        row.push(distanceRange);
                        continue;
                    }

                    const packed = pixels[idx] * 256 + pixels[idx + 1];
                    const normalized = packed / 65535;
                    row.push(((normalized * 2.0) - 1.0) * distanceRange);
                }
                field.push(row);
            }
            results.push({
                sampleY: firstSampleY + (sliceYStep * batchIndex),
                field,
            });
        }

        return results;
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
        const loc = this.getUniformLocation(name);
        if (loc !== null) {
            this.gl.uniform1f(loc, value);
        }
    }

    private setUniform1i(name: string, value: number): void {
        if (!this.gl || !this.program) {
            return;
        }
        const loc = this.getUniformLocation(name);
        if (loc !== null) {
            this.gl.uniform1i(loc, value);
        }
    }

    private setUniform2f(name: string, x: number, y: number): void {
        if (!this.gl || !this.program) {
            return;
        }
        const loc = this.getUniformLocation(name);
        if (loc !== null) {
            this.gl.uniform2f(loc, x, y);
        }
    }

    private getUniformLocation(name: string): WebGLUniformLocation | null {
        if (!this.gl || !this.program) {
            return null;
        }
        if (this.uniformLocations.has(name)) {
            return this.uniformLocations.get(name) ?? null;
        }
        const location = this.gl.getUniformLocation(this.program, name);
        this.uniformLocations.set(name, location);
        return location;
    }
}

function extractContoursFromField(field: number[][], bounds: SliceBounds): SlicePoint[][] {
    const rows = field.length;
    const cols = field[0]?.length ?? 0;
    if (rows < 2 || cols < 2) {
        return [];
    }

    const segments: SliceSegment[] = [];
    for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols - 1; col++) {
            const cellSegments = extractCellSegments(field, bounds, rows, cols, row, col);
            segments.push(...cellSegments);
        }
    }

    return joinSegmentsIntoContours(segments);
}

function extractCellSegments(
    field: number[][],
    bounds: SliceBounds,
    rowCount: number,
    columnCount: number,
    row: number,
    col: number
): SliceSegment[] {
    const x0 = lerp(bounds.minX, bounds.maxX, col / Math.max(1, columnCount - 1));
    const x1 = lerp(bounds.minX, bounds.maxX, (col + 1) / Math.max(1, columnCount - 1));
    const z0 = lerp(bounds.minZ, bounds.maxZ, row / Math.max(1, rowCount - 1));
    const z1 = lerp(bounds.minZ, bounds.maxZ, (row + 1) / Math.max(1, rowCount - 1));

    const bl = field[row][col];
    const br = field[row][col + 1];
    const tr = field[row + 1][col + 1];
    const tl = field[row + 1][col];

    const caseIndex =
        ((tl <= 0 ? 1 : 0) << 3) |
        ((tr <= 0 ? 1 : 0) << 2) |
        ((br <= 0 ? 1 : 0) << 1) |
        (bl <= 0 ? 1 : 0);

    const center = 0.25 * (bl + br + tr + tl);
    switch (caseIndex) {
        case 0:
        case 15:
            return [];
        case 1:
            return [[
                createLeftVertex(row, col, x0, z0, z1, tl, bl),
                createBottomVertex(row, col, x0, x1, z0, bl, br),
            ]];
        case 2:
            return [[
                createBottomVertex(row, col, x0, x1, z0, bl, br),
                createRightVertex(row, col, x1, z0, z1, br, tr),
            ]];
        case 3:
            return [[
                createLeftVertex(row, col, x0, z0, z1, tl, bl),
                createRightVertex(row, col, x1, z0, z1, br, tr),
            ]];
        case 4:
            return [[
                createRightVertex(row, col, x1, z0, z1, br, tr),
                createTopVertex(row, col, x0, x1, z1, tr, tl),
            ]];
        case 5:
            return center <= 0
                ? [[
                    createLeftVertex(row, col, x0, z0, z1, tl, bl),
                    createTopVertex(row, col, x0, x1, z1, tr, tl),
                ], [
                    createBottomVertex(row, col, x0, x1, z0, bl, br),
                    createRightVertex(row, col, x1, z0, z1, br, tr),
                ]]
                : [[
                    createLeftVertex(row, col, x0, z0, z1, tl, bl),
                    createBottomVertex(row, col, x0, x1, z0, bl, br),
                ], [
                    createTopVertex(row, col, x0, x1, z1, tr, tl),
                    createRightVertex(row, col, x1, z0, z1, br, tr),
                ]];
        case 6:
            return [[
                createBottomVertex(row, col, x0, x1, z0, bl, br),
                createTopVertex(row, col, x0, x1, z1, tr, tl),
            ]];
        case 7:
            return [[
                createLeftVertex(row, col, x0, z0, z1, tl, bl),
                createTopVertex(row, col, x0, x1, z1, tr, tl),
            ]];
        case 8:
            return [[
                createTopVertex(row, col, x0, x1, z1, tr, tl),
                createLeftVertex(row, col, x0, z0, z1, tl, bl),
            ]];
        case 9:
            return [[
                createBottomVertex(row, col, x0, x1, z0, bl, br),
                createTopVertex(row, col, x0, x1, z1, tr, tl),
            ]];
        case 10:
            return center <= 0
                ? [[
                    createLeftVertex(row, col, x0, z0, z1, tl, bl),
                    createBottomVertex(row, col, x0, x1, z0, bl, br),
                ], [
                    createTopVertex(row, col, x0, x1, z1, tr, tl),
                    createRightVertex(row, col, x1, z0, z1, br, tr),
                ]]
                : [[
                    createLeftVertex(row, col, x0, z0, z1, tl, bl),
                    createTopVertex(row, col, x0, x1, z1, tr, tl),
                ], [
                    createBottomVertex(row, col, x0, x1, z0, bl, br),
                    createRightVertex(row, col, x1, z0, z1, br, tr),
                ]];
        case 11:
            return [[
                createTopVertex(row, col, x0, x1, z1, tr, tl),
                createRightVertex(row, col, x1, z0, z1, br, tr),
            ]];
        case 12:
            return [[
                createLeftVertex(row, col, x0, z0, z1, tl, bl),
                createRightVertex(row, col, x1, z0, z1, br, tr),
            ]];
        case 13:
            return [[
                createBottomVertex(row, col, x0, x1, z0, bl, br),
                createRightVertex(row, col, x1, z0, z1, br, tr),
            ]];
        case 14:
            return [[
                createLeftVertex(row, col, x0, z0, z1, tl, bl),
                createBottomVertex(row, col, x0, x1, z0, bl, br),
            ]];
        default:
            return [];
    }
}

function createBottomVertex(row: number, col: number, x0: number, x1: number, z0: number, bl: number, br: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey('h', row, col),
        interpolateIsoPoint({ x: x0, z: z0 }, bl, { x: x1, z: z0 }, br),
    );
}

function createRightVertex(row: number, col: number, x1: number, z0: number, z1: number, br: number, tr: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey('v', row, col + 1),
        interpolateIsoPoint({ x: x1, z: z0 }, br, { x: x1, z: z1 }, tr),
    );
}

function createTopVertex(row: number, col: number, x0: number, x1: number, z1: number, tr: number, tl: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey('h', row + 1, col),
        interpolateIsoPoint({ x: x1, z: z1 }, tr, { x: x0, z: z1 }, tl),
    );
}

function createLeftVertex(row: number, col: number, x0: number, z0: number, z1: number, tl: number, bl: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey('v', row, col),
        interpolateIsoPoint({ x: x0, z: z1 }, tl, { x: x0, z: z0 }, bl),
    );
}

function createSliceSegmentVertex(key: string, point: SlicePoint): SliceSegmentVertex {
    return { key, point };
}

function edgeKey(axis: 'h' | 'v', row: number, col: number): string {
    return `${axis}:${row}:${col}`;
}

function interpolateIsoPoint(a: SlicePoint, aValue: number, b: SlicePoint, bValue: number): SlicePoint {
    const delta = bValue - aValue;
    const t = Math.abs(delta) < 1e-8 ? 0.5 : clamp((-aValue) / delta, 0, 1);
    return {
        x: lerp(a.x, b.x, t),
        z: lerp(a.z, b.z, t),
    };
}

function joinSegmentsIntoContours(segments: SliceSegment[]): SlicePoint[][] {
    if (segments.length === 0) {
        return [];
    }

    const adjacency = new Map<string, Array<{ segmentIndex: number; endpointIndex: 0 | 1 }>>();
    const contours: SlicePoint[][] = [];

    segments.forEach((segment, segmentIndex) => {
        for (let endpointIndex = 0 as 0 | 1; endpointIndex <= 1; endpointIndex = (endpointIndex + 1) as 0 | 1) {
            const vertex = segment[endpointIndex];
            const refs = adjacency.get(vertex.key) ?? [];
            refs.push({ segmentIndex, endpointIndex });
            adjacency.set(vertex.key, refs);
        }
    });

    const visited = new Array<boolean>(segments.length).fill(false);

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        if (visited[segmentIndex]) {
            continue;
        }

        visited[segmentIndex] = true;
        const startSegment = segments[segmentIndex];
        const contour: SlicePoint[] = [startSegment[0].point, startSegment[1].point];
        const startKey = startSegment[0].key;
        let cursorKey = startSegment[1].key;

        while (cursorKey !== startKey) {
            const nextRef = (adjacency.get(cursorKey) ?? []).find((ref) => !visited[ref.segmentIndex]);
            if (!nextRef) {
                break;
            }

            visited[nextRef.segmentIndex] = true;
            const nextSegment = segments[nextRef.segmentIndex];
            const nextEndpointIndex = nextRef.endpointIndex === 0 ? 1 : 0;
            contour.push(nextSegment[nextEndpointIndex].point);
            cursorKey = nextSegment[nextEndpointIndex].key;
        }

        if (cursorKey === startKey) {
            contour.pop();
            const cleaned = dedupeClosedContour(contour);
            if (cleaned.length >= 3) {
                contours.push(cleaned);
            }
        }
    }

    return contours;
}

function normalizeContour(points: SlicePoint[]): SlicePoint[] {
    const deduped = dedupeClosedContour(points);
    if (deduped.length < 3) {
        return deduped;
    }

    return signedContourArea(deduped) < 0 ? deduped.slice().reverse() : deduped;
}

function dedupeClosedContour(points: SlicePoint[]): SlicePoint[] {
    const cleaned: SlicePoint[] = [];
    for (const point of points) {
        const previous = cleaned[cleaned.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-6) {
            cleaned.push(point);
        }
    }

    if (cleaned.length > 1) {
        const first = cleaned[0];
        const last = cleaned[cleaned.length - 1];
        if (Math.hypot(first.x - last.x, first.z - last.z) <= 1e-6) {
            cleaned.pop();
        }
    }

    return cleaned;
}

function selectPrimaryContour(
    rawContours: SlicePoint[][],
    bounds: SliceBounds,
    gridSize: number,
    settings: VaseSlicerSettings,
):
    | { ok: true; contour: SlicePoint[]; contourCount: number; detail: string }
    | { ok: false; contourCount: number; detail: string } {
    const candidates = rawContours
        .map((contour) => buildContourCandidate(contour))
        .filter((candidate) => candidate !== null)
        .sort((a, b) => {
            if (b.area !== a.area) {
                return b.area - a.area;
            }
            return b.perimeter - a.perimeter;
        });

    if (candidates.length === 0) {
        return { ok: false, contourCount: 0, detail: 'no valid closed loops' };
    }
    if (candidates.length === 1) {
        return { ok: true, contour: candidates[0].contour, contourCount: 1, detail: '' };
    }

    const primary = candidates[0];
    const gridPitch = Math.max(
        (bounds.maxX - bounds.minX) / Math.max(1, gridSize - 1),
        (bounds.maxZ - bounds.minZ) / Math.max(1, gridSize - 1),
    );
    const printableFeatureSize = Math.max(
        gridPitch * 3.0,
        settings.hitEpsilon * 6.0,
        (Math.max(settings.nozzleDiameter, settings.lineWidth) * 0.35) / Math.max(settings.modelScale, 1e-6),
    );
    const minSecondaryArea = Math.max(
        primary.area * 0.08,
        printableFeatureSize * printableFeatureSize * 2.0,
    );
    const minSecondaryPerimeter = Math.max(
        primary.perimeter * 0.12,
        printableFeatureSize * 8.0,
    );

    const significant = candidates.filter((candidate, index) => (
        index === 0 || (candidate.area >= minSecondaryArea && candidate.perimeter >= minSecondaryPerimeter)
    ));

    if (significant.length > 1) {
        return {
            ok: false,
            contourCount: significant.length,
            detail: significant
                .slice(0, 3)
                .map((candidate) => `${(candidate.area * settings.modelScale * settings.modelScale).toFixed(2)}mm^2`)
                .join(', '),
        };
    }

    const ignoredCount = Math.max(0, candidates.length - 1);
    return {
        ok: true,
        contour: primary.contour,
        contourCount: candidates.length,
        detail: ignoredCount > 0 ? `ignored ${ignoredCount} tiny loop${ignoredCount === 1 ? '' : 's'}` : '',
    };
}

function buildContourCandidate(contour: SlicePoint[]): SliceContourCandidate | null {
    const normalized = normalizeContour(contour);
    if (normalized.length < 3) {
        return null;
    }

    const perimeter = contourPerimeter(normalized);
    const area = Math.abs(signedContourArea(normalized));
    if (perimeter <= 1e-4 || area <= 1e-8) {
        return null;
    }

    return {
        contour: normalized,
        area,
        perimeter,
    };
}

function signedContourArea(points: SlicePoint[]): number {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        area += (current.x * next.z) - (next.x * current.z);
    }
    return area * 0.5;
}

function contourPerimeter(points: SlicePoint[]): number {
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        perimeter += Math.hypot(next.x - current.x, next.z - current.z);
    }
    return perimeter;
}

function resampleClosedContour(points: SlicePoint[], count: number): SlicePoint[] {
    const source = dedupeClosedContour(points);
    if (source.length < 3) {
        return source;
    }

    const perimeter = contourPerimeter(source);
    if (perimeter <= 1e-8) {
        return source;
    }

    const cumulative: number[] = [0];
    for (let i = 0; i < source.length; i++) {
        const current = source[i];
        const next = source[(i + 1) % source.length];
        cumulative.push(cumulative[cumulative.length - 1] + Math.hypot(next.x - current.x, next.z - current.z));
    }

    const resampled: SlicePoint[] = [];
    let segmentIndex = 0;
    for (let i = 0; i < count; i++) {
        const targetDistance = (perimeter * i) / count;
        while (segmentIndex < source.length - 1 && cumulative[segmentIndex + 1] < targetDistance) {
            segmentIndex++;
        }

        const segmentStart = source[segmentIndex % source.length];
        const segmentEnd = source[(segmentIndex + 1) % source.length];
        const segmentLength = cumulative[segmentIndex + 1] - cumulative[segmentIndex];
        const localT = segmentLength <= 1e-8 ? 0 : (targetDistance - cumulative[segmentIndex]) / segmentLength;
        resampled.push({
            x: lerp(segmentStart.x, segmentEnd.x, localT),
            z: lerp(segmentStart.z, segmentEnd.z, localT),
        });
    }

    return resampled;
}

function smoothClosedContourTaubin(points: SlicePoint[], iterations: number): SlicePoint[] {
    let current = dedupeClosedContour(points);
    if (current.length < 4 || iterations <= 0) {
        return current;
    }

    for (let iteration = 0; iteration < iterations; iteration++) {
        current = smoothClosedContourPass(current, 0.45);
        current = smoothClosedContourPass(current, -0.47);
    }

    return current;
}

function smoothClosedContourPass(points: SlicePoint[], factor: number): SlicePoint[] {
    const smoothed: SlicePoint[] = [];
    for (let index = 0; index < points.length; index++) {
        const previous = points[(index - 1 + points.length) % points.length];
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const laplacianX = 0.5 * (previous.x + next.x) - current.x;
        const laplacianZ = 0.5 * (previous.z + next.z) - current.z;
        smoothed.push({
            x: current.x + laplacianX * factor,
            z: current.z + laplacianZ * factor,
        });
    }

    return smoothed;
}

function anchorContourStart(points: SlicePoint[]): SlicePoint[] {
    if (points.length === 0) {
        return points;
    }

    let anchorIndex = 0;
    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        const anchor = points[anchorIndex];
        if (point.x > anchor.x || (point.x === anchor.x && point.z > anchor.z)) {
            anchorIndex = i;
        }
    }

    return rotateContour(points, anchorIndex);
}

function rotateContour(points: SlicePoint[], shift: number): SlicePoint[] {
    if (points.length === 0) {
        return points;
    }

    const normalizedShift = ((shift % points.length) + points.length) % points.length;
    return points.map((_, index) => points[(index + normalizedShift) % points.length]);
}

function findBestContourShift(previous: SlicePoint[], next: SlicePoint[], seedShift = 0): number {
    if (previous.length === 0 || next.length === 0 || previous.length !== next.length) {
        return 0;
    }

    const localSampleStride = Math.max(1, Math.floor(previous.length / 64));
    const localRadius = Math.max(8, Math.floor(previous.length / 24));
    const normalizedSeed = normalizeContourShift(seedShift, next.length);

    let bestShift = normalizedSeed;
    let bestScore = scoreContourShift(previous, next, normalizedSeed, localSampleStride);

    for (let delta = -localRadius; delta <= localRadius; delta++) {
        const shift = normalizeContourShift(normalizedSeed + delta, next.length);
        const score = scoreContourShift(previous, next, shift, localSampleStride);
        if (score < bestScore) {
            bestScore = score;
            bestShift = shift;
        }
    }

    const averageSpacing = contourPerimeter(previous) / Math.max(1, previous.length);
    const averageScore = bestScore / Math.ceil(previous.length / localSampleStride);
    if (averageScore <= averageSpacing * 3.0) {
        return bestShift;
    }

    const coarseSampleStride = Math.max(1, Math.floor(previous.length / 96));
    const coarseStride = Math.max(1, Math.floor(previous.length / 48));
    bestScore = Number.POSITIVE_INFINITY;

    for (let shift = 0; shift < next.length; shift += coarseStride) {
        const score = scoreContourShift(previous, next, shift, coarseSampleStride);
        if (score < bestScore) {
            bestScore = score;
            bestShift = shift;
        }
    }

    for (let delta = -coarseStride; delta <= coarseStride; delta++) {
        const shift = normalizeContourShift(bestShift + delta, next.length);
        const score = scoreContourShift(previous, next, shift, coarseSampleStride);
        if (score < bestScore) {
            bestScore = score;
            bestShift = shift;
        }
    }

    return bestShift;
}

function scoreContourShift(previous: SlicePoint[], next: SlicePoint[], shift: number, stride: number): number {
    let score = 0;
    for (let index = 0; index < previous.length; index += stride) {
        const a = previous[index];
        const b = next[(index + shift) % next.length];
        score += Math.hypot(a.x - b.x, a.z - b.z);
    }
    return score;
}

function normalizeContourShift(shift: number, length: number): number {
    return ((shift % length) + length) % length;
}

function calculateExtrusionPerMm(settings: VaseSlicerSettings, targetLineWidth?: number): number {
    const requestedLineWidth = typeof targetLineWidth === 'number' ? targetLineWidth : settings.lineWidth;
    const lineWidth = Math.max(requestedLineWidth, settings.nozzleDiameter);
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

function lerp(a: number, b: number, t: number): number {
    return a + ((b - a) * t);
}

function distance2(a: SlicePoint, b: SlicePoint): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

function distance3(a: Pick<ToolpathPoint, 'x' | 'y' | 'z'>, b: Pick<ToolpathPoint, 'x' | 'y' | 'z'>): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function turnAngleDegrees(
    a: Pick<ToolpathPoint, 'x' | 'y' | 'z'>,
    b: Pick<ToolpathPoint, 'x' | 'y' | 'z'>,
    c: Pick<ToolpathPoint, 'x' | 'y' | 'z'>
): number {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const vz = c.z - b.z;

    const lu = Math.hypot(ux, uy, uz);
    const lv = Math.hypot(vx, vy, vz);
    if (lu < 1e-9 || lv < 1e-9) {
        return 0;
    }

    const cosTheta = clamp(((ux * vx) + (uy * vy) + (uz * vz)) / (lu * lv), -1, 1);
    return (Math.acos(cosTheta) * 180) / Math.PI;
}

function pointLineDistance3(
    p: Pick<ToolpathPoint, 'x' | 'y' | 'z'>,
    a: Pick<ToolpathPoint, 'x' | 'y' | 'z'>,
    b: Pick<ToolpathPoint, 'x' | 'y' | 'z'>
): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const apz = p.z - a.z;

    const abLenSq = (abx * abx) + (aby * aby) + (abz * abz);
    if (abLenSq < 1e-12) {
        return Math.hypot(apx, apy, apz);
    }

    const t = clamp(((apx * abx) + (apy * aby) + (apz * abz)) / abLenSq, 0, 1);
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const qz = a.z + abz * t;
    return Math.hypot(p.x - qx, p.y - qy, p.z - qz);
}

function percentToPwm(percent: number): number {
    const clamped = clamp(percent, 0, 100);
    return Math.round((clamped / 100) * 255);
}

function appendBrimGcode(
    lines: string[],
    toolpath: VaseToolpath,
    settings: VaseSlicerSettings,
    firstLayerZ: number,
    extrusionPerMm: number
): boolean {
    const lineWidth = Math.max(0.01, settings.firstLayerLineWidth);
    const brimLoops = Math.floor(settings.brimWidthMm / lineWidth);
    const brimGap = Math.max(0, settings.brimGapMm);
    if (brimLoops <= 0 || toolpath.pointsPerLayer < 3) {
        return false;
    }

    const firstLayer = toolpath.points.filter((point) => point.layer === 0);
    if (firstLayer.length < 3) {
        return false;
    }

    const printFeed = mmPerSecToFeedrate(settings.firstLayerPrintSpeedMmPerSec).toFixed(0);
    const travelFeed = mmPerSecToFeedrate(settings.travelSpeedMmPerSec).toFixed(0);

    lines.push('; FEATURE: Brim');
    let isFirstBrimLoop = true;
    let emittedAnyBrimLoop = false;
    for (let loopIndex = brimLoops; loopIndex >= 1; loopIndex--) {
        const offset = lineWidth + brimGap + (loopIndex - 1) * lineWidth;
        const loop = buildBrimLoop(firstLayer, settings.centerX, settings.centerZ, offset);
        if (loop.length < 3) {
            continue;
        }

        emittedAnyBrimLoop = true;

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

    return emittedAnyBrimLoop;
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

function buildOrcaMetadataHeader(
    toolpath: VaseToolpath,
    settings: VaseSlicerSettings,
    filamentMeta: { type: string; densityGcm3: number; costPerKg: number }
): string[] {
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
    const firstLayerPrintSpeedMmPerSec = Math.round(settings.firstLayerPrintSpeedMmPerSec);
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
        `; filament_density: ${filamentMeta.densityGcm3.toFixed(2)}`,
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
        `; filament_cost = ${filamentMeta.costPerKg.toFixed(0)}`,
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
        `; initial_layer_line_width = ${settings.firstLayerLineWidth.toFixed(2)}`,
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
        `; filament_type = ${filamentMeta.type}`,
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
        `; first_layer_line_width = ${settings.firstLayerLineWidth.toFixed(2)}`,
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
        `; initial_layer_speed = ${firstLayerPrintSpeedMmPerSec}`,
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
        `; first layer extrusion width = ${settings.firstLayerLineWidth.toFixed(2)}mm`,
        '',
        '; EXECUTABLE_BLOCK_START',
    ];
}

function inferFilamentMetadata(settings: VaseSlicerSettings): { type: string; densityGcm3: number; costPerKg: number } {
    const probe = `${settings.filamentProfileId} ${settings.filamentProfileName}`.toUpperCase();
    if (probe.includes('PETG')) {
        return { type: 'PETG', densityGcm3: 1.27, costPerKg: 24 };
    }
    if (probe.includes('ABS')) {
        return { type: 'ABS', densityGcm3: 1.04, costPerKg: 22 };
    }
    if (probe.includes('ASA')) {
        return { type: 'ASA', densityGcm3: 1.07, costPerKg: 28 };
    }
    if (probe.includes('TPU')) {
        return { type: 'TPU', densityGcm3: 1.21, costPerKg: 35 };
    }
    if (probe.includes('PA') || probe.includes('NYLON')) {
        return { type: 'PA', densityGcm3: 1.14, costPerKg: 40 };
    }

    return { type: 'PLA', densityGcm3: 1.24, costPerKg: 20 };
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