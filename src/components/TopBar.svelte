<script lang="ts">
    import type { FilamentProfile } from '../core/filament-profiles';
    import type { PrinterModel } from '../core/printer-models';
    import type { SceneOption } from '../core/shader-pipeline';
    import type { ShaderStatusMode } from '../studio-controller';
    import { VIEW_MODE_OPTIONS } from '../ui/inspector-schema';

    export let sceneOptions: SceneOption[];
    export let sceneId: string;
    export let viewMode: number;
    export let printerModels: PrinterModel[];
    export let filamentProfiles: FilamentProfile[];
    export let printerModelId: string;
    export let filamentProfileId: string;
    export let shaderStatusMode: ShaderStatusMode;
    export let shaderStatusText: string;
    export let actionPending: boolean;
    export let showDownloadButton: boolean;
    export let showPrintButton: boolean;
    export let onCommitScene: (sceneId: string) => void;
    export let onCommitViewMode: (viewMode: number) => void;
    export let onCommitPrinterModel: (printerModelId: string) => void;
    export let onCommitFilamentProfile: (filamentProfileId: string) => void;
    export let onDownloadGeneratedGcode: () => void | Promise<void>;
    export let onSendVaseGcodeToPrinter: () => void | Promise<void>;
</script>

<header class="app-topbar">
    <div class="app-brand">
        <img class="app-brand-logo" src="/branding/implicit-logo-primary.svg" alt="Implicit logo">
        <h1>Implicit</h1>
    </div>

    <div class="topbar-selectors" aria-label="Workspace selectors">
        <label class="topbar-field">
            <span>Scene</span>
            <select value={sceneId} on:change={(event) => onCommitScene((event.currentTarget as HTMLSelectElement).value)}>
                {#each sceneOptions as scene}
                    <option value={scene.id}>{scene.name}</option>
                {/each}
            </select>
        </label>

        <label class="topbar-field">
            <span>View</span>
            <select value={String(viewMode)} on:change={(event) => onCommitViewMode(Number((event.currentTarget as HTMLSelectElement).value))}>
                {#each VIEW_MODE_OPTIONS as option}
                    <option value={option.value}>{option.label}</option>
                {/each}
            </select>
        </label>

        <label class="topbar-field">
            <span>Machine</span>
            <select value={printerModelId} on:change={(event) => onCommitPrinterModel((event.currentTarget as HTMLSelectElement).value)}>
                {#each printerModels as model}
                    <option value={model.id}>{model.name}</option>
                {/each}
            </select>
        </label>

        <label class="topbar-field">
            <span>Material</span>
            <select value={filamentProfileId} on:change={(event) => onCommitFilamentProfile((event.currentTarget as HTMLSelectElement).value)}>
                {#each filamentProfiles as profile}
                    <option value={profile.id}>{profile.name}</option>
                {/each}
            </select>
        </label>
    </div>

    <div class="topbar-actions">
        {#if showDownloadButton}
            <button class="chrome-button" type="button" disabled={actionPending} on:click={onDownloadGeneratedGcode}>Download</button>
        {/if}
        {#if showPrintButton}
            <button class="chrome-button" type="button" disabled={actionPending} on:click={onSendVaseGcodeToPrinter}>Print</button>
        {/if}
        <div class={`shader-status shader-status-${shaderStatusMode}`} role="status" aria-live="polite">{shaderStatusText}</div>
    </div>
</header>