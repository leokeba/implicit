/**
 * Turns a sliced toolpath into preview buffers.
 *
 * Runs once per slice, never per frame. Everything the viewport needs -
 * geometry, bead cross-sections, and every colourable channel - is derived
 * here so the render loop only binds buffers and draws.
 */

import { calculateExtrusionPerMm } from '../slicer/toolpath';
import type { VaseSlicerSettings } from '../slicer/config';
import type { ToolpathPoint } from '../slicer/types';
import type { SceneFieldDefinition } from '../shaders/types';
import {
    FEATURE_BRIM,
    FEATURE_CAP,
    FEATURE_CATEGORIES,
    FEATURE_DWELL,
    FEATURE_FIRST_LAYER,
    FEATURE_SOLID_BOTTOM,
    FEATURE_TRAVEL,
    FEATURE_WALL,
} from './color-ramps';
import { measureChannelDomain } from './domain';
import {
    META_STRIDE_FLOATS,
    type ToolpathChannel,
    type ToolpathPreviewData,
} from './types';

/** Bead width drawn for non-printing moves, in mm. */
const TRAVEL_WIDTH_MM = 0.08;

export function buildToolpathPreviewData(
    points: ToolpathPoint[],
    settings: VaseSlicerSettings,
    fieldDefinitions: SceneFieldDefinition[] = [],
): ToolpathPreviewData {
    const pointCount = points.length;
    const segmentCount = Math.max(0, pointCount - 1);
    const invScale = 1 / Math.max(1e-6, settings.modelScale);

    const positions = new Float32Array(pointCount * 3);
    const bounds = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity,
    };

    for (let i = 0; i < pointCount; i++) {
        const point = points[i];
        const x = (point.x - settings.centerX) * invScale;
        const y = settings.minY + point.y * invScale;
        const z = (point.z - settings.centerZ) * invScale;
        positions[i * 3 + 0] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
        if (z < bounds.minZ) bounds.minZ = z;
        if (z > bounds.maxZ) bounds.maxZ = z;
    }

    if (segmentCount === 0) {
        return emptyPreviewData(positions, pointCount, invScale, bounds);
    }

    const meta = new Float32Array(segmentCount * META_STRIDE_FLOATS);
    const feature = new Float32Array(segmentCount);
    const speed = new Float32Array(segmentCount);
    const flow = new Float32Array(segmentCount);
    const layerHeight = new Float32Array(segmentCount);
    const layerIndex = new Float32Array(segmentCount);
    const segmentLength = new Float32Array(segmentCount);
    const dwell = new Float32Array(segmentCount);
    // Travels and zero-length segments are excluded from every ramp domain.
    // A travel's 120 mm/s would compress all printing speeds into the bottom
    // of the ramp, and a duplicate point has no defined flow at all - one of
    // either is enough to waste half the colour range.
    const excluded = new Uint8Array(segmentCount);

    const filamentArea = Math.PI * Math.pow(settings.filamentDiameter * 0.5, 2);
    const halfTravelWidthScene = TRAVEL_WIDTH_MM * 0.5 * invScale;

    let nominalCacheKey = '';
    let nominalCached = calculateExtrusionPerMm(settings, settings.lineWidth);
    let travelSegmentCount = 0;
    let maxLayer = 0;
    let anyDwell = false;

    for (let s = 0; s < segmentCount; s++) {
        const from = points[s];
        const to = points[s + 1];
        const lengthMm = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
        const travel = to.travel === true;

        // `to` describes the move that ends at it: its feedrate, its extruder
        // delta, its travel flag. Travels carry no F of their own in the
        // point stream - G-code emits them at the machine travel speed.
        const layer = Math.max(0, Math.floor(to.layer));
        if (layer > maxLayer) maxLayer = layer;

        const thicknessMm = Math.max(1e-4, to.layerThicknessMm ?? settings.layerHeight);
        const lineWidthMm = layer === 0 ? settings.firstLayerLineWidth : settings.lineWidth;
        const cacheKey = `${lineWidthMm}:${thicknessMm}`;
        if (cacheKey !== nominalCacheKey) {
            nominalCacheKey = cacheKey;
            nominalCached = calculateExtrusionPerMm(settings, lineWidthMm, thicknessMm);
        }

        const extrusionPerMm = lengthMm > 1e-9 ? Math.max(0, to.e - from.e) / lengthMm : 0;
        const dwellMs = Math.max(0, to.dwellAfterMs ?? 0);
        if (dwellMs > 0) anyDwell = true;

        feature[s] = classifyFeature(to, travel, dwellMs, layer, settings);
        speed[s] = travel ? settings.travelSpeedMmPerSec : Math.max(0, to.speedMmPerSec);
        flow[s] = travel ? 1 : extrusionPerMm / Math.max(1e-9, nominalCached);
        layerHeight[s] = thicknessMm;
        layerIndex[s] = layer;
        segmentLength[s] = lengthMm;
        dwell[s] = dwellMs;
        excluded[s] = travel || lengthMm < 1e-6 ? 1 : 0;
        if (travel) travelSegmentCount++;

        const halfWidthScene = travel
            ? halfTravelWidthScene
            : beadWidthMm(extrusionPerMm * filamentArea, thicknessMm) * 0.5 * invScale;
        const halfHeightScene = travel ? halfTravelWidthScene : thicknessMm * 0.5 * invScale;

        const base = s * META_STRIDE_FLOATS;
        meta[base + 0] = halfWidthScene;
        meta[base + 1] = halfHeightScene;
        meta[base + 2] = travel ? 1 : 0;
        meta[base + 3] = layer;
    }

    const layerCount = maxLayer + 1;
    const channels: ToolpathChannel[] = [
        {
            key: 'feature',
            label: 'Feature type',
            kind: 'categorical',
            values: feature,
            ...measureChannelDomain(
                { kind: 'categorical', categoryCount: FEATURE_CATEGORIES.length },
                feature,
                excluded,
                0,
                segmentCount,
            ),
            unit: '',
            decimals: 0,
            categories: FEATURE_CATEGORIES,
        },
        sequentialChannel('speed', 'Speed', speed, excluded, 'mm/s', 0, {
            description: 'Range covers printing moves; travels are clamped to the top of the ramp.',
        }),
        divergingChannel('flow', 'Flow ratio', flow, excluded, 'x', 2, 1, {
            description: 'Deposited cross-section vs the bead the current line width and layer height call for. 1.00 is on model.',
        }),
        sequentialChannel('layerIndex', 'Layer index', layerIndex, excluded, '', 0),
        sequentialChannel('segmentLength', 'Segment length', segmentLength, excluded, 'mm', 3),
    ];

    // Only offer modes that can actually show variation: a flat ramp is a
    // dead menu entry that costs a click to discover.
    const layerHeightChannel = sequentialChannel('layerHeight', 'Layer height', layerHeight, excluded, 'mm', 3);
    if (layerHeightChannel.max - layerHeightChannel.min > 1e-4) {
        channels.push(layerHeightChannel);
    }
    if (anyDwell) {
        channels.push(sequentialChannel('dwell', 'Dwell', dwell, excluded, 'ms', 0));
    }
    channels.push(...buildSceneFieldChannels(points, fieldDefinitions, excluded));

    return {
        positions,
        pointCount,
        segmentCount,
        meta,
        channels,
        layerCount,
        layerSegmentStarts: buildLayerSegmentStarts(layerIndex, layerCount, segmentCount),
        excludedFromDomain: excluded,
        travelSegmentCount,
        bounds,
        sceneUnitsPerMm: invScale,
    };
}

function classifyFeature(
    point: ToolpathPoint,
    travel: boolean,
    dwellMs: number,
    layer: number,
    settings: VaseSlicerSettings,
): number {
    if (travel) return FEATURE_TRAVEL;
    if (dwellMs > 0) return FEATURE_DWELL;
    if (point.feature === 'brim') return FEATURE_BRIM;
    if (point.feature === 'bottom') return FEATURE_SOLID_BOTTOM;
    if (point.feature === 'cap') return FEATURE_CAP;
    if (layer === 0) return FEATURE_FIRST_LAYER;
    if (layer < settings.bottomLayers) return FEATURE_SOLID_BOTTOM;
    return FEATURE_WALL;
}

/**
 * Inverts the stadium bead model used by `calculateExtrusionPerMm`: given the
 * cross-section actually deposited and the layer thickness, recover the width
 * the bead spreads to. Over-extrusion therefore shows up as a fatter line in
 * the preview, not only as a hotter colour.
 */
function beadWidthMm(areaMm2: number, thicknessMm: number): number {
    if (areaMm2 <= 0) {
        return 0;
    }

    const stadiumWidth = areaMm2 / thicknessMm + thicknessMm * (1 - Math.PI / 4);
    const width = stadiumWidth > thicknessMm
        ? stadiumWidth
        : (4 * areaMm2) / (Math.PI * thicknessMm);
    return Math.min(10, Math.max(0.02, width));
}

interface ChannelExtras {
    description?: string;
}

function sequentialChannel(
    key: string,
    label: string,
    values: Float32Array,
    excluded: Uint8Array,
    unit: string,
    decimals: number,
    extras: ChannelExtras = {},
): ToolpathChannel {
    const domain = measureChannelDomain({ kind: 'sequential' }, values, excluded, 0, values.length);
    return { key, label, kind: 'sequential', values, ...domain, unit, decimals, ...extras };
}

function divergingChannel(
    key: string,
    label: string,
    values: Float32Array,
    excluded: Uint8Array,
    unit: string,
    decimals: number,
    neutral: number,
    extras: ChannelExtras = {},
): ToolpathChannel {
    const domain = measureChannelDomain({ kind: 'diverging', neutral }, values, excluded, 0, values.length);
    return { key, label, kind: 'diverging', values, ...domain, neutral, unit, decimals, ...extras };
}

const VECTOR_COMPONENT_SUFFIX = ['x', 'y', 'z', 'w'];

/**
 * Postprocess scripts attach scene fields per point, so the pattern a script
 * is driven by can be inspected directly on the toolpath it produced.
 */
function buildSceneFieldChannels(
    points: ToolpathPoint[],
    fieldDefinitions: SceneFieldDefinition[],
    excluded: Uint8Array,
): ToolpathChannel[] {
    const segmentCount = excluded.length;
    const channels: ToolpathChannel[] = [];

    for (const definition of fieldDefinitions) {
        const componentCount = definition.type === 'float'
            ? 1
            : Number.parseInt(definition.type.slice(3), 10);

        for (let component = 0; component < componentCount; component++) {
            const values = new Float32Array(segmentCount);
            let present = false;

            for (let s = 0; s < segmentCount; s++) {
                const raw = points[s + 1].sceneFields?.[definition.key];
                if (raw === undefined) continue;
                const value = typeof raw === 'number' ? (component === 0 ? raw : 0) : (raw[component] ?? 0);
                if (Number.isFinite(value)) {
                    values[s] = value;
                    present = true;
                }
            }

            if (!present) continue;

            const label = componentCount === 1
                ? definition.label
                : `${definition.label}.${VECTOR_COMPONENT_SUFFIX[component]}`;
            // The domain comes from the data rather than the manifest's
            // declared range: a field that only exercises a slice of its
            // range still deserves the full ramp.
            channels.push(sequentialChannel(
                `field:${definition.key}:${component}`,
                label,
                values,
                excluded,
                '',
                3,
                {
                    description: definition.description
                        ?? `Scene field declared over ${definition.minValue} to ${definition.maxValue}.`,
                },
            ));
        }
    }

    return channels;
}

function buildLayerSegmentStarts(
    layerIndex: Float32Array,
    layerCount: number,
    segmentCount: number,
): Int32Array {
    const starts = new Int32Array(layerCount + 1).fill(segmentCount);
    for (let s = 0; s < segmentCount; s++) {
        const layer = layerIndex[s];
        if (starts[layer] > s) {
            starts[layer] = s;
        }
    }

    // Layers are emitted in order, so the starts must be non-decreasing; a
    // layer with no segments of its own collapses onto the next one.
    for (let layer = layerCount - 1; layer >= 0; layer--) {
        if (starts[layer] > starts[layer + 1]) {
            starts[layer] = starts[layer + 1];
        }
    }

    return starts;
}

function emptyPreviewData(
    positions: Float32Array,
    pointCount: number,
    sceneUnitsPerMm: number,
    bounds: ToolpathPreviewData['bounds'],
): ToolpathPreviewData {
    return {
        positions,
        pointCount,
        segmentCount: 0,
        meta: new Float32Array(0),
        channels: [],
        layerCount: 0,
        layerSegmentStarts: new Int32Array(1),
        excludedFromDomain: new Uint8Array(0),
        travelSegmentCount: 0,
        bounds,
        sceneUnitsPerMm,
    };
}
