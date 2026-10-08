<script lang="ts">
    import Icon from './Icon.svelte';
    import type { FilamentProfile } from '../core/filament-profiles';
    import type { PrinterModel } from '../core/printer-models';
    import type { SceneOption } from '../core/shader-pipeline';

    export let sceneOptions: SceneOption[];
    export let sceneId: string;
    export let printerModels: PrinterModel[];
    export let filamentProfiles: FilamentProfile[];
    export let printerModelId: string;
    export let filamentProfileId: string;
    export let actionPending: boolean;
    export let generateActionLabel: string;
    export let showDownloadButton: boolean;
    export let showPrintButton: boolean;
    /** "Print" for Moonraker; Bambu hands off to Connect rather than starting. */
    export let printActionLabel: string;
    export let onCommitScene: (sceneId: string) => void;
    export let onCommitPrinterModel: (printerModelId: string) => void;
    export let onCommitFilamentProfile: (filamentProfileId: string) => void;
    export let onGenerateVaseGcode: () => void | Promise<void>;
    export let onDownloadGeneratedGcode: () => void | Promise<void>;
    export let onSendVaseGcodeToPrinter: () => void | Promise<void>;
</script>

<header class="app-topbar">
    <div class="app-brand">
        <img class="app-brand-logo" src="{import.meta.env.BASE_URL}branding/implicit-logo-primary.svg" alt="">
        <h1>Implicit</h1>
    </div>

    <div class="topbar-selectors" aria-label="Workspace selectors">
        <label class="topbar-field topbar-field-scene">
            <span>Scene</span>
            <select id="topbar-scene" name="scene" value={sceneId} on:change={(event) => onCommitScene((event.currentTarget as HTMLSelectElement).value)}>
                {#each sceneOptions as scene}
                    <option value={scene.id}>{scene.name}</option>
                {/each}
            </select>
        </label>

        <!-- Machine and material also live in their inspector tabs; on narrow
             screens the top bar drops them rather than wrapping. -->
        <label class="topbar-field topbar-field-print">
            <span>Machine</span>
            <select id="topbar-machine" name="machine" value={printerModelId} on:change={(event) => onCommitPrinterModel((event.currentTarget as HTMLSelectElement).value)}>
                {#each printerModels as model}
                    <option value={model.id}>{model.name}</option>
                {/each}
            </select>
        </label>

        <label class="topbar-field topbar-field-print">
            <span>Material</span>
            <select id="topbar-material" name="material" value={filamentProfileId} on:change={(event) => onCommitFilamentProfile((event.currentTarget as HTMLSelectElement).value)}>
                {#each filamentProfiles as profile}
                    <option value={profile.id}>{profile.name}</option>
                {/each}
            </select>
        </label>
    </div>

    <div class="topbar-actions">
        <button class="chrome-button chrome-button-primary" type="button" disabled={actionPending} on:click={onGenerateVaseGcode}>{generateActionLabel}</button>
        {#if showDownloadButton}
            <button class="chrome-button" type="button" aria-label="Download G-code" title="Download G-code" disabled={actionPending} on:click={onDownloadGeneratedGcode}>
                <Icon name="download" />
                <span class="button-label">Download</span>
            </button>
        {/if}
        {#if showPrintButton}
            <button class="chrome-button" type="button" aria-label={printActionLabel} title={printActionLabel} disabled={actionPending} on:click={onSendVaseGcodeToPrinter}>
                <Icon name="send" />
                <span class="button-label">{printActionLabel}</span>
            </button>
        {/if}
    </div>
</header>
