import type { SceneControlDefinition, SceneControlValueMap } from '../shader-pipeline';
import type { VaseSlicerSettings } from './config';
import type { SliceBounds } from './types';

/**
 * The sampling ↔ slicing boundary.
 *
 * A field sampler evaluates the scene's signed-distance field over horizontal
 * slices and returns plain float grids; everything downstream (marching
 * squares, contour selection, toolpath, G-code) is sampler-agnostic CPU
 * geometry. Implementations may batch and pipeline however they like (the
 * GPU sampler renders batches into an FBO and reads back through a fenced
 * pixel-pack buffer); a CPU implementation can compute in `issueBatch` and
 * make `wait` a no-op.
 *
 * Field layout contract: `field` is row-major `gridSize × gridSize`.
 * `field[row * gridSize + col]` is the signed distance at
 *   x = lerp(bounds.minX, bounds.maxX, col / (gridSize - 1))
 *   z = lerp(bounds.minZ, bounds.maxZ, row / (gridSize - 1))
 * i.e. row 0 is the minZ edge. Values are SDF-space distances (negative
 * inside the surface); out-of-range samples saturate to the encoder's
 * distance range.
 */
export interface FieldBatch {
    /** SDF-space Y of this slice. */
    sampleY: number;
    /** Row-major gridSize×gridSize signed distances (see layout contract above). */
    field: Float32Array;
}

export interface FieldBatchRequest {
    bounds: SliceBounds;
    gridSize: number;
    firstSampleY: number;
    sliceYStep: number;
    batchLayerCount: number;
}

/** A batch whose evaluation has been started but not yet consumed. */
export interface PendingFieldBatch {
    /** Resolves when `read` can complete without stalling. */
    wait(): Promise<void>;
    /** Consumes the batch; call at most once, after `wait` resolves. */
    read(): FieldBatch[];
}

export interface FieldSampler {
    /** Scene uniform state applied to every subsequent batch. */
    setSceneControlState(definitions: SceneControlDefinition[], values: SceneControlValueMap): void;
    /** Start evaluating a batch; the previous batch can be consumed while this one runs. */
    issueBatch(settings: VaseSlicerSettings, request: FieldBatchRequest): PendingFieldBatch;
    /** Synchronous convenience for small jobs (e.g. the coarse bounds pre-pass). */
    sampleBatch(settings: VaseSlicerSettings, request: FieldBatchRequest): FieldBatch[];
    /** Largest supported gridSize. */
    maxGridSize(): number;
    /** How many layers of a gridSize-wide batch can be evaluated at once. */
    batchCapacity(gridSize: number): number;
}
