// Knit Loops
//
// Rebuilds each pitched-spiral revolution into rows of upward loops, like
// wire-knit / fabric prints: slow anchor stitches welded to the wall, and
// over-extruded loop segments drawn up through free air between them. The
// nozzle dwells at each loop apex so the strand cools and stiffens before
// descending to the next anchor. Requires a spiral pitch above the layer
// height (Print Geometry -> Spiral pitch); loops stay pinned to the model
// wall via context.surface, and the next row anchors onto the loop tops.

const PI = Math.PI;

export const controls = {
    stitchesPerRow: { default: 72, min: 8, max: 256, step: 1, label: 'Stitches per row', section: 'Knit Loops', description: 'Anchor count per revolution.' },
    loopDepthMm: { default: 2.5, min: 0.0, max: 8.0, step: 0.1, label: 'Loop depth (mm)', section: 'Knit Loops', description: 'Outward bulge of each loop from the wall.' },
    loopRiseFactor: { default: 0.75, min: 0.0, max: 1.5, step: 0.05, label: 'Loop rise (x pitch)', section: 'Knit Loops', description: 'How far loops rise above the anchors, as a fraction of the spiral pitch.' },
    loopSegments: { default: 4, min: 2, max: 8, step: 1, label: 'Loop segments', section: 'Knit Loops', description: 'Path samples per loop; more = rounder.' },
    loopFlowMmPerMm: { default: 0.05, min: 0.0, max: 0.5, step: 0.005, label: 'Loop flow (mm/mm)', section: 'Knit Loops', description: 'Filament mm per path mm for airborne loop segments.' },
    loopSpeedMmPerSec: { default: 12.0, min: 1.0, max: 60.0, step: 0.5, label: 'Loop speed (mm/s)', section: 'Knit Loops', description: 'Speed while drawing loops through the air.' },
    anchorSpeedMmPerSec: { default: 8.0, min: 1.0, max: 60.0, step: 0.5, label: 'Anchor speed (mm/s)', section: 'Knit Loops', description: 'Speed for the short welds at each anchor.' },
    apexDwellMs: { default: 250, min: 0, max: 2000, step: 10, label: 'Apex dwell (ms)', section: 'Knit Loops', description: 'Pause at the top of each loop so the filament cools before the descent.' },
};

export function transform(context: any) {
    const surface = context.surface;
    const settings = context.settings ?? {};
    const pitchMm = Number(settings.spiralPitchMm ?? 0);
    const layerHeight = Number(settings.layerHeight ?? 0.2);
    const perLayer = Math.max(1, Number(settings.pointsPerLayer ?? 1));

    if (!surface || pitchMm <= layerHeight) {
        return {
            points: context.points,
            notes: ['Knit loops bypassed: set Spiral pitch above the layer height (surface + pitched rows required).'],
        };
    }

    const stitchesPerRow = Math.max(8, Math.round(Number(context.params?.stitchesPerRow ?? 72)));
    const loopDepthMm = Number(context.params?.loopDepthMm ?? 2.5);
    const loopRiseMm = Number(context.params?.loopRiseFactor ?? 0.75) * pitchMm;
    const loopSegments = Math.max(2, Math.round(Number(context.params?.loopSegments ?? 4)));
    const loopFlowMmPerMm = Number(context.params?.loopFlowMmPerMm ?? 0.05);
    const loopSpeedMmPerSec = Number(context.params?.loopSpeedMmPerSec ?? 12.0);
    const anchorSpeedMmPerSec = Number(context.params?.anchorSpeedMmPerSec ?? 8.0);
    const apexDwellMs = Number(context.params?.apexDwellMs ?? 250);
    const apexSegment = Math.round(loopSegments / 2);

    // Flat adhesion/bottom layers pass through untouched.
    const flatLayerCount = Math.max(1, Number(settings.bottomLayers ?? 0));

    const nextPoints: any[] = [];
    let rowCount = 0;
    let stitchCount = 0;

    for (const row of context.layers) {
        const rowPoints = context.points.slice(row.startIndex, row.endIndex + 1);
        if (rowPoints.length === 0) {
            continue;
        }

        if (rowPoints[0].layer < flatLayerCount) {
            nextPoints.push(...rowPoints);
            continue;
        }

        rowCount += 1;
        const stride = rowPoints.length / stitchesPerRow;
        // Anchor at evenly strided samples of the original revolution, always
        // keeping the row's final point so the path hands off to the next row.
        let previousAnchorIndex = -1;
        for (let stitch = 0; stitch <= stitchesPerRow; stitch++) {
            const anchorIndex = stitch === stitchesPerRow
                ? rowPoints.length - 1
                : Math.min(rowPoints.length - 1, Math.round(stitch * stride));
            if (anchorIndex <= previousAnchorIndex) {
                continue;
            }

            const anchor = rowPoints[anchorIndex];
            if (previousAnchorIndex >= 0) {
                const from = rowPoints[previousAnchorIndex];
                // Loop rises outward and up between the two anchors, riding
                // the wall at each sample's height. The apex dwells so the
                // strand cools before the nozzle descends again.
                for (let segment = 1; segment < loopSegments; segment++) {
                    const t = segment / loopSegments;
                    const swell = Math.sin(PI * t);
                    const u = (from.metrics.layerPointIndex + ((anchor.metrics.layerPointIndex - from.metrics.layerPointIndex) * t)) / perLayer;
                    const y = (from.y + ((anchor.y - from.y) * t)) + (loopRiseMm * swell);
                    const wall = surface.at(u, y);
                    nextPoints.push({
                        x: wall.x + (wall.nx * loopDepthMm * swell),
                        y,
                        z: wall.z + (wall.nz * loopDepthMm * swell),
                        layer: anchor.layer,
                        speedMmPerSec: loopSpeedMmPerSec,
                        extrusionPerMmOverride: loopFlowMmPerMm,
                        layerThicknessMm: anchor.layerThicknessMm,
                        dwellAfterMs: segment === apexSegment ? apexDwellMs : undefined,
                    });
                }
                stitchCount += 1;
            }

            nextPoints.push({
                ...anchor,
                speedMmPerSec: anchorSpeedMmPerSec,
            });
            previousAnchorIndex = anchorIndex;
        }
    }

    return {
        points: nextPoints,
        notes: [
            `Knit loops: ${rowCount} rows, ${stitchCount} stitches, depth ${loopDepthMm.toFixed(1)}mm, rise ${loopRiseMm.toFixed(1)}mm, flow ${loopFlowMmPerMm.toFixed(3)}mm/mm.`,
        ],
    };
}
