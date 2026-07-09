import { get, type Readable } from 'svelte/store';
import type { WorkspaceState } from '../ui/workspace-store';

interface WorkspaceLayoutStore extends Readable<WorkspaceState> {
    setInspectorWidth(width: number): void;
    resetInspectorWidth(): void;
    setInspectorResizing(active: boolean): void;
    setEditorWidth(width: number): void;
    setEditorHeight(height: number): void;
    resetEditorWidth(): void;
    resetEditorHeight(): void;
    setEditorResizing(active: boolean): void;
}

export interface LayoutResizeOptions {
    workspace: WorkspaceLayoutStore;
    /** True when the editor is docked to the side (resize horizontally) rather than the bottom. */
    isEditorDockedSide: () => boolean;
    /** Live viewport resize while dragging. */
    resizeViewport: () => void;
    /** Final viewport resize after the layout settles. */
    resizeViewportAfterLayout: () => void;
}

export interface LayoutResizeController {
    startInspectorResize(event: PointerEvent): void;
    startEditorResize(event: PointerEvent): void;
    handleDockKeydown(event: KeyboardEvent): void;
    handleEditorResizeKeydown(event: KeyboardEvent): void;
    resetInspectorWidth(): void;
    /** Removes any in-flight drag listeners; call on component teardown. */
    cleanup(): void;
}

/**
 * Pointer and keyboard resizing for the inspector dock and the editor panel.
 * Owns the transient window listeners of an active drag so the component
 * only wires events to handlers.
 */
export function createLayoutResizeController(options: LayoutResizeOptions): LayoutResizeController {
    const { workspace, isEditorDockedSide, resizeViewport, resizeViewportAfterLayout } = options;
    let inspectorResizeCleanup: (() => void) | null = null;
    let editorResizeCleanup: (() => void) | null = null;

    function cleanupInspectorResize(): void {
        if (inspectorResizeCleanup) {
            inspectorResizeCleanup();
            inspectorResizeCleanup = null;
        }
        workspace.setInspectorResizing(false);
    }

    function cleanupEditorResize(): void {
        if (editorResizeCleanup) {
            editorResizeCleanup();
            editorResizeCleanup = null;
        }
        workspace.setEditorResizing(false);
    }

    function resetInspectorWidth(): void {
        workspace.resetInspectorWidth();
        resizeViewportAfterLayout();
    }

    function startInspectorResize(event: PointerEvent): void {
        const state = get(workspace);
        if (state.inspectorCollapsed || window.innerWidth <= 980) {
            return;
        }

        event.preventDefault();
        cleanupInspectorResize();

        const startX = event.clientX;
        const startWidth = state.inspectorWidth;
        workspace.setInspectorResizing(true);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const delta = startX - moveEvent.clientX;
            workspace.setInspectorWidth(startWidth + delta);
            resizeViewport();
        };

        const handlePointerUp = () => {
            cleanupInspectorResize();
            resizeViewportAfterLayout();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
        window.addEventListener('pointercancel', handlePointerUp, { once: true });

        inspectorResizeCleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
        };
    }

    function startEditorResize(event: PointerEvent): void {
        event.preventDefault();
        cleanupEditorResize();
        workspace.setEditorResizing(true);
        const state = get(workspace);

        let handlePointerMove: ((moveEvent: PointerEvent) => void) | null = null;

        if (isEditorDockedSide()) {
            const startX = event.clientX;
            const startWidth = state.editorWidth;
            handlePointerMove = (moveEvent: PointerEvent) => {
                const delta = moveEvent.clientX - startX;
                workspace.setEditorWidth(startWidth + delta);
                resizeViewport();
            };
        } else {
            const startY = event.clientY;
            const startHeight = state.editorHeight;
            handlePointerMove = (moveEvent: PointerEvent) => {
                const delta = startY - moveEvent.clientY;
                workspace.setEditorHeight(startHeight + delta);
                resizeViewport();
            };
        }

        const handlePointerUp = () => {
            cleanupEditorResize();
            resizeViewportAfterLayout();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
        window.addEventListener('pointercancel', handlePointerUp, { once: true });

        editorResizeCleanup = () => {
            if (handlePointerMove) {
                window.removeEventListener('pointermove', handlePointerMove);
            }
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
        };
    }

    function nudgeInspectorWidth(delta: number): void {
        const state = get(workspace);
        if (state.inspectorCollapsed) {
            return;
        }

        workspace.setInspectorWidth(state.inspectorWidth + delta);
        resizeViewportAfterLayout();
    }

    function handleDockKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudgeInspectorWidth(16);
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudgeInspectorWidth(-16);
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            resetInspectorWidth();
        }
    }

    function handleEditorResizeKeydown(event: KeyboardEvent): void {
        const dockedSide = isEditorDockedSide();
        const growKey = dockedSide ? 'ArrowRight' : 'ArrowUp';
        const shrinkKey = dockedSide ? 'ArrowLeft' : 'ArrowDown';
        const state = get(workspace);

        if (event.key === growKey || event.key === shrinkKey) {
            event.preventDefault();
            const delta = event.key === growKey ? 16 : -16;
            if (dockedSide) {
                workspace.setEditorWidth(state.editorWidth + delta);
            } else {
                workspace.setEditorHeight(state.editorHeight + delta);
            }
            resizeViewportAfterLayout();
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            if (dockedSide) {
                workspace.resetEditorWidth();
            } else {
                workspace.resetEditorHeight();
            }
            resizeViewportAfterLayout();
        }
    }

    return {
        startInspectorResize,
        startEditorResize,
        handleDockKeydown,
        handleEditorResizeKeydown,
        resetInspectorWidth,
        cleanup: () => {
            cleanupInspectorResize();
            cleanupEditorResize();
        },
    };
}
