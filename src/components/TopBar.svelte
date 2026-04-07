<script lang="ts">
    import type { ShaderStatusMode } from '../studio-controller';

    export let activeSceneLabel: string;
    export let activeViewModeLabel: string;
    export let inspectorCollapsed: boolean;
    export let shaderStatusMode: ShaderStatusMode;
    export let shaderStatusText: string;
    export let onResetView: () => void;
    export let onToggleInspector: () => void | Promise<void>;
</script>

<header class="app-topbar">
    <div class="app-brand">
        <p class="app-eyebrow">Implicit Studio</p>
        <div class="app-brand-row">
            <h1>Implicit</h1>
            <span class="app-build-tag">Svelte Workspace</span>
        </div>
    </div>
    <div class="topbar-meta" aria-label="Workspace metadata">
        <div class="topbar-chip">
            <span class="topbar-chip-label">Scene</span>
            <strong>{activeSceneLabel}</strong>
        </div>
        <div class="topbar-chip">
            <span class="topbar-chip-label">View</span>
            <strong>{activeViewModeLabel}</strong>
        </div>
    </div>
    <div class="topbar-actions">
        <button class="chrome-button chrome-button-secondary" type="button" on:click={onResetView}>Reset View</button>
        <button class="chrome-button" type="button" aria-expanded={!inspectorCollapsed} on:click={onToggleInspector}>
            {inspectorCollapsed ? 'Show Inspector' : 'Hide Inspector'}
        </button>
        <div class={`shader-status shader-status-${shaderStatusMode}`} role="status" aria-live="polite">{shaderStatusText}</div>
    </div>
</header>