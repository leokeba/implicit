import { clamp, lerp } from './math';
import type { VaseSlicerSettings } from './config';
import type { SliceContourLayer } from './types';

/**
 * Bilinear surface query over the finalized contour stack, for postprocess
 * scripts that displace points vertically and need to stay on the model
 * wall. Contours are index-aligned across layers and share a uniform point
 * count, so a (loop parameter, height) pair maps to a wall position with
 * the same interpolation the helix builder uses.
 */

export interface ToolpathSurfaceSample {
    /** Printer-space X of the wall, mm (same space as toolpath point.x). */
    x: number;
    /** Printer-space Z of the wall, mm (same space as toolpath point.z). */
    z: number;
    /** Unit outward normal, X component. */
    nx: number;
    /** Unit outward normal, Z component. */
    nz: number;
}

export interface ToolpathSurface {
    /** Contour samples per revolution; u advances by 1/pointsPerLayer per sample. */
    pointsPerLayer: number;
    /** Number of contour layers backing the query. */
    layerCount: number;
    /** Deposit height of the first contour, mm. Queries below clamp here. */
    minHeightMm: number;
    /** Deposit height of the last contour, mm. Queries above clamp here. */
    maxHeightMm: number;
    /**
     * Sample the model wall at loop parameter u (wraps at 1; same origin and
     * direction as the spiral) and height yMm (clamped to the printed span).
     */
    at(u: number, yMm: number): ToolpathSurfaceSample;
}

/** Null when the contour stack is missing or too small to interpolate. */
export function buildToolpathSurface(
    contourLayers: SliceContourLayer[] | undefined,
    settings: VaseSlicerSettings,
): ToolpathSurface | null {
    if (!contourLayers || contourLayers.length === 0) {
        return null;
    }

    const perLayer = contourLayers[0].contour.length;
    if (perLayer < 3) {
        return null;
    }

    const layerCount = contourLayers.length;
    const heights = contourLayers.map((layer, index) => layer.printHeightMm ?? (settings.layerHeight * (index + 1)));
    // Winding per layer decides which perpendicular of the tangent points
    // outward. Alignment only shifts contours, so layers normally agree;
    // computing per layer keeps normals right even if one flips.
    const orientationSigns = contourLayers.map((layer) => (signedAreaXZ(layer.contour) >= 0 ? 1 : -1));

    const contourPoint = (layerIndex: number, pointIndex: number) => {
        const contour = contourLayers[layerIndex].contour;
        return contour[pointIndex] ?? contour[contour.length - 1];
    };

    const at = (u: number, yMm: number): ToolpathSurfaceSample => {
        if (!Number.isFinite(u) || !Number.isFinite(yMm)) {
            throw new Error('surface.at(u, yMm) requires finite arguments.');
        }

        const wrapped = u - Math.floor(u);
        const s = wrapped * perLayer;
        const k0 = Math.min(Math.floor(s), perLayer - 1);
        const k1 = (k0 + 1) % perLayer;
        const pointBlend = s - k0;

        const y = clamp(yMm, heights[0], heights[layerCount - 1]);
        // Largest layer with deposit height <= y; heights are increasing.
        let low = 0;
        let high = layerCount - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (heights[mid] <= y) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        const layerLow = Math.min(low, layerCount - 2);
        const layerHigh = Math.min(layerLow + 1, layerCount - 1);
        const span = heights[layerHigh] - heights[layerLow];
        const layerBlend = span > 1e-9 ? clamp((y - heights[layerLow]) / span, 0, 1) : 0;

        const blended = (pointIndex: number): { x: number; z: number } => {
            const a = contourPoint(layerLow, pointIndex);
            const b = contourPoint(layerHigh, pointIndex);
            return { x: lerp(a.x, b.x, layerBlend), z: lerp(a.z, b.z, layerBlend) };
        };

        const p0 = blended(k0);
        const p1 = blended(k1);
        const sampleX = lerp(p0.x, p1.x, pointBlend);
        const sampleZ = lerp(p0.z, p1.z, pointBlend);

        // Central-difference tangent at both bracketing samples, blended for
        // a normal that varies smoothly along the loop.
        const before = blended((k0 - 1 + perLayer) % perLayer);
        const after = blended((k1 + 1) % perLayer);
        const t0x = p1.x - before.x;
        const t0z = p1.z - before.z;
        const t1x = after.x - p0.x;
        const t1z = after.z - p0.z;
        let tx = lerp(t0x, t1x, pointBlend);
        let tz = lerp(t0z, t1z, pointBlend);
        const tangentLength = Math.hypot(tx, tz);
        if (tangentLength > 1e-9) {
            tx /= tangentLength;
            tz /= tangentLength;
        } else {
            tx = 1;
            tz = 0;
        }

        // For counter-clockwise winding (positive signed area in XZ) the
        // outward perpendicular of (tx, tz) is (tz, -tx).
        const sign = orientationSigns[layerLow];
        const nx = sign > 0 ? tz : -tz;
        const nz = sign > 0 ? -tx : tx;

        return {
            x: settings.centerX + (sampleX * settings.modelScale),
            z: settings.centerZ + (sampleZ * settings.modelScale),
            nx,
            nz,
        };
    };

    return {
        pointsPerLayer: perLayer,
        layerCount,
        minHeightMm: heights[0],
        maxHeightMm: heights[layerCount - 1],
        at,
    };
}

function signedAreaXZ(contour: Array<{ x: number; z: number }>): number {
    let area = 0;
    for (let index = 0; index < contour.length; index++) {
        const a = contour[index];
        const b = contour[(index + 1) % contour.length];
        area += (a.x * b.z) - (b.x * a.z);
    }
    return area * 0.5;
}
