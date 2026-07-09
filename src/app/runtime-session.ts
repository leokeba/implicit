import type { AnimationParams, RaymarchParams, ViewportParams } from '../core/renderer';
import type { SceneOverrides } from '../studio/types';

const APP_RUNTIME_STORAGE_KEY = 'implicit.runtimeState.v2';

/**
 * Session-only exploration state (sessionStorage). Everything print-relevant
 * also lives in scene overrides so exports stay reproducible; this snapshot
 * just restores the workspace after a reload.
 */
export interface AppRuntimeSnapshot {
    sceneId?: string;
    viewMode?: number;
    raymarchParams?: Partial<RaymarchParams>;
    viewportParams?: Partial<ViewportParams>;
    animationParams?: Partial<AnimationParams>;
    activePostprocessScriptId?: string;
    postprocessAutoUpdate?: boolean;
    editorDocumentMode?: 'scene' | 'postprocess';
    activeSceneFileName?: string;
    viewerFullscreen?: boolean;
    sceneOverrides?: Record<string, Partial<SceneOverrides>>;
}

export function readRuntimeSnapshot(): AppRuntimeSnapshot | null {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const raw = window.sessionStorage.getItem(APP_RUNTIME_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as AppRuntimeSnapshot;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function persistRuntimeSnapshot(runtimeSnapshot: AppRuntimeSnapshot): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.sessionStorage.setItem(APP_RUNTIME_STORAGE_KEY, JSON.stringify(runtimeSnapshot));
    } catch {
        // Ignore storage write failures.
    }
}
