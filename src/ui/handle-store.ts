/**
 * Persistence for File System Access handles.
 *
 * Directory handles survive a reload only if they are stored in IndexedDB —
 * they are structured-cloneable but not serialisable, so localStorage cannot
 * hold them. Browsers usually downgrade the permission to 'prompt' between
 * sessions, so every caller must be ready to re-request from a user gesture.
 */

const HANDLE_DB_NAME = 'implicit-workspace';
const HANDLE_STORE_NAME = 'handles';

export const PROJECT_ROOT_HANDLE_KEY = 'project-root';
export const BAMBU_HANDOFF_HANDLE_KEY = 'bambu-handoff-folder';

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

export async function readStoredDirectoryHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
    const stored = await withHandleStore('readonly', (store) => store.get(key));
    return stored instanceof FileSystemDirectoryHandle ? stored : null;
}

export async function storeDirectoryHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
    await withHandleStore('readwrite', (store) => store.put(handle, key));
}

export async function forgetStoredDirectoryHandle(key: string): Promise<void> {
    await withHandleStore('readwrite', (store) => store.delete(key));
}
