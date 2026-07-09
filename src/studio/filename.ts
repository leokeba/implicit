import { getActiveSceneId } from '../core/shader-pipeline';
import type { SceneManifest } from '../scene-runtime';
import type { VaseSlicerSettings } from '../core/slicer';

export function buildSlicerFilename(
    settings: VaseSlicerSettings,
    manifest: SceneManifest,
    templateValues: Record<string, number>,
    pipelineSlugs: string[],
): string {
    const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
    const modelSlug = slugifyForFilename(getActiveSceneId(), 'model');
    const printerSlug = slugifyForFilename(settings.printerModelId, 'printer');
    const nozzleSlug = buildNozzleSlug(settings.nozzleDiameter);
    const stepSlugs = pipelineSlugs.map((slug) => slugifyForFilename(slug, '')).filter(Boolean);
    const suffixSlug = buildManifestSuffixSlug(manifest, templateValues);
    const parts = [modelSlug, printerSlug, nozzleSlug, ...stepSlugs, suffixSlug, stamp].filter(Boolean);
    return `${parts.join('-')}.gcode`;
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

function buildManifestSuffixSlug(manifest: SceneManifest, templateValues: Record<string, number>): string | null {
    const template = manifest.export.filenameSuffix?.trim() ?? '';
    if (!template) {
        return null;
    }

    const partIndex = readIntegerValue(templateValues.partIndex ?? templateValues.uPartIndex);
    const partCount = readIntegerValue(templateValues.partCount ?? templateValues.uPartCount);
    const safeIndex = partIndex ?? 0;
    const safePart = safeIndex + 1;
    const safeCount = Math.max(partCount ?? safePart, safePart, 1);
    const padWidth = Math.max(String(safeCount).length, 2);

    const resolved = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
        if (token === 'index') {
            return String(safeIndex);
        }
        if (token === 'indexPad') {
            return padInteger(safeIndex, padWidth);
        }
        if (token === 'part') {
            return String(safePart);
        }
        if (token === 'part1') {
            return padInteger(safePart, padWidth);
        }
        if (token === 'count') {
            return padInteger(safeCount, padWidth);
        }

        const value = templateValues[token];
        return typeof value === 'number' && Number.isFinite(value) ? formatTemplateNumber(value) : match;
    });

    const slug = slugifyForFilename(resolved, '');
    return slug || null;
}

function formatTemplateNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function readIntegerValue(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    return Math.max(0, Math.floor(value));
}

function padInteger(value: number, width: number): string {
    return Math.max(0, Math.floor(value)).toString().padStart(width, '0');
}
