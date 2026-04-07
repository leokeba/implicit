<script lang="ts">
    import type { ViewportParams } from '../../core/renderer';
    import { VIEWPORT_FIELDS } from '../../ui/inspector-config';

    export let viewportParams: ViewportParams;
    export let onUpdateViewportField: (key: keyof ViewportParams, value: number) => void;
    export let onResetView: () => void;
</script>

<section class="tab-panel">
    <section class="inspector-group">
        <h3>Navigation Tuning</h3>
        <p class="group-caption">These controls tune how the orbit camera behaves in the workspace.</p>
        <div class="field-grid">
            {#each VIEWPORT_FIELDS as field}
                <div class="field-row">
                    <label for={field.id}>{field.label}</label>
                    <input
                        id={field.id}
                        type="number"
                        step={field.step}
                        min={field.min}
                        max={field.max}
                        value={viewportParams[field.key as keyof ViewportParams]}
                        on:change={(event) => onUpdateViewportField(field.key as keyof ViewportParams, Number((event.currentTarget as HTMLInputElement).value))}
                    >
                </div>
            {/each}
        </div>
    </section>
    <div class="action-row">
        <button class="action-button action-button-secondary" type="button" on:click={onResetView}>Reset View</button>
    </div>
</section>