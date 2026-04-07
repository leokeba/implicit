<script lang="ts">
    export let inspectorCollapsed: boolean;
    export let onResetView: () => void;
    export let onToggleInspector: () => void;
</script>

<main class="workspace-main">
    <section class="viewport-stage" aria-label="Viewport workspace">
        <div class="viewport-toolbar">
            <span class="viewport-badge">Live Viewport</span>
            <div class="viewport-toolbar-actions">
                <button class="chrome-button chrome-button-ghost" type="button" on:click={onResetView}>Reset</button>
                <button class="chrome-button chrome-button-ghost" type="button" aria-expanded={!inspectorCollapsed} on:click={onToggleInspector}>
                    {inspectorCollapsed ? 'Show Panel' : 'Hide Panel'}
                </button>
            </div>
        </div>
        <section id="preview" aria-label="Surface preview"></section>
    </section>
</main>