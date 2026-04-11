import type { ToolpathPostprocessLanguage } from '../core/toolpath-postprocess';
import {
    buildBrowserStoragePayload,
    hasDirtyDocuments,
    mergeBrowserDocuments,
    type StoredBrowserDocuments,
} from './documents/repository';

const POSTPROCESS_STORAGE_KEY = 'implicit.postprocessScripts.v1';
const POSTPROCESS_API_ENDPOINT = '/__implicit_api/postprocess-scripts';

const bundledScriptModules = import.meta.glob('../postprocess-scripts/*.{js,ts}', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

export type PostprocessScriptStorageMode = 'browser' | 'filesystem';

export interface PostprocessScriptDocument {
    id: string;
    name: string;
    fileName: string;
    language: ToolpathPostprocessLanguage;
    source: string;
}

export interface PostprocessRepositoryState {
    mode: PostprocessScriptStorageMode;
    documents: PostprocessScriptDocument[];
}

interface ScriptApiDocumentPayload {
    id: string;
    name: string;
    fileName: string;
    language: ToolpathPostprocessLanguage;
    source: string;
}

interface ScriptApiListResponse {
    documents?: ScriptApiDocumentPayload[];
}

interface ScriptApiSingleResponse {
    document?: ScriptApiDocumentPayload;
}

export function getBundledPostprocessDocuments(): PostprocessScriptDocument[] {
    const entries = Object.entries(bundledScriptModules).map(([modulePath, source]) => {
        const fileName = modulePath.split('/').pop() ?? 'postprocess.ts';
        return normalizePostprocessDocument({
            id: fileName.replace(/\.(js|ts)$/i, ''),
            name: toScriptLabel(fileName.replace(/\.(js|ts)$/i, '')),
            fileName,
            language: inferLanguageFromFileName(fileName),
            source,
        });
    });

    return sortPostprocessDocuments(entries);
}

export async function loadPostprocessRepository(defaultDocuments: PostprocessScriptDocument[]): Promise<PostprocessRepositoryState> {
    const filesystemDocuments = await loadFilesystemPostprocessDocuments();
    if (filesystemDocuments) {
        return {
            mode: 'filesystem',
            documents: filesystemDocuments,
        };
    }

    return {
        mode: 'browser',
        documents: loadBrowserPostprocessDocuments(defaultDocuments),
    };
}

export async function reloadFilesystemPostprocessDocuments(): Promise<PostprocessScriptDocument[] | null> {
    return loadFilesystemPostprocessDocuments();
}

export async function savePostprocessDocument(
    mode: PostprocessScriptStorageMode,
    targetDocument: PostprocessScriptDocument,
    defaultDocuments: PostprocessScriptDocument[],
    currentDocuments: PostprocessScriptDocument[]
): Promise<PostprocessScriptDocument[]> {
    if (mode === 'filesystem') {
        return saveFilesystemPostprocessDocument(targetDocument, currentDocuments);
    }

    persistBrowserPostprocessDocuments(defaultDocuments, currentDocuments);
    return clonePostprocessDocuments(currentDocuments);
}

export function createPostprocessDocument(
    existingDocuments: PostprocessScriptDocument[],
    language: ToolpathPostprocessLanguage = 'typescript',
    requestedName?: string,
): PostprocessScriptDocument {
    const baseName = (requestedName ?? 'New Postprocess').trim() || 'New Postprocess';
    const existingIds = new Set(existingDocuments.map((document) => document.id));
    const baseId = toScriptId(baseName);

    let nextId = baseId;
    let suffix = 2;
    while (existingIds.has(nextId)) {
        nextId = `${baseId}_${suffix}`;
        suffix += 1;
    }

    const extension = language === 'javascript' ? 'js' : 'ts';
    return {
        id: nextId,
        name: toScriptLabel(nextId),
        fileName: `${nextId}.${extension}`,
        language,
        source: buildDefaultPostprocessSource(nextId, language),
    };
}

export function hasDirtyPostprocessDocuments(
    workingDocuments: PostprocessScriptDocument[],
    persistedDocuments: PostprocessScriptDocument[]
): boolean {
    return hasDirtyDocuments(workingDocuments, persistedDocuments, (working, persisted) => (
        working.id === persisted.id &&
        working.source === persisted.source &&
        working.fileName === persisted.fileName &&
        working.language === persisted.language
    ));
}

function loadBrowserPostprocessDocuments(defaultDocuments: PostprocessScriptDocument[]): PostprocessScriptDocument[] {
    const stored = readStoredBrowserDocuments();
    return mergeBrowserDocuments(defaultDocuments, stored, clonePostprocessDocument, sortPostprocessDocuments);
}

function persistBrowserPostprocessDocuments(defaultDocuments: PostprocessScriptDocument[], currentDocuments: PostprocessScriptDocument[]): void {
    if (typeof localStorage === 'undefined') {
        return;
    }

    const payload = buildBrowserStoragePayload(defaultDocuments, currentDocuments, clonePostprocessDocument);

    try {
        localStorage.setItem(
            POSTPROCESS_STORAGE_KEY,
            JSON.stringify(payload)
        );
    } catch {
        // Ignore storage write failures.
    }
}

async function loadFilesystemPostprocessDocuments(): Promise<PostprocessScriptDocument[] | null> {
    if (typeof fetch === 'undefined') {
        return null;
    }

    try {
        const response = await fetch(POSTPROCESS_API_ENDPOINT, { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as ScriptApiListResponse;
        if (!Array.isArray(payload.documents)) {
            return null;
        }

        return sortPostprocessDocuments(payload.documents.map(normalizePostprocessDocument));
    } catch {
        return null;
    }
}

async function saveFilesystemPostprocessDocument(
    targetDocument: PostprocessScriptDocument,
    currentDocuments: PostprocessScriptDocument[]
): Promise<PostprocessScriptDocument[]> {
    const response = await fetch(`${POSTPROCESS_API_ENDPOINT}/${encodeURIComponent(targetDocument.fileName)}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            source: targetDocument.source,
            language: targetDocument.language,
        }),
    });

    if (!response.ok) {
        const payload = await readErrorPayload(response);
        throw new Error(payload);
    }

    const payload = (await response.json()) as ScriptApiSingleResponse;
    const savedDocument = payload.document ? normalizePostprocessDocument(payload.document) : clonePostprocessDocument(targetDocument);
    const nextDocuments = currentDocuments.map((document) =>
        document.id === targetDocument.id ? savedDocument : clonePostprocessDocument(document)
    );

    if (!nextDocuments.some((document) => document.id === savedDocument.id)) {
        nextDocuments.push(savedDocument);
    }

    return sortPostprocessDocuments(nextDocuments);
}

async function readErrorPayload(response: Response): Promise<string> {
    try {
        const payload = (await response.json()) as { error?: string };
        return payload.error || `Postprocess save failed with status ${response.status}.`;
    } catch {
        return `Postprocess save failed with status ${response.status}.`;
    }
}

function readStoredBrowserDocuments(): StoredBrowserDocuments<PostprocessScriptDocument> {
    if (typeof localStorage === 'undefined') {
        return { overrides: [], customs: [] };
    }

    try {
        const raw = localStorage.getItem(POSTPROCESS_STORAGE_KEY);
        if (!raw) {
            return { overrides: [], customs: [] };
        }

        const parsed = JSON.parse(raw) as Partial<StoredBrowserDocuments<PostprocessScriptDocument>>;
        return {
            overrides: Array.isArray(parsed.overrides)
                ? parsed.overrides.filter(isStoredOverride)
                : [],
            customs: Array.isArray(parsed.customs)
                ? parsed.customs.filter(isPostprocessDocumentLike).map(normalizePostprocessDocument)
                : [],
        };
    } catch {
        return { overrides: [], customs: [] };
    }
}

function isStoredOverride(value: unknown): value is { id: string; source: string } {
    return Boolean(
        value &&
            typeof value === 'object' &&
            typeof (value as { id?: unknown }).id === 'string' &&
            typeof (value as { source?: unknown }).source === 'string'
    );
}

function isPostprocessDocumentLike(value: unknown): value is ScriptApiDocumentPayload {
    return Boolean(
        value &&
            typeof value === 'object' &&
            typeof (value as ScriptApiDocumentPayload).id === 'string' &&
            typeof (value as ScriptApiDocumentPayload).name === 'string' &&
            typeof (value as ScriptApiDocumentPayload).fileName === 'string' &&
            typeof (value as ScriptApiDocumentPayload).source === 'string' &&
            typeof (value as ScriptApiDocumentPayload).language === 'string'
    );
}

function normalizePostprocessDocument(document: ScriptApiDocumentPayload): PostprocessScriptDocument {
    const fileName = sanitizeScriptFileName(document.fileName || `${document.id}.ts`);
    const id = (document.id || fileName.replace(/\.(js|ts)$/i, '')).trim() || 'postprocess';
    return {
        id,
        name: document.name?.trim() || toScriptLabel(id),
        fileName,
        language: inferLanguageFromFileName(fileName),
        source: typeof document.source === 'string' ? document.source : '',
    };
}

function buildDefaultPostprocessSource(scriptId: string, language: ToolpathPostprocessLanguage): string {
    const label = toScriptLabel(scriptId);
    const header = `// ${label}\n// Mutate context.points in place or return a new array.\n// @control {"key":"strength","label":"Strength","min":0.0,"max":2.0,"step":0.05,"default":1.0,"section":"Script Parameters"}\n`;
    if (language === 'javascript') {
        return `${header}\nexport function transform(context) {\n    const strength = context.params.strength ?? 1.0;\n    return {\n        points: context.points.map((point) => ({\n            ...point,\n            extrusionScale: (point.extrusionScale ?? 1) * strength,\n        })),\n        notes: [\`Applied strength=\${strength.toFixed(2)}\`],\n    };\n}\n`;
    }

    return `${header}\nexport function transform(context: any) {\n    const strength = context.params.strength ?? 1.0;\n    return {\n        points: context.points.map((point: any) => ({\n            ...point,\n            extrusionScale: (point.extrusionScale ?? 1) * strength,\n        })),\n        notes: [\`Applied strength=\${strength.toFixed(2)}\`],\n    };\n}\n`;
}

function toScriptId(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'postprocess';
}

function toScriptLabel(value: string): string {
    return value
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ') || 'Postprocess';
}

function inferLanguageFromFileName(fileName: string): ToolpathPostprocessLanguage {
    return fileName.toLowerCase().endsWith('.js') ? 'javascript' : 'typescript';
}

function sanitizeScriptFileName(fileName: string): string {
    const trimmed = fileName.trim() || 'postprocess.ts';
    if (/\.(js|ts)$/i.test(trimmed)) {
        return trimmed;
    }

    return `${trimmed}.ts`;
}

function clonePostprocessDocument(document: PostprocessScriptDocument): PostprocessScriptDocument {
    return {
        ...document,
    };
}

function clonePostprocessDocuments(documents: PostprocessScriptDocument[]): PostprocessScriptDocument[] {
    return documents.map(clonePostprocessDocument);
}

function sortPostprocessDocuments(documents: PostprocessScriptDocument[]): PostprocessScriptDocument[] {
    return documents.slice().sort((left, right) => left.name.localeCompare(right.name));
}