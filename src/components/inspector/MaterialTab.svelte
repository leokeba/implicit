<script lang="ts">
    import type { FilamentProfile } from '../../core/filament-profiles';
    import type { VaseSlicerSettings } from '../../core/slicer';
    import { MATERIAL_FIELDS } from '../../ui/inspector-config';
    import type { NumericSlicerKey } from '../../ui/inspector-config';

    export let filamentProfiles: FilamentProfile[];
    export let slicerSettings: VaseSlicerSettings;
    export let onCommitFilamentProfile: (filamentProfileId: string) => void;
    export let onUpdateSlicerNumber: (key: NumericSlicerKey, value: number) => void;
</script>

<section class="tab-panel">
    <section class="inspector-group">
        <h3>Material Setup</h3>
        <p class="group-caption">Thermals and extrusion settings are grouped under the filament profile.</p>
        <div class="field-grid">
            <div class="field-row">
                <label for="slicer-filament-profile">Filament profile</label>
                <select id="slicer-filament-profile" value={slicerSettings.filamentProfileId} on:change={(event) => onCommitFilamentProfile((event.currentTarget as HTMLSelectElement).value)}>
                    {#each filamentProfiles as profile}
                        <option value={profile.id}>{profile.name}</option>
                    {/each}
                </select>
            </div>
            {#each MATERIAL_FIELDS as field}
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