import {
    buildScriptDocument,
    type PostprocessScriptDocument,
    type PostprocessScriptLanguage,
} from '../core/postprocess-registry';

export type { PostprocessScriptDocument } from '../core/postprocess-registry';

const POSTPROCESS_API_ENDPOINT = '/__implicit_api/postprocess-scripts';

interface ScriptApiDocumentPayload {
    id?: unknown;
    name?: unknown;
    fileName?: unknown;
    language?: unknown;
    source?: unknown;
}

interface ScriptApiListResponse {
    documents?: ScriptApiDocumentPayload[];
}

/** Null when the dev server file API is unavailable (static build). */
export async function reloadFilesystemPostprocessDocuments(): Promise<PostprocessScriptDocument[] | null> {
    return fetchFilesystemPostprocessDocuments();
}

export async function savePostprocessDocument(document: PostprocessScriptDocument): Promise<PostprocessScriptDocument> {
    const response = await fetch(`${POSTPROCESS_API_ENDPOINT}/${encodeURIComponent(document.fileName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source: document.source,
            language: document.language,
        }),
    });

    if (!response.ok) {
        throw new Error(await readErrorPayload(response));
    }

    const payload = (await response.json()) as { document?: ScriptApiDocumentPayload };
    return normalizeScriptDocument(payload.document) ?? { ...document };
}

export function createPostprocessDocument(
    existingDocuments: PostprocessScriptDocument[],
    language: PostprocessScriptLanguage = 'typescript',
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
    const document = buildScriptDocument(`${nextId}.${extension}`, buildDefaultPostprocessSource(nextId, language));
    return document;
}

async function fetchFilesystemPostprocessDocuments(): Promise<PostprocessScriptDocument[] | null> {
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

        const documents = payload.documents
            .map(normalizeScriptDocument)
            .filter((document): document is PostprocessScriptDocument => document !== null);
        return documents.sort((leftDoc, rightDoc) => leftDoc.name.localeCompare(rightDoc.name));
    } catch {
        return null;
    }
}

function normalizeScriptDocument(payload: ScriptApiDocumentPayload | undefined): PostprocessScriptDocument | null {
    if (!payload || typeof payload.fileName !== 'string' || typeof payload.source !== 'string') {
        return null;
    }

    return buildScriptDocument(payload.fileName, payload.source);
}

function buildDefaultPostprocessSource(scriptId: string, language: PostprocessScriptLanguage): string {
    const label = toScriptLabel(scriptId);
    if (language === 'javascript') {
        return `// ${label}
// Mutate context.points in place or return a new array.
// point.metrics.shapeLayerProgress gives smooth 0..1 progress across the full print.
// Scene field samples (manifest \`fields\`) are available at point.sceneFields.<key>.

export const controls = {
    strength: { default: 1.0, min: 0.0, max: 2.0, step: 0.05 },
};

export function transform(context) {
    const strength = context.params.strength ?? 1.0;
    return {
        points: context.points.map((point) => ({
            ...point,
            extrusionScale: (point.extrusionScale ?? 1) * strength,
        })),
        notes: [\`Applied strength=\${strength.toFixed(2)}\`],
    };
}
`;
    }

    return `// ${label}
// Mutate context.points in place or return a new array.
// point.metrics.shapeLayerProgress gives smooth 0..1 progress across the full print.
// Scene field samples (manifest \`fields\`) are available at point.sceneFields.<key>.
import type { ToolpathPostprocessContext } from 'implicit/scene';

export const controls = {
    strength: { default: 1.0, min: 0.0, max: 2.0, step: 0.05 },
};

export function transform(context: ToolpathPostprocessContext) {
    const strength = context.params.strength ?? 1.0;
    return {
        points: context.points.map((point) => ({
            ...point,
            extrusionScale: (point.extrusionScale ?? 1) * strength,
        })),
        notes: [\`Applied strength=\${strength.toFixed(2)}\`],
    };
}
`;
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

async function readErrorPayload(response: Response): Promise<string> {
    try {
        const payload = (await response.json()) as { error?: string };
        return payload.error || `Postprocess save failed with status ${response.status}.`;
    } catch {
        return `Postprocess save failed with status ${response.status}.`;
    }
}
