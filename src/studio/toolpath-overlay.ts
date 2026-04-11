import type { ToolpathPoint, VaseSlicerSettings } from '../core/slicer';

export function convertToolpathToScenePoints(
    points: ToolpathPoint[],
    settings: VaseSlicerSettings
): Array<{ x: number; y: number; z: number }> {
    const invScale = 1.0 / Math.max(1e-6, settings.modelScale);
    return points.map((point) => ({
        x: (point.x - settings.centerX) * invScale,
        y: settings.minY + point.y * invScale,
        z: (point.z - settings.centerZ) * invScale,
    }));
}
