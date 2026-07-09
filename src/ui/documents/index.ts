import type { SceneBundle } from '../../core/shader-pipeline';
import type { PostprocessScriptDocument } from '../../core/postprocess-registry';
import { createDocumentSet, type DocumentSet } from './document-set';

export type { DocumentSet, DocumentSetState } from './document-set';

export function createSceneDocumentSet(initial: SceneBundle[]): DocumentSet<SceneBundle> {
    return createDocumentSet<SceneBundle>({
        initial,
        getId: (bundle) => bundle.id,
        sort: (bundles) => bundles.slice().sort((left, right) => left.id.localeCompare(right.id)),
        isDocumentEqual: (left, right) => {
            const leftNames = Object.keys(left.files).sort();
            const rightNames = Object.keys(right.files).sort();
            if (leftNames.length !== rightNames.length) {
                return false;
            }
            return leftNames.every((name, index) => (
                name === rightNames[index] && left.files[name] === right.files[name]
            ));
        },
    });
}

export function createPostprocessDocumentSet(initial: PostprocessScriptDocument[]): DocumentSet<PostprocessScriptDocument> {
    return createDocumentSet<PostprocessScriptDocument>({
        initial,
        getId: (document) => document.id,
        sort: (documents) => documents.slice().sort((left, right) => left.name.localeCompare(right.name)),
        isDocumentEqual: (left, right) => (
            left.fileName === right.fileName
            && left.language === right.language
            && left.source === right.source
        ),
    });
}
