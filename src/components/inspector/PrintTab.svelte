<script lang="ts">
    import type { VaseSlicerSettings } from '../../core/slicer';
    import { PRINT_ADHESION_FIELDS, PRINT_GEOMETRY_FIELDS, SLICER_MODE_OPTIONS } from '../../ui/inspector-config';
    import type { NumericSlicerKey } from '../../ui/inspector-config';

    export let slicerSettings: VaseSlicerSettings;
    export let onUpdateSlicerMode: (value: string) => void;
    export let onUpdateSlicerNumber: (key: NumericSlicerKey, value: number) => void;
</script>

<section class="tab-panel">
    <section class="inspector-group">
        <h3>Print Geometry</h3>
        <p class="group-caption">Shape and sampling parameters that affect the generated contour.</p>
        <div class="field-grid">
            <div class="field-row">
                <label for="slicer-mode">Slicer mode</label>
                <select id="slicer-mode" value={slicerSettings.slicerMode} on:change={(event) => onUpdateSlicerMode((event.currentTarget as HTMLSelectElement).value)}>
                    {#each SLICER_MODE_OPTIONS as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </div>
            {#each PRINT_GEOMETRY_FIELDS as field}
                <div class="field-row">
                    <label for={field.id}>{field.label}</label>
                    <input
                        id={field.id}
                        type="number"
                        step={field.step}
                        min={field.min}
                        max={field.max}
                        value={slicerSettings[field.key]}
                        on:change={(event) => onUpdateSlicerNumber(field.key, Number((event.currentTarget as HTMLInputElement).value))}
                    >
                </div>
            {/each}
        </div>
    </section>

    <section class="inspector-group">
        <h3>Adhesion And Merge</h3>
        <p class="group-caption">Brim and simplification controls stay together in the print workflow.</p>
        <div class="field-grid">
            {#each PRINT_ADHESION_FIELDS as field}
                <div class="field-row">
                    <label for={field.id}>{field.label}</label>
                    <input
                        id={field.id}
                        type="number"
                        step={field.step}
                        min={field.min}
                        max={field.max}
                        value={slicerSettings[field.key]}
                        on:change={(event) => onUpdateSlicerNumber(field.key, Number((event.currentTarget as HTMLInputElement).value))}
                    >
                </div>
            {/each}
        </div>
    </section>
</section>