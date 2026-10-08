<script lang="ts">
    import Icon from './Icon.svelte';
    import type { ShaderStatusMode } from '../studio/types';

    export let shaderStatusMode: ShaderStatusMode;
    export let shaderStatusText: string;
    export let shaderStatusDetail: string;
    export let workspaceStatus: string;
    export let workspaceActionLabel: string | null = null;
    export let onWorkspaceAction: (() => void) | null = null;
    export let outputStatus: string;
    export let actionPending: boolean;
    export let progressVisible: boolean;
    export let progressPercent: number;
    export let progressPhaseLabel: string;
    export let progressDetail: string;

    let diagnosticsOpen = false;
    let lastShaderStatusMode: ShaderStatusMode | null = null;

    // Compile errors open the diagnostics once per transition into the error
    // state; after that the reader decides whether they stay open.
    $: if (shaderStatusMode !== lastShaderStatusMode) {
        if (shaderStatusMode === 'error') {
            diagnosticsOpen = true;
        }
        lastShaderStatusMode = shaderStatusMode;
    }

    $: clampedProgress = Math.max(0, Math.min(100, progressPercent));
</script>

<footer class="status-strip">
    {#if diagnosticsOpen}
        <section class="status-diagnostics" aria-label="Shader diagnostics">
            <header>
                <span>Shader diagnostics</span>
                <button class="icon-button icon-button-small" type="button" aria-label="Close shader diagnostics" on:click={() => (diagnosticsOpen = false)}>
                    <Icon name="close" size={14} />
                </button>
            </header>
            <pre aria-live="polite">{shaderStatusDetail}</pre>
        </section>
    {/if}

    <button
        class={`status-item status-shader status-shader-${shaderStatusMode}`}
        type="button"
        aria-expanded={diagnosticsOpen}
        title="Shader diagnostics"
        on:click={() => (diagnosticsOpen = !diagnosticsOpen)}
    >
        <span class="status-dot" aria-hidden="true"></span>
        <span class="status-text" role="status" aria-live="polite">{shaderStatusText}</span>
    </button>

    <div class="status-item status-command" title={progressDetail || outputStatus}>
        {#if progressVisible}
            <div class="slice-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label="Slicing progress">
                <span class="slice-progress-label">{progressPhaseLabel || 'Slicing'}</span>
                <span class="slice-progress-track"><span class="slice-progress-fill" style={`width: ${clampedProgress}%`}></span></span>
                <span class="slice-progress-percent">{`${Math.round(clampedProgress)}%`}</span>
                {#if progressDetail}
                    <span class="status-text status-muted">{progressDetail}</span>
                {/if}
            </div>
        {:else}
            <span class="status-text">{actionPending ? 'Running…' : outputStatus}</span>
        {/if}
    </div>

    <div class="status-item status-workspace" title={workspaceStatus}>
        <span class="status-text status-muted">{workspaceStatus}</span>
        {#if workspaceActionLabel && onWorkspaceAction}
            <button class="status-link" type="button" on:click={onWorkspaceAction}>{workspaceActionLabel}</button>
        {/if}
    </div>

    <button class="icon-button icon-button-small" type="button" popovertarget="navigation-help" aria-label="Viewport controls" title="Viewport controls">
        <Icon name="help" size={14} />
    </button>
    <div id="navigation-help" class="navigation-help" popover>
        <dl>
            <dt>Orbit</dt><dd>Left-drag, or one finger</dd>
            <dt>Pan</dt><dd>Shift-drag or right-drag</dd>
            <dt>Dolly</dt><dd>Middle-drag, or pinch</dd>
            <dt>Zoom</dt><dd>Scroll wheel</dd>
            <dt>Reset</dt><dd>F</dd>
            <dt>Save file</dt><dd>⌘S / Ctrl+S</dd>
        </dl>
    </div>
</footer>
