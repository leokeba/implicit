import { clamp, clampInt } from './math';
import {
    getModelHeightMm,
    getSliceSampleY,
    getSliceSearchWindow,
    type VaseSlicerSettings,
} from './config';
import type { SliceBounds } from './types';
import type { FieldSampler } from './field-sampler';

/**
 * Plans how a slice job is split into batches for a field sampler: overall
 * grid resolution from targetSegmentMm, a coarse pre-pass that shrinks the
 * window to the model's footprint, and per-batch bounds tightened to each
 * height band. Sampler-agnostic — capacity limits come from the sampler.
 */

export interface SliceBatchPlan {
    layerIndex: number;
    batchLayerCount: number;
    bounds: SliceBounds;
    gridSize: number;
    /** True when bounds are tighter than the job bounds and a failed
     * extraction should retry at full job bounds before giving up. */
    tight: boolean;
}

export interface SliceJob {
    layerCount: number;
    bounds: SliceBounds;
    gridSize: number;
    batchCapacity: number;
    sliceYStep: number;
    warnings: string[];
    batches: SliceBatchPlan[];
}

interface SlicePrepassLevel {
    y: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

interface SliceBoundsFit {
    bounds: SliceBounds;
    warnings: string[];
    levels: SlicePrepassLevel[];
    margin: number;
}

export function prepareSliceJob(sampler: FieldSampler, settings: VaseSlicerSettings): SliceJob {
    const modelHeightMm = getModelHeightMm(settings);
    const layerCount = Math.max(2, Math.floor(modelHeightMm / settings.layerHeight));
    const searchWindow = getSliceSearchWindow(settings);
    const fit = fitSliceBounds(sampler, settings, layerCount, searchWindow);
    const maxGridSize = sampler.maxGridSize();
    const sliceSpanMm = Math.max(fit.bounds.maxX - fit.bounds.minX, fit.bounds.maxZ - fit.bounds.minZ) * settings.modelScale;
    // Grid pitch at half the target segment length resolves every feature
    // the final contour resample can keep.
    const gridPitchMm = Math.max(0.02, settings.targetSegmentMm * 0.5);
    const gridSize = clampInt(Math.ceil(sliceSpanMm / gridPitchMm) + 1, 32, maxGridSize);
    const batchCapacity = sampler.batchCapacity(gridSize);

    const job: SliceJob = {
        layerCount,
        bounds: fit.bounds,
        gridSize,
        batchCapacity,
        sliceYStep: settings.layerHeight / settings.modelScale,
        warnings: fit.warnings,
        batches: [],
    };

    for (let layerIndex = 0; layerIndex < layerCount; layerIndex += batchCapacity) {
        const batchLayerCount = Math.min(batchCapacity, layerCount - layerIndex);
        job.batches.push(planSliceBatch(settings, job, fit, layerIndex, batchLayerCount, gridPitchMm, maxGridSize));
    }

    return job;
}

/**
 * Bounds for one batch, tightened to the pre-pass footprint of the
 * batch's height band. Tapered models sample far fewer cells on their
 * narrow layers; extraction falls back to the full job bounds if a tight
 * batch ever looks clipped.
 */
function planSliceBatch(
    settings: VaseSlicerSettings,
    job: SliceJob,
    fit: SliceBoundsFit,
    layerIndex: number,
    batchLayerCount: number,
    gridPitchMm: number,
    maxGridSize: number,
): SliceBatchPlan {
    const fullBatch: SliceBatchPlan = {
        layerIndex,
        batchLayerCount,
        bounds: job.bounds,
        gridSize: job.gridSize,
        tight: false,
    };
    if (fit.levels.length === 0) {
        return fullBatch;
    }

    const yLow = getSliceSampleY(settings, layerIndex);
    const yHigh = getSliceSampleY(settings, layerIndex + batchLayerCount - 1);
    // Include one pre-pass level of slack on each side of the band.
    const levelSpacing = fit.levels.length > 1
        ? Math.abs(fit.levels[1].y - fit.levels[0].y)
        : Number.POSITIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const level of fit.levels) {
        if (level.y < yLow - levelSpacing || level.y > yHigh + levelSpacing) {
            continue;
        }
        minX = Math.min(minX, level.minX);
        maxX = Math.max(maxX, level.maxX);
        minZ = Math.min(minZ, level.minZ);
        maxZ = Math.max(maxZ, level.maxZ);
    }
    if (!Number.isFinite(minX)) {
        return fullBatch;
    }

    // Grow by the pre-pass margin plus a slice of the span for slope the
    // coarse levels missed, then square and clamp inside the job bounds.
    const growth = fit.margin + (Math.max(maxX - minX, maxZ - minZ) * 0.05);
    minX -= growth;
    maxX += growth;
    minZ -= growth;
    maxZ += growth;
    const jobHalfSpan = Math.max(job.bounds.maxX - job.bounds.minX, job.bounds.maxZ - job.bounds.minZ) * 0.5;
    const halfSpan = Math.min(Math.max(maxX - minX, maxZ - minZ) * 0.5, jobHalfSpan);
    const centerX = clamp((minX + maxX) * 0.5, job.bounds.minX + halfSpan, job.bounds.maxX - halfSpan);
    const centerZ = clamp((minZ + maxZ) * 0.5, job.bounds.minZ + halfSpan, job.bounds.maxZ - halfSpan);
    const bounds: SliceBounds = {
        minX: Math.max(job.bounds.minX, centerX - halfSpan),
        maxX: Math.min(job.bounds.maxX, centerX + halfSpan),
        minZ: Math.max(job.bounds.minZ, centerZ - halfSpan),
        maxZ: Math.min(job.bounds.maxZ, centerZ + halfSpan),
    };

    const batchSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const jobSpan = Math.max(job.bounds.maxX - job.bounds.minX, job.bounds.maxZ - job.bounds.minZ);
    if (batchSpan >= jobSpan * 0.9) {
        // Not enough savings to justify a divergent grid.
        return fullBatch;
    }

    const gridSize = clampInt(Math.ceil((batchSpan * settings.modelScale) / gridPitchMm) + 1, 32, maxGridSize);
    return {
        layerIndex,
        batchLayerCount,
        bounds,
        gridSize,
        tight: true,
    };
}

/**
 * Coarse pre-pass over the ±maxRadius search window that shrinks the
 * slicing bounds to the model's actual XZ extent. Keeps grid resolution
 * where the model is instead of spending it on empty window, and supports
 * off-center models. Falls back to the full window when nothing is found.
 */
function fitSliceBounds(
    sampler: FieldSampler,
    settings: VaseSlicerSettings,
    layerCount: number,
    window: SliceBounds,
): SliceBoundsFit {
    const warnings: string[] = [];
    const coarseGrid = 64;
    const coarseLayerCount = Math.min(24, layerCount);
    const firstY = getSliceSampleY(settings, 0);
    const lastY = getSliceSampleY(settings, layerCount - 1);
    const stepY = coarseLayerCount > 1 ? (lastY - firstY) / (coarseLayerCount - 1) : 0;

    const batches = sampler.sampleBatch(settings, {
        bounds: window,
        gridSize: coarseGrid,
        firstSampleY: firstY,
        sliceYStep: stepY,
        batchLayerCount: coarseLayerCount,
    });

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
    const levels: SlicePrepassLevel[] = [];
    for (const batch of batches) {
        const field = batch.field;
        let levelMinCol = coarseGrid;
        let levelMaxCol = -1;
        let levelMinRow = coarseGrid;
        let levelMaxRow = -1;
        for (let row = 0; row < coarseGrid; row++) {
            const base = row * coarseGrid;
            for (let col = 0; col < coarseGrid; col++) {
                const value = field[base + col];
                if (value <= nearSurface) {
                    if (col < levelMinCol) levelMinCol = col;
                    if (col > levelMaxCol) levelMaxCol = col;
                    if (row < levelMinRow) levelMinRow = row;
                    if (row > levelMaxRow) levelMaxRow = row;
                    if (value <= 0 && (col === 0 || row === 0 || col === coarseGrid - 1 || row === coarseGrid - 1)) {
                        insideTouchesEdge = true;
                    }
                }
            }
        }

        if (levelMaxCol >= 0) {
            if (levelMinCol < minCol) minCol = levelMinCol;
            if (levelMaxCol > maxCol) maxCol = levelMaxCol;
            if (levelMinRow < minRow) minRow = levelMinRow;
            if (levelMaxRow > maxRow) maxRow = levelMaxRow;
            levels.push({
                y: batch.sampleY,
                minX: window.minX + (levelMinCol * cellX),
                maxX: window.minX + (levelMaxCol * cellX),
                minZ: window.minZ + (levelMinRow * cellZ),
                maxZ: window.minZ + (levelMaxRow * cellZ),
            });
        }
    }

    if (maxCol < 0) {
        // Nothing near the surface anywhere; keep the full window so the
        // fine pass produces its own diagnostics.
        return { bounds: window, warnings, levels: [], margin: 0 };
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
        levels,
        margin,
    };
}
