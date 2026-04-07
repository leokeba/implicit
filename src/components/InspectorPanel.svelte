<script lang="ts">
    import type { AnimationParams, RaymarchParams, ViewportParams } from '../core/renderer';
    import type { FilamentProfile } from '../core/filament-profiles';
    import type { PrinterModel } from '../core/printer-models';
    import type { SceneOption } from '../core/shader-pipeline';
    import type { VaseSlicerSettings } from '../core/slicer';
    import CameraTab from './inspector/CameraTab.svelte';
    import MachineTab from './inspector/MachineTab.svelte';
    import MaterialTab from './inspector/MaterialTab.svelte';
    import OutputTab from './inspector/OutputTab.svelte';
    import PrintTab from './inspector/PrintTab.svelte';
    import RenderTab from './inspector/RenderTab.svelte';
    import SceneTab from './inspector/SceneTab.svelte';
    import { INSPECTOR_TABS } from '../ui/inspector-config';
    import type { ControlTabId, NumericSlicerKey } from '../ui/inspector-config';

    export let activeTab: ControlTabId;
    export let sceneOptions: SceneOption[];
    export let printerModels: PrinterModel[];
    export let filamentProfiles: FilamentProfile[];
    export let sceneId: string;
    export let viewMode: number;
    export let raymarchParams: RaymarchParams;
    export let viewportParams: ViewportParams;
    export let animationParams: AnimationParams;
    export let slicerSettings: VaseSlicerSettings;
    export let benchmarkIterations: number;
    export let benchmarkWarmups: number;
    export let actionPending: boolean;
    export let outputStatus: string;
    export let onSelectTab: (tabId: ControlTabId) => void;
    export let onCommitViewMode: (viewMode: number) => void;
    export let onCommitScene: (sceneId: string) => void;
    export let onUpdateViewportField: (key: keyof ViewportParams, value: number) => void;
    export let onResetView: () => void;
    export let onUpdateRaymarchField: (key: keyof RaymarchParams, value: number) => void;
    export let onUpdateAnimationField: (key: keyof AnimationParams, value: number) => void;
    export let onUpdateSlicerMode: (value: string) => void;
    export let onUpdateSlicerNumber: (key: NumericSlicerKey, value: number) => void;
    export let onCommitPrinterModel: (printerModelId: string) => void;
    export let onUpdateSlicerString: (key: keyof Pick<VaseSlicerSettings, 'startGcode' | 'endGcode'>, value: string) => void;
    export let onCommitFilamentProfile: (filamentProfileId: string) => void;
    export let onSetBenchmarkIterations: (value: number) => void;
    export let onSetBenchmarkWarmups: (value: number) => void;
    export let onGenerateVaseGcode: () => void | Promise<void>;
    export let onBenchmarkVaseGcode: () => void | Promise<void>;
</script>

<aside id="controls" aria-label="Inspector">
    <div class="controls-shell">
        <div class="controls-header">
            <h2>Inspector</h2>
            <p class="controls-note">Task-oriented tabs replace the old stacked form so the viewport can stay dominant.</p>
        </div>

        <div class="tab-bar">
            {#each INSPECTOR_TABS as tab}
                <button
                    class:is-active={activeTab === tab.id}
                    class="tab-button"
                    type="button"
                    aria-pressed={activeTab === tab.id}
                    on:click={() => onSelectTab(tab.id)}
                >
                    {tab.label}
                </button>
            {/each}
        </div>

        <div class="tab-panels">
            {#if activeTab === 'scene'}
                <SceneTab {sceneOptions} {sceneId} {viewMode} onCommitViewMode={onCommitViewMode} onCommitScene={onCommitScene} />
            {:else if activeTab === 'camera'}
                <CameraTab {viewportParams} onUpdateViewportField={onUpdateViewportField} onResetView={onResetView} />
            {:else if activeTab === 'render'}
                <RenderTab {raymarchParams} {animationParams} onUpdateRaymarchField={onUpdateRaymarchField} onUpdateAnimationField={onUpdateAnimationField} />
            {:else if activeTab === 'print'}
                <PrintTab {slicerSettings} onUpdateSlicerMode={onUpdateSlicerMode} onUpdateSlicerNumber={onUpdateSlicerNumber} />
            {:else if activeTab === 'machine'}
                <MachineTab {printerModels} {slicerSettings} onCommitPrinterModel={onCommitPrinterModel} onUpdateSlicerNumber={onUpdateSlicerNumber} onUpdateSlicerString={onUpdateSlicerString} />
            {:else if activeTab === 'material'}
                <MaterialTab {filamentProfiles} {slicerSettings} onCommitFilamentProfile={onCommitFilamentProfile} onUpdateSlicerNumber={onUpdateSlicerNumber} />
            {:else}
                <OutputTab
                    {benchmarkIterations}
                    {benchmarkWarmups}
                    {actionPending}
                    {outputStatus}
                    onSetBenchmarkIterations={onSetBenchmarkIterations}
                    onSetBenchmarkWarmups={onSetBenchmarkWarmups}
                    onGenerateVaseGcode={onGenerateVaseGcode}
                    onBenchmarkVaseGcode={onBenchmarkVaseGcode}
                />
            {/if}
        </div>
    </div>
</aside>