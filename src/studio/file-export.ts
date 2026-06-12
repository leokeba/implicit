import { getActiveSceneId } from '../core/shader-pipeline';

import type { SceneManifest } from '../scene-runtime';
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
        const response = await fetch(`${normalizedBaseUrl}/server/info`, withLocalNetworkHint(normalizedBaseUrl, {
            method: 'GET',
            headers,
        }));
        return response.ok;
    } catch {
        return false;
    }
}

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

    const response = await fetch(`${normalizedBaseUrl}/server/files/upload`, withLocalNetworkHint(normalizedBaseUrl, {
        method: 'POST',
        body: formData,
        headers,
    }));

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

/**
 * Chrome's Local Network Access lets a secure page reach an HTTP printer on
 * the LAN: declaring the target address space up front exempts the request
 * from mixed-content blocking behind a one-time permission prompt. Chrome can
 * only pre-classify private IP literals and .local hostnames; the extra
 * RequestInit member is ignored by browsers that don't know it.
 */
function withLocalNetworkHint(baseUrl: string, init: RequestInit): RequestInit {
    if (!isPrivateHttpTarget(baseUrl)) {
        return init;
    }

    return { ...init, targetAddressSpace: 'local' } as RequestInit;
}

function isPrivateHttpTarget(baseUrl: string): boolean {
    try {
        const url = new URL(baseUrl);
        if (url.protocol !== 'http:') {
            return false;
        }

        const host = url.hostname;
        return host.endsWith('.local')
            || /^10\./.test(host)
            || /^192\.168\./.test(host)
            || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
            || /^169\.254\./.test(host);
    } catch {
        return false;
    }
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
