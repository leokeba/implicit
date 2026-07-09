import { clamp, lerp } from './math';
import { sampleYToPrintHeightMm, type VaseSlicerSettings } from './config';
import type {
    SliceBounds,
    SliceDebugContourMetric,
    SliceDebugSegment,
    SliceDebugSnapshot,
    SlicePoint,
} from './types';

/**
 * Contour extraction and selection over sampled signed-distance fields.
 * Everything here is pure CPU geometry: inputs are flat row-major
 * `Float32Array` fields (see the layout contract in field-sampler.ts) and
 * outputs are SDF-space contours. No GL types cross this module.
 */

// Disjoint islands smaller than this are skipped with a warning; larger ones fail the slice.
const MAX_SKIPPABLE_ISLAND_AREA_MM2 = 4.0;

export interface SliceContourExtractionDebug {
    closedContours: SlicePoint[][];
    openPolylines: SlicePoint[][];
    segments: SliceDebugSegment[];
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

interface SliceSegmentVertex {
    key: number;
    point: SlicePoint;
}

type SliceSegment = [SliceSegmentVertex, SliceSegmentVertex];

export interface SliceContourSelectionOk {
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

export interface SliceContourSelectionFail {
    ok: false;
    contourCount: number;
    detail: string;
    kind: 'none' | 'islands';
}

export interface SliceLayerWarningStats {
    holeLayers: number;
    maxHoleCount: number;
    droppedLayers: number;
    droppedLargestAreaMm2: number;
    islandLayers: number;
    islandLargestAreaMm2: number;
}

/**
 * Marching squares over a flat row-major field. Only boundary cells (mixed
 * corner signs) pay for interpolation or allocation; the full-grid scan is a
 * tight typed-array loop. Shared cell edges are keyed by integer edge ids so
 * segment joining is exact.
 */
export function extractContoursFromField(field: Float32Array, gridSize: number, bounds: SliceBounds): SliceContourExtractionDebug {
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
            // Cases 0 and 15 are filtered by the caller.
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

export function dedupeClosedContour(points: SlicePoint[]): SlicePoint[] {
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

export function selectPrimaryContour(
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

export function buildContourFailureMessage(
    selection: SliceContourSelectionFail,
    extraction: SliceContourExtractionDebug,
    bounds: SliceBounds,
    gridSize: number,
    settings: VaseSlicerSettings,
    sampleY: number,
    acceptedLayerCount: number,
    layerCount: number,
): string {
    const sliceHeightMm = sampleYToPrintHeightMm(sampleY, settings);
    const layerLabel = `Layer ${acceptedLayerCount + 1}/${layerCount} at Z ${sliceHeightMm.toFixed(2)} mm`;
    let message = selection.kind === 'islands'
        ? `Spiral vase mode needs a single connected outline per layer. ${layerLabel} has ${selection.detail}.`
        : `${layerLabel} produced no closed outline${selection.detail ? ` (${selection.detail})` : ''}.`;
    if (extractionTouchesBounds(extraction, bounds, gridSize)) {
        message += ' The surface crosses the slice window edge - increase "Slice half-extent" or re-center the model in XZ.';
    }
    return message;
}

export function extractionTouchesBounds(
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

export function createSliceLayerWarningStats(): SliceLayerWarningStats {
    return {
        holeLayers: 0,
        maxHoleCount: 0,
        droppedLayers: 0,
        droppedLargestAreaMm2: 0,
        islandLayers: 0,
        islandLargestAreaMm2: 0,
    };
}

export function summarizeSliceLayerWarnings(stats: SliceLayerWarningStats): string[] {
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

export function buildSliceDebugSnapshot(
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
        sliceHeightMm: sampleYToPrintHeightMm(sampleY, settings),
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

export function signedContourArea(points: SlicePoint[]): number {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        area += (current.x * next.z) - (next.x * current.z);
    }
    return area * 0.5;
}

export function contourPerimeter(points: SlicePoint[]): number {
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        perimeter += Math.hypot(next.x - current.x, next.z - current.z);
    }
    return perimeter;
}
