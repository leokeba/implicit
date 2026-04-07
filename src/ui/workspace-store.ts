import type { ControlTabId } from './inspector-schema';
import { writable } from 'svelte/store';

const WORKSPACE_STORAGE_KEY = 'implicit-ui-workspace';
const LEGACY_TAB_STORAGE_KEY = 'implicit-ui-active-tab';

export const DEFAULT_INSPECTOR_WIDTH = 388;
export const MIN_INSPECTOR_WIDTH = 340;
export const MAX_INSPECTOR_WIDTH = 520;

interface WorkspacePreferences {
    activeTab: ControlTabId;
    inspectorCollapsed: boolean;
    inspectorWidth: number;
    overlayVisible: boolean;
}

export interface WorkspaceState extends WorkspacePreferences {
    activeSceneLabel: string;
    activeViewModeLabel: string;
    isInspectorResizing: boolean;
}

function clampInspectorWidth(width: number): number {
    return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.round(width)));
}

function getDefaultPreferences(): WorkspacePreferences {
    return {
        activeTab: 'scene',
        inspectorCollapsed: false,
        inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
        overlayVisible: true,
    };
}

function readLegacyTabPreference(): ControlTabId | null {
    if (typeof localStorage === 'undefined') {
        return null;
    }

    try {
        const stored = localStorage.getItem(LEGACY_TAB_STORAGE_KEY) as ControlTabId | null;
        return stored ?? null;
    } catch {
        return null;
    }
}

function readStoredPreferences(): WorkspacePreferences {
    if (typeof localStorage === 'undefined') {
        return getDefaultPreferences();
    }

    try {
        const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (!raw) {
            const legacyTab = readLegacyTabPreference();
            return {
                ...getDefaultPreferences(),
                activeTab: legacyTab ?? 'scene',
            };
        }

        const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
        return {
            activeTab: parsed.activeTab ?? readLegacyTabPreference() ?? 'scene',
            inspectorCollapsed: parsed.inspectorCollapsed ?? false,
            inspectorWidth: clampInspectorWidth(parsed.inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH),
            overlayVisible: parsed.overlayVisible ?? true,
        };
    } catch {
        return getDefaultPreferences();
    }
}

function persistPreferences(state: WorkspaceState): void {
    if (typeof localStorage === 'undefined') {
        return;
    }

    const nextPreferences: WorkspacePreferences = {
        activeTab: state.activeTab,
        inspectorCollapsed: state.inspectorCollapsed,
        inspectorWidth: state.inspectorWidth,
        overlayVisible: state.overlayVisible,
    };

    try {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(nextPreferences));
        localStorage.setItem(LEGACY_TAB_STORAGE_KEY, state.activeTab);
    } catch {
        // Ignore storage errors.
    }
}

export function createWorkspaceStore(initialLabels: Pick<WorkspaceState, 'activeSceneLabel' | 'activeViewModeLabel'>) {
    const initialState: WorkspaceState = {
        ...readStoredPreferences(),
        ...initialLabels,
        isInspectorResizing: false,
    };

    const { subscribe, update } = writable<WorkspaceState>(initialState);

    function mutate(mutator: (state: WorkspaceState) => WorkspaceState): void {
        update((state) => {
            const nextState = mutator(state);
            persistPreferences(nextState);
            return nextState;
        });
    }

    return {
        subscribe,
        selectTab(tabId: ControlTabId): void {
            mutate((state) => ({
                ...state,
                activeTab: tabId,
                inspectorCollapsed: false,
            }));
        },
        toggleInspector(): void {
            mutate((state) => ({
                ...state,
                inspectorCollapsed: !state.inspectorCollapsed,
            }));
        },
        setInspectorCollapsed(inspectorCollapsed: boolean): void {
            mutate((state) => ({
                ...state,
                inspectorCollapsed,
            }));
        },
        setInspectorWidth(width: number): void {
            if (!Number.isFinite(width)) {
                return;
            }

            mutate((state) => ({
                ...state,
                inspectorWidth: clampInspectorWidth(width),
            }));
        },
        resetInspectorWidth(): void {
            mutate((state) => ({
                ...state,
                inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
            }));
        },
        setInspectorResizing(isInspectorResizing: boolean): void {
            update((state) => ({
                ...state,
                isInspectorResizing,
            }));
        },
        setActiveLabels(activeSceneLabel: string, activeViewModeLabel: string): void {
            update((state) => ({
                ...state,
                activeSceneLabel,
                activeViewModeLabel,
            }));
        },
        toggleOverlay(): void {
            mutate((state) => ({
                ...state,
                overlayVisible: !state.overlayVisible,
            }));
        },
        setOverlayVisible(overlayVisible: boolean): void {
            mutate((state) => ({
                ...state,
                overlayVisible,
            }));
        },
    };
}