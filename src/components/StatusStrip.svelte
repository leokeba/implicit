<script lang="ts">
    export let workspaceStatus: string;
    export let outputStatus: string;
    export let actionPending: boolean;
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