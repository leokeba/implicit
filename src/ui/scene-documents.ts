import type { SceneBundle, SceneFiles } from '../core/shader-pipeline';

const SCENE_API_ENDPOINT = '/__implicit_api/scenes';

interface SceneApiListResponse {
    scenes?: Array<{ id?: unknown; files?: unknown }>;
}

interface SceneApiSaveResponse {
    scene?: { id?: unknown; files?: unknown };
}

/** Null when the dev server file API is unavailable (static build). */
export async function reloadFilesystemScenes(): Promise<SceneBundle[] | null> {
    return fetchFilesystemScenes();
}

export async function saveSceneFile(sceneId: string, fileName: string, source: string): Promise<SceneBundle> {
    const response = await fetch(
        `${SCENE_API_ENDPOINT}/${encodeURIComponent(sceneId)}/${encodeURIComponent(fileName)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source }),
        }
    );

    if (!response.ok) {
        throw new Error(await readErrorPayload(response));
    }

    const payload = (await response.json()) as SceneApiSaveResponse;
    const bundle = normalizeSceneBundle(payload.scene);
    if (!bundle) {
        throw new Error('Scene save returned an invalid payload.');
    }

    return bundle;
}

export function areSceneBundlesEqual(left: SceneBundle[], right: SceneBundle[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((bundle, index) => {
        const candidate = right[index];
        if (!candidate || candidate.id !== bundle.id) {
            return false;
        }

        const leftNames = Object.keys(bundle.files).sort();
        const rightNames = Object.keys(candidate.files).sort();
        if (leftNames.length !== rightNames.length) {
            return false;
        }

        return leftNames.every((name, nameIndex) => (
            name === rightNames[nameIndex] && bundle.files[name] === candidate.files[name]
        ));
    });
}

async function fetchFilesystemScenes(): Promise<SceneBundle[] | null> {
    if (typeof fetch === 'undefined') {
        return null;
    }

    try {
        const response = await fetch(SCENE_API_ENDPOINT, { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as SceneApiListResponse;
        if (!Array.isArray(payload.scenes)) {
            return null;
        }

        const bundles = payload.scenes
            .map(normalizeSceneBundle)
            .filter((bundle): bundle is SceneBundle => bundle !== null);
        return bundles.sort((leftBundle, rightBundle) => leftBundle.id.localeCompare(rightBundle.id));
    } catch {
        return null;
    }
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

async function readErrorPayload(response: Response): Promise<string> {
    try {
        const payload = (await response.json()) as { error?: string };
        return payload.error || `Scene save failed with status ${response.status}.`;
    } catch {
        return `Scene save failed with status ${response.status}.`;
    }
}
