import { buildScriptDocument, type PostprocessScriptDocument } from '../core/postprocess-registry';
import type { SceneBundle } from '../core/shader-pipeline';
import type { WorkspaceBackend } from './workspace-backend';

// Mirrors the dev server file API's safety patterns (vite.config.ts).
const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const SCENE_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.(glsl|ts|js)$/i;
const POSTPROCESS_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.(js|ts)$/i;

const HANDLE_DB_NAME = 'implicit-workspace';
const HANDLE_STORE_NAME = 'handles';
const PROJECT_ROOT_KEY = 'project-root';

const POSTPROCESS_DIR_NAME = 'postprocess-scripts';

export interface StoredLocalFolder {
    name: string;
    /** Re-requests folder permission; must be called from a user gesture. */
    reconnect(): Promise<WorkspaceBackend | null>;
}

export type LocalFolderRestoreResult =
    | { status: 'connected'; backend: WorkspaceBackend }
    | { status: 'needs-permission'; folder: StoredLocalFolder }
    | { status: 'none' };

export function isLocalFolderSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Opens the directory picker (user gesture required), validates the folder
 * layout, and remembers the handle for the next visit.
 */
export async function pickLocalFolderBackend(): Promise<WorkspaceBackend> {
    const root = await window.showDirectoryPicker({ id: 'implicit-project', mode: 'readwrite' });
    const backend = await createLocalFolderBackend(root);
    await storeRootHandle(root);
    return backend;
}

/**
 * Restores the folder remembered in IndexedDB. Browsers usually downgrade the
 * permission to 'prompt' between sessions, in which case the caller gets a
 * reconnect callback to invoke from a user gesture.
 */
export async function restoreLocalFolderBackend(): Promise<LocalFolderRestoreResult> {
    const root = await readStoredRootHandle();
    if (!root) {
        return { status: 'none' };
    }

    let permission: PermissionState;
    try {
        permission = await root.queryPermission({ mode: 'readwrite' });
    } catch {
        return { status: 'none' };
    }

    if (permission === 'granted') {
        try {
            return { status: 'connected', backend: await createLocalFolderBackend(root) };
        } catch {
            await forgetStoredRootHandle();
            return { status: 'none' };
        }
    }

    if (permission === 'denied') {
        return { status: 'none' };
    }

    return {
        status: 'needs-permission',
        folder: {
            name: root.name,
            reconnect: async () => {
                if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    return null;
                }
                try {
                    return await createLocalFolderBackend(root);
                } catch {
                    await forgetStoredRootHandle();
                    return null;
                }
            },
        },
    };
}

async function createLocalFolderBackend(root: FileSystemDirectoryHandle): Promise<WorkspaceBackend> {
    const layout = await resolveProjectLayout(root);
    // Skip re-reading file contents whose identity has not changed between
    // polls; keyed by path, validated by File metadata.
    const fileTextCache = new Map<string, { lastModified: number; size: number; text: string }>();

    async function readFileText(cacheKey: string, fileHandle: FileSystemFileHandle): Promise<string> {
        const file = await fileHandle.getFile();
        const cached = fileTextCache.get(cacheKey);
        if (cached && cached.lastModified === file.lastModified && cached.size === file.size) {
            return cached.text;
        }

        const text = await file.text();
        fileTextCache.set(cacheKey, { lastModified: file.lastModified, size: file.size, text });
        return text;
    }

    async function readSceneBundle(sceneId: string, sceneDir: FileSystemDirectoryHandle): Promise<SceneBundle> {
        const files: Record<string, string> = {};
        for await (const [fileName, handle] of sceneDir.entries()) {
            if (handle.kind !== 'file' || !SCENE_FILE_PATTERN.test(fileName)) {
                continue;
            }
            files[fileName] = await readFileText(`${sceneId}/${fileName}`, handle as FileSystemFileHandle);
        }
        return { id: sceneId, name: sceneId, files };
    }

    return {
        kind: 'local-folder',
        writable: true,
        scenesLabel: layout.scenesLabel,
        postprocessLabel: layout.postprocessLabel,

        async listScenes() {
            const bundles: SceneBundle[] = [];
            for await (const [name, handle] of layout.scenesDir.entries()) {
                if (handle.kind !== 'directory' || !SCENE_ID_PATTERN.test(name)) {
                    continue;
                }
                const bundle = await readSceneBundle(name, handle as FileSystemDirectoryHandle);
                if (Object.keys(bundle.files).length > 0) {
                    bundles.push(bundle);
                }
            }
            return bundles.sort((left, right) => left.id.localeCompare(right.id));
        },

        async saveSceneFile(sceneId, fileName, source) {
            if (!SCENE_ID_PATTERN.test(sceneId) || !SCENE_FILE_PATTERN.test(fileName)) {
                throw new Error(`Unsafe scene path: ${sceneId}/${fileName}`);
            }
            const sceneDir = await layout.scenesDir.getDirectoryHandle(sceneId, { create: true });
            await writeFile(sceneDir, fileName, source);
            return readSceneBundle(sceneId, sceneDir);
        },

        async listPostprocessDocuments() {
            const directory = await layout.getPostprocessDir(false);
            if (!directory) {
                return null;
            }

            const documents: PostprocessScriptDocument[] = [];
            for await (const [fileName, handle] of directory.entries()) {
                if (handle.kind !== 'file' || !POSTPROCESS_FILE_PATTERN.test(fileName)) {
                    continue;
                }
                const source = await readFileText(`${POSTPROCESS_DIR_NAME}/${fileName}`, handle as FileSystemFileHandle);
                documents.push(buildScriptDocument(fileName, source));
            }
            return documents.sort((left, right) => left.name.localeCompare(right.name));
        },

        async savePostprocessDocument(document) {
            if (!POSTPROCESS_FILE_PATTERN.test(document.fileName)) {
                throw new Error(`Unsafe postprocess filename: ${document.fileName}`);
            }
            const directory = await layout.getPostprocessDir(true);
            if (!directory) {
                throw new Error('Postprocess folder is unavailable in the connected project.');
            }
            await writeFile(directory, document.fileName, document.source);
            return buildScriptDocument(document.fileName, document.source);
        },
    };
}

interface LocalProjectLayout {
    scenesDir: FileSystemDirectoryHandle;
    scenesLabel: string;
    postprocessLabel: string;
    getPostprocessDir(create: boolean): Promise<FileSystemDirectoryHandle | null>;
}

/**
 * Accepts the project root ('src/scenes' inside) or a sources folder
 * ('scenes' inside); the postprocess folder lives next to the scenes folder.
 */
async function resolveProjectLayout(root: FileSystemDirectoryHandle): Promise<LocalProjectLayout> {
    const sourceParent = await (async () => {
        try {
            return await root.getDirectoryHandle('src');
        } catch {
            return root;
        }
    })();

    let scenesDir: FileSystemDirectoryHandle;
    try {
        scenesDir = await sourceParent.getDirectoryHandle('scenes');
    } catch {
        throw new Error(`'${root.name}' has no scenes folder: pick the project root containing src/scenes.`);
    }

    const prefix = sourceParent === root ? root.name : `${root.name}/src`;
    return {
        scenesDir,
        scenesLabel: `${prefix}/scenes`,
        postprocessLabel: `${prefix}/${POSTPROCESS_DIR_NAME}`,
        async getPostprocessDir(create: boolean) {
            try {
                return await sourceParent.getDirectoryHandle(POSTPROCESS_DIR_NAME, { create });
            } catch {
                return null;
            }
        },
    };
}

async function writeFile(directory: FileSystemDirectoryHandle, fileName: string, source: string): Promise<void> {
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(source);
    await writable.close();
}

function openHandleDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(HANDLE_DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(HANDLE_STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
    });
}

async function withHandleStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
    if (typeof indexedDB === 'undefined') {
        return null;
    }

    try {
        const db = await openHandleDb();
        try {
            return await new Promise<T>((resolve, reject) => {
                const request = operation(db.transaction(HANDLE_STORE_NAME, mode).objectStore(HANDLE_STORE_NAME));
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
            });
        } finally {
            db.close();
        }
    } catch {
        return null;
    }
}

async function readStoredRootHandle(): Promise<FileSystemDirectoryHandle | null> {
    const stored = await withHandleStore('readonly', (store) => store.get(PROJECT_ROOT_KEY));
    return stored instanceof FileSystemDirectoryHandle ? stored : null;
}

async function storeRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    await withHandleStore('readwrite', (store) => store.put(handle, PROJECT_ROOT_KEY));
}

async function forgetStoredRootHandle(): Promise<void> {
    await withHandleStore('readwrite', (store) => store.delete(PROJECT_ROOT_KEY));
}
