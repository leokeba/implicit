<script lang="ts">
    import ToolpathPreviewControls from './ToolpathPreviewControls.svelte';
    import type { ToolpathPreviewView } from '../studio/types';

    export let actionPending: boolean;
    export let inspectorCollapsed: boolean;
    export let editorVisible: boolean;
    export let viewerFullscreen: boolean;
    export let onResetView: () => void;
    export let onToggleInspector: () => void | Promise<void>;
    export let onToggleEditor: () => void | Promise<void>;
    export let onToggleViewerFullscreen: () => void | Promise<void>;
    export let onGenerateVaseGcode: () => void | Promise<void>;
    export let generateActionLabel: string;
    export let hasToolpath: boolean;
    export let toolpathVisible: boolean;
    export let onToggleToolpath: () => void;
    export let toolpathPreview: ToolpathPreviewView | null;
    export let onSelectToolpathChannel: (key: string) => void;
    export let onToolpathLayerRange: (minLayer: number, maxLayer: number) => void;
    export let onToggleToolpathTravels: (visible: boolean) => void;
    export let onToggleToolpathAutoScale: (autoScale: boolean) => void;
</script>

<main class="workspace-main">
    <section class="viewport-stage" aria-label="Viewport workspace">
        <div class="viewport-toolbar">
            <div class="viewport-command-surface">
                <div class="viewport-toolbar-actions">
                    <button class="chrome-button" type="button" disabled={actionPending} on:click={onGenerateVaseGcode}>{generateActionLabel}</button>
                    <!-- Labels flip to describe the action, so no aria-pressed:
                         a changing label plus pressed state reads contradictorily. -->
                    <button class="chrome-button chrome-button-ghost" type="button" on:click={onToggleViewerFullscreen}>
                        {viewerFullscreen ? 'Exit Preview' : 'Expand Preview'}
                    </button>
                    {#if !viewerFullscreen}
                        <button class="chrome-button chrome-button-ghost" type="button" on:click={onToggleEditor}>
                            {editorVisible ? 'Hide Editor' : 'Show Editor'}
                        </button>
                    {/if}
                    <button class="chrome-button chrome-button-ghost" type="button" on:click={onResetView}>Reset View</button>
                    {#if hasToolpath}
                        <button class="chrome-button chrome-button-ghost" type="button" on:click={onToggleToolpath}>
                            {toolpathVisible ? 'Hide Toolpath' : 'Show Toolpath'}
                        </button>
                    {/if}
                    {#if !viewerFullscreen}
                        <button class="chrome-button chrome-button-ghost" type="button" on:click={onToggleInspector}>
                            {inspectorCollapsed ? 'Show Inspector' : 'Hide Inspector'}
                        </button>
                    {/if}
                </div>
            </div>
        </div>
        <section id="preview" aria-label="Surface preview"></section>
        {#if toolpathVisible}
            <ToolpathPreviewControls
                view={toolpathPreview}
                onSelectChannel={onSelectToolpathChannel}
                onLayerRange={onToolpathLayerRange}
                onToggleTravels={onToggleToolpathTravels}
                onToggleAutoScale={onToggleToolpathAutoScale}
            />
        {/if}
    </section>
</main>