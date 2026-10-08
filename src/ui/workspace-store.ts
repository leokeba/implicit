import { INSPECTOR_TABS, type ControlTabId } from './inspector-schema';
import { writable } from 'svelte/store';

const WORKSPACE_STORAGE_KEY = 'implicit-ui-workspace';

export const DEFAULT_INSPECTOR_WIDTH = 360;
export const MIN_INSPECTOR_WIDTH = 300;
export const MAX_INSPECTOR_WIDTH = 520;
export const DEFAULT_EDITOR_WIDTH = 440;
export const MIN_EDITOR_WIDTH = 320;
export const MAX_EDITOR_WIDTH = 760;

/**
 * Below the wide breakpoint there is room for one side panel only; it shows
 * either the inspector or the code editor.
 */
export type DockPane = 'inspector' | 'editor';

interface WorkspacePreferences {
    activeTab: ControlTabId;
    inspectorCollapsed: boolean;
    inspectorWidth: number;
    overlayVisible: boolean;
    editorVisible: boolean;
    editorWidth: number;
    dockPane: DockPane;
}

export interface WorkspaceState extends WorkspacePreferences {
    activeSceneLabel: string;
    activeViewModeLabel: string;
    isInspectorResizing: boolean;
    isEditorResizing: boolean;
}

function clampInspectorWidth(width: number): number {
    return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.round(width)));
}

function clampEditorWidth(width: number): number {
    return Math.min(MAX_EDITOR_WIDTH, Math.max(MIN_EDITOR_WIDTH, Math.round(width)));
}

function readTabId(value: unknown): ControlTabId | null {
    return INSPECTOR_TABS.find((tab) => tab.id === value)?.id ?? null;
}

function getDefaultPreferences(): WorkspacePreferences {
    return {
        activeTab: 'scene',
        inspectorCollapsed: false,
        inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
        overlayVisible: true,
        editorVisible: true,
        editorWidth: DEFAULT_EDITOR_WIDTH,
        dockPane: 'inspector',
    };
}

function readStoredPreferences(): WorkspacePreferences {
    const defaults = getDefaultPreferences();
    if (typeof localStorage === 'undefined') {
        return defaults;
    }

    try {
        const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (!raw) {
            return defaults;
        }

        const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
        return {
            activeTab: readTabId(parsed.activeTab) ?? defaults.activeTab,
            inspectorCollapsed: parsed.inspectorCollapsed ?? defaults.inspectorCollapsed,
            inspectorWidth: clampInspectorWidth(parsed.inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH),
            overlayVisible: parsed.overlayVisible ?? defaults.overlayVisible,
            editorVisible: typeof parsed.editorVisible === 'boolean' ? parsed.editorVisible : defaults.editorVisible,
            editorWidth: clampEditorWidth(parsed.editorWidth ?? DEFAULT_EDITOR_WIDTH),
            dockPane: parsed.dockPane === 'editor' ? 'editor' : 'inspector',
        };
    } catch {
        return defaults;
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
        editorVisible: state.editorVisible,
        editorWidth: state.editorWidth,
        dockPane: state.dockPane,
    };

    try {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(nextPreferences));
    } catch {
        // Ignore storage errors.
    }
}

export function createWorkspaceStore(initialLabels: Pick<WorkspaceState, 'activeSceneLabel' | 'activeViewModeLabel'>) {
    const initialState: WorkspaceState = {
        ...readStoredPreferences(),
        ...initialLabels,
        isInspectorResizing: false,
        isEditorResizing: false,
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
        toggleEditor(): void {
            mutate((state) => ({
                ...state,
                editorVisible: !state.editorVisible,
            }));
        },
        setEditorVisible(editorVisible: boolean): void {
            mutate((state) => ({
                ...state,
                editorVisible,
            }));
        },
        setEditorWidth(width: number): void {
            if (!Number.isFinite(width)) {
                return;
            }

            mutate((state) => ({
                ...state,
                editorWidth: clampEditorWidth(width),
            }));
        },
        resetEditorWidth(): void {
            mutate((state) => ({
                ...state,
                editorWidth: DEFAULT_EDITOR_WIDTH,
            }));
        },
        setEditorResizing(isEditorResizing: boolean): void {
            update((state) => ({
                ...state,
                isEditorResizing,
            }));
        },
        /** Shows the given pane in the single side panel and opens it. */
        showDockPane(dockPane: DockPane): void {
            mutate((state) => ({
                ...state,
                dockPane,
                inspectorCollapsed: false,
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
