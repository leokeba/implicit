import type { SceneFieldValue } from '../shader-pipeline';
import type { VaseSlicerSettings } from './config';

export interface ToolpathPoint {
    x: number;
    y: number;
    z: number;
    e: number;
    speedMmPerSec: number;
    layer: number;
    extrusionScale?: number;
    /** Local layer thickness in mm when adaptive layer heights are active. */
    layerThicknessMm?: number;
    /** Pause after reaching this point, in milliseconds (G4 dwell). Ignored on the first point. */
    dwellAfterMs?: number;
    /** Marks the move ending at this point as a travel: emitted as G0 with no extrusion. */
    travel?: boolean;
    /**
     * Direct filament mm per path mm for the move ending at this point,
     * bypassing the line-width x layer-height bead model. extrusionScale
     * still multiplies on top.
     */
    extrusionPerMmOverride?: number;
    /**
     * Print feature this move belongs to. Unset means the spiral wall (or a
     * flat bottom layer of it, distinguished by `layer`). Set for the top
     * cap's extrusion-ramped revolution, and by the G-code builder for the
     * brim and bottom-fill loops it prepends.
     */
    feature?: 'brim' | 'bottom' | 'cap';
    sceneFields?: Record<string, SceneFieldValue>;
}

export interface ToolpathPipelineStepSummary {
    stepIndex: number;
    scriptId: string | null;
    name: string;
    inputPointCount: number;
    outputPointCount: number;
    durationMs: number;
    notes: string[];
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
    /**
     * Finalized contour stack the spiral was built from (cylindrical mode:
     * the radial resample). Kept so postprocess scripts can query the model
     * wall at arbitrary heights; survives the base-toolpath cache.
     */
    contourLayers?: SliceContourLayer[];
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

/** A point on a slice contour in SDF space (XZ plane). */
export interface SlicePoint {
    x: number;
    z: number;
}

/** XZ extent of a sampling window in SDF space. */
export interface SliceBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface SliceContourLayer {
    sampleY: number;
    contour: SlicePoint[];
    /** Height of the helix pass that deposits this contour, in mm. */
    printHeightMm?: number;
}

export interface SampledSliceContours {
    layers: SliceContourLayer[];
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

export type SliceProgressReporter = (update: SliceProgressUpdate) => void;

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
