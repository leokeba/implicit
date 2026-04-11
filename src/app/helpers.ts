import type { SceneDocument } from '../core/shader-pipeline';
import type { PostprocessScriptDocument } from '../ui/postprocess-documents';

export function formatEta(seconds: number): string {
    const clamped = Math.max(0, Math.round(seconds));
    if (clamped < 60) {
        return `${clamped}s`;
    }

    const minutes = Math.floor(clamped / 60);
    const remSeconds = clamped % 60;
    return `${minutes}m ${remSeconds}s`;
}

export function buildSceneTemplate(sceneName: string): string {
    const label = sceneName.trim() || 'New Scene';
    return `// ${label}\n// @control {"key":"radius","label":"Radius","uniform":"uSceneRadius","min":0.2,"max":2.0,"step":0.01,"default":0.8,"section":"Scene Parameters"}\n\nuniform float uSceneRadius;\n\nfloat sceneSdf(vec3 p) {\n    return length(p) - uSceneRadius;\n}\n`;
}

export function areSceneCollectionsEqual(left: SceneDocument[], right: SceneDocument[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((document, index) => {
        const candidate = right[index];
        return Boolean(
            candidate &&
                candidate.id === document.id &&
                candidate.fileName === document.fileName &&
                candidate.source === document.source
        );
    });
}

export function arePostprocessCollectionsEqual(left: PostprocessScriptDocument[], right: PostprocessScriptDocument[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((document, index) => {
        const candidate = right[index];
        return Boolean(
            candidate &&
                candidate.id === document.id &&
                candidate.fileName === document.fileName &&
                candidate.language === document.language &&
                candidate.source === document.source
        );
    });
}