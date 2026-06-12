import type { PostprocessScriptDocument } from '../core/postprocess-registry';
import type { SceneBundle } from '../core/shader-pipeline';
import { reloadFilesystemPostprocessDocuments, savePostprocessDocument } from './postprocess-documents';
import { reloadFilesystemScenes, saveSceneFile } from './scene-documents';

export type WorkspaceBackendKind = 'dev-server' | 'local-folder' | 'bundled';

/**
 * One storage backend for everything the app edits as files: scene folders
 * and postprocess scripts. 'dev-server' talks to the vite file API,
 * 'local-folder' reads and writes a user-picked folder through the File
 * System Access API, and 'bundled' keeps the build-time snapshots
 * (in-memory editing only).
 */
export interface WorkspaceBackend {
    readonly kind: WorkspaceBackendKind;
    /** False when saves cannot reach disk (bundled snapshots). */
    readonly writable: boolean;
    /** Where scene saves land, for status messages, e.g. 'src/scenes'. */
    readonly scenesLabel: string;
    readonly postprocessLabel: string;
    /** Null means "keep whatever is currently loaded" (bundled snapshots). */
    listScenes(): Promise<SceneBundle[] | null>;
    saveSceneFile(sceneId: string, fileName: string, source: string): Promise<SceneBundle>;
    /** Null means "keep whatever is currently loaded". */
    listPostprocessDocuments(): Promise<PostprocessScriptDocument[] | null>;
    savePostprocessDocument(document: PostprocessScriptDocument): Promise<PostprocessScriptDocument>;
}

export const bundledWorkspaceBackend: WorkspaceBackend = {
    kind: 'bundled',
    writable: false,
    scenesLabel: 'the bundled snapshot',
    postprocessLabel: 'the bundled snapshot',
    listScenes: async () => null,
    listPostprocessDocuments: async () => null,
    saveSceneFile: async () => {
        throw new Error('Bundled scenes are read-only.');
    },
    savePostprocessDocument: async () => {
        throw new Error('Bundled postprocess scripts are read-only.');
    },
};

const devServerWorkspaceBackend: WorkspaceBackend = {
    kind: 'dev-server',
    writable: true,
    scenesLabel: 'src/scenes',
    postprocessLabel: 'src/postprocess-scripts',
    listScenes: reloadFilesystemScenes,
    saveSceneFile,
    listPostprocessDocuments: reloadFilesystemPostprocessDocuments,
    savePostprocessDocument,
};

/** The dev server backend when its file API responds, null otherwise. */
export async function probeDevServerBackend(): Promise<WorkspaceBackend | null> {
    return (await reloadFilesystemScenes()) ? devServerWorkspaceBackend : null;
}
