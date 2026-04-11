import type { ToolpathPostprocessConfig } from '../core/toolpath-postprocess';
import type { VaseSlicerSettings } from '../core/slicer';
import { getActiveSceneId } from '../core/shader-pipeline';

export function buildSlicerFilename(
    settings: VaseSlicerSettings,
    postprocessConfig?: ToolpathPostprocessConfig | null,
): string {
    const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
    const modelSlug = slugifyForFilename(getActiveSceneId(), 'model');
    const printerSlug = slugifyForFilename(settings.printerModelId, 'printer');
    const nozzleSlug = buildNozzleSlug(settings.nozzleDiameter);
    const postprocessSlug = buildPostprocessSlug(postprocessConfig);
    const parts = [modelSlug, printerSlug, nozzleSlug, postprocessSlug, stamp].filter(Boolean);
    return `${parts.join('-')}.gcode`;
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

function buildNozzleSlug(nozzleDiameter: number): string {
    if (!Number.isFinite(nozzleDiameter) || nozzleDiameter <= 0) {
        return 'nozzle-unknown';
    }

    const compact = nozzleDiameter
        .toFixed(2)
        .replace(/0+$/, '')
        .replace(/\.$/, '')
        .replace('.', 'p');
    return `${compact}`;
}

function buildPostprocessSlug(config?: ToolpathPostprocessConfig | null): string | null {
    if (!config?.enabled) {
        return null;
    }

    const patternSlug = slugifyForFilename(config.scriptId || config.scriptName, 'postprocess');
    return `${patternSlug}`;
}
