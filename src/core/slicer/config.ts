import { clamp, clampInt } from './math';
import { getDefaultEndGcode, getDefaultStartGcode } from './gcode-template';

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
    /**
     * Number of solid bottom layers (0 = open vase). Each is printed as a
     * flat perimeter plus concentric inward fill before the helix starts.
     */
    bottomLayers: number;
    /**
     * Adaptive layer height ceiling in mm. 0 (or <= layerHeight) keeps
     * uniform layers; above layerHeight, near-vertical regions coalesce
     * consecutive contours into thicker revolutions while sloped regions
     * keep the base layer height. Extrusion follows the local thickness.
     */
    maxLayerHeightMm: number;
    /**
     * Vertical rise per helix revolution in mm. 0 (or <= layerHeight) keeps
     * the classic one-revolution-per-layer spiral. Above layerHeight the
     * helix climbs this much per revolution while contours are still sampled
     * at layerHeight pitch, so postprocess patterns get coarse row spacing
     * over a finely resolved surface. Pitched prints skip the top cap and
     * default to a lineWidth-capped bead; pattern scripts set flow per
     * segment.
     */
    spiralPitchMm: number;
    brimWidthMm: number;
    brimGapMm: number;
    enableContourAlignment: boolean;
    enableMoveMerging: boolean;
    startGcode: string;
    endGcode: string;
}

export function getDefaultVaseSettings(): VaseSlicerSettings {
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
        bottomLayers: 0,
        maxLayerHeightMm: 0,
        spiralPitchMm: 0,
        brimWidthMm: 5,
        brimGapMm: 0.1,
        enableContourAlignment: true,
        enableMoveMerging: true,
        startGcode: getDefaultStartGcode().join('\n'),
        endGcode: getDefaultEndGcode().join('\n'),
    };
}

/** Merge partial settings over the defaults and clamp every field to its valid range. */
export function resolveVaseSettings(next: Partial<VaseSlicerSettings>): VaseSlicerSettings {
    const base = getDefaultVaseSettings();
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
    merged.bottomLayers = clampInt(merged.bottomLayers, 0, 3);
    merged.maxLayerHeightMm = clamp(merged.maxLayerHeightMm, 0, 1.5);
    merged.spiralPitchMm = clamp(merged.spiralPitchMm, 0, 10);
    merged.brimWidthMm = clamp(merged.brimWidthMm, 0, 30);
    merged.brimGapMm = clamp(merged.brimGapMm, 0, 5);
    merged.enableContourAlignment = Boolean(merged.enableContourAlignment);
    merged.enableMoveMerging = Boolean(merged.enableMoveMerging);
    if (merged.maxY <= merged.minY) {
        merged.maxY = merged.minY + merged.layerHeight;
    }

    return merged;
}

/** Active pitch in mm, or 0 when the spiral follows the layer height. */
export function getSpiralPitchMm(settings: VaseSlicerSettings): number {
    return settings.spiralPitchMm > settings.layerHeight ? settings.spiralPitchMm : 0;
}

export function getModelHeightMm(settings: VaseSlicerSettings): number {
    const unclampedHeight = Math.max(0.01, (settings.maxY - settings.minY) * settings.modelScale);
    return Math.max(0.01, Math.min(unclampedHeight, settings.maxPrintHeightMm));
}

/**
 * SDF-space Y at which layer `layerIndex` is sampled. Contour j is deposited
 * while the helix climbs from layerHeight*j to layerHeight*(j+1); sampling at
 * the mid-height of that band lines printed geometry up with the field
 * instead of lagging behind it by up to a layer.
 */
export function getSliceSampleY(settings: VaseSlicerSettings, layerIndex: number): number {
    const midHeightMm = settings.layerHeight * (layerIndex + 0.5);
    return settings.minY + (midHeightMm / settings.modelScale);
}

/** Print-space Z height in mm for an SDF-space sample Y. */
export function sampleYToPrintHeightMm(sampleY: number, settings: VaseSlicerSettings): number {
    return Math.max(settings.layerHeight, (sampleY - settings.minY) * settings.modelScale);
}

/** The full ±maxRadius XZ search window that sampling starts from. */
export function getSliceSearchWindow(settings: VaseSlicerSettings): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const extent = Math.max(settings.maxRadius, settings.hitEpsilon * 8.0);
    return {
        minX: -extent,
        maxX: extent,
        minZ: -extent,
        maxZ: extent,
    };
}
