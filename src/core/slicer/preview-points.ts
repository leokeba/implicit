/**
 * Builds the point stream the viewport draws.
 *
 * The exported toolpath is only the spiral: the brim and the solid-bottom
 * fill are generated inside the G-code builder and, until this module
 * existed, appeared nowhere but the exported text - so the preview showed a
 * vase floating above a bed plate it never printed.
 *
 * Here those loops are rebuilt from the same functions the emitter uses and
 * merged into the spiral in print order, with each hop between features
 * flagged as a travel, matching the G0 the machine actually runs. The result
 * feeds the preview only; G-code emission still works from the toolpath.
 */

import { collectBottomLayerRings, buildBottomFillLoopSet, buildBrimLoopSet, type SupportLoop2D } from './gcode';
import { calculateExtrusionPerMm } from './toolpath';
import type { VaseSlicerSettings } from './config';
import type { ToolpathPoint, VaseToolpath } from './types';

export function buildPreviewToolpathPoints(
    toolpath: VaseToolpath,
    settings: VaseSlicerSettings,
): ToolpathPoint[] {
    const source = toolpath.points;
    if (source.length < 2) {
        return source;
    }

    const brimLoops = buildBrimLoopSet(toolpath, settings);
    const bottomRings = collectBottomLayerRings(toolpath, settings);
    if (brimLoops.length === 0 && bottomRings.size === 0) {
        return source;
    }

    const points: ToolpathPoint[] = [];
    let eAcc = 0;

    const appendLoop = (
        loop: SupportLoop2D,
        y: number,
        layer: number,
        feature: 'brim' | 'bottom',
        extrusionPerMm: number,
        speedMmPerSec: number,
    ): void => {
        // The emitter walks the loop and closes back onto its first point.
        const closed = [...loop, loop[0]];
        let previous = closed[0];
        points.push({
            x: previous.x,
            y,
            z: previous.y,
            e: eAcc,
            speedMmPerSec: settings.travelSpeedMmPerSec,
            layer,
            layerThicknessMm: settings.layerHeight,
            feature,
            travel: true,
        });

        for (let i = 1; i < closed.length; i++) {
            const target = closed[i];
            const distance = Math.hypot(target.x - previous.x, target.y - previous.y);
            if (distance <= 1e-6) {
                previous = target;
                continue;
            }
            eAcc += distance * extrusionPerMm;
            points.push({
                x: target.x,
                y,
                z: target.y,
                e: eAcc,
                speedMmPerSec,
                layer,
                layerThicknessMm: settings.layerHeight,
                feature,
            });
            previous = target;
        }
    };

    const firstLayerZ = Math.max(settings.layerHeight, source[0].y);
    const brimExtrusionPerMm = calculateExtrusionPerMm(settings, settings.firstLayerLineWidth);
    for (const loop of brimLoops) {
        appendLoop(loop, firstLayerZ, 0, 'brim', brimExtrusionPerMm, settings.firstLayerPrintSpeedMmPerSec);
    }

    const appendBottomFill = (layer: number): void => {
        const ring = bottomRings.get(layer);
        if (!ring || ring.length < 3) {
            return;
        }
        const fillLineWidth = layer === 0 ? settings.firstLayerLineWidth : settings.lineWidth;
        const extrusionPerMm = calculateExtrusionPerMm(settings, fillLineWidth);
        const speed = layer === 0 ? settings.firstLayerPrintSpeedMmPerSec : settings.printSpeedMmPerSec;
        const y = ring[ring.length - 1].y;
        for (const loop of buildBottomFillLoopSet(ring, layer, settings)) {
            appendLoop(loop, y, layer, 'bottom', extrusionPerMm, speed);
        }
    };

    // The spiral, with each completed solid-bottom layer's fill spliced in
    // where the emitter puts it: after the layer's perimeter closes.
    let resumeAsTravel = points.length > 0;
    for (let i = 0; i < source.length; i++) {
        const point = source[i];
        const previousLayer = i > 0 ? source[i - 1].layer : point.layer;
        if (i > 0 && point.layer !== previousLayer && previousLayer < settings.bottomLayers) {
            const before = points.length;
            appendBottomFill(previousLayer);
            resumeAsTravel = resumeAsTravel || points.length > before;
        }

        const delta = i > 0 ? Math.max(0, point.e - source[i - 1].e) : 0;
        eAcc += delta;
        points.push(
            resumeAsTravel
                ? { ...point, e: eAcc, travel: true }
                : { ...point, e: eAcc },
        );
        resumeAsTravel = false;
    }

    // A trailing solid-bottom layer (bottomLayers covering the whole model)
    // never hits a layer change, so its fill is emitted at the end.
    const lastLayer = source[source.length - 1].layer;
    if (lastLayer < settings.bottomLayers) {
        appendBottomFill(lastLayer);
    }

    return points;
}
