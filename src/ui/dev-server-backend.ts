import { parseFilamentProfileJson, type FilamentProfile } from '../core/filament-profiles';
import { buildScriptDocument, type PostprocessScriptDocument } from '../core/postprocess-registry';
import { parsePrinterModelJson, type PrinterModel } from '../core/printer-models';
import type { SceneBundle, SceneFiles } from '../core/shader-pipeline';
import type { WorkspaceBackend, WorkspaceContents } from './workspace-backend';

const WORKSPACE_ENDPOINT = '/__implicit_api/workspace';
const SCENE_ENDPOINT = '/__implicit_api/scenes';
const POSTPROCESS_ENDPOINT = '/__implicit_api/postprocess-scripts';

interface WorkspaceApiFile {
    fileName?: unknown;
    source?: unknown;
}

interface WorkspaceApiResponse {
    label?: unknown;
    scenes?: unknown;
    postprocessScripts?: unknown;
    printers?: unknown;
    filaments?: unknown;
}

/**
 * The dev server backend when its file API responds, null otherwise (static
 * build). The vite plugin serves whatever folder IMPLICIT_WORKSPACE names,
 * falling back to this repo's src/.
 */
export async function probeDevServerBackend(): Promise<WorkspaceBackend | null> {
    const payload = await fetchWorkspace();
    if (!payload) {
        return null;
    }

    return {
        kind: 'dev-server',
        writable: true,
        label: typeof payload.label === 'string' && payload.label ? payload.label : 'src',
        async listContents() {
            const next = await fetchWorkspace();
            return next ? normalizeWorkspace(next) : null;
        },
        saveSceneFile,
        savePostprocessDocument,
    };
}

async function fetchWorkspace(): Promise<WorkspaceApiResponse | null> {
    if (typeof fetch === 'undefined') {
        return null;
    }

    try {
        const response = await fetch(WORKSPACE_ENDPOINT, { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }
        const payload = (await response.json()) as unknown;
        return payload && typeof payload === 'object' ? (payload as WorkspaceApiResponse) : null;
    } catch {
        return null;
    }
}

function normalizeWorkspace(payload: WorkspaceApiResponse): WorkspaceContents {
    const scenes = (Array.isArray(payload.scenes) ? payload.scenes : [])
        .map(normalizeSceneBundle)
        .filter((bundle): bundle is SceneBundle => bundle !== null)
        .sort((left, right) => left.id.localeCompare(right.id));

    const postprocessScripts = normalizeFiles(payload.postprocessScripts)
        .map((file) => buildScriptDocument(file.fileName, file.source))
        .sort((left, right) => left.name.localeCompare(right.name));

    const printerModels = normalizeFiles(payload.printers)
        .map((file) => parsePrinterModelJson(file.fileName, file.source))
        .filter((model): model is PrinterModel => model !== null);

    const filamentProfiles = normalizeFiles(payload.filaments)
        .map((file) => parseFilamentProfileJson(file.fileName, file.source))
        .filter((profile): profile is FilamentProfile => profile !== null);

    return { scenes, postprocessScripts, printerModels, filamentProfiles };
}

function normalizeFiles(value: unknown): Array<{ fileName: string; source: string }> {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry: WorkspaceApiFile) => (
        entry && typeof entry.fileName === 'string' && typeof entry.source === 'string'
            ? [{ fileName: entry.fileName, source: entry.source }]
            : []
    ));
}

async function saveSceneFile(sceneId: string, fileName: string, source: string): Promise<SceneBundle> {
    const response = await fetch(
        `${SCENE_ENDPOINT}/${encodeURIComponent(sceneId)}/${encodeURIComponent(fileName)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source }),
        }
    );

    if (!response.ok) {
        throw new Error(await readErrorPayload(response, 'Scene save'));
    }

    const payload = (await response.json()) as { scene?: unknown };
    const bundle = normalizeSceneBundle(payload.scene);
    if (!bundle) {
        throw new Error('Scene save returned an invalid payload.');
    }
    return bundle;
}

async function savePostprocessDocument(document: PostprocessScriptDocument): Promise<PostprocessScriptDocument> {
    const response = await fetch(`${POSTPROCESS_ENDPOINT}/${encodeURIComponent(document.fileName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: document.source }),
    });

    if (!response.ok) {
        throw new Error(await readErrorPayload(response, 'Postprocess save'));
    }

    const payload = (await response.json()) as { document?: WorkspaceApiFile };
    const saved = payload.document;
    return saved && typeof saved.fileName === 'string' && typeof saved.source === 'string'
        ? buildScriptDocument(saved.fileName, saved.source)
        : { ...document };
}

function normalizeSceneBundle(value: unknown): SceneBundle | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const id = typeof (value as { id?: unknown }).id === 'string' ? ((value as { id: string }).id).trim() : '';
    const rawFiles = (value as { files?: unknown }).files;
    if (!id || !rawFiles || typeof rawFiles !== 'object') {
        return null;
    }

    const files: SceneFiles = {};
    for (const [fileName, source] of Object.entries(rawFiles as Record<string, unknown>)) {
        if (typeof source === 'string') {
            files[fileName] = source;
        }
    }

    return { id, name: id, files };
}

async function readErrorPayload(response: Response, action: string): Promise<string> {
    try {
        const payload = (await response.json()) as { error?: string };
        return payload.error || `${action} failed with status ${response.status}.`;
    } catch {
        return `${action} failed with status ${response.status}.`;
    }
}
