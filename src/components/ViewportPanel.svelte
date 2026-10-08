<script lang="ts">
    import Icon from './Icon.svelte';
    import ToolpathPreviewControls from './ToolpathPreviewControls.svelte';
    import type { ToolpathPreviewView } from '../studio/types';
    import type { LayoutMode } from '../app/layout-mode';
    import { VIEW_MODE_OPTIONS } from '../ui/inspector-schema';

    export let layoutMode: LayoutMode;
    export let viewMode: number;
    export let onCommitViewMode: (viewMode: number) => void;
    export let inspectorCollapsed: boolean;
    export let editorVisible: boolean;
    export let viewerFullscreen: boolean;
    export let onResetView: () => void;
    export let onToggleInspector: () => void | Promise<void>;
    export let onToggleEditor: () => void | Promise<void>;
    export let onToggleViewerFullscreen: () => void | Promise<void>;
    export let hasToolpath: boolean;
    export let toolpathVisible: boolean;
    export let onToggleToolpath: () => void;
    export let toolpathPreview: ToolpathPreviewView | null;
    export let onSelectToolpathChannel: (key: string) => void;
    export let onToolpathLayerRange: (minLayer: number, maxLayer: number) => void;
    export let onToggleToolpathTravels: (visible: boolean) => void;
    export let onToggleToolpathAutoScale: (autoScale: boolean) => void;

    $: panelIcon = layoutMode === 'narrow' ? 'panel-bottom' as const : 'panel-right' as const;
</script>

<main class="workspace-main">
    <section class="viewport-stage" aria-label="Viewport workspace">
        <div class="viewport-toolbar">
            <div class="viewport-toolbar-group">
                <select
                    id="viewport-view-mode"
                    name="view"
                    class="viewport-select"
                    aria-label="View mode"
                    value={String(viewMode)}
                    on:change={(event) => onCommitViewMode(Number((event.currentTarget as HTMLSelectElement).value))}
                >
                    {#each VIEW_MODE_OPTIONS as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
                <button class="icon-button" type="button" aria-label="Reset view (F)" title="Reset view (F)" on:click={onResetView}>
                    <Icon name="reset-view" />
                </button>
                {#if hasToolpath}
                    <button class="icon-button" type="button" aria-label="Toolpath" title="Toolpath" aria-pressed={toolpathVisible} on:click={onToggleToolpath}>
                        <Icon name="layers" />
                    </button>
                {/if}
                <button class="icon-button" type="button" aria-label="Fullscreen preview" title={viewerFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'} aria-pressed={viewerFullscreen} on:click={onToggleViewerFullscreen}>
                    <Icon name={viewerFullscreen ? 'collapse' : 'expand'} />
                </button>
            </div>

            {#if !viewerFullscreen}
                <div class="viewport-toolbar-group">
                    {#if layoutMode === 'wide'}
                        <button class="icon-button" type="button" aria-label="Code editor" title="Code editor" aria-pressed={editorVisible} on:click={onToggleEditor}>
                            <Icon name="code" />
                        </button>
                    {/if}
                    <button class="icon-button" type="button" aria-label="Side panel" title="Side panel" aria-pressed={!inspectorCollapsed} on:click={onToggleInspector}>
                        <Icon name={panelIcon} />
                    </button>
                </div>
            {/if}
        </div>
        <section id="preview" aria-label="Surface preview"></section>
        {#if toolpathVisible}
            <ToolpathPreviewControls
                view={toolpathPreview}
                onSelectChannel={onSelectToolpathChannel}
                onLayerRange={onToolpathLayerRange}
                onToggleTravels={onToggleToolpathTravels}
                onToggleAutoScale={onToggleToolpathAutoScale}
                startCollapsed={layoutMode === 'narrow'}
            />
        {/if}
    </section>
</main>
