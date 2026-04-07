<script lang="ts">
    import type { PrinterModel } from '../../core/printer-models';
    import type { VaseSlicerSettings } from '../../core/slicer';
    import { MACHINE_FIELDS } from '../../ui/inspector-config';
    import type { NumericSlicerKey } from '../../ui/inspector-config';

    export let printerModels: PrinterModel[];
    export let slicerSettings: VaseSlicerSettings;
    export let onCommitPrinterModel: (printerModelId: string) => void;
    export let onUpdateSlicerNumber: (key: NumericSlicerKey, value: number) => void;
    export let onUpdateSlicerString: (key: keyof Pick<VaseSlicerSettings, 'startGcode' | 'endGcode'>, value: string) => void;
</script>

<section class="tab-panel">
    <section class="inspector-group">
        <h3>Machine Setup</h3>
        <p class="group-caption">Machine geometry, preset selection, and bed placement belong here.</p>
        <div class="field-grid">
            <div class="field-row">
                <label for="slicer-printer-model">Printer model</label>
                <select id="slicer-printer-model" value={slicerSettings.printerModelId} on:change={(event) => onCommitPrinterModel((event.currentTarget as HTMLSelectElement).value)}>
                    {#each printerModels as printer}
                        <option value={printer.id}>{printer.name}</option>
                    {/each}
                </select>
            </div>
            {#each MACHINE_FIELDS as field}
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
        <h3>Machine G-code</h3>
        <p class="group-caption">Templates support placeholders like {'{nozzleTempC}'}, {'{bedTempC}'}, and {'{fanPwm}'}.</p>
        <div class="field-grid">
            <div class="field-row field-row-textarea">
                <label for="slicer-start-gcode">Start G-code</label>
                <textarea id="slicer-start-gcode" rows="5" value={slicerSettings.startGcode} on:change={(event) => onUpdateSlicerString('startGcode', (event.currentTarget as HTMLTextAreaElement).value)}></textarea>
            </div>
            <div class="field-row field-row-textarea">
                <label for="slicer-end-gcode">End G-code</label>
                <textarea id="slicer-end-gcode" rows="5" value={slicerSettings.endGcode} on:change={(event) => onUpdateSlicerString('endGcode', (event.currentTarget as HTMLTextAreaElement).value)}></textarea>
            </div>
        </div>
    </section>
</section>