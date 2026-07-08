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
} from './shader-pipeline';
import {
    applyToolpathPipeline,
    type ToolpathPipelineStepSummary,
} from './toolpath-postprocess';
import type { ResolvedPipelineStep } from './postprocess-registry';
import { snapToNearestOptionValue } from './control-options';
import {
    buildExcludeObjectDefineLine,
    buildOrcaMetadataHeader,
    inferFilamentMetadata,
    shouldEmitOrcaMetadata,
} from './slicer/gcode-metadata';
import {
    expandGcodeTemplate,
    getDefaultEndGcode,
    getDefaultStartGcode,
    parseGcodeLines,
} from './slicer/gcode-template';

export interface VaseSlicerSettings {
    slicerMode: 'planar' | 'cylindrical';
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
    /**
     * Target toolpath segment length in mm. Single quality knob for slicing:
     * drives both the sampling grid pitch and the per-layer contour point
     * count (derived from the largest layer perimeter).
     */
    targetSegmentMm: number;
    /**
     * Contour points per layer. Derived from targetSegmentMm and the largest
     * layer perimeter during slicing; not a user-facing setting.
     */
    pointsPerLayer: number;
    maxRadius: number;
    hitEpsilon: number;
    sliceIsoSnapFactor: number;
    centerX: number;
    centerZ: number;
    lineWidth: number;
    firstLayerLineWidth: number;
    filamentDiameter: number;
    firstLayerPrintSpeedMmPerSec: number;
    printSpeedMmPerSec: number;
    minLayerTimeSec: number;
    travelSpeedMmPerSec: number;
    nozzleTempC: number;
    bedTempC: number;
    fanPercent: number;
    flowRate: number;
    moveMergeMinMoveMm: number;
    moveMergeMaxDeviationMm: number;
    moveMergeMaxTurnDeg: number;
    moveMergeKeepStride: number;
    retractMm: number;
    retractSpeedMmPerSec: number;
    primeMm: number;
    brimWidthMm: number;
    brimGapMm: number;
    enableContourAlignment: boolean;
    enableMoveMerging: boolean;
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
    extrusionScale?: number;
    sceneFields?: Record<string, SceneFieldValue>;
}

export interface VaseToolpath {
    points: ToolpathPoint[];
    layerCount: number;
    pointsPerLayer: number;
    estimatedHeight: number;
    postprocessSummaries?: ToolpathPipelineStepSummary[];
}

export interface VaseBaseToolpath {
    points: ToolpathPoint[];
    layerCount: number;
    pointsPerLayer: number;
    estimatedHeight: number;
    /** Non-fatal issues from sampling (ignored holes, dropped loops, window fit). */
    warnings?: string[];
}

export interface VaseSliceResult {
    settings: VaseSlicerSettings;
    toolpath: VaseToolpath;
    gcode: string;
    warnings: string[];
}

export interface VaseSliceBaseResult {
    settings: VaseSlicerSettings;
    baseToolpath: VaseBaseToolpath;
    warnings: string[];
}

export interface SliceDebugBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface SliceDebugSegment {
    ax: number;
    az: number;
    bx: number;
    bz: number;
}

export interface SliceDebugContourMetric {
    index: number;
    pointCount: number;
    areaMm2: number;
    perimeterMm: number;
    significant: boolean;
}

export interface SliceDebugSnapshot {
    layerIndex: number;
    layerCount: number;
    sampleY: number;
    sliceHeightMm: number;
    gridSize: number;
    bounds: SliceDebugBounds;
    contourCount: number;
    detail: string;
    minDistance: number;
    maxDistance: number;
    closedContours: SlicePoint[][];
    openPolylines: SlicePoint[][];
    segments: SliceDebugSegment[];
    contourMetrics: SliceDebugContourMetric[];
    field: number[][];
}

export type SliceProgressPhase = 'preparing' | 'sampling' | 'toolpath' | 'gcode' | 'finalizing';

export interface SliceProgressUpdate {
    phase: SliceProgressPhase;
    phaseLabel: string;
    completed: number;
    total: number;
    overall: number;
    detail: string;
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

type SliceProgressReporter = (update: SliceProgressUpdate) => void;

interface SliceBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface SlicePoint {
    x: number;
    z: number;
}

interface SliceContourLayer {
    sampleY: number;
    contour: SlicePoint[];
}

interface SampledSliceContours {
    layers: SliceContourLayer[];
    warnings: string[];
}

interface SliceJob {
    layerCount: number;
    bounds: SliceBounds;
    gridSize: number;
    batchCapacity: number;
    sliceYStep: number;
    warnings: string[];
}

interface SliceLayerWarningStats {
    holeLayers: number;
    maxHoleCount: number;
    droppedLayers: number;
    droppedLargestAreaMm2: number;
    islandLayers: number;
    islandLargestAreaMm2: number;
}

interface SliceContourCandidate {
    contour: SlicePoint[];
    area: number;
    perimeter: number;
}

interface SliceContourSelectionDebug {
    significantIndices: Set<number>;
    metrics: SliceDebugContourMetric[];
}

interface SliceContourExtractionDebug {
    closedContours: SlicePoint[][];
    openPolylines: SlicePoint[][];
    segments: SliceDebugSegment[];
}

interface SliceSegmentVertex {
    key: number;
    point: SlicePoint;
}

type SliceSegment = [SliceSegmentVertex, SliceSegmentVertex];

const SLICE_BATCH_SIZE = 16;
// Disjoint islands smaller than this are skipped with a warning; larger ones fail the slice.
const MAX_SKIPPABLE_ISLAND_AREA_MM2 = 4.0;
const MAX_SLICE_GRID_SIZE = 2048;

interface SliceGpuBatchResult {
    sampleY: number;
    /** Row-major gridSize×gridSize signed distances. */
    field: Float32Array;
}

/**
 * A GPU batch whose draw + readback have been issued but not yet consumed.
 * On WebGL2 the pixels land in a PIXEL_PACK_BUFFER guarded by a fence so the
 * CPU can extract the previous batch while this one renders; on WebGL1 the
 * synchronous readback already happened at issue time.
 */
interface SliceGpuPendingBatch {
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
    private renderTargetWidth: number;
    private renderTargetHeight: number;
    private sceneControlDefinitions: SceneControlDefinition[];
    private sceneControlValues: SceneControlValueMap;
    private lastSliceDebugSnapshot: SliceDebugSnapshot | null;

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
        this.renderTargetWidth = 0;
        this.renderTargetHeight = 0;
        this.sceneControlDefinitions = [];
        this.sceneControlValues = {};
        this.lastSliceDebugSnapshot = null;
    }

    public setSceneControlState(definitions: SceneControlDefinition[], values: SceneControlValueMap): void {
        this.sceneControlDefinitions = definitions.map((definition) => ({ ...definition }));
        this.sceneControlValues = buildSceneControlValueMap(this.sceneControlDefinitions, values);
    }

    public getDefaultVaseSettings(): VaseSlicerSettings {
        return {
            slicerMode: 'planar',
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
            targetSegmentMm: 0.3,
            pointsPerLayer: 640,
            maxRadius: 1.1,
            hitEpsilon: 0.0014,
            sliceIsoSnapFactor: 0.0,
            centerX: 110,
            centerZ: 110,
            lineWidth: 0.42,
            firstLayerLineWidth: 0.5,
            filamentDiameter: 1.75,
            firstLayerPrintSpeedMmPerSec: 20,
            printSpeedMmPerSec: 35,
            minLayerTimeSec: 8,
            travelSpeedMmPerSec: 120,
            nozzleTempC: 215,
            bedTempC: 55,
            fanPercent: 100,
            flowRate: 1.0,
            moveMergeMinMoveMm: 0.10,
            moveMergeMaxDeviationMm: 0.025,
            moveMergeMaxTurnDeg: 1.0,
            moveMergeKeepStride: 12,
            retractMm: 1.2,
            retractSpeedMmPerSec: 20,
            primeMm: 0.8,
            brimWidthMm: 5,
            brimGapMm: 0.1,
            enableContourAlignment: true,
            enableMoveMerging: true,
            startGcode: getDefaultStartGcode().join('\n'),
            endGcode: getDefaultEndGcode().join('\n'),
        };
    }

    public normalizeVaseSettings(next: Partial<VaseSlicerSettings>): VaseSlicerSettings {
        return this.getMergedSettings(next);
    }

    public generateVaseGcode(next: Partial<VaseSlicerSettings>, pipeline?: ResolvedPipelineStep[]): VaseSliceResult {
        const settings = this.getMergedSettings(next);
        const result = this.executeVaseSlice(settings, pipeline);
        return {
            settings: result.settings,
            toolpath: result.toolpath,
            gcode: result.gcode,
            warnings: result.warnings,
        };
    }

    public async generateVaseGcodeWithProgress(
        next: Partial<VaseSlicerSettings>,
        onProgress?: SliceProgressReporter,
        pipeline?: ResolvedPipelineStep[],
    ): Promise<VaseSliceResult> {
        const settings = this.getMergedSettings(next);
        const result = await this.executeVaseSliceAsync(settings, onProgress, pipeline);
        return {
            settings: result.settings,
            toolpath: result.toolpath,
            gcode: result.gcode,
            warnings: result.warnings,
        };
    }

    public benchmarkVaseGcode(
        next: Partial<VaseSlicerSettings>,
        iterations: number,
        warmupRuns = 1,
        pipeline?: ResolvedPipelineStep[],
    ): VaseSliceBenchmarkResult {
        const settings = this.getMergedSettings(next);
        const measuredRunCount = clampInt(iterations, 1, 20);
        const warmupRunCount = clampInt(warmupRuns, 0, 10);
        const totalRunCount = measuredRunCount + warmupRunCount;
        const runs: VaseSliceBenchmarkRun[] = [];
        let lastResult: VaseSliceResult | null = null;

        for (let runIndex = 0; runIndex < totalRunCount; runIndex++) {
            const result = this.executeVaseSlice(settings, pipeline);
            lastResult = {
                settings: result.settings,
                toolpath: result.toolpath,
                gcode: result.gcode,
                warnings: result.warnings,
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

    public async generateVaseBaseToolpathWithProgress(
        next: Partial<VaseSlicerSettings>,
        onProgress?: SliceProgressReporter,
    ): Promise<VaseSliceBaseResult> {
        const settings = this.getMergedSettings(next);
        const baseToolpath = await this.executeVaseBaseSliceAsync(settings, onProgress);
        return {
            settings,
            baseToolpath,
            warnings: baseToolpath.warnings ?? [],
        };
    }

    public generateVaseGcodeFromBaseToolpath(
        baseToolpath: VaseBaseToolpath,
        next: Partial<VaseSlicerSettings>,
        pipeline?: ResolvedPipelineStep[],
        extraHeaderLines?: string[],
    ): VaseSliceResult {
        const settings = this.getMergedSettings(next);
        // The base toolpath already fixed its contour density; keep the
        // settings copy consistent for pipeline scripts and G-code metadata.
        settings.pointsPerLayer = baseToolpath.pointsPerLayer;
        const warnings = baseToolpath.warnings ?? [];
        const finalized = this.finalizeSpiralToolpath(baseToolpath, settings, pipeline);
        const gcode = this.buildGcode(finalized, settings, [
            ...(extraHeaderLines ?? []),
            ...warnings.map((warning) => `Slicer warning: ${warning}`),
        ]);
        return {
            settings,
            toolpath: finalized,
            gcode,
            warnings,
        };
    }

    public getLastSliceDebugSnapshot(): SliceDebugSnapshot | null {
        return this.lastSliceDebugSnapshot;
    }

    private executeVaseSlice(
        settings: VaseSlicerSettings,
        pipeline?: ResolvedPipelineStep[],
    ): VaseSliceExecution {
        this.lastSliceDebugSnapshot = null;
        const startTime = performance.now();
        const sampled = this.sampleSliceContoursGpu(settings);
        const contourSamplingEndTime = performance.now();
        const baseToolpath = settings.slicerMode === 'cylindrical'
            ? this.buildCylindricalSpiralBaseToolpath(sampled.layers, settings)
            : this.buildPlanarSpiralBaseToolpath(sampled.layers, settings);
        const toolpath = this.finalizeSpiralToolpath(baseToolpath, settings, pipeline);
        const toolpathEndTime = performance.now();
        const warnings = [...sampled.warnings, ...(baseToolpath.warnings ?? [])];
        const gcode = this.buildGcode(toolpath, settings, warnings.map((warning) => `Slicer warning: ${warning}`));
        const endTime = performance.now();

        return {
            settings,
            toolpath,
            gcode,
            warnings,
            timings: {
                contourSamplingMs: contourSamplingEndTime - startTime,
                toolpathBuildMs: toolpathEndTime - contourSamplingEndTime,
                gcodeBuildMs: endTime - toolpathEndTime,
                totalMs: endTime - startTime,
            },
        };
    }

    private async executeVaseSliceAsync(
        settings: VaseSlicerSettings,
        onProgress?: SliceProgressReporter,
        pipeline?: ResolvedPipelineStep[],
    ): Promise<VaseSliceExecution> {
        this.lastSliceDebugSnapshot = null;
        reportSliceProgress(onProgress, 'preparing', 0, 1, 0.0, 'Preparing slicer settings...');
        await this.yieldToMainThread();

        const startTime = performance.now();
        const sampled = await this.sampleSliceContoursGpuAsync(settings, onProgress);
        const contourSamplingEndTime = performance.now();

        reportSliceProgress(onProgress, 'toolpath', 0, 1, 0.78, `Building ${settings.slicerMode} spiral toolpath...`);
        await this.yieldToMainThread();
        const baseToolpath = settings.slicerMode === 'cylindrical'
            ? this.buildCylindricalSpiralBaseToolpath(sampled.layers, settings)
            : this.buildPlanarSpiralBaseToolpath(sampled.layers, settings);
        const toolpath = this.finalizeSpiralToolpath(baseToolpath, settings, pipeline);
        const toolpathEndTime = performance.now();

        reportSliceProgress(onProgress, 'gcode', 0, 1, 0.92, 'Encoding G-code...');
        await this.yieldToMainThread();
        const warnings = [...sampled.warnings, ...(baseToolpath.warnings ?? [])];
        const gcode = this.buildGcode(toolpath, settings, warnings.map((warning) => `Slicer warning: ${warning}`));
        const endTime = performance.now();

        reportSliceProgress(onProgress, 'finalizing', 1, 1, 1.0, 'Finalizing export...');

        return {
            settings,
            toolpath,
            gcode,
            warnings,
            timings: {
                contourSamplingMs: contourSamplingEndTime - startTime,
                toolpathBuildMs: toolpathEndTime - contourSamplingEndTime,
                gcodeBuildMs: endTime - toolpathEndTime,
                totalMs: endTime - startTime,
            },
        };
    }

    private async executeVaseBaseSliceAsync(
        settings: VaseSlicerSettings,
        onProgress?: SliceProgressReporter,
    ): Promise<VaseBaseToolpath> {
        this.lastSliceDebugSnapshot = null;
        reportSliceProgress(onProgress, 'preparing', 0, 1, 0.0, 'Preparing slicer settings...');
        await this.yieldToMainThread();

        const sampled = await this.sampleSliceContoursGpuAsync(settings, onProgress);
        reportSliceProgress(onProgress, 'toolpath', 0, 1, 0.78, `Building ${settings.slicerMode} spiral toolpath...`);
        await this.yieldToMainThread();

        const baseToolpath = settings.slicerMode === 'cylindrical'
            ? this.buildCylindricalSpiralBaseToolpath(sampled.layers, settings)
            : this.buildPlanarSpiralBaseToolpath(sampled.layers, settings);
        baseToolpath.warnings = [...sampled.warnings, ...(baseToolpath.warnings ?? [])];

        reportSliceProgress(onProgress, 'finalizing', 1, 1, 1.0, 'Toolpath ready for export.');
        return baseToolpath;
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
        merged.targetSegmentMm = clamp(merged.targetSegmentMm, 0.05, 2.0);
        merged.pointsPerLayer = clampInt(merged.pointsPerLayer, 48, 4096);
        merged.maxRadius = clamp(merged.maxRadius, 0.1, 3.0);
        merged.hitEpsilon = clamp(merged.hitEpsilon, 0.0001, 0.02);
        merged.sliceIsoSnapFactor = clamp(merged.sliceIsoSnapFactor, 0.0, 4.0);
        merged.lineWidth = clamp(merged.lineWidth, 0.2, 1.2);
        merged.firstLayerLineWidth = clamp(merged.firstLayerLineWidth, 0.2, 1.2);
        merged.filamentDiameter = clamp(merged.filamentDiameter, 1.0, 3.0);
        merged.printSpeedMmPerSec = clamp(merged.printSpeedMmPerSec, 5, 200);
        merged.firstLayerPrintSpeedMmPerSec = clamp(merged.firstLayerPrintSpeedMmPerSec, 5, merged.printSpeedMmPerSec);
        merged.minLayerTimeSec = clamp(merged.minLayerTimeSec, 0, 120);
        merged.travelSpeedMmPerSec = clamp(merged.travelSpeedMmPerSec, 10, 300);
        merged.flowRate = clamp(merged.flowRate, 0.01, 5.0);
        merged.moveMergeMinMoveMm = clamp(merged.moveMergeMinMoveMm, 0.005, 1.0);
        merged.moveMergeMaxDeviationMm = clamp(merged.moveMergeMaxDeviationMm, 0.001, 0.5);
        merged.moveMergeMaxTurnDeg = clamp(merged.moveMergeMaxTurnDeg, 0.5, 45);
        merged.moveMergeKeepStride = clampInt(merged.moveMergeKeepStride, 1, 200);
        merged.retractMm = clamp(merged.retractMm, 0, 10);
        merged.retractSpeedMmPerSec = clamp(merged.retractSpeedMmPerSec, 5, 80);
        merged.primeMm = clamp(merged.primeMm, 0, 5);
        merged.brimWidthMm = clamp(merged.brimWidthMm, 0, 30);
        merged.brimGapMm = clamp(merged.brimGapMm, 0, 5);
        merged.enableContourAlignment = Boolean(merged.enableContourAlignment);
        merged.enableMoveMerging = Boolean(merged.enableMoveMerging);
        if (merged.maxY <= merged.minY) {
            merged.maxY = merged.minY + merged.layerHeight;
        }

        return merged;
    }

    private sampleSliceContoursGpu(settings: VaseSlicerSettings): SampledSliceContours {
        const job = this.prepareSliceJob(settings);
        const rawLayers: SliceContourLayer[] = [];
        const layerStats = createSliceLayerWarningStats();

        for (let layerIndex = 0; layerIndex < job.layerCount; layerIndex += job.batchCapacity) {
            this.sampleSliceBatchInto(rawLayers, settings, job, layerIndex, layerStats);
        }

        return this.finalizeSliceLayers(rawLayers, settings, [...job.warnings, ...summarizeSliceLayerWarnings(layerStats)]);
    }

    private async sampleSliceContoursGpuAsync(
        settings: VaseSlicerSettings,
        onProgress?: SliceProgressReporter
    ): Promise<SampledSliceContours> {
        const job = this.prepareSliceJob(settings);
        const rawLayers: SliceContourLayer[] = [];
        const layerStats = createSliceLayerWarningStats();

        reportSliceProgress(onProgress, 'sampling', 0, job.layerCount, 0.02, `Sampling signed-distance field (${job.layerCount} layers)...`);

        const reportBatchProgress = () => {
            const completedLayers = Math.min(job.layerCount, rawLayers.length);
            const samplingRatio = job.layerCount > 0 ? completedLayers / job.layerCount : 1;
            const overall = 0.02 + samplingRatio * 0.76;
            reportSliceProgress(
                onProgress,
                'sampling',
                completedLayers,
                job.layerCount,
                overall,
                `Extracted contours for ${completedLayers}/${job.layerCount} layers...`
            );
        };

        // Pipelined: batch k+1's draw+readback are enqueued before batch k is
        // consumed, so contour extraction overlaps the GPU instead of
        // stalling on readPixels (WebGL2; WebGL1 degrades to serial).
        let pending: SliceGpuPendingBatch | null = null;
        for (let layerIndex = 0; layerIndex < job.layerCount; layerIndex += job.batchCapacity) {
            const batchLayerCount = Math.min(job.batchCapacity, job.layerCount - layerIndex);
            const next = this.issueSliceFieldBatch(
                settings,
                job.bounds,
                job.gridSize,
                this.getSliceSampleY(settings, layerIndex),
                job.sliceYStep,
                batchLayerCount,
            );

            if (pending) {
                await this.waitForPendingBatch(pending);
                for (const batchResult of this.readPendingBatch(pending)) {
                    rawLayers.push(this.extractSliceLayer(batchResult, job, settings, rawLayers.length, layerStats));
                }
                reportBatchProgress();
                await this.yieldToMainThread();
            }

            pending = next;
        }

        if (pending) {
            await this.waitForPendingBatch(pending);
            for (const batchResult of this.readPendingBatch(pending)) {
                rawLayers.push(this.extractSliceLayer(batchResult, job, settings, rawLayers.length, layerStats));
            }
            reportBatchProgress();
        }

        return this.finalizeSliceLayers(rawLayers, settings, [...job.warnings, ...summarizeSliceLayerWarnings(layerStats)]);
    }

    /** Samples one GPU batch and appends the extracted per-layer contours. */
    private sampleSliceBatchInto(
        rawLayers: SliceContourLayer[],
        settings: VaseSlicerSettings,
        job: SliceJob,
        layerIndex: number,
        layerStats: SliceLayerWarningStats,
    ): void {
        const batchLayerCount = Math.min(job.batchCapacity, job.layerCount - layerIndex);
        const batchResults = this.sampleSignedDistanceFieldGpuBatch(
            settings,
            job.bounds,
            job.gridSize,
            this.getSliceSampleY(settings, layerIndex),
            job.sliceYStep,
            batchLayerCount,
        );

        for (const batchResult of batchResults) {
            rawLayers.push(this.extractSliceLayer(batchResult, job, settings, rawLayers.length, layerStats));
        }
    }

    private prepareSliceJob(settings: VaseSlicerSettings): SliceJob {
        const modelHeightMm = this.getModelHeightMm(settings);
        const layerCount = Math.max(2, Math.floor(modelHeightMm / settings.layerHeight));
        const searchWindow = this.getSliceBounds(settings);
        const fit = this.fitSliceBounds(settings, layerCount, searchWindow);
        const maxGridSize = this.getMaxSliceGridSize();
        const sliceSpanMm = Math.max(fit.bounds.maxX - fit.bounds.minX, fit.bounds.maxZ - fit.bounds.minZ) * settings.modelScale;
        // Grid pitch at half the target segment length resolves every feature
        // the final contour resample can keep.
        const gridPitchMm = Math.max(0.02, settings.targetSegmentMm * 0.5);
        const gridSize = clampInt(Math.ceil(sliceSpanMm / gridPitchMm) + 1, 32, maxGridSize);

        return {
            layerCount,
            bounds: fit.bounds,
            gridSize,
            batchCapacity: this.getSliceBatchCapacity(gridSize),
            sliceYStep: settings.layerHeight / settings.modelScale,
            warnings: fit.warnings,
        };
    }

    /**
     * Coarse GPU pre-pass over the ±maxRadius search window that shrinks the
     * slicing bounds to the model's actual XZ extent. Keeps grid resolution
     * where the model is instead of spending it on empty window, and supports
     * off-center models. Falls back to the full window when nothing is found.
     */
    private fitSliceBounds(
        settings: VaseSlicerSettings,
        layerCount: number,
        window: SliceBounds,
    ): { bounds: SliceBounds; warnings: string[] } {
        const warnings: string[] = [];
        const coarseGrid = 64;
        const coarseLayerCount = Math.min(24, layerCount);
        const firstY = this.getSliceSampleY(settings, 0);
        const lastY = this.getSliceSampleY(settings, layerCount - 1);
        const stepY = coarseLayerCount > 1 ? (lastY - firstY) / (coarseLayerCount - 1) : 0;

        const batches = this.sampleSignedDistanceFieldGpuBatch(settings, window, coarseGrid, firstY, stepY, coarseLayerCount);

        const cellX = (window.maxX - window.minX) / (coarseGrid - 1);
        const cellZ = (window.maxZ - window.minZ) / (coarseGrid - 1);
        // Treat any sample within ~a cell of the surface as occupied so thin
        // walls narrower than the coarse pitch cannot slip between samples
        // (the field is a signed distance, so proximity is reliable).
        const nearSurface = Math.hypot(cellX, cellZ) * 1.25;
        let minCol = coarseGrid;
        let maxCol = -1;
        let minRow = coarseGrid;
        let maxRow = -1;
        let insideTouchesEdge = false;
        for (const batch of batches) {
            const field = batch.field;
            for (let row = 0; row < coarseGrid; row++) {
                const base = row * coarseGrid;
                for (let col = 0; col < coarseGrid; col++) {
                    const value = field[base + col];
                    if (value <= nearSurface) {
                        if (col < minCol) minCol = col;
                        if (col > maxCol) maxCol = col;
                        if (row < minRow) minRow = row;
                        if (row > maxRow) maxRow = row;
                        if (value <= 0 && (col === 0 || row === 0 || col === coarseGrid - 1 || row === coarseGrid - 1)) {
                            insideTouchesEdge = true;
                        }
                    }
                }
            }
        }

        if (maxCol < 0) {
            // Nothing near the surface anywhere; keep the full window so the
            // fine pass produces its own diagnostics.
            return { bounds: window, warnings };
        }

        // Only warn when the interior actually reaches the window boundary;
        // merely being near it is normal for scenes whose maxRadius hugs the
        // model.
        if (insideTouchesEdge) {
            warnings.push('Model reaches the edge of the slice window; geometry is being clipped. Increase "Slice half-extent" or re-center the model.');
        }

        const margin = (2 * Math.max(cellX, cellZ)) + (settings.lineWidth / Math.max(settings.modelScale, 1e-6));
        const minX = Math.max(window.minX, window.minX + (minCol * cellX) - margin);
        const maxX = Math.min(window.maxX, window.minX + (maxCol * cellX) + margin);
        const minZ = Math.max(window.minZ, window.minZ + (minRow * cellZ) - margin);
        const maxZ = Math.min(window.maxZ, window.minZ + (maxRow * cellZ) + margin);

        // Square bounds centered on the fit keep the sampling pitch isotropic.
        const halfSpan = Math.max(maxX - minX, maxZ - minZ) * 0.5;
        const centerX = (minX + maxX) * 0.5;
        const centerZ = (minZ + maxZ) * 0.5;
        return {
            bounds: {
                minX: Math.max(window.minX, centerX - halfSpan),
                maxX: Math.min(window.maxX, centerX + halfSpan),
                minZ: Math.max(window.minZ, centerZ - halfSpan),
                maxZ: Math.min(window.maxZ, centerZ + halfSpan),
            },
            warnings,
        };
    }

    private extractSliceLayer(
        batchResult: SliceGpuBatchResult,
        job: SliceJob,
        settings: VaseSlicerSettings,
        acceptedLayerCount: number,
        layerStats: SliceLayerWarningStats,
    ): SliceContourLayer {
        const contourExtraction = extractContoursFromField(batchResult.field, job.gridSize, job.bounds);
        const contourSelection = selectPrimaryContour(
            contourExtraction.closedContours,
            job.bounds,
            job.gridSize,
            settings,
        );

        if (!contourSelection.ok) {
            this.lastSliceDebugSnapshot = buildSliceDebugSnapshot(
                batchResult.field,
                job.bounds,
                job.gridSize,
                batchResult.sampleY,
                job.layerCount,
                acceptedLayerCount,
                settings,
                contourSelection,
                contourExtraction,
            );
            throw new Error(buildContourFailureMessage(
                contourSelection,
                contourExtraction,
                job.bounds,
                job.gridSize,
                settings,
                batchResult.sampleY,
                acceptedLayerCount,
                job.layerCount,
            ));
        }

        if (contourSelection.ignoredHoleCount > 0) {
            layerStats.holeLayers += 1;
            layerStats.maxHoleCount = Math.max(layerStats.maxHoleCount, contourSelection.ignoredHoleCount);
        }
        if (contourSelection.droppedLoopCount > 0) {
            layerStats.droppedLayers += 1;
            layerStats.droppedLargestAreaMm2 = Math.max(layerStats.droppedLargestAreaMm2, contourSelection.droppedLargestAreaMm2);
        }
        if (contourSelection.skippedIslandCount > 0) {
            layerStats.islandLayers += 1;
            layerStats.islandLargestAreaMm2 = Math.max(layerStats.islandLargestAreaMm2, contourSelection.skippedIslandLargestAreaMm2);
        }

        return {
            sampleY: batchResult.sampleY,
            contour: contourSelection.contour,
        };
    }

    private finalizeSliceLayers(
        rawLayers: SliceContourLayer[],
        settings: VaseSlicerSettings,
        warnings: string[],
    ): SampledSliceContours {
        if (rawLayers.length < 2) {
            throw new Error('Planar contour slicer produced too few valid slices.');
        }

        // Single quality knob: derive the per-layer point count from the
        // largest perimeter so segments come out near targetSegmentMm on every
        // layer. Mutates the merged settings copy so downstream consumers and
        // G-code metadata report the derived value.
        let maxPerimeterMm = 0;
        for (const layer of rawLayers) {
            maxPerimeterMm = Math.max(maxPerimeterMm, contourPerimeter(layer.contour) * settings.modelScale);
        }
        settings.pointsPerLayer = clampInt(Math.ceil(maxPerimeterMm / settings.targetSegmentMm), 48, 4096);

        const layers = rawLayers.map((layer) => ({
            sampleY: layer.sampleY,
            contour: this.buildPrintableContour(layer.contour, settings),
        }));

        if (settings.enableContourAlignment) {
            this.alignContourLayers(layers);
        }

        return { layers, warnings };
    }

    private async yieldToMainThread(): Promise<void> {
        await new Promise<void>((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
                return;
            }

            setTimeout(() => resolve(), 0);
        });
    }

    private sampleSignedDistanceFieldGpuBatch(
        settings: VaseSlicerSettings,
        bounds: SliceBounds,
        gridSize: number,
        firstSampleY: number,
        sliceYStep: number,
        batchLayerCount: number,
    ): SliceGpuBatchResult[] {
        return this.readPendingBatch(
            this.issueSliceFieldBatch(settings, bounds, gridSize, firstSampleY, sliceYStep, batchLayerCount),
        );
    }

    private issueSliceFieldBatch(
        settings: VaseSlicerSettings,
        bounds: SliceBounds,
        gridSize: number,
        firstSampleY: number,
        sliceYStep: number,
        batchLayerCount: number,
    ): SliceGpuPendingBatch {
        const width = gridSize;
        const height = gridSize * batchLayerCount;
        const distanceRange = Math.max(
            settings.hitEpsilon * 8.0,
            Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
        );

        this.ensureRenderTarget(width, height);
        this.ensureSlicerProgram();
        this.ensureQuadBuffer();

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
        this.setUniform1f('uLineWidth', settings.lineWidth);
        this.setUniform1f('uFirstLayerLineWidth', settings.firstLayerLineWidth);
        this.setUniform2f('uSliceMin', bounds.minX, bounds.minZ);
        this.setUniform2f('uSliceMax', bounds.maxX, bounds.maxZ);
        this.setUniform1f('uSliceY', firstSampleY);
        this.setUniform1f('uSliceYStep', sliceYStep);
        this.setUniform1f('uSliceGridSize', gridSize);
        this.setUniform1f('uDistanceRange', distanceRange);
        this.setUniform1f('uIsoSnapEpsilon', settings.hitEpsilon * settings.sliceIsoSnapFactor);

        for (const control of this.sceneControlDefinitions) {
            this.setUniform1f(control.uniform, this.sceneControlValues[control.key] ?? control.defaultValue);
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
    private async waitForPendingBatch(pending: SliceGpuPendingBatch): Promise<void> {
        const gl2 = this.getGl2();
        if (!gl2 || !pending.fence) {
            return;
        }

        for (;;) {
            const status = gl2.clientWaitSync(pending.fence, 0, 0);
            if (status === gl2.ALREADY_SIGNALED || status === gl2.CONDITION_SATISFIED || status === gl2.WAIT_FAILED) {
                return;
            }
            await this.yieldToMainThread();
        }
    }

    private readPendingBatch(pending: SliceGpuPendingBatch): SliceGpuBatchResult[] {
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
            gl2.deleteBuffer(pending.pbo);
            if (pending.fence) {
                gl2.deleteSync(pending.fence);
            }
        }

        return this.decodeSliceBatchFields(
            pixels,
            pending.gridSize,
            pending.gridSize,
            pending.batchLayerCount,
            pending.distanceRange,
            pending.firstSampleY,
            pending.sliceYStep,
        );
    }

    private buildPlanarSpiralBaseToolpath(
        contourLayers: SliceContourLayer[],
        settings: VaseSlicerSettings,
    ): VaseBaseToolpath {
        return this.buildInterpolatedSpiralBaseToolpath(contourLayers, settings);
    }

    private buildCylindricalSpiralBaseToolpath(
        contourLayers: SliceContourLayer[],
        settings: VaseSlicerSettings,
    ): VaseBaseToolpath {
        let bridgedRayCount = 0;
        let bridgedLayerCount = 0;
        const cylindricalLayers: SliceContourLayer[] = contourLayers.map((layer, layerIndex) => {
            const sampled = this.sampleCylindricalContour(layer.contour, settings.pointsPerLayer, layerIndex);
            if (sampled.contour.length !== settings.pointsPerLayer) {
                throw new Error(`Cylindrical slicer failed to sample layer ${layerIndex + 1}.`);
            }
            if (sampled.bridgedRays > 0) {
                bridgedRayCount += sampled.bridgedRays;
                bridgedLayerCount += 1;
            }

            return {
                sampleY: layer.sampleY,
                contour: sampled.contour,
            };
        });

        const baseToolpath = this.buildInterpolatedSpiralBaseToolpath(cylindricalLayers, settings);
        if (bridgedLayerCount > 0) {
            baseToolpath.warnings = [
                `Cylindrical mode bridged reentrant geometry on ${bridgedRayCount} ray${bridgedRayCount === 1 ? '' : 's'} across ${bridgedLayerCount} layer${bridgedLayerCount === 1 ? '' : 's'} - the radial resample keeps only the outermost surface. Use planar mode for exact contours.`,
            ];
        }
        return baseToolpath;
    }

    private buildInterpolatedSpiralBaseToolpath(
        contourLayers: SliceContourLayer[],
        settings: VaseSlicerSettings,
    ): VaseBaseToolpath {
        const layers = contourLayers.length;
        const perLayer = settings.pointsPerLayer;
        // The helix tops out at layerHeight*layers, which stays at or below the
        // model height because the layer count is floored. No Y clamping: a
        // clamped tail would flatten part of the last revolution at the top
        // and then get traced again by the cap (double extrusion at the rim).
        const printedHeightMm = settings.layerHeight * layers;

        const firstLayerExtrusionPerMm = calculateExtrusionPerMm(settings, settings.firstLayerLineWidth);
        const extrusionPerMm = calculateExtrusionPerMm(settings, settings.lineWidth);

        const points: ToolpathPoint[] = [];
        let eAcc = 0;
        let prevX = 0;
        let prevY = 0;
        let prevZ = 0;

        // Layer 0 stays flat at Y = layerHeight (first-layer adhesion).
        // Layers 1+ form a single continuous helix: each sample step advances
        // Y by layerHeight/perLayer and the contour blend by 1/perLayer, so
        // the wrap from k=perLayer-1 of revolution N to k=0 of revolution N+1
        // is a uniform perimeter step with no flat-Y segment and no XZ
        // jump-back.
        const totalPoints = layers * perLayer;
        for (let n = 0; n < totalPoints; n++) {
            const layerIndex = Math.floor(n / perLayer);
            const k = n % perLayer;

            let sampleX: number;
            let sampleZ: number;
            let y: number;
            let segmentExtrusionPerMm: number;

            if (layerIndex === 0) {
                const contour = contourLayers[0].contour;
                const point = contour[k] ?? contour[contour.length - 1];
                sampleX = point.x;
                sampleZ = point.z;
                y = settings.layerHeight;
                segmentExtrusionPerMm = firstLayerExtrusionPerMm;
            } else {
                // spiralT advances by 1/perLayer per sample; at n=perLayer it is 1/perLayer
                // (one sample-step into revolution 1), and at n=totalPoints-1 it is layers-1.
                const spiralT = (n - perLayer + 1) / perLayer;
                const layerLow = Math.min(Math.max(0, Math.floor(spiralT)), layers - 2);
                const layerHigh = Math.min(layerLow + 1, layers - 1);
                const blend = spiralT - layerLow;
                const lowContour = contourLayers[layerLow].contour;
                const highContour = contourLayers[layerHigh].contour;
                const lowPoint = lowContour[k] ?? lowContour[lowContour.length - 1];
                const highPoint = highContour[k] ?? highContour[highContour.length - 1];
                sampleX = lerp(lowPoint.x, highPoint.x, blend);
                sampleZ = lerp(lowPoint.z, highPoint.z, blend);
                y = settings.layerHeight * (1 + spiralT);
                segmentExtrusionPerMm = layerIndex === 1
                    ? lerp(firstLayerExtrusionPerMm, extrusionPerMm, blend)
                    : extrusionPerMm;
            }

            const x = settings.centerX + (sampleX * settings.modelScale);
            const z = settings.centerZ + (sampleZ * settings.modelScale);

            if (points.length > 0) {
                const segment = Math.hypot(x - prevX, y - prevY, z - prevZ);
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

        // Top cap: one revolution at constant top Y, tracing the actual top
        // contour (not the helix-interpolated last revolution, which would pull
        // the path back toward the previous layer). Extrusion ramps from full
        // down to 0 across the revolution so the print finishes evenly without
        // a dimple. The cap is tagged with its own layer index so
        // applyMinimumLayerTime treats it as a single revolution and gives it
        // the same speed as the helix layer below — not 2× faster from sharing
        // a group.
        if (layers >= 2 && perLayer >= 3) {
            const topContour = contourLayers[layers - 1].contour;
            const topY = printedHeightMm;
            const topLayerIndex = layers;
            const divisor = Math.max(1, perLayer - 1);
            for (let k = 0; k < perLayer; k++) {
                const sample = topContour[k] ?? topContour[topContour.length - 1];
                const x = settings.centerX + (sample.x * settings.modelScale);
                const z = settings.centerZ + (sample.z * settings.modelScale);
                const progress = k / divisor;
                const extrusionScale = Math.max(0, Math.pow(1 - progress, 1.2));
                const segment = Math.hypot(x - prevX, topY - prevY, z - prevZ);
                eAcc += segment * extrusionPerMm * extrusionScale;
                points.push({
                    x,
                    y: topY,
                    z,
                    e: eAcc,
                    speedMmPerSec: settings.printSpeedMmPerSec,
                    layer: topLayerIndex,
                    extrusionScale,
                });
                prevX = x;
                prevY = topY;
                prevZ = z;
            }
        }

        return {
            points,
            layerCount: layers,
            pointsPerLayer: perLayer,
            estimatedHeight: printedHeightMm,
        };
    }

    private finalizeSpiralToolpath(
        baseToolpath: VaseBaseToolpath,
        settings: VaseSlicerSettings,
        pipeline?: ResolvedPipelineStep[],
    ): VaseToolpath {
        const basePoints = baseToolpath.points.map((point) => ({ ...point }));
        this.attachSceneFieldsToPoints(basePoints, settings);
        const postprocessed = applyToolpathPipeline(basePoints, settings, pipeline ?? []);
        const optimizedPoints = this.optimizeToolpath(postprocessed.points, settings);
        this.recomputeExtrusion(optimizedPoints, settings);
        this.applyMinimumLayerTime(optimizedPoints, settings);

        return {
            points: optimizedPoints,
            layerCount: baseToolpath.layerCount,
            pointsPerLayer: baseToolpath.pointsPerLayer,
            estimatedHeight: baseToolpath.estimatedHeight,
            postprocessSummaries: postprocessed.summaries,
        };
    }

    private sampleCylindricalContour(
        contour: SlicePoint[],
        pointCount: number,
        layerIndex: number,
    ): { contour: SlicePoint[]; bridgedRays: number } {
        const radial: SlicePoint[] = [];
        const step = (Math.PI * 2.0) / Math.max(1, pointCount);
        let bridgedRays = 0;

        for (let i = 0; i < pointCount; i++) {
            const angle = i * step;
            const directionX = Math.cos(angle);
            const directionZ = Math.sin(angle);
            const intersection = this.rayIntersectContourOuter(contour, directionX, directionZ);
            if (!intersection) {
                throw new Error(
                    `Cylindrical mode requires the slice contour to enclose the center axis. Layer ${layerIndex + 1}: the ray at ${((angle * 180) / Math.PI).toFixed(0)} deg found no boundary - re-center the model or use planar mode.`
                );
            }
            // An enclosing contour crosses an outbound ray an odd number of
            // times; three or more means reentrant geometry that the
            // outermost-hit resample silently bridges.
            if (intersection.crossings >= 3) {
                bridgedRays++;
            }
            radial.push(intersection.point);
        }

        return { contour: radial, bridgedRays };
    }

    private rayIntersectContourOuter(
        contour: SlicePoint[],
        directionX: number,
        directionZ: number,
    ): { point: SlicePoint; crossings: number } | null {
        let bestDistance = -1;
        let crossings = 0;

        for (let i = 0; i < contour.length; i++) {
            const a = contour[i];
            const b = contour[(i + 1) % contour.length];
            const edgeX = b.x - a.x;
            const edgeZ = b.z - a.z;
            const cross = (directionX * edgeZ) - (directionZ * edgeX);
            if (Math.abs(cross) < 1e-8) {
                continue;
            }

            const t = ((a.x * edgeZ) - (a.z * edgeX)) / cross;
            const u = ((a.x * directionZ) - (a.z * directionX)) / cross;
            if (t < 0 || u < 0 || u > 1) {
                continue;
            }

            crossings++;
            if (t > bestDistance) {
                bestDistance = t;
            }
        }

        if (bestDistance < 0) {
            return null;
        }

        return {
            point: {
                x: directionX * bestDistance,
                z: directionZ * bestDistance,
            },
            crossings,
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

    private attachSceneFieldsToPoints(points: ToolpathPoint[], settings: VaseSlicerSettings): void {
        if (points.length === 0) {
            return;
        }

        const fieldDefinitions = getSceneFieldDefinitions();
        if (fieldDefinitions.length === 0) {
            return;
        }

        const sampledFields = this.sampleSceneFieldsGpu(points, settings, fieldDefinitions);
        for (let index = 0; index < points.length; index++) {
            const pointFields = sampledFields[index];
            if (pointFields && Object.keys(pointFields).length > 0) {
                points[index].sceneFields = pointFields;
            }
        }
    }

    private sampleSceneFieldsGpu(
        points: ToolpathPoint[],
        settings: VaseSlicerSettings,
        fieldDefinitions: SceneFieldDefinition[],
    ): Array<Record<string, SceneFieldValue>> {
        const perPointFields = Array.from({ length: points.length }, () => ({} as Record<string, SceneFieldValue>));

        for (const field of fieldDefinitions) {
            const componentCount = getSceneFieldComponentCount(field);
            const componentSamples = new Array<number[]>(componentCount);

            for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
                componentSamples[componentIndex] = this.sampleSceneFieldComponentGpu(points, settings, field, componentIndex);
            }

            for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
                const components = componentSamples.map((samples) => samples[pointIndex] ?? 0);
                perPointFields[pointIndex][field.key] = buildSceneFieldValue(field, components);
            }
        }

        return perPointFields;
    }

    private sampleSceneFieldComponentGpu(
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
        const program = this.createProgram(
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

    private getSliceBounds(settings: VaseSlicerSettings): SliceBounds {
        const extent = Math.max(settings.maxRadius, settings.hitEpsilon * 8.0);
        return {
            minX: -extent,
            maxX: extent,
            minZ: -extent,
            maxZ: extent,
        };
    }

    private getSliceSampleY(settings: VaseSlicerSettings, layerIndex: number): number {
        // Contour j is deposited while the helix climbs from layerHeight*j to
        // layerHeight*(j+1); sample the SDF at the mid-height of that band so
        // printed geometry lines up with the field instead of lagging behind
        // it by up to a layer.
        const midHeightMm = settings.layerHeight * (layerIndex + 0.5);
        return settings.minY + (midHeightMm / settings.modelScale);
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
        if (!settings.enableMoveMerging) {
            return points;
        }

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
        // Points dropped since the last kept point. Every merge decision
        // re-checks all of them against the candidate chord so accumulated
        // deviation stays bounded by maxDeviationMm relative to the original
        // path, not just to the local point triple.
        const dropped: ToolpathPoint[] = [];

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

            const speedStable =
                Math.abs(prev.speedMmPerSec - cur.speedMmPerSec) <= 1e-3 &&
                Math.abs(cur.speedMmPerSec - next.speedMmPerSec) <= 1e-3;
            const prevExtrusionScale = prev.extrusionScale ?? 1;
            const curExtrusionScale = cur.extrusionScale ?? 1;
            const nextExtrusionScale = next.extrusionScale ?? 1;
            const extrusionStable =
                Math.abs(prevExtrusionScale - curExtrusionScale) <= 1e-4 &&
                Math.abs(curExtrusionScale - nextExtrusionScale) <= 1e-4;

            let canMerge =
                (isTinyMove || isSmoothEnough) &&
                speedStable &&
                extrusionStable &&
                dropped.length < keepStride;

            if (canMerge && dropped.length > 0) {
                // Tiny-move runs may legitimately wander up to the tiny-move
                // radius itself; smooth runs are held to the deviation limit.
                const chordBound = isTinyMove && !isSmoothEnough
                    ? Math.max(maxDeviationMm, minMoveMm * 0.5)
                    : maxDeviationMm;
                for (const droppedPoint of dropped) {
                    if (pointLineDistance3(droppedPoint, prev, next) > chordBound) {
                        canMerge = false;
                        break;
                    }
                }
            }

            if (canMerge) {
                dropped.push(cur);
                continue;
            }

            out.push(cur);
            dropped.length = 0;
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
        const transitionProgress = new Array<number>(points.length).fill(0);

        let layerStart = 0;
        while (layerStart < points.length) {
            const layer = points[layerStart].layer;
            let layerEnd = layerStart + 1;
            while (layerEnd < points.length && points[layerEnd].layer === layer) {
                layerEnd++;
            }

            const divisor = Math.max(1, layerEnd - layerStart - 1);
            for (let index = layerStart; index < layerEnd; index++) {
                transitionProgress[index] = (index - layerStart) / divisor;
            }

            layerStart = layerEnd;
        }

        points[0].e = 0;
        let eAcc = 0;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const point = points[i];
            const segment = distance3(prev, point);
            const layerProgress = transitionProgress[i];
            const extrusionScale = clamp(point.extrusionScale ?? 1, 0, 16);
            const segmentExtrusionPerMm = point.layer === 0
                ? firstLayerExtrusionPerMm
                : (point.layer === 1 ? lerp(firstLayerExtrusionPerMm, extrusionPerMm, layerProgress) : extrusionPerMm);
            eAcc += segment * segmentExtrusionPerMm * extrusionScale;
            point.e = eAcc;
        }
    }

    private applyMinimumLayerTime(points: ToolpathPoint[], settings: VaseSlicerSettings): void {
        const minLayerTimeSec = settings.minLayerTimeSec;
        if (points.length < 2 || minLayerTimeSec <= 0) {
            return;
        }

        const minAllowedSpeedMmPerSec = 1.0;
        let layerStart = 0;
        while (layerStart < points.length) {
            const layer = points[layerStart].layer;
            let layerEnd = layerStart + 1;
            while (layerEnd < points.length && points[layerEnd].layer === layer) {
                layerEnd++;
            }

            if (layer === 0) {
                layerStart = layerEnd;
                continue;
            }

            const baseSpeedMmPerSec = settings.printSpeedMmPerSec;
            let layerPathLengthMm = 0;
            for (let i = layerStart + 1; i < layerEnd; i++) {
                layerPathLengthMm += distance3(points[i - 1], points[i]);
            }

            const maxSpeedForMinTime = layerPathLengthMm / minLayerTimeSec;
            const targetSpeedMmPerSec = clamp(
                Math.min(baseSpeedMmPerSec, maxSpeedForMinTime),
                minAllowedSpeedMmPerSec,
                baseSpeedMmPerSec,
            );

            for (let i = layerStart; i < layerEnd; i++) {
                points[i].speedMmPerSec = targetSpeedMmPerSec;
            }

            layerStart = layerEnd;
        }
    }

    private buildGcode(toolpath: VaseToolpath, settings: VaseSlicerSettings, extraHeaderLines?: string[]): string {
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

        const excludeObjectDefine = buildExcludeObjectDefineLine(toolpath, settings);
        if (excludeObjectDefine) {
            lines.push(excludeObjectDefine);
        }

        lines.push('; Implicit vase-mode toolpath');
        lines.push('; Generated by Implicit');
        lines.push(`; Slicer mode: ${settings.slicerMode}`);
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
        lines.push(`; Target segment length (mm): ${settings.targetSegmentMm.toFixed(3)}`);
        lines.push(`; First layer print speed (mm/s): ${settings.firstLayerPrintSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Print speed (mm/s): ${settings.printSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Minimum layer time (s): ${settings.minLayerTimeSec.toFixed(2)}`);
        lines.push(`; Travel speed (mm/s): ${settings.travelSpeedMmPerSec.toFixed(1)}`);
        lines.push(`; Brim width (mm): ${settings.brimWidthMm.toFixed(2)}`);
        lines.push(`; Brim gap (mm): ${settings.brimGapMm.toFixed(2)}`);
        lines.push(`; Iso snap factor: ${settings.sliceIsoSnapFactor.toFixed(2)}`);
        lines.push(`; Contour alignment: ${settings.enableContourAlignment ? 'on' : 'off'}`);
        lines.push(`; Move merging: ${settings.enableMoveMerging ? 'on' : 'off'}`);
        lines.push(`; First layer extrusion/mm: ${calculateExtrusionPerMm(settings, settings.firstLayerLineWidth).toFixed(5)}`);
        lines.push(`; Extrusion/mm: ${calculateExtrusionPerMm(settings, settings.lineWidth).toFixed(5)}`);
        lines.push(`; Estimated height (mm): ${toolpath.estimatedHeight.toFixed(3)}`);
        for (const summary of toolpath.postprocessSummaries ?? []) {
            lines.push(`; Postprocess step ${summary.stepIndex + 1}: ${summary.name}${summary.scriptId ? ` (${summary.scriptId})` : ''}`);
            lines.push(`; Postprocess points: ${summary.inputPointCount} -> ${summary.outputPointCount} before merge`);
            lines.push(`; Postprocess runtime (ms): ${summary.durationMs.toFixed(2)}`);
            for (const note of summary.notes) {
                lines.push(`; Postprocess note: ${note}`);
            }
        }
        for (const line of extraHeaderLines ?? []) {
            lines.push(line.startsWith(';') ? line : `; ${line}`);
        }
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
            if (settings.primeMm > 0) {
                lines.push(`G1 F${mmPerSecToFeedrate(settings.retractSpeedMmPerSec).toFixed(0)} E${settings.primeMm.toFixed(4)}`);
            }
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

        // Feedrate is modal in Marlin/Klipper and Z rarely changes on flat
        // layers; emitting them only on change trims the file by 10-20%.
        // The travel G0 above set the travel feedrate and first-layer Z.
        let modalFeedrate = mmPerSecToFeedrate(settings.travelSpeedMmPerSec).toFixed(0);
        let modalZ = Math.max(settings.layerHeight, p0.y).toFixed(3);
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
                if (layer >= toolpath.layerCount) {
                    lines.push('; FEATURE: Top surface');
                    lines.push(';TYPE:Top surface');
                } else {
                    lines.push('; FEATURE: Outer wall');
                    lines.push(';TYPE:Outer wall');
                }
            }

            const feedrate = mmPerSecToFeedrate(point.speedMmPerSec).toFixed(0);
            const zText = Math.max(0.0, point.y).toFixed(3);
            let line = 'G1';
            if (feedrate !== modalFeedrate) {
                line += ` F${feedrate}`;
                modalFeedrate = feedrate;
            }
            line += ` X${point.x.toFixed(3)} Y${point.z.toFixed(3)}`;
            if (zText !== modalZ) {
                line += ` Z${zText}`;
                modalZ = zText;
            }
            line += ` E${Math.max(0, point.e - prevPoint.e).toFixed(5)}`;
            lines.push(line);
        }

        const lastPoint = toolpath.points[toolpath.points.length - 1];

        if (settings.retractMm > 0) {
            lines.push(`G1 F${mmPerSecToFeedrate(settings.retractSpeedMmPerSec).toFixed(0)} E-${settings.retractMm.toFixed(4)}`);
        }
        lines.push('; FEATURE: Travel');
        lines.push('G0 F6000 Z' + Math.max(0.0, lastPoint.y).toFixed(3));

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

    private getSliceBatchCapacity(gridSize: number): number {
        const maxTextureSize = Math.max(1, this.getMaxTextureSize());
        const maxBatchByTexture = Math.max(1, Math.floor(maxTextureSize / Math.max(1, gridSize)));
        return Math.max(1, Math.min(SLICE_BATCH_SIZE, maxBatchByTexture));
    }

    private getMaxSliceGridSize(): number {
        return clampInt(Math.min(this.getMaxTextureSize(), MAX_SLICE_GRID_SIZE), 32, MAX_SLICE_GRID_SIZE);
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

/**
 * Marching squares over a flat row-major field. Only boundary cells (mixed
 * corner signs) pay for interpolation or allocation; the full-grid scan is a
 * tight typed-array loop. Shared cell edges are keyed by integer edge ids so
 * segment joining is exact.
 */
function extractContoursFromField(field: Float32Array, gridSize: number, bounds: SliceBounds): SliceContourExtractionDebug {
    if (gridSize < 2) {
        return {
            closedContours: [],
            openPolylines: [],
            segments: [],
        };
    }

    const segments: SliceSegment[] = [];
    const inv = 1 / (gridSize - 1);
    for (let row = 0; row < gridSize - 1; row++) {
        const rowBase = row * gridSize;
        const nextBase = rowBase + gridSize;
        const z0 = lerp(bounds.minZ, bounds.maxZ, row * inv);
        const z1 = lerp(bounds.minZ, bounds.maxZ, (row + 1) * inv);
        for (let col = 0; col < gridSize - 1; col++) {
            const bl = field[rowBase + col];
            const br = field[rowBase + col + 1];
            const tl = field[nextBase + col];
            const tr = field[nextBase + col + 1];

            const caseIndex =
                ((tl <= 0 ? 1 : 0) << 3) |
                ((tr <= 0 ? 1 : 0) << 2) |
                ((br <= 0 ? 1 : 0) << 1) |
                (bl <= 0 ? 1 : 0);
            if (caseIndex === 0 || caseIndex === 15) {
                continue;
            }

            const x0 = lerp(bounds.minX, bounds.maxX, col * inv);
            const x1 = lerp(bounds.minX, bounds.maxX, (col + 1) * inv);
            const cellSegments = extractCellSegments(gridSize, row, col, x0, x1, z0, z1, bl, br, tr, tl, caseIndex);
            for (const segment of cellSegments) {
                segments.push(segment);
            }
        }
    }

    const joined = joinSegmentsIntoContours(segments);
    return {
        closedContours: joined.closedContours,
        openPolylines: joined.openPolylines,
        segments: segments.map((segment) => ({
            ax: segment[0].point.x,
            az: segment[0].point.z,
            bx: segment[1].point.x,
            bz: segment[1].point.z,
        })),
    };
}

function extractCellSegments(
    gridSize: number,
    row: number,
    col: number,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    bl: number,
    br: number,
    tr: number,
    tl: number,
    caseIndex: number,
): SliceSegment[] {
    const center = 0.25 * (bl + br + tr + tl);
    switch (caseIndex) {
        case 0:
        case 15:
            return [];
        case 1:
            return [[
                createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
            ]];
        case 2:
            return [[
                createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
            ]];
        case 3:
            return [[
                createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
            ]];
        case 4:
            return [[
                createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
                createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
            ]];
        case 5:
            return center <= 0
                ? [[
                    createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                    createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
                ], [
                    createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                    createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
                ]]
                : [[
                    createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                    createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                ], [
                    createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
                    createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
                ]];
        case 6:
            return [[
                createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
            ]];
        case 7:
            return [[
                createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
            ]];
        case 8:
            return [[
                createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
                createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
            ]];
        case 9:
            return [[
                createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
            ]];
        case 10:
            return center <= 0
                ? [[
                    createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                    createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                ], [
                    createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
                    createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
                ]]
                : [[
                    createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                    createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
                ], [
                    createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                    createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
                ]];
        case 11:
            return [[
                createTopVertex(gridSize, row, col, x0, x1, z1, tr, tl),
                createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
            ]];
        case 12:
            return [[
                createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
            ]];
        case 13:
            return [[
                createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
                createRightVertex(gridSize, row, col, x1, z0, z1, br, tr),
            ]];
        case 14:
            return [[
                createLeftVertex(gridSize, row, col, x0, z0, z1, tl, bl),
                createBottomVertex(gridSize, row, col, x0, x1, z0, bl, br),
            ]];
        default:
            return [];
    }
}

function createBottomVertex(gridSize: number, row: number, col: number, x0: number, x1: number, z0: number, bl: number, br: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey(0, gridSize, row, col),
        interpolateIsoPoint({ x: x0, z: z0 }, bl, { x: x1, z: z0 }, br),
    );
}

function createRightVertex(gridSize: number, row: number, col: number, x1: number, z0: number, z1: number, br: number, tr: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey(1, gridSize, row, col + 1),
        interpolateIsoPoint({ x: x1, z: z0 }, br, { x: x1, z: z1 }, tr),
    );
}

function createTopVertex(gridSize: number, row: number, col: number, x0: number, x1: number, z1: number, tr: number, tl: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey(0, gridSize, row + 1, col),
        interpolateIsoPoint({ x: x1, z: z1 }, tr, { x: x0, z: z1 }, tl),
    );
}

function createLeftVertex(gridSize: number, row: number, col: number, x0: number, z0: number, z1: number, tl: number, bl: number): SliceSegmentVertex {
    return createSliceSegmentVertex(
        edgeKey(1, gridSize, row, col),
        interpolateIsoPoint({ x: x0, z: z1 }, tl, { x: x0, z: z0 }, bl),
    );
}

function createSliceSegmentVertex(key: number, point: SlicePoint): SliceSegmentVertex {
    return { key, point };
}

/** Integer id for a grid edge: axis 0 = horizontal, 1 = vertical. */
function edgeKey(axis: 0 | 1, gridSize: number, row: number, col: number): number {
    return (((row * (gridSize + 1)) + col) * 2) + axis;
}

function interpolateIsoPoint(a: SlicePoint, aValue: number, b: SlicePoint, bValue: number): SlicePoint {
    const delta = bValue - aValue;
    const t = Math.abs(delta) < 1e-8 ? 0.5 : clamp((-aValue) / delta, 0, 1);
    return {
        x: lerp(a.x, b.x, t),
        z: lerp(a.z, b.z, t),
    };
}

function joinSegmentsIntoContours(segments: SliceSegment[]): { closedContours: SlicePoint[][]; openPolylines: SlicePoint[][] } {
    if (segments.length === 0) {
        return {
            closedContours: [],
            openPolylines: [],
        };
    }

    const adjacency = new Map<number, Array<{ segmentIndex: number; endpointIndex: 0 | 1 }>>();
    const contours: SlicePoint[][] = [];
    const openPolylines: SlicePoint[][] = [];

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
            continue;
        }

        const open = dedupeOpenPolyline(contour);
        if (open.length >= 2) {
            openPolylines.push(open);
        }
    }

    return {
        closedContours: contours,
        openPolylines,
    };
}

function dedupeOpenPolyline(points: SlicePoint[]): SlicePoint[] {
    const cleaned: SlicePoint[] = [];
    for (const point of points) {
        const previous = cleaned[cleaned.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-6) {
            cleaned.push(point);
        }
    }

    return cleaned;
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

interface SliceContourSelectionOk {
    ok: true;
    contour: SlicePoint[];
    contourCount: number;
    /** Significant contours nested inside the outer wall (holes) that vase mode skips. */
    ignoredHoleCount: number;
    /** Sub-printable loops dropped by the significance filter. */
    droppedLoopCount: number;
    droppedLargestAreaMm2: number;
    /** Small disconnected islands skipped instead of failing the slice. */
    skippedIslandCount: number;
    skippedIslandLargestAreaMm2: number;
}

interface SliceContourSelectionFail {
    ok: false;
    contourCount: number;
    detail: string;
    kind: 'none' | 'islands';
}

function selectPrimaryContour(
    rawContours: SlicePoint[][],
    bounds: SliceBounds,
    gridSize: number,
    settings: VaseSlicerSettings,
): SliceContourSelectionOk | SliceContourSelectionFail {
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
        return { ok: false, contourCount: 0, detail: 'no valid closed loops', kind: 'none' };
    }

    const primary = candidates[0];
    const areaToMm2 = settings.modelScale * settings.modelScale;
    if (candidates.length === 1) {
        return {
            ok: true,
            contour: primary.contour,
            contourCount: 1,
            ignoredHoleCount: 0,
            droppedLoopCount: 0,
            droppedLargestAreaMm2: 0,
            skippedIslandCount: 0,
            skippedIslandLargestAreaMm2: 0,
        };
    }

    // Absolute printable-size thresholds only: a secondary loop is significant
    // as soon as it is big enough to print, regardless of how large the
    // primary is. (A relative cut silently discards real features on large
    // slices.) A thin fin qualifies via perimeter even when its area is tiny.
    const thresholds = getContourSignificanceThresholds(bounds, gridSize, settings);
    const significantSecondaries: SliceContourCandidate[] = [];
    let droppedLoopCount = 0;
    let droppedLargestArea = 0;
    for (let index = 1; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (candidate.area >= thresholds.minArea || candidate.perimeter >= thresholds.minPerimeter) {
            significantSecondaries.push(candidate);
        } else {
            droppedLoopCount++;
            droppedLargestArea = Math.max(droppedLargestArea, candidate.area);
        }
    }

    // Nested loops are holes in the outer wall: vase mode prints the outer
    // wall only, so proceed and report. Disjoint loops are separate islands a
    // single spiral cannot reach. (Deeper nesting — an island inside a hole —
    // is classified as a hole here; the warning still points at the layer.)
    let holeCount = 0;
    const islandAreasMm2: number[] = [];
    let skippedIslandCount = 0;
    let skippedIslandLargest = 0;
    for (const candidate of significantSecondaries) {
        if (pointInContour(candidate.contour[0], primary.contour)) {
            holeCount++;
            continue;
        }
        const areaMm2 = candidate.area * areaToMm2;
        // A spiral physically cannot reach a disjoint island of any size, but
        // failing an entire slice over a speck (typical for noise-displaced
        // surfaces) is worse than omitting it visibly. Below this area the
        // island is skipped with a warning; above it the slice fails.
        if (areaMm2 < MAX_SKIPPABLE_ISLAND_AREA_MM2) {
            skippedIslandCount++;
            skippedIslandLargest = Math.max(skippedIslandLargest, areaMm2);
        } else {
            islandAreasMm2.push(areaMm2);
        }
    }

    if (islandAreasMm2.length > 0) {
        const areas = [primary.area * areaToMm2, ...islandAreasMm2];
        return {
            ok: false,
            contourCount: islandAreasMm2.length + 1,
            kind: 'islands',
            detail: `${islandAreasMm2.length + 1} separate islands (${areas.slice(0, 3).map((area) => `${area.toFixed(2)} mm^2`).join(', ')}${areas.length > 3 ? ', ...' : ''})`,
        };
    }

    return {
        ok: true,
        contour: primary.contour,
        contourCount: candidates.length,
        ignoredHoleCount: holeCount,
        droppedLoopCount,
        droppedLargestAreaMm2: droppedLargestArea * areaToMm2,
        skippedIslandCount,
        skippedIslandLargestAreaMm2: skippedIslandLargest,
    };
}

function getContourSignificanceThresholds(
    bounds: SliceBounds,
    gridSize: number,
    settings: VaseSlicerSettings,
): { minArea: number; minPerimeter: number } {
    const gridPitch = Math.max(
        (bounds.maxX - bounds.minX) / Math.max(1, gridSize - 1),
        (bounds.maxZ - bounds.minZ) / Math.max(1, gridSize - 1),
    );
    const printableFeatureSize = Math.max(
        gridPitch * 3.0,
        settings.hitEpsilon * 6.0,
        (Math.max(settings.nozzleDiameter, settings.lineWidth) * 0.35) / Math.max(settings.modelScale, 1e-6),
    );
    return {
        minArea: printableFeatureSize * printableFeatureSize * 2.0,
        minPerimeter: printableFeatureSize * 4.0,
    };
}

function pointInContour(point: SlicePoint, contour: SlicePoint[]): boolean {
    let inside = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
        const a = contour[i];
        const b = contour[j];
        if ((a.z > point.z) !== (b.z > point.z)) {
            const t = (point.z - a.z) / (b.z - a.z);
            if (point.x < a.x + ((b.x - a.x) * t)) {
                inside = !inside;
            }
        }
    }
    return inside;
}

function buildContourFailureMessage(
    selection: SliceContourSelectionFail,
    extraction: SliceContourExtractionDebug,
    bounds: SliceBounds,
    gridSize: number,
    settings: VaseSlicerSettings,
    sampleY: number,
    acceptedLayerCount: number,
    layerCount: number,
): string {
    const sliceHeightMm = Math.max(settings.layerHeight, (sampleY - settings.minY) * settings.modelScale);
    const layerLabel = `Layer ${acceptedLayerCount + 1}/${layerCount} at Z ${sliceHeightMm.toFixed(2)} mm`;
    let message = selection.kind === 'islands'
        ? `Spiral vase mode needs a single connected outline per layer. ${layerLabel} has ${selection.detail}.`
        : `${layerLabel} produced no closed outline${selection.detail ? ` (${selection.detail})` : ''}.`;
    if (extractionTouchesBounds(extraction, bounds, gridSize)) {
        message += ' The surface crosses the slice window edge - increase "Slice half-extent" or re-center the model in XZ.';
    }
    return message;
}

function extractionTouchesBounds(
    extraction: SliceContourExtractionDebug,
    bounds: SliceBounds,
    gridSize: number,
): boolean {
    const tolerance = (Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / Math.max(1, gridSize - 1)) * 1.5;
    for (const polyline of extraction.openPolylines) {
        if (polyline.length === 0) {
            continue;
        }
        for (const point of [polyline[0], polyline[polyline.length - 1]]) {
            if (
                point.x - bounds.minX <= tolerance ||
                bounds.maxX - point.x <= tolerance ||
                point.z - bounds.minZ <= tolerance ||
                bounds.maxZ - point.z <= tolerance
            ) {
                return true;
            }
        }
    }
    return false;
}

function createSliceLayerWarningStats(): SliceLayerWarningStats {
    return {
        holeLayers: 0,
        maxHoleCount: 0,
        droppedLayers: 0,
        droppedLargestAreaMm2: 0,
        islandLayers: 0,
        islandLargestAreaMm2: 0,
    };
}

function summarizeSliceLayerWarnings(stats: SliceLayerWarningStats): string[] {
    const warnings: string[] = [];
    if (stats.holeLayers > 0) {
        warnings.push(
            `Ignored inner contour${stats.maxHoleCount === 1 ? '' : 's'} (holes) on ${stats.holeLayers} layer${stats.holeLayers === 1 ? '' : 's'} - vase mode prints only the outer wall.`
        );
    }
    if (stats.droppedLayers > 0) {
        warnings.push(
            `Ignored sub-printable loops on ${stats.droppedLayers} layer${stats.droppedLayers === 1 ? '' : 's'} (largest ${stats.droppedLargestAreaMm2.toFixed(2)} mm^2).`
        );
    }
    if (stats.islandLayers > 0) {
        warnings.push(
            `Skipped small disconnected island${stats.islandLargestAreaMm2 === 0 ? '' : 's'} on ${stats.islandLayers} layer${stats.islandLayers === 1 ? '' : 's'} (largest ${stats.islandLargestAreaMm2.toFixed(2)} mm^2) - a single spiral cannot reach them.`
        );
    }
    return warnings;
}

function buildSliceDebugSnapshot(
    field: Float32Array,
    bounds: SliceBounds,
    gridSize: number,
    sampleY: number,
    layerCount: number,
    acceptedLayerCount: number,
    settings: VaseSlicerSettings,
    contourSelection: SliceContourSelectionFail,
    extraction: SliceContourExtractionDebug,
): SliceDebugSnapshot {
    let minDistance = Number.POSITIVE_INFINITY;
    let maxDistance = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < field.length; index++) {
        const value = field[index];
        minDistance = Math.min(minDistance, value);
        maxDistance = Math.max(maxDistance, value);
    }

    const fieldRows: number[][] = [];
    for (let row = 0; row < gridSize; row++) {
        fieldRows.push(Array.from(field.subarray(row * gridSize, (row + 1) * gridSize)));
    }

    const debugSelection = evaluateContourSignificance(
        extraction.closedContours,
        bounds,
        gridSize,
        settings,
    );

    return {
        layerIndex: acceptedLayerCount + 1,
        layerCount,
        sampleY,
        sliceHeightMm: Math.max(settings.layerHeight, (sampleY - settings.minY) * settings.modelScale),
        gridSize,
        bounds,
        contourCount: contourSelection.contourCount,
        detail: contourSelection.detail,
        minDistance: Number.isFinite(minDistance) ? minDistance : 0,
        maxDistance: Number.isFinite(maxDistance) ? maxDistance : 0,
        closedContours: extraction.closedContours,
        openPolylines: extraction.openPolylines,
        segments: extraction.segments,
        contourMetrics: debugSelection.metrics,
        field: fieldRows,
    };
}

function evaluateContourSignificance(
    rawContours: SlicePoint[][],
    bounds: SliceBounds,
    gridSize: number,
    settings: VaseSlicerSettings,
): SliceContourSelectionDebug {
    const candidates = rawContours
        .map((contour) => buildContourCandidate(contour))
        .filter((candidate): candidate is SliceContourCandidate => candidate !== null)
        .sort((a, b) => {
            if (b.area !== a.area) {
                return b.area - a.area;
            }
            return b.perimeter - a.perimeter;
        });

    if (candidates.length === 0) {
        return {
            significantIndices: new Set<number>(),
            metrics: [],
        };
    }

    // Mirror selectPrimaryContour's absolute thresholds so the debug view
    // shows the same significance verdicts as the selection itself.
    const thresholds = getContourSignificanceThresholds(bounds, gridSize, settings);

    const significantIndices = new Set<number>();
    const metrics: SliceDebugContourMetric[] = [];
    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const significant = index === 0 || candidate.area >= thresholds.minArea || candidate.perimeter >= thresholds.minPerimeter;
        if (significant) {
            significantIndices.add(index);
        }

        metrics.push({
            index,
            pointCount: candidate.contour.length,
            areaMm2: candidate.area * settings.modelScale * settings.modelScale,
            perimeterMm: candidate.perimeter * settings.modelScale,
            significant,
        });
    }

    return {
        significantIndices,
        metrics,
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
        const loop = buildBrimLoop(firstLayer, offset);
        if (loop.length < 3) {
            continue;
        }

        emittedAnyBrimLoop = true;

        const start = loop[0];
        lines.push(';TYPE:Brim');
        lines.push(`G0 F${travelFeed} X${start.x.toFixed(3)} Y${start.y.toFixed(3)} Z${firstLayerZ.toFixed(3)}`);
        if (isFirstBrimLoop) {
            if (settings.primeMm > 0) {
                lines.push(`G1 F${mmPerSecToFeedrate(settings.retractSpeedMmPerSec).toFixed(0)} E${(settings.primeMm * 0.75).toFixed(4)}`);
            }
            isFirstBrimLoop = false;
        }

        let previous = start;
        // The G0 above set the travel feedrate; only the first print move of
        // the loop needs to restate F.
        let brimFeedSet = false;
        for (let i = 1; i < loop.length; i++) {
            const point = loop[i];
            const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
            if (distance > 0) {
                lines.push(`G1${brimFeedSet ? '' : ` F${printFeed}`} X${point.x.toFixed(3)} Y${point.y.toFixed(3)} E${(distance * extrusionPerMm).toFixed(5)}`);
                brimFeedSet = true;
            }
            previous = point;
        }

        const closingDistance = Math.hypot(start.x - previous.x, start.y - previous.y);
        if (closingDistance > 0) {
            lines.push(`G1${brimFeedSet ? '' : ` F${printFeed}`} X${start.x.toFixed(3)} Y${start.y.toFixed(3)} E${(closingDistance * extrusionPerMm).toFixed(5)}`);
        }
    }

    return emittedAnyBrimLoop;
}

function buildBrimLoop(
    source: ToolpathPoint[],
    offsetMm: number
): Array<{ x: number; y: number }> {
    if (offsetMm <= 1e-6) {
        return source.map((point) => ({ x: point.x, y: point.z }));
    }

    const contour = dedupeClosedPath2D(source.map((point) => ({ x: point.x, y: point.z })));
    if (contour.length < 3) {
        return contour;
    }

    const orientation = signedArea2D(contour);
    if (Math.abs(orientation) < 1e-9) {
        return contour;
    }

    const orientationSign = orientation >= 0 ? 1 : -1;
    const edges = buildOffsetEdges2D(contour, offsetMm, orientationSign);
    if (edges.length < 3) {
        return contour;
    }

    const miterLimit = Math.max(offsetMm * 6.0, 0.5);
    const loop: Array<{ x: number; y: number }> = [];

    for (let index = 0; index < edges.length; index++) {
        const prevEdge = edges[(index - 1 + edges.length) % edges.length];
        const nextEdge = edges[index];
        const vertex = contour[index];

        const join = intersectLines2D(prevEdge.a, prevEdge.b, nextEdge.a, nextEdge.b);
        if (join && distance2D(join, vertex) <= miterLimit) {
            pushUnique2D(loop, join);
            continue;
        }

        pushUnique2D(loop, prevEdge.b);
        pushUnique2D(loop, nextEdge.a);
    }

    return dedupeClosedPath2D(loop);
}

function buildOffsetEdges2D(
    contour: Array<{ x: number; y: number }>,
    offsetMm: number,
    orientationSign: number
): Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> {
    const edges: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> = [];

    for (let i = 0; i < contour.length; i++) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length <= 1e-8) {
            continue;
        }

        const tx = dx / length;
        const ty = dy / length;
        const nx = orientationSign > 0 ? ty : -ty;
        const ny = orientationSign > 0 ? -tx : tx;
        edges.push({
            a: { x: a.x + nx * offsetMm, y: a.y + ny * offsetMm },
            b: { x: b.x + nx * offsetMm, y: b.y + ny * offsetMm },
        });
    }

    return edges;
}

function signedArea2D(points: Array<{ x: number; y: number }>): number {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += (a.x * b.y) - (b.x * a.y);
    }
    return area * 0.5;
}

function dedupeClosedPath2D(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    const deduped: Array<{ x: number; y: number }> = [];
    for (const point of points) {
        pushUnique2D(deduped, point);
    }

    if (deduped.length > 1 && distance2D(deduped[0], deduped[deduped.length - 1]) <= 1e-6) {
        deduped.pop();
    }

    return deduped;
}

function pushUnique2D(points: Array<{ x: number; y: number }>, next: { x: number; y: number }): void {
    const previous = points[points.length - 1];
    if (!previous || distance2D(previous, next) > 1e-6) {
        points.push(next);
    }
}

function distance2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function intersectLines2D(
    a0: { x: number; y: number },
    a1: { x: number; y: number },
    b0: { x: number; y: number },
    b1: { x: number; y: number }
): { x: number; y: number } | null {
    const arx = a1.x - a0.x;
    const ary = a1.y - a0.y;
    const brx = b1.x - b0.x;
    const bry = b1.y - b0.y;
    const det = (arx * bry) - (ary * brx);
    if (Math.abs(det) <= 1e-9) {
        return null;
    }

    const qpx = b0.x - a0.x;
    const qpy = b0.y - a0.y;
    const t = ((qpx * bry) - (qpy * brx)) / det;
    return {
        x: a0.x + arx * t,
        y: a0.y + ary * t,
    };
}

function reportSliceProgress(
    reporter: SliceProgressReporter | undefined,
    phase: SliceProgressPhase,
    completed: number,
    total: number,
    overall: number,
    detail: string,
): void {
    if (!reporter) {
        return;
    }

    reporter({
        phase,
        phaseLabel: getSliceProgressPhaseLabel(phase),
        completed,
        total,
        overall: clamp(overall, 0, 1),
        detail,
    });
}

function getSliceProgressPhaseLabel(phase: SliceProgressPhase): string {
    switch (phase) {
        case 'preparing':
            return 'Preparing';
        case 'sampling':
            return 'Sampling';
        case 'toolpath':
            return 'Toolpath';
        case 'gcode':
            return 'G-code';
        case 'finalizing':
            return 'Finalizing';
        default:
            return 'Slicing';
    }
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

function buildSceneControlValueMap(definitions: SceneControlDefinition[], values: SceneControlValueMap): SceneControlValueMap {
    const next: SceneControlValueMap = {};

    for (const definition of definitions) {
        const rawValue = values[definition.key] ?? definition.defaultValue;
        if (definition.hasControl === false) {
            next[definition.key] = rawValue;
            continue;
        }

        if (definition.options && definition.options.length > 0) {
            next[definition.key] = snapToNearestOptionValue(rawValue, definition.options);
            continue;
        }

        next[definition.key] = clamp(rawValue, definition.min, definition.max);
    }

    return next;
}