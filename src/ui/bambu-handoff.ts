/**
 * Hands a sliced plate to the Bambu Connect desktop app.
 *
 * Bambu gates third-party print starts behind Bambu Connect unless the
 * printer is put in LAN-only + Developer Mode, so this is the route that
 * leaves cloud features (Handy, firmware updates) working. Connect takes an
 * *absolute filesystem path* over its URL scheme, which the browser cannot
 * discover on its own: the package is written through a File System Access
 * directory handle, and the matching absolute path is configured once by hand.
 *
 * Writing through a handle rather than a download matters for correctness —
 * a download would silently become `plate (1).gcode.3mf` when the name is
 * taken, and Connect would then be handed the path of a stale plate.
 */

import {
    BAMBU_HANDOFF_HANDLE_KEY,
    forgetStoredDirectoryHandle,
    readStoredDirectoryHandle,
    storeDirectoryHandle,
} from './handle-store';

/** Fixed by Bambu's scheme contract; reserved for future revisions. */
const IMPORT_FILE_VERSION = '1.0.0';
export const BAMBU_PACKAGE_EXTENSION = '.gcode.3mf';

export type BambuHandoffFolderStatus = 'connected' | 'needs-permission' | 'none';

export interface BambuHandoffFolder {
    name: string;
    handle: FileSystemDirectoryHandle;
}

export function isBambuHandoffSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Opens the directory picker (user gesture required) and remembers the folder. */
export async function pickBambuHandoffFolder(): Promise<BambuHandoffFolder> {
    const handle = await window.showDirectoryPicker({ id: 'implicit-bambu-handoff', mode: 'readwrite' });
    await storeDirectoryHandle(BAMBU_HANDOFF_HANDLE_KEY, handle);
    return { name: handle.name, handle };
}

export async function restoreBambuHandoffFolder(): Promise<{
    status: BambuHandoffFolderStatus;
    folder: BambuHandoffFolder | null;
}> {
    const handle = await readStoredDirectoryHandle(BAMBU_HANDOFF_HANDLE_KEY);
    if (!handle) {
        return { status: 'none', folder: null };
    }

    let permission: PermissionState;
    try {
        permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
        await forgetStoredDirectoryHandle(BAMBU_HANDOFF_HANDLE_KEY);
        return { status: 'none', folder: null };
    }

    if (permission === 'denied') {
        return { status: 'none', folder: null };
    }

    return {
        status: permission === 'granted' ? 'connected' : 'needs-permission',
        folder: { name: handle.name, handle },
    };
}

/** Re-requests write permission; must be called from a user gesture. */
export async function reconnectBambuHandoffFolder(folder: BambuHandoffFolder): Promise<boolean> {
    try {
        return (await folder.handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch {
        return false;
    }
}

export async function writeHandoffPackage(
    folder: BambuHandoffFolder,
    fileName: string,
    bytes: Uint8Array,
): Promise<void> {
    const fileHandle = await folder.handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(bytes as unknown as BufferSource);
    } finally {
        // close() commits the file; without it Connect could read a partial
        // or missing plate.
        await writable.close();
    }
}

/**
 * `bambu-connect://import-file?path=…&name=…&version=1.0.0`, with both
 * user-supplied values percent-encoded as the scheme requires.
 */
export function buildBambuConnectImportUrl(absoluteFilePath: string, displayName: string): string {
    const path = encodeURIComponent(absoluteFilePath);
    const name = encodeURIComponent(displayName);
    return `bambu-connect://import-file?path=${path}&name=${name}&version=${IMPORT_FILE_VERSION}`;
}

export function openBambuConnect(url: string): void {
    window.location.href = url;
}

export function joinHandoffPath(folderPath: string, fileName: string): string {
    return `${folderPath.replace(/\/+$/, '')}/${fileName}`;
}

/**
 * Guards the one thing the browser cannot verify: that the typed absolute
 * path names the same folder as the granted handle. A mismatch would hand
 * Connect a path that does not exist, or worse, an unrelated stale file.
 */
export function describeHandoffPathProblem(folderPath: string, folderName: string | null): string | null {
    const trimmed = folderPath.trim();
    if (!trimmed) {
        return 'Set the handoff folder path (the absolute path of the folder you picked).';
    }

    if (trimmed.startsWith('~')) {
        return 'Use a full path such as /Users/you/Implicit; Bambu Connect does not expand "~".';
    }

    if (!trimmed.startsWith('/')) {
        return 'The handoff folder path must be absolute.';
    }

    if (!folderName) {
        return null;
    }

    const lastSegment = trimmed.replace(/\/+$/, '').split('/').pop() ?? '';
    if (lastSegment !== folderName) {
        return `Handoff path ends in "${lastSegment}" but the picked folder is "${folderName}".`;
    }

    return null;
}

/** `<base>.gcode.3mf`, replacing the `.gcode` the slicer's filename carries. */
export function toBambuPackageFilename(gcodeFilename: string): string {
    return `${gcodeFilename.replace(/\.gcode$/i, '')}${BAMBU_PACKAGE_EXTENSION}`;
}
