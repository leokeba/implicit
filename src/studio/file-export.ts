import { getActiveSceneId } from '../core/shader-pipeline';
import type { VaseSlicerSettings } from '../core/slicer';

export function buildSlicerFilename(settings: VaseSlicerSettings): string {
    const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
    const modelSlug = slugifyForFilename(getActiveSceneId(), 'model');
    const printerSlug = slugifyForFilename(settings.printerModelId, 'printer');
    return `${modelSlug}-${printerSlug}-${stamp}.gcode`;
}

export function downloadTextFile(filename: string, text: string): void {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function slugifyForFilename(value: string, fallback: string): string {
    const normalized = value
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return normalized.length > 0 ? normalized : fallback;
}
