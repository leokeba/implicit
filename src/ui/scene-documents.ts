import type { SceneDocument } from '../core/shader-pipeline';

const SCENE_DOCUMENTS_STORAGE_KEY = 'implicit.sceneDocuments.v1';
const SCENE_API_ENDPOINT = '/__implicit_api/scenes';

export type SceneDocumentStorageMode = 'browser' | 'filesystem';

export interface SceneRepositoryState {
    mode: SceneDocumentStorageMode;
    documents: SceneDocument[];
}

interface StoredBrowserDocuments {
    overrides: Array<{ id: string; source: string }>;
    customs: SceneDocument[];
}

interface SceneApiDocumentPayload {
    id: string;
    name: string;
    fileName: string;
    source: string;
}

interface SceneApiListResponse {
    documents?: SceneApiDocumentPayload[];
}

interface SceneApiSingleResponse {
    document?: SceneApiDocumentPayload;
}

export async function loadSceneRepository(defaultDocuments: SceneDocument[]): Promise<SceneRepositoryState> {
    const filesystemDocuments = await loadFilesystemSceneDocuments();
    if (filesystemDocuments) {
        return {
            mode: 'filesystem',
            documents: filesystemDocuments,
        };
    }

    return {
        mode: 'browser',
        documents: loadBrowserSceneDocuments(defaultDocuments),
    };
}

export async function reloadFilesystemSceneDocuments(): Promise<SceneDocument[] | null> {
    return loadFilesystemSceneDocuments();
}

export async function saveSceneDocuments(
    mode: SceneDocumentStorageMode,
    targetDocument: SceneDocument,
    defaultDocuments: SceneDocument[],
    currentDocuments: SceneDocument[]
): Promise<SceneDocument[]> {
    if (mode === 'filesystem') {
        return saveFilesystemSceneDocuments(targetDocument, currentDocuments);
    }

    persistBrowserSceneDocuments(defaultDocuments, currentDocuments);
    return cloneSceneDocuments(currentDocuments);
}

export function createSceneDocument(existingDocuments: SceneDocument[], sourceTemplate: string, requestedName?: string): SceneDocument {
    const baseName = (requestedName ?? 'New Scene').trim() || 'New Scene';
    const existingIds = new Set(existingDocuments.map((document) => document.id));
    const baseId = toSceneId(baseName);

    let nextId = baseId;
    let suffix = 2;
    while (existingIds.has(nextId)) {
        nextId = `${baseId}_${suffix}`;
        suffix += 1;
    }

    return {
        id: nextId,
        name: toSceneLabel(nextId),
        fileName: `${nextId}.glsl`,
        source: sourceTemplate,
    };
}

export function hasDirtySceneDocuments(workingDocuments: SceneDocument[], persistedDocuments: SceneDocument[]): boolean {
    const persistedById = new Map(persistedDocuments.map((document) => [document.id, document]));

    if (workingDocuments.length !== persistedDocuments.length) {
        return true;
    }

    return workingDocuments.some((document) => {
        const persisted = persistedById.get(document.id);
        return !persisted || persisted.source !== document.source || persisted.fileName !== document.fileName;
    });
}

function loadBrowserSceneDocuments(defaultDocuments: SceneDocument[]): SceneDocument[] {
    const stored = readStoredBrowserDocuments();
    const defaultById = new Map(defaultDocuments.map((document) => [document.id, cloneSceneDocument(document)]));

    for (const override of stored.overrides) {
        const existing = defaultById.get(override.id);
        if (!existing) {
            continue;
        }

        existing.source = override.source;
    }

    for (const custom of stored.customs) {
        if (defaultById.has(custom.id)) {
            continue;
        }

        defaultById.set(custom.id, cloneSceneDocument(custom));
    }

    return sortSceneDocuments(Array.from(defaultById.values()));
}

function persistBrowserSceneDocuments(defaultDocuments: SceneDocument[], currentDocuments: SceneDocument[]): void {
    if (typeof localStorage === 'undefined') {
        return;
    }

    const defaultsById = new Map(defaultDocuments.map((document) => [document.id, document]));
    const overrides: StoredBrowserDocuments['overrides'] = [];
    const customs: SceneDocument[] = [];

    for (const document of currentDocuments) {
        const defaultDocument = defaultsById.get(document.id);
        if (defaultDocument) {
            if (defaultDocument.source !== document.source) {
                overrides.push({ id: document.id, source: document.source });
            }
            continue;
        }

        customs.push(cloneSceneDocument(document));
    }

    try {
        localStorage.setItem(
            SCENE_DOCUMENTS_STORAGE_KEY,
            JSON.stringify({ overrides, customs } satisfies StoredBrowserDocuments)
        );
    } catch {
        // Ignore storage write failures.
    }
}

async function loadFilesystemSceneDocuments(): Promise<SceneDocument[] | null> {
    if (typeof fetch === 'undefined') {
        return null;
    }

    try {
        const response = await fetch(SCENE_API_ENDPOINT, { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as SceneApiListResponse;
        if (!Array.isArray(payload.documents)) {
            return null;
        }

        return sortSceneDocuments(payload.documents.map(normalizeSceneApiDocument));
    } catch {
        return null;
    }
}

async function saveFilesystemSceneDocuments(targetDocument: SceneDocument, currentDocuments: SceneDocument[]): Promise<SceneDocument[]> {
    const response = await fetch(`${SCENE_API_ENDPOINT}/${encodeURIComponent(targetDocument.fileName)}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source: targetDocument.source }),
    });

    if (!response.ok) {
        const payload = await readErrorPayload(response);
        throw new Error(payload);
    }

    const payload = (await response.json()) as SceneApiSingleResponse;
    const savedDocument = payload.document ? normalizeSceneApiDocument(payload.document) : cloneSceneDocument(targetDocument);
    const nextDocuments = currentDocuments.map((document) =>
        document.id === targetDocument.id ? savedDocument : cloneSceneDocument(document)
    );

    if (!nextDocuments.some((document) => document.id === savedDocument.id)) {
        nextDocuments.push(savedDocument);
    }

    return sortSceneDocuments(nextDocuments);
}

async function readErrorPayload(response: Response): Promise<string> {
    try {
        const payload = (await response.json()) as { error?: string };
        return payload.error || `Scene save failed with status ${response.status}.`;
    } catch {
        return `Scene save failed with status ${response.status}.`;
    }
}

function readStoredBrowserDocuments(): StoredBrowserDocuments {
    if (typeof localStorage === 'undefined') {
        return { overrides: [], customs: [] };
    }

    try {
        const raw = localStorage.getItem(SCENE_DOCUMENTS_STORAGE_KEY);
        if (!raw) {
            return { overrides: [], customs: [] };
        }

        const parsed = JSON.parse(raw) as Partial<StoredBrowserDocuments>;
        return {
            overrides: Array.isArray(parsed.overrides)
                ? parsed.overrides.filter(isStoredOverride)
                : [],
            customs: Array.isArray(parsed.customs)
                ? parsed.customs.filter(isSceneDocumentLike).map(normalizeSceneApiDocument)
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

function isSceneDocumentLike(value: unknown): value is SceneApiDocumentPayload {
    return Boolean(
        value &&
            typeof value === 'object' &&
            typeof (value as SceneApiDocumentPayload).id === 'string' &&
            typeof (value as SceneApiDocumentPayload).name === 'string' &&
            typeof (value as SceneApiDocumentPayload).fileName === 'string' &&
            typeof (value as SceneApiDocumentPayload).source === 'string'
    );
}

function normalizeSceneApiDocument(document: SceneApiDocumentPayload): SceneDocument {
    const fileName = sanitizeSceneFileName(document.fileName || `${document.id}.glsl`);
    const id = (document.id || fileName.replace(/\.glsl$/i, '')).trim() || 'scene';
    return {
        id,
        name: document.name.trim().length > 0 ? document.name.trim() : toSceneLabel(id),
        fileName,
        source: document.source,
    };
}

function sanitizeSceneFileName(value: string): string {
    const trimmed = value.trim().replace(/[\\/]+/g, '_');
    return trimmed.toLowerCase().endsWith('.glsl') ? trimmed : `${trimmed}.glsl`;
}

function cloneSceneDocuments(documents: SceneDocument[]): SceneDocument[] {
    return documents.map(cloneSceneDocument);
}

function cloneSceneDocument(document: SceneDocument): SceneDocument {
    return {
        id: document.id,
        name: document.name,
        fileName: document.fileName,
        source: document.source,
    };
}

function sortSceneDocuments(documents: SceneDocument[]): SceneDocument[] {
    return cloneSceneDocuments(documents).sort((left, right) => left.name.localeCompare(right.name));
}

function toSceneId(value: string): string {
    const withoutExtension = value.replace(/\.glsl$/i, '').trim();
    return withoutExtension
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'scene';
}

function toSceneLabel(sceneId: string): string {
    return sceneId
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ') || 'Scene';
}