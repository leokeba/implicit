<script lang="ts">
    export let benchmarkIterations: number;
    export let benchmarkWarmups: number;
    export let actionPending: boolean;
    export let outputStatus: string;
    export let onSetBenchmarkIterations: (value: number) => void;
    export let onSetBenchmarkWarmups: (value: number) => void;
    export let onGenerateVaseGcode: () => void | Promise<void>;
    export let onBenchmarkVaseGcode: () => void | Promise<void>;
</script>

<section class="tab-panel">
    <section class="inspector-group">
        <h3>Export And Benchmark</h3>
        <p class="group-caption">Run the slicer and inspect results without leaving the workspace.</p>
        <div class="field-grid">
            <div class="field-row">
                <label for="benchmark-iterations">Measured runs</label>
                <input
                    id="benchmark-iterations"
                    class="action-input"
                    type="number"
                    min="1"
                    max="20"
                    step="1"
                    value={benchmarkIterations}
                    disabled={actionPending}
                    on:input={(event) => onSetBenchmarkIterations(Number((event.currentTarget as HTMLInputElement).value))}
                >
            </div>
            <div class="field-row">
                <label for="benchmark-warmups">Warmup runs</label>
                <input
                    id="benchmark-warmups"
                    class="action-input"
                    type="number"
                    min="0"
                    max="10"
                    step="1"
                    value={benchmarkWarmups}
                    disabled={actionPending}
                    on:input={(event) => onSetBenchmarkWarmups(Number((event.currentTarget as HTMLInputElement).value))}
                >
            </div>
        </div>
    </section>
    <p class="group-caption">Planar contour mode is the strict algorithm. Cylindrical radial mode remains useful for star-convex profiles.</p>
    <div class="action-row">
        <button class="action-button" type="button" disabled={actionPending} on:click={onGenerateVaseGcode}>Generate Vase G-code</button>
        <button class="action-button action-button-secondary" type="button" disabled={actionPending} on:click={onBenchmarkVaseGcode}>Benchmark</button>
    </div>
    <div class="output-console">{outputStatus}</div>
</section>