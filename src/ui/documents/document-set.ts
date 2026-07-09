import { get, writable, type Readable } from 'svelte/store';

/**
 * A collection of editable documents with working and persisted copies.
 * "Working" is what the editor shows; "persisted" is the last state confirmed
 * by the backend (disk / dev-server API). Dirtiness is the difference between
 * the two for a given document. One store instance per document kind (scene
 * bundles, postprocess scripts) replaces the hand-rolled merge/sort/equality
 * bookkeeping the component used to duplicate per kind.
 */
export interface DocumentSetState<T> {
    documents: T[];
    persisted: T[];
    savePending: boolean;
}

export interface DocumentSetOptions<T> {
    initial: T[];
    getId(document: T): string;
    sort(documents: T[]): T[];
    /** Full-content equality for one document (used to short-circuit backend refreshes). */
    isDocumentEqual(left: T, right: T): boolean;
}

export interface DocumentSet<T> extends Readable<DocumentSetState<T>> {
    /** Current state without subscribing. */
    current(): DocumentSetState<T>;
    /** Edit or add a working copy; persisted copies are untouched. */
    upsertWorking(document: T): void;
    /** A confirmed save: the document becomes both working and persisted. */
    applySaved(document: T): void;
    /**
     * A backend refresh: replaces both collections. No-ops (returning false)
     * when the incoming set matches the current persisted set.
     */
    replaceAll(documents: T[]): boolean;
    setSavePending(pending: boolean): void;
}

export function createDocumentSet<T>(options: DocumentSetOptions<T>): DocumentSet<T> {
    const { getId, sort, isDocumentEqual } = options;
    const initial = sort([...options.initial]);
    const store = writable<DocumentSetState<T>>({
        documents: initial,
        persisted: initial,
        savePending: false,
    });

    function upsertInto(collection: T[], document: T): T[] {
        const id = getId(document);
        const merged = collection.some((candidate) => getId(candidate) === id)
            ? collection.map((candidate) => (getId(candidate) === id ? document : candidate))
            : [...collection, document];
        return sort(merged);
    }

    function areCollectionsEqual(left: T[], right: T[]): boolean {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((document, index) => {
            const candidate = right[index];
            return Boolean(candidate)
                && getId(candidate) === getId(document)
                && isDocumentEqual(candidate, document);
        });
    }

    return {
        subscribe: store.subscribe,
        current: () => get(store),
        upsertWorking(document: T): void {
            store.update((state) => ({
                ...state,
                documents: upsertInto(state.documents, document),
            }));
        },
        applySaved(document: T): void {
            store.update((state) => ({
                ...state,
                documents: upsertInto(state.documents, document),
                persisted: upsertInto(state.persisted, document),
            }));
        },
        replaceAll(documents: T[]): boolean {
            const sorted = sort([...documents]);
            if (areCollectionsEqual(sorted, get(store).persisted)) {
                return false;
            }
            store.update((state) => ({
                ...state,
                documents: sorted,
                persisted: sorted,
            }));
            return true;
        },
        setSavePending(pending: boolean): void {
            store.update((state) => ({ ...state, savePending: pending }));
        },
    };
}
