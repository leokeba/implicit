/**
 * Preview-side view of a sliced toolpath: geometry plus every per-segment
 * attribute the slicer produced, laid out as typed arrays for direct upload
 * to WebGL.
 *
 * Everything here is *per segment*, not per point. A toolpath point carries
 * the parameters of the move that *ends* at it (`speedMmPerSec` is that
 * move's feedrate, `e` is the extruder position after it, `travel` marks it
 * as a non-printing move), so segment i - from point i to point i + 1 - is
 * described by point i + 1. Colouring per segment also means a speed or flow
 * change lands on an exact boundary instead of being smeared across two
 * segments by interpolation.
 */

export type ToolpathRampKind = 'sequential' | 'diverging' | 'categorical';

export interface ToolpathCategory {
    label: string;
    /** Linear RGB in 0..1. */
    color: [number, number, number];
}

/**
 * Everything about a colourable quantity except its samples. The UI only ever
 * needs this half, so the megabyte of per-segment data never has to cross into
 * component state.
 */
export interface ToolpathChannelSummary {
    key: string;
    label: string;
    kind: ToolpathRampKind;
    min: number;
    max: number;
    /** Ramp midpoint for diverging channels, in domain units. */
    neutral?: number;
    unit: string;
    /** Decimal places for legend tick labels. */
    decimals: number;
    /** Present only when kind === 'categorical'; value i indexes this list. */
    categories?: ToolpathCategory[];
    /** Extra context for the legend, e.g. how a ratio was normalised. */
    description?: string;
}

/** A channel summary plus its one-sample-per-segment data. */
export interface ToolpathChannel extends ToolpathChannelSummary {
    values: Float32Array;
}

export function summarizeChannel(channel: ToolpathChannel): ToolpathChannelSummary {
    const { values, ...summary } = channel;
    void values;
    return summary;
}

export interface ToolpathPreviewBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
}

export interface ToolpathPreviewData {
    /** Scene-space xyz per point; segment i spans points i and i + 1. */
    positions: Float32Array;
    pointCount: number;
    segmentCount: number;
    /**
     * Per segment: half-width and half-height of the deposited bead in scene
     * units, a travel flag (0 or 1), and the layer index. Packed as vec4 so
     * the renderer binds one buffer instead of four.
     */
    meta: Float32Array;
    channels: ToolpathChannel[];
    layerCount: number;
    /**
     * Index of the first segment of each layer, plus a terminating
     * `segmentCount`. Segments are layer-ordered, so a layer range maps to a
     * contiguous draw range.
     */
    layerSegmentStarts: Int32Array;
    /**
     * Segments left out of every ramp domain: travels, whose speeds belong to
     * a different regime, and zero-length moves, which have no defined flow.
     */
    excludedFromDomain: Uint8Array;
    travelSegmentCount: number;
    bounds: ToolpathPreviewBounds;
    /** Scene units per mm, for converting sizes back for display. */
    sceneUnitsPerMm: number;
}

export const META_STRIDE_FLOATS = 4;
export const META_HALF_WIDTH = 0;
export const META_HALF_HEIGHT = 1;
export const META_TRAVEL = 2;
export const META_LAYER = 3;
