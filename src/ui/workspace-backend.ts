import type { FilamentProfile } from '../core/filament-profiles';
import type { PostprocessScriptDocument } from '../core/postprocess-registry';
import type { PrinterModel } from '../core/printer-models';
import type { SceneBundle } from '../core/shader-pipeline';

export type WorkspaceBackendKind = 'dev-server' | 'local-folder' | 'bundled';

/**
 * Everything a workspace folder contributes. A workspace has the same layout
 * as this repo's src/: scenes/<id>/, postprocess-scripts/, printers/ and
 * filaments/. Its contents are laid over the bundled defaults (the public
 * repo's own src/), so a private folder only needs to hold what is not
 * already shipped.
 */
export interface WorkspaceContents {
    scenes: SceneBundle[];
    postprocessScripts: PostprocessScriptDocument[];
    printerModels: PrinterModel[];
    filamentProfiles: FilamentProfile[];
}

/**
 * One storage backend for the workspace folder. 'dev-server' talks to the
 * vite file API (IMPLICIT_WORKSPACE on the server side), 'local-folder'
 * reads and writes a user-picked folder through the File System Access API,
 * and 'bundled' keeps the build-time snapshots (in-memory editing only).
 */
export interface WorkspaceBackend {
    readonly kind: WorkspaceBackendKind;
    /** False when saves cannot reach disk (bundled snapshots). */
    readonly writable: boolean;
    /** Workspace root name for status messages, e.g. 'implicit-designs'. */
    readonly label: string;
    /** Null means "keep whatever is currently loaded" (bundled snapshots). */
    listContents(): Promise<WorkspaceContents | null>;
    saveSceneFile(sceneId: string, fileName: string, source: string): Promise<SceneBundle>;
    savePostprocessDocument(document: PostprocessScriptDocument): Promise<PostprocessScriptDocument>;
}

// Mirrors the dev server file API's safety patterns (vite.config.ts).
export const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
export const SCENE_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.(glsl|ts|js)$/i;
export const POSTPROCESS_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.(js|ts)$/i;
export const PRESET_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.json$/i;

export const SCENES_DIR_NAME = 'scenes';
export const POSTPROCESS_DIR_NAME = 'postprocess-scripts';
export const PRINTERS_DIR_NAME = 'printers';
export const FILAMENTS_DIR_NAME = 'filaments';

export const bundledWorkspaceBackend: WorkspaceBackend = {
    kind: 'bundled',
    writable: false,
    label: 'the bundled snapshot',
    listContents: async () => null,
    saveSceneFile: async () => {
        throw new Error('Bundled scenes are read-only.');
    },
    savePostprocessDocument: async () => {
        throw new Error('Bundled postprocess scripts are read-only.');
    },
};
