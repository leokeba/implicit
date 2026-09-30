import { parseFilamentProfileJson, type FilamentProfile } from '../core/filament-profiles';
import { buildScriptDocument, type PostprocessScriptDocument } from '../core/postprocess-registry';
import { parsePrinterModelJson, type PrinterModel } from '../core/printer-models';
import type { SceneBundle } from '../core/shader-pipeline';
import {
    forgetStoredDirectoryHandle,
    PROJECT_ROOT_HANDLE_KEY,
    readStoredDirectoryHandle,
    storeDirectoryHandle,
} from './handle-store';
import {
    FILAMENTS_DIR_NAME,
    POSTPROCESS_DIR_NAME,
    POSTPROCESS_FILE_PATTERN,
    PRESET_FILE_PATTERN,
    PRINTERS_DIR_NAME,
    SCENE_FILE_PATTERN,
    SCENE_ID_PATTERN,
    SCENES_DIR_NAME,
    type WorkspaceBackend,
    type WorkspaceContents,
} from './workspace-backend';

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
    const root = await window.showDirectoryPicker({ id: 'implicit-workspace', mode: 'readwrite' });
    const backend = await createLocalFolderBackend(root);
    await storeDirectoryHandle(PROJECT_ROOT_HANDLE_KEY, root);
    return backend;
}

/**
 * Restores the folder remembered in IndexedDB. Browsers usually downgrade the
 * permission to 'prompt' between sessions, in which case the caller gets a
 * reconnect callback to invoke from a user gesture.
 */
export async function restoreLocalFolderBackend(): Promise<LocalFolderRestoreResult> {
    const root = await readStoredDirectoryHandle(PROJECT_ROOT_HANDLE_KEY);
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
            await forgetStoredDirectoryHandle(PROJECT_ROOT_HANDLE_KEY);
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
                    await forgetStoredDirectoryHandle(PROJECT_ROOT_HANDLE_KEY);
                    return null;
                }
            },
        },
    };
}

/**
 * The workspace root must hold a scenes/ folder (the check that the right
 * folder was picked); postprocess-scripts/, printers/ and filaments/ are
 * optional and the scripts folder is created on the first save.
 */
async function createLocalFolderBackend(root: FileSystemDirectoryHandle): Promise<WorkspaceBackend> {
    const scenesDir = await requireScenesDirectory(root);

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

    async function readFilesIn(
        dirName: string,
        pattern: RegExp,
    ): Promise<Array<{ fileName: string; source: string }>> {
        const directory = await getSubdirectory(root, dirName, false);
        if (!directory) {
            return [];
        }

        const files: Array<{ fileName: string; source: string }> = [];
        for await (const [fileName, handle] of directory.entries()) {
            if (handle.kind !== 'file' || !pattern.test(fileName)) {
                continue;
            }
            files.push({
                fileName,
                source: await readFileText(`${dirName}/${fileName}`, handle as FileSystemFileHandle),
            });
        }
        return files;
    }

    async function readSceneBundle(sceneId: string, sceneDir: FileSystemDirectoryHandle): Promise<SceneBundle> {
        const files: Record<string, string> = {};
        for await (const [fileName, handle] of sceneDir.entries()) {
            if (handle.kind !== 'file' || !SCENE_FILE_PATTERN.test(fileName)) {
                continue;
            }
            files[fileName] = await readFileText(`${SCENES_DIR_NAME}/${sceneId}/${fileName}`, handle as FileSystemFileHandle);
        }
        return { id: sceneId, name: sceneId, files };
    }

    async function listScenes(): Promise<SceneBundle[]> {
        const bundles: SceneBundle[] = [];
        for await (const [name, handle] of scenesDir.entries()) {
            if (handle.kind !== 'directory' || !SCENE_ID_PATTERN.test(name)) {
                continue;
            }
            const bundle = await readSceneBundle(name, handle as FileSystemDirectoryHandle);
            if (Object.keys(bundle.files).length > 0) {
                bundles.push(bundle);
            }
        }
        return bundles.sort((left, right) => left.id.localeCompare(right.id));
    }

    return {
        kind: 'local-folder',
        writable: true,
        label: root.name,

        async listContents(): Promise<WorkspaceContents> {
            const [scenes, scriptFiles, printerFiles, filamentFiles] = await Promise.all([
                listScenes(),
                readFilesIn(POSTPROCESS_DIR_NAME, POSTPROCESS_FILE_PATTERN),
                readFilesIn(PRINTERS_DIR_NAME, PRESET_FILE_PATTERN),
                readFilesIn(FILAMENTS_DIR_NAME, PRESET_FILE_PATTERN),
            ]);

            return {
                scenes,
                postprocessScripts: scriptFiles
                    .map((file) => buildScriptDocument(file.fileName, file.source))
                    .sort((left, right) => left.name.localeCompare(right.name)),
                printerModels: printerFiles
                    .map((file) => parsePrinterModelJson(file.fileName, file.source))
                    .filter((model): model is PrinterModel => model !== null),
                filamentProfiles: filamentFiles
                    .map((file) => parseFilamentProfileJson(file.fileName, file.source))
                    .filter((profile): profile is FilamentProfile => profile !== null),
            };
        },

        async saveSceneFile(sceneId, fileName, source) {
            if (!SCENE_ID_PATTERN.test(sceneId) || !SCENE_FILE_PATTERN.test(fileName)) {
                throw new Error(`Unsafe scene path: ${sceneId}/${fileName}`);
            }
            const sceneDir = await scenesDir.getDirectoryHandle(sceneId, { create: true });
            await writeFile(sceneDir, fileName, source);
            return readSceneBundle(sceneId, sceneDir);
        },

        async savePostprocessDocument(document: PostprocessScriptDocument) {
            if (!POSTPROCESS_FILE_PATTERN.test(document.fileName)) {
                throw new Error(`Unsafe postprocess filename: ${document.fileName}`);
            }
            const directory = await getSubdirectory(root, POSTPROCESS_DIR_NAME, true);
            if (!directory) {
                throw new Error(`Could not create ${root.name}/${POSTPROCESS_DIR_NAME}.`);
            }
            await writeFile(directory, document.fileName, document.source);
            return buildScriptDocument(document.fileName, document.source);
        },
    };
}

async function requireScenesDirectory(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
    const scenesDir = await getSubdirectory(root, SCENES_DIR_NAME, false);
    if (!scenesDir) {
        throw new Error(`'${root.name}' has no ${SCENES_DIR_NAME}/ folder: pick a workspace laid out like implicit's src/.`);
    }
    return scenesDir;
}

async function getSubdirectory(
    root: FileSystemDirectoryHandle,
    name: string,
    create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
    try {
        return await root.getDirectoryHandle(name, { create });
    } catch {
        return null;
    }
}

async function writeFile(directory: FileSystemDirectoryHandle, fileName: string, source: string): Promise<void> {
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(source);
    await writable.close();
}
