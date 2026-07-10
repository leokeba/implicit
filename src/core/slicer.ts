import {
    composeSlicerFragmentSource,
    getSlicerProgramSignature,
    getSlicerVertexSource,
    type SceneControlDefinition,
    type SceneControlValueMap,
} from './shader-pipeline';
import { applyToolpathPipeline } from './toolpath-postprocess';
import type { ResolvedPipelineStep } from './postprocess-registry';
import { clamp, clampInt, yieldToMainThread } from './slicer/math';
import {
    getDefaultVaseSettings,
    getSliceSampleY,
    resolveVaseSettings,
    type VaseSlicerSettings,
} from './slicer/config';
import type {
    SampledSliceContours,
    SliceBounds,
    SliceContourLayer,
    SliceDebugSnapshot,
    SliceProgressPhase,
    SliceProgressReporter,
    SliceProgressUpdate,
    ToolpathPoint,
    VaseBaseToolpath,
    VaseSliceBaseResult,
    VaseSliceBenchmarkResult,
    VaseSliceBenchmarkRun,
    VaseSlicePhaseTimings,
    VaseSliceResult,
    VaseToolpath,
} from './slicer/types';
import type { FieldBatch, PendingFieldBatch } from './slicer/field-sampler';
import { GpuFieldSampler } from './slicer/field-sampler-gpu';
import { prepareSliceJob, type SliceBatchPlan, type SliceJob } from './slicer/job-planner';
import {
    buildContourFailureMessage,
    buildSliceDebugSnapshot,
    createSliceLayerWarningStats,
    extractContoursFromField,
    extractionTouchesBounds,
    selectPrimaryContour,
    summarizeSliceLayerWarnings,
    type SliceLayerWarningStats,
} from './slicer/contours';
import { finalizeContourLayers } from './slicer/contour-postprocess';
import {
    applyMinimumLayerTime,
    buildSpiralBaseToolpath,
    optimizeToolpath,
    recomputeExtrusion,
} from './slicer/toolpath';
import { buildGcode } from './slicer/gcode';
import { buildToolpathSurface } from './slicer/surface';

export type { VaseSlicerSettings } from './slicer/config';
export type {
    SampledSliceContours,
    SliceBounds,
    SliceContourLayer,
    SliceDebugBounds,
    SliceDebugContourMetric,
    SliceDebugSegment,
    SliceDebugSnapshot,
    SlicePoint,
    SliceProgressPhase,
    SliceProgressReporter,
    SliceProgressUpdate,
    ToolpathPipelineStepSummary,
    ToolpathPoint,
    VaseBaseToolpath,
    VaseSliceBaseResult,
    VaseSliceBenchmarkResult,
    VaseSliceBenchmarkRun,
    VaseSlicePhaseTimings,
    VaseSliceResult,
    VaseToolpath,
} from './slicer/types';
export type { FieldBatch, FieldBatchRequest, FieldSampler, PendingFieldBatch } from './slicer/field-sampler';

interface VaseSliceExecution extends VaseSliceResult {
    timings: VaseSlicePhaseTimings;
}

/** Internal signal: tight-bounds extraction hit a suspected clip; retry the batch at full bounds. */
class SliceBatchRetry extends Error {
    constructor() {
        super('retry batch at full bounds');
    }
}

interface SamplingWorkerJob {
    resolve: (result: { layers: SliceContourLayer[]; warnings: string[]; pointsPerLayer: number }) => void;
    reject: (error: Error) => void;
    onProgress?: SliceProgressReporter;
}

/** Worker crashed or could not start; distinct from a real slicing error so callers can fall back. */
class SamplingWorkerUnavailable extends Error {}

/**
 * Orchestrates a vase slice: field sampling (worker-preferred, GPU-backed)
 * -> contour extraction and finalization -> spiral toolpath -> G-code.
 * The heavy lifting lives in the `slicer/` modules; this class owns the
 * pipeline order, the sampling worker, and progress/debug reporting.
 */
export class Slicer {
    private sampler: GpuFieldSampler;
    private samplingWorker: Worker | null;
    private samplingWorkerFailed: boolean;
    private samplingWorkerJobs: Map<number, SamplingWorkerJob>;
    private samplingWorkerJobCounter: number;
    private sceneControlDefinitions: SceneControlDefinition[];
    private sceneControlValues: SceneControlValueMap;
    private lastSliceDebugSnapshot: SliceDebugSnapshot | null;

    constructor() {
        this.sampler = new GpuFieldSampler();
        this.samplingWorker = null;
        this.samplingWorkerFailed = false;
        this.samplingWorkerJobs = new Map();
        this.samplingWorkerJobCounter = 0;
        this.sceneControlDefinitions = [];
        this.sceneControlValues = {};
        this.lastSliceDebugSnapshot = null;
    }

    public setSceneControlState(definitions: SceneControlDefinition[], values: SceneControlValueMap): void {
        this.sceneControlDefinitions = definitions.map((definition) => ({ ...definition }));
        this.sceneControlValues = { ...values };
        this.sampler.setSceneControlState(definitions, values);
    }

    public getDefaultVaseSettings(): VaseSlicerSettings {
        return getDefaultVaseSettings();
    }

    public normalizeVaseSettings(next: Partial<VaseSlicerSettings>): VaseSlicerSettings {
        return resolveVaseSettings(next);
    }

    /**
     * Inject pre-composed shader sources (worker mode). Outside a worker the
     * sources come from the live scene registry.
     */
    public setSlicerProgramSourcesOverride(vertex: string, fragment: string, signature: string): void {
        this.sampler.setProgramSourcesOverride(vertex, fragment, signature);
    }

    /** Times repeated slices through the production (async, worker-preferred) pipeline. */
    public async benchmarkVaseGcode(
        next: Partial<VaseSlicerSettings>,
        iterations: number,
        warmupRuns = 1,
        pipeline?: ResolvedPipelineStep[],
    ): Promise<VaseSliceBenchmarkResult> {
        const settings = resolveVaseSettings(next);
        const measuredRunCount = clampInt(iterations, 1, 20);
        const warmupRunCount = clampInt(warmupRuns, 0, 10);
        const totalRunCount = measuredRunCount + warmupRunCount;
        const runs: VaseSliceBenchmarkRun[] = [];
        let lastResult: VaseSliceResult | null = null;

        for (let runIndex = 0; runIndex < totalRunCount; runIndex++) {
            const result = await this.executeVaseSliceAsync(settings, undefined, pipeline);
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
        const settings = resolveVaseSettings(next);
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
        const settings = resolveVaseSettings(next);
        // The base toolpath already fixed its contour density; keep the
        // settings copy consistent for pipeline scripts and G-code metadata.
        settings.pointsPerLayer = baseToolpath.pointsPerLayer;
        const warnings = baseToolpath.warnings ?? [];
        const finalized = this.finalizeSpiralToolpath(baseToolpath, settings, pipeline);
        const gcode = buildGcode(finalized, settings, [
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

    /**
     * Worker-side entry point: samples contours with the injected shader
     * sources and returns plain-data results (including the derived
     * pointsPerLayer) for structured cloning back to the main thread.
     */
    public async sampleContoursForWorker(
        next: Partial<VaseSlicerSettings>,
        onProgress?: SliceProgressReporter,
    ): Promise<{ layers: SliceContourLayer[]; warnings: string[]; pointsPerLayer: number }> {
        this.lastSliceDebugSnapshot = null;
        const settings = resolveVaseSettings(next);
        const sampled = await this.sampleSliceContoursAsync(settings, onProgress);
        return {
            layers: sampled.layers,
            warnings: sampled.warnings,
            pointsPerLayer: settings.pointsPerLayer,
        };
    }

    /**
     * Async sampling entry: prefers the dedicated worker (keeps the main
     * thread free of GPU stalls and extraction work) and falls back to
     * in-thread sampling when workers are unavailable or crash. Real slicing
     * errors from the worker propagate; they are not a reason to fall back.
     */
    private async sampleSliceContoursPreferWorker(
        settings: VaseSlicerSettings,
        onProgress?: SliceProgressReporter,
    ): Promise<SampledSliceContours> {
        const worker = this.getSamplingWorker();
        if (worker) {
            try {
                const result = await this.runSamplingWorkerJob(worker, settings, onProgress);
                settings.pointsPerLayer = result.pointsPerLayer;
                return { layers: result.layers, warnings: result.warnings };
            } catch (error) {
                if (!(error instanceof SamplingWorkerUnavailable)) {
                    throw error;
                }
            }
        }

        return this.sampleSliceContoursAsync(settings, onProgress);
    }

    private getSamplingWorker(): Worker | null {
        if (this.samplingWorkerFailed) {
            return null;
        }
        if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof document === 'undefined') {
            // No worker support, or we are already inside the worker.
            return null;
        }

        if (!this.samplingWorker) {
            try {
                this.samplingWorker = new Worker(new URL('./slicer/sampling.worker.ts', import.meta.url), { type: 'module' });
            } catch {
                this.samplingWorkerFailed = true;
                return null;
            }
            this.samplingWorker.onmessage = (event: MessageEvent) => this.handleSamplingWorkerMessage(event.data);
            this.samplingWorker.onerror = () => {
                this.samplingWorkerFailed = true;
                this.failAllSamplingWorkerJobs();
                this.samplingWorker?.terminate();
                this.samplingWorker = null;
            };
        }

        return this.samplingWorker;
    }

    private runSamplingWorkerJob(
        worker: Worker,
        settings: VaseSlicerSettings,
        onProgress?: SliceProgressReporter,
    ): Promise<{ layers: SliceContourLayer[]; warnings: string[]; pointsPerLayer: number }> {
        const jobId = ++this.samplingWorkerJobCounter;
        return new Promise((resolve, reject) => {
            this.samplingWorkerJobs.set(jobId, { resolve, reject, onProgress });
            worker.postMessage({
                type: 'sample',
                jobId,
                settings,
                vertexSource: getSlicerVertexSource(),
                fragmentSource: composeSlicerFragmentSource(),
                signature: getSlicerProgramSignature(),
                controlDefinitions: this.sceneControlDefinitions,
                controlValues: this.sceneControlValues,
            });
        });
    }

    private handleSamplingWorkerMessage(message: unknown): void {
        const data = message as {
            type?: string;
            jobId?: number;
            update?: SliceProgressUpdate;
            layers?: SliceContourLayer[];
            warnings?: string[];
            pointsPerLayer?: number;
            message?: string;
            debugSnapshot?: SliceDebugSnapshot | null;
        };
        if (!data || typeof data.jobId !== 'number') {
            return;
        }
        const job = this.samplingWorkerJobs.get(data.jobId);
        if (!job) {
            return;
        }

        if (data.type === 'progress' && data.update) {
            job.onProgress?.(data.update);
            return;
        }
        if (data.type === 'done') {
            this.samplingWorkerJobs.delete(data.jobId);
            job.resolve({
                layers: data.layers ?? [],
                warnings: data.warnings ?? [],
                pointsPerLayer: data.pointsPerLayer ?? 0,
            });
            return;
        }
        if (data.type === 'error') {
            this.samplingWorkerJobs.delete(data.jobId);
            this.lastSliceDebugSnapshot = data.debugSnapshot ?? null;
            job.reject(new Error(data.message ?? 'Slicing failed in worker.'));
        }
    }

    private failAllSamplingWorkerJobs(): void {
        for (const job of this.samplingWorkerJobs.values()) {
            job.reject(new SamplingWorkerUnavailable('Slicing worker crashed.'));
        }
        this.samplingWorkerJobs.clear();
    }

    private async executeVaseSliceAsync(
        settings: VaseSlicerSettings,
        onProgress?: SliceProgressReporter,
        pipeline?: ResolvedPipelineStep[],
    ): Promise<VaseSliceExecution> {
        this.lastSliceDebugSnapshot = null;
        reportSliceProgress(onProgress, 'preparing', 0, 1, 0.0, 'Preparing slicer settings...');
        await yieldToMainThread();

        const startTime = performance.now();
        const sampled = await this.sampleSliceContoursPreferWorker(settings, onProgress);
        const contourSamplingEndTime = performance.now();

        reportSliceProgress(onProgress, 'toolpath', 0, 1, 0.78, `Building ${settings.slicerMode} spiral toolpath...`);
        await yieldToMainThread();
        const baseToolpath = buildSpiralBaseToolpath(sampled.layers, settings);
        const toolpath = this.finalizeSpiralToolpath(baseToolpath, settings, pipeline);
        const toolpathEndTime = performance.now();

        reportSliceProgress(onProgress, 'gcode', 0, 1, 0.92, 'Encoding G-code...');
        await yieldToMainThread();
        const warnings = [...sampled.warnings, ...(baseToolpath.warnings ?? [])];
        const gcode = buildGcode(toolpath, settings, warnings.map((warning) => `Slicer warning: ${warning}`));
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
        await yieldToMainThread();

        const sampled = await this.sampleSliceContoursPreferWorker(settings, onProgress);
        reportSliceProgress(onProgress, 'toolpath', 0, 1, 0.78, `Building ${settings.slicerMode} spiral toolpath...`);
        await yieldToMainThread();

        const baseToolpath = buildSpiralBaseToolpath(sampled.layers, settings);
        baseToolpath.warnings = [...sampled.warnings, ...(baseToolpath.warnings ?? [])];

        reportSliceProgress(onProgress, 'finalizing', 1, 1, 1.0, 'Toolpath ready for export.');
        return baseToolpath;
    }

    /**
     * In-thread sampling: plan the job, run sampler batches pipelined with
     * contour extraction, then finalize (resample/smooth/align) the layers.
     * The derived pointsPerLayer is written back onto the merged settings
     * copy so downstream consumers and G-code metadata report it.
     */
    private async sampleSliceContoursAsync(
        settings: VaseSlicerSettings,
        onProgress?: SliceProgressReporter,
    ): Promise<SampledSliceContours> {
        const job = prepareSliceJob(this.sampler, settings);
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

        // Pipelined: batch k+1's evaluation is issued before batch k is
        // consumed, so contour extraction overlaps the sampler instead of
        // stalling on readback (WebGL2; WebGL1 degrades to serial).
        let pending: { plan: SliceBatchPlan; batch: PendingFieldBatch } | null = null;
        for (const plan of job.batches) {
            const next = {
                plan,
                batch: this.sampler.issueBatch(settings, {
                    bounds: plan.bounds,
                    gridSize: plan.gridSize,
                    firstSampleY: getSliceSampleY(settings, plan.layerIndex),
                    sliceYStep: job.sliceYStep,
                    batchLayerCount: plan.batchLayerCount,
                }),
            };

            if (pending) {
                await pending.batch.wait();
                this.extractBatchResults(rawLayers, settings, job, pending.plan, pending.batch.read(), layerStats);
                reportBatchProgress();
                await yieldToMainThread();
            }

            pending = next;
        }

        if (pending) {
            await pending.batch.wait();
            this.extractBatchResults(rawLayers, settings, job, pending.plan, pending.batch.read(), layerStats);
            reportBatchProgress();
        }

        const finalized = finalizeContourLayers(rawLayers, settings, [...job.warnings, ...summarizeSliceLayerWarnings(layerStats)]);
        settings.pointsPerLayer = finalized.pointsPerLayer;
        return { layers: finalized.layers, warnings: finalized.warnings };
    }

    /**
     * Extracts a batch's contours; a tight-bounds batch that fails or looks
     * clipped is transparently resampled at the full job bounds first.
     */
    private extractBatchResults(
        rawLayers: SliceContourLayer[],
        settings: VaseSlicerSettings,
        job: SliceJob,
        plan: SliceBatchPlan,
        results: FieldBatch[],
        layerStats: SliceLayerWarningStats,
    ): void {
        const startCount = rawLayers.length;
        const statsBackup = { ...layerStats };
        try {
            for (const batchResult of results) {
                rawLayers.push(this.extractSliceLayer(
                    batchResult, plan.bounds, plan.gridSize, job.layerCount, settings, rawLayers.length, layerStats, plan.tight,
                ));
            }
            return;
        } catch (error) {
            if (!(error instanceof SliceBatchRetry)) {
                throw error;
            }
            rawLayers.length = startCount;
            Object.assign(layerStats, statsBackup);
        }

        const fullResults = this.sampler.sampleBatch(settings, {
            bounds: job.bounds,
            gridSize: job.gridSize,
            firstSampleY: getSliceSampleY(settings, plan.layerIndex),
            sliceYStep: job.sliceYStep,
            batchLayerCount: plan.batchLayerCount,
        });
        for (const batchResult of fullResults) {
            rawLayers.push(this.extractSliceLayer(
                batchResult, job.bounds, job.gridSize, job.layerCount, settings, rawLayers.length, layerStats, false,
            ));
        }
    }

    private extractSliceLayer(
        batchResult: FieldBatch,
        bounds: SliceBounds,
        gridSize: number,
        layerCount: number,
        settings: VaseSlicerSettings,
        acceptedLayerCount: number,
        layerStats: SliceLayerWarningStats,
        tight: boolean,
    ): SliceContourLayer {
        const contourExtraction = extractContoursFromField(batchResult.field, gridSize, bounds);
        const contourSelection = selectPrimaryContour(
            contourExtraction.closedContours,
            bounds,
            gridSize,
            settings,
        );

        if (!contourSelection.ok) {
            if (tight) {
                // The tightened batch window may have clipped real geometry;
                // let the caller retry at the full job bounds.
                throw new SliceBatchRetry();
            }
            this.lastSliceDebugSnapshot = buildSliceDebugSnapshot(
                batchResult.field,
                bounds,
                gridSize,
                batchResult.sampleY,
                layerCount,
                acceptedLayerCount,
                settings,
                contourSelection,
                contourExtraction,
            );
            throw new Error(buildContourFailureMessage(
                contourSelection,
                contourExtraction,
                bounds,
                gridSize,
                settings,
                batchResult.sampleY,
                acceptedLayerCount,
                layerCount,
            ));
        }

        if (tight && extractionTouchesBounds(contourExtraction, bounds, gridSize)) {
            throw new SliceBatchRetry();
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

    private finalizeSpiralToolpath(
        baseToolpath: VaseBaseToolpath,
        settings: VaseSlicerSettings,
        pipeline?: ResolvedPipelineStep[],
    ): VaseToolpath {
        const basePoints: ToolpathPoint[] = baseToolpath.points.map((point) => ({ ...point }));
        this.sampler.attachSceneFieldsToPoints(basePoints, settings);
        const surface = buildToolpathSurface(baseToolpath.contourLayers, settings);
        const postprocessed = applyToolpathPipeline(basePoints, settings, pipeline ?? [], surface);
        const optimizedPoints = optimizeToolpath(postprocessed.points, settings);
        recomputeExtrusion(optimizedPoints, settings);
        applyMinimumLayerTime(optimizedPoints, settings);

        return {
            points: optimizedPoints,
            layerCount: baseToolpath.layerCount,
            pointsPerLayer: baseToolpath.pointsPerLayer,
            estimatedHeight: baseToolpath.estimatedHeight,
            postprocessSummaries: postprocessed.summaries,
        };
    }
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
    }
}
