import { getActiveSceneId, getSceneDefaultParams } from '../core/shader-pipeline';

import type { ToolpathPostprocessConfig } from '../core/toolpath-postprocess';
import type { VaseSlicerSettings } from '../core/slicer';

export interface MoonrakerUploadOptions {
    baseUrl: string;
    apiKey?: string;
    print?: boolean;
    root?: 'gcodes' | 'config';
    path?: string;
}

export interface MoonrakerUploadResult {
    path: string;
    root: string;
    printStarted: boolean;
    printQueued: boolean;
}

export async function checkMoonrakerAvailability(baseUrl: string, apiKey?: string): Promise<boolean> {
    const normalizedBaseUrl = normalizeMoonrakerBaseUrl(baseUrl);
    if (!normalizedBaseUrl) {
        return false;
    }

    const headers = new Headers();
    if (apiKey?.trim()) {
        headers.set('X-Api-Key', apiKey.trim());
    }

    try {
        const response = await fetch(`${normalizedBaseUrl}/server/info`, {
            method: 'GET',
            headers,
        });
        return response.ok;
    } catch {
        return false;
    }
}

export function buildSlicerFilename(
    settings: VaseSlicerSettings,
    postprocessConfig?: ToolpathPostprocessConfig | null,
): string {
    const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
    const modelSlug = slugifyForFilename(getActiveSceneId(), 'model');
    const printerSlug = slugifyForFilename(settings.printerModelId, 'printer');
    const nozzleSlug = buildNozzleSlug(settings.nozzleDiameter);
    const postprocessSlug = buildPostprocessSlug(postprocessConfig);
    const sceneSuffixSlug = buildSceneSuffixSlug();
    const parts = [modelSlug, printerSlug, nozzleSlug, postprocessSlug, sceneSuffixSlug, stamp].filter(Boolean);
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

export async function uploadGcodeToMoonraker(
    filename: string,
    gcode: string,
    options: MoonrakerUploadOptions,
): Promise<MoonrakerUploadResult> {
    const normalizedBaseUrl = normalizeMoonrakerBaseUrl(options.baseUrl);
    if (!normalizedBaseUrl) {
        throw new Error('Printer host is required.');
    }

    const root = options.root ?? 'gcodes';
    const shouldStartPrint = Boolean(options.print);
    const formData = new FormData();
    formData.append('file', new Blob([gcode], { type: 'text/plain;charset=utf-8' }), filename);
    formData.append('root', root);
    formData.append('print', shouldStartPrint ? 'true' : 'false');

    const uploadPath = options.path?.trim();
    if (uploadPath) {
        formData.append('path', uploadPath);
    }

    const headers = new Headers();
    if (options.apiKey?.trim()) {
        headers.set('X-Api-Key', options.apiKey.trim());
    }

    const response = await fetch(`${normalizedBaseUrl}/server/files/upload`, {
        method: 'POST',
        body: formData,
        headers,
    });

    if (!response.ok) {
        const detail = await safeReadResponseText(response);
        throw new Error(`Moonraker upload failed (${response.status}): ${detail}`);
    }

    const payload = await response.json() as {
        result?: MoonrakerUploadPayload;
        item?: {
            path?: string;
            root?: string;
        };
        print_started?: boolean;
        print_queued?: boolean;
    };

    const uploadPayload: MoonrakerUploadPayload = (payload.result && typeof payload.result === 'object')
        ? payload.result
        : payload;

    const fallbackItem = getFallbackUploadItem(response, filename);
    const itemPath = uploadPayload.item?.path ?? fallbackItem.path;
    const itemRoot = uploadPayload.item?.root ?? fallbackItem.root;
    if (!itemPath || !itemRoot) {
        throw new Error('Moonraker upload response was missing file metadata.');
    }

    return {
        path: itemPath,
        root: itemRoot,
        printStarted: Boolean(uploadPayload.print_started),
        printQueued: Boolean(uploadPayload.print_queued),
    };
}

interface MoonrakerUploadPayload {
    item?: {
        path?: string;
        root?: string;
    };
    print_started?: boolean;
    print_queued?: boolean;
}

function normalizeMoonrakerBaseUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, '');
}

async function safeReadResponseText(response: Response): Promise<string> {
    try {
        const text = await response.text();
        return text.trim() || response.statusText || 'Request failed';
    } catch {
        return response.statusText || 'Request failed';
    }
}

function getFallbackUploadItem(response: Response, filename: string): { path: string; root: 'gcodes' } {
    const location = response.headers.get('Location')?.trim() ?? '';
    if (!location) {
        return { path: filename, root: 'gcodes' };
    }

    const gcodesSegment = '/server/files/gcodes/';
    const segmentIndex = location.indexOf(gcodesSegment);
    if (segmentIndex < 0) {
        return { path: filename, root: 'gcodes' };
    }

    const encodedPath = location.slice(segmentIndex + gcodesSegment.length);
    const decodedPath = decodeURIComponent(encodedPath).trim();
    return {
        path: decodedPath || filename,
        root: 'gcodes',
    };
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

function buildSceneSuffixSlug(): string | null {
    const params = getSceneDefaultParams();
    const template = typeof params.gcodeSuffix === 'string' ? params.gcodeSuffix.trim() : '';
    if (!template) {
        return null;
    }

    const partIndex = readSceneIntegerParam(params.partIndex);
    const partCount = readSceneIntegerParam(params.partCount);
    const resolved = interpolateSceneSuffixTemplate(template, partIndex, partCount);
    const slug = slugifyForFilename(resolved, '');
    return slug || null;
}

function interpolateSceneSuffixTemplate(template: string, partIndex: number | null, partCount: number | null): string {
    const safeIndex = partIndex ?? 0;
    const safePart = safeIndex + 1;
    const safeCount = Math.max(partCount ?? safePart, safePart, 1);
    const padWidth = Math.max(String(safeCount).length, 2);

    return template
        .replaceAll('{index}', String(safeIndex))
        .replaceAll('{indexPad}', padInteger(safeIndex, padWidth))
        .replaceAll('{part}', String(safePart))
        .replaceAll('{part1}', padInteger(safePart, padWidth))
        .replaceAll('{count}', padInteger(safeCount, padWidth));
}

function readSceneIntegerParam(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    return Math.max(0, Math.floor(value));
}

function padInteger(value: number, width: number): string {
    return Math.max(0, Math.floor(value)).toString().padStart(width, '0');
}
