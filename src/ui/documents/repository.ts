export interface SourceOverride {
    id: string;
    source: string;
}

export interface StoredBrowserDocuments<TDocument> {
    overrides: SourceOverride[];
    customs: TDocument[];
}

export function mergeBrowserDocuments<TDocument extends { id: string; source: string }>(
    defaultDocuments: TDocument[],
    stored: StoredBrowserDocuments<TDocument>,
    cloneDocument: (document: TDocument) => TDocument,
    sortDocuments: (documents: TDocument[]) => TDocument[]
): TDocument[] {
    const documentsById = new Map(defaultDocuments.map((document) => [document.id, cloneDocument(document)]));

    for (const override of stored.overrides) {
        const existing = documentsById.get(override.id);
        if (!existing) {
            continue;
        }

        existing.source = override.source;
    }

    for (const custom of stored.customs) {
        if (documentsById.has(custom.id)) {
            continue;
        }

        documentsById.set(custom.id, cloneDocument(custom));
    }

    return sortDocuments(Array.from(documentsById.values()));
}

export function buildBrowserStoragePayload<TDocument extends { id: string; source: string }>(
    defaultDocuments: TDocument[],
    currentDocuments: TDocument[],
    cloneDocument: (document: TDocument) => TDocument
): StoredBrowserDocuments<TDocument> {
    const defaultsById = new Map(defaultDocuments.map((document) => [document.id, document]));
    const overrides: SourceOverride[] = [];
    const customs: TDocument[] = [];

    for (const document of currentDocuments) {
        const defaultDocument = defaultsById.get(document.id);
        if (defaultDocument) {
            if (defaultDocument.source !== document.source) {
                overrides.push({ id: document.id, source: document.source });
            }
            continue;
        }

        customs.push(cloneDocument(document));
    }

    return { overrides, customs };
}

export function hasDirtyDocuments<TDocument>(
    workingDocuments: TDocument[],
    persistedDocuments: TDocument[],
    isEqual: (left: TDocument, right: TDocument) => boolean
): boolean {
    const persistedByIndex = persistedDocuments;

    if (workingDocuments.length !== persistedDocuments.length) {
        return true;
    }

    for (let index = 0; index < workingDocuments.length; index += 1) {
        const working = workingDocuments[index];
        const persisted = persistedByIndex[index];
        if (!persisted || !isEqual(working, persisted)) {
            return true;
        }
    }

    return false;
}