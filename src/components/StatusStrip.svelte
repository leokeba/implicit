<script lang="ts">
    export let workspaceStatus: string;
    export let outputStatus: string;
    export let actionPending: boolean;
    export let progressVisible: boolean;
    export let progressPercent: number;
    export let progressPhaseLabel: string;
    export let progressDetail: string;
    export let shaderStatusDetail: string;
</script>

<footer class="status-strip">
    <section class="status-panel">
        <span class="status-label">Workspace</span>
        <p class="status-copy">{workspaceStatus}</p>
    </section>
    <section class="status-panel">
        <span class="status-label">Commands</span>
        <p class="status-copy">{actionPending ? 'Running command...' : outputStatus}</p>
        {#if progressVisible}
            <div class="slice-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label="Slicing progress">
                <div class="slice-progress-meta">
                    <span>{progressPhaseLabel || 'Slicing'}</span>
                    <span>{`${Math.max(0, Math.min(100, Math.round(progressPercent)))}%`}</span>
                </div>
                <div class="slice-progress-track">
                    <span class="slice-progress-fill" style={`width: ${Math.max(0, Math.min(100, progressPercent))}%`}></span>
                </div>
                <p class="slice-progress-detail">{progressDetail}</p>
            </div>
        {/if}
    </section>
    <section class="status-panel">
        <span class="status-label">Navigation</span>
        <p class="status-copy">Left-drag orbit, Shift or right-drag pan, middle-drag dolly, wheel zoom, press F to reset.</p>
    </section>
    <section class="status-panel status-panel-diagnostics">
        <span class="status-label">Shader Diagnostics</span>
        <pre class="shader-status-detail" aria-live="polite">{shaderStatusDetail}</pre>
    </section>
</footer>