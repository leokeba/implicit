<script lang="ts">
    export let actionPending: boolean;
    export let inspectorCollapsed: boolean;
    export let editorVisible: boolean;
    export let editorModeLabel: string;
    export let editorDirty: boolean;
    export let onResetView: () => void;
    export let onToggleInspector: () => void | Promise<void>;
    export let onToggleEditor: () => void | Promise<void>;
    export let onGenerateVaseGcode: () => void | Promise<void>;
</script>

<main class="workspace-main">
    <section class="viewport-stage" aria-label="Viewport workspace">
        <div class="viewport-toolbar">
            <div class="viewport-command-surface">
                <div class="viewport-toolbar-group viewport-toolbar-group-strong">
                    <span class="viewport-badge">Live Viewport</span>
                    <span class="viewport-badge viewport-badge-muted">{editorModeLabel}</span>
                    {#if editorDirty}
                        <span class="viewport-badge scene-editor-dirty-badge">Unsaved Scene</span>
                    {/if}
                </div>
                <div class="viewport-toolbar-actions">
                    <button class="chrome-button" type="button" disabled={actionPending} on:click={onGenerateVaseGcode}>Generate</button>
                    <button class="chrome-button chrome-button-ghost" type="button" aria-pressed={editorVisible} on:click={onToggleEditor}>
                        {editorVisible ? 'Hide Editor' : 'Show Editor'}
                    </button>
                    <button class="chrome-button chrome-button-ghost" type="button" on:click={onResetView}>Reset View</button>
                    <button class="chrome-button chrome-button-ghost" type="button" aria-expanded={!inspectorCollapsed} on:click={onToggleInspector}>
                        {inspectorCollapsed ? 'Show Inspector' : 'Hide Inspector'}
                    </button>
                </div>
            </div>
        </div>
        <section id="preview" aria-label="Surface preview"></section>
    </section>
</main>