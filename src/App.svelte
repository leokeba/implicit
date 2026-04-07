<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';

    import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
    import type { VaseSlicerSettings } from './core/slicer';
    import InspectorPanel from './components/InspectorPanel.svelte';
    import StatusStrip from './components/StatusStrip.svelte';
    import TopBar from './components/TopBar.svelte';
    import ViewportPanel from './components/ViewportPanel.svelte';
    import { type ShaderStatusMode, type StudioController } from './studio-controller';
    import {
        type ControlTabId,
        type InspectorSchemaHandlers,
        type InspectorSchemaState,
        type NumericSlicerKey,
    } from './ui/inspector-schema';
    import { createStatusModel } from './ui/status-model';
    import { createWorkspaceStore } from './ui/workspace-store';

    export let studio: StudioController;

    const snapshot = studio.getSnapshot();

    let sceneOptions = snapshot.sceneOptions;
    let sceneControlDefinitions = snapshot.sceneControlDefinitions;
    let sceneControlValues = snapshot.sceneControlValues;
    let printerModels = snapshot.printerModels;
    let filamentProfiles = snapshot.filamentProfiles;
    let sceneId = snapshot.sceneId;
    let viewMode = snapshot.viewMode;
    let raymarchParams = snapshot.raymarchParams;
    let viewportParams = snapshot.viewportParams;
    let animationParams = snapshot.animationParams;
    let slicerSettings = snapshot.slicerSettings;

    const workspace = createWorkspaceStore({
        activeSceneLabel: studio.getSceneLabel(sceneId),
        activeViewModeLabel: studio.getViewModeLabel(viewMode),
    });
    const status = createStatusModel();

    let resizeCleanup: (() => void) | null = null;

    $: workspace.setActiveLabels(studio.getSceneLabel(sceneId), studio.getViewModeLabel(viewMode));
    $: studio.setToolpathOverlayVisible($workspace.overlayVisible);
    $: inspectorState = {
        sceneOptions,
        sceneControlDefinitions,
        sceneControlValues,
        printerModels,
        filamentProfiles,
        sceneId,
        viewMode,
        raymarchParams,
        viewportParams,
        animationParams,
        slicerSettings,
        benchmarkIterations: $status.benchmarkIterations,
        benchmarkWarmups: $status.benchmarkWarmups,
        actionPending: $status.actionPending,
        outputStatus: $status.outputStatus,
    } satisfies InspectorSchemaState;

    async function resizeViewportAfterLayout(): Promise<void> {
        await tick();
        studio.resizeViewport();
    }

    async function selectTab(tabId: ControlTabId): Promise<void> {
        workspace.selectTab(tabId);
        await resizeViewportAfterLayout();
    }

    async function toggleInspector(): Promise<void> {
        workspace.toggleInspector();
        await resizeViewportAfterLayout();
    }

    function commitViewMode(nextViewMode: number): void {
        viewMode = nextViewMode;
        status.setWorkspaceStatus(studio.setViewMode(nextViewMode));
    }

    function commitScene(nextSceneId: string): void {
        status.setShaderStatus('compiling', 'Compiling...');
        const result = studio.changeScene(nextSceneId);
        sceneId = result.sceneId;
        slicerSettings = result.settings;
        sceneControlDefinitions = result.sceneControlDefinitions;
        sceneControlValues = result.sceneControlValues;
        status.applySceneChange(result);
    }

    function updateSceneControlValue(controlKey: string, value: number): void {
        sceneControlValues = {
            ...sceneControlValues,
            [controlKey]: value,
        };
        studio.updateSceneControlValue(controlKey, value);
    }

    function updateRaymarchField(key: keyof RaymarchParams, value: number): void {
        raymarchParams = { ...raymarchParams, [key]: value };
        studio.updateRaymarchParams({ [key]: value });
    }

    function updateViewportField(key: keyof ViewportParams, value: number): void {
        viewportParams = { ...viewportParams, [key]: value };
        studio.updateViewportParams({ [key]: value });
    }

    function updateAnimationField(key: keyof AnimationParams, value: number): void {
        animationParams = { ...animationParams, [key]: value };
        studio.updateAnimationParams({ [key]: value });
    }

    function resetView(): void {
        status.setWorkspaceStatus(studio.resetView());
    }

    function commitPrinterModel(printerModelId: string): void {
        const result = studio.changePrinterModel(printerModelId);
        slicerSettings = result.settings;
        status.applyPresetChange(result);
    }

    function commitFilamentProfile(filamentProfileId: string): void {
        const result = studio.changeFilamentProfile(filamentProfileId);
        slicerSettings = result.settings;
        status.applyPresetChange(result);
    }

    function updateSlicerNumber(key: NumericSlicerKey, value: number): void {
        slicerSettings = { ...slicerSettings, [key]: value } as VaseSlicerSettings;
        studio.updateSlicerParams({ [key]: value } as Partial<VaseSlicerSettings>);
    }

    function updateSlicerString(key: keyof Pick<VaseSlicerSettings, 'startGcode' | 'endGcode'>, value: string): void {
        slicerSettings = { ...slicerSettings, [key]: value };
        studio.updateSlicerParams({ [key]: value });
    }

    function updateSlicerMode(value: string): void {
        const nextMode = value as VaseSlicerSettings['slicerMode'];
        slicerSettings = { ...slicerSettings, slicerMode: nextMode };
        studio.updateSlicerParams({ slicerMode: nextMode });
    }

    async function generateVaseGcode(): Promise<void> {
        await status.runCommand('Generating G-code...', () => {
            const result = studio.generateVaseGcode();
            return `Exported ${result.filename} (${(result.bytes / 1024).toFixed(1)} KB, ${result.points} points).`;
        });
    }

    async function benchmarkVaseGcode(): Promise<void> {
        const iterations = Math.max(1, $status.benchmarkIterations || 1);
        const warmups = Math.max(0, $status.benchmarkWarmups || 0);
        const measuredLabel = `${iterations} measured run${iterations === 1 ? '' : 's'}`;
        const warmupLabel = `${warmups} warmup run${warmups === 1 ? '' : 's'}`;
        await status.runCommand(`Benchmarking ${measuredLabel} after ${warmupLabel}...`, () => {
            const summary = studio.benchmarkVaseGcode(iterations, warmups);
            return `Benchmark settled on ${summary.measuredRuns} measured run${summary.measuredRuns === 1 ? '' : 's'} after ${summary.warmupRuns} warmup run${summary.warmupRuns === 1 ? '' : 's'}: avg ${summary.averageMs.toFixed(1)} ms, median ${summary.medianMs.toFixed(1)} ms, min ${summary.minMs.toFixed(1)} ms, max ${summary.maxMs.toFixed(1)} ms, spread ${summary.spreadMs.toFixed(1)} ms. Phase avg: sample ${summary.averageContourSamplingMs.toFixed(1)} ms, toolpath ${summary.averageToolpathBuildMs.toFixed(1)} ms, gcode ${summary.averageGcodeBuildMs.toFixed(1)} ms. Last output: ${(summary.bytes / 1024).toFixed(1)} KB, ${summary.points} points, ${summary.layers} layers.`;
        });
    }

    function toggleOverlay(): void {
        const nextVisible = !$workspace.overlayVisible;
        workspace.setOverlayVisible(nextVisible);
        status.setWorkspaceStatus(nextVisible ? 'Toolpath overlay enabled.' : 'Toolpath overlay hidden.');
    }

    function resetInspectorWidth(): void {
        workspace.resetInspectorWidth();
        void resizeViewportAfterLayout();
    }

    function cleanupInspectorResize(): void {
        if (resizeCleanup) {
            resizeCleanup();
            resizeCleanup = null;
        }
        workspace.setInspectorResizing(false);
    }

    function startInspectorResize(event: PointerEvent): void {
        if ($workspace.inspectorCollapsed || window.innerWidth <= 980) {
            return;
        }

        event.preventDefault();
        cleanupInspectorResize();

        const startX = event.clientX;
        const startWidth = $workspace.inspectorWidth;
        workspace.setInspectorResizing(true);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const delta = startX - moveEvent.clientX;
            workspace.setInspectorWidth(startWidth + delta);
            studio.resizeViewport();
        };

        const handlePointerUp = () => {
            cleanupInspectorResize();
            void resizeViewportAfterLayout();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
        window.addEventListener('pointercancel', handlePointerUp, { once: true });

        resizeCleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
        };
    }

    function nudgeInspectorWidth(delta: number): void {
        if ($workspace.inspectorCollapsed) {
            return;
        }

        workspace.setInspectorWidth($workspace.inspectorWidth + delta);
        void resizeViewportAfterLayout();
    }

    function handleDockKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudgeInspectorWidth(16);
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudgeInspectorWidth(-16);
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            resetInspectorWidth();
        }
    }

    const inspectorHandlers: InspectorSchemaHandlers = {
        commitViewMode,
        commitScene,
        updateSceneControlValue,
        updateViewportField,
        resetView,
        updateRaymarchField,
        updateAnimationField,
        updateSlicerMode,
        updateSlicerNumber,
        commitPrinterModel,
        updateSlicerString,
        commitFilamentProfile,
        setBenchmarkIterations: (value) => status.setBenchmarkIterations(value),
        setBenchmarkWarmups: (value) => status.setBenchmarkWarmups(value),
        generateVaseGcode,
        benchmarkVaseGcode,
    };

    onMount(() => {
        const handleShaderStatus = (event: Event) => {
            const customEvent = event as CustomEvent<{ mode?: ShaderStatusMode; message?: string }>;
            const mode = customEvent.detail?.mode;
            const message = customEvent.detail?.message;
            if (!mode || !message) {
                return;
            }

            status.setShaderStatus(mode, message);
        };

        window.addEventListener('shader-hmr-status', handleShaderStatus);

        try {
            studio.init();
            status.setShaderStatus('ready', 'Ready');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to initialize renderer';
            status.setShaderStatus('error', message);
            status.setWorkspaceStatus('Renderer initialization failed.');
            console.error('[Startup] Renderer initialization failed.', error);
        }

        return () => {
            window.removeEventListener('shader-hmr-status', handleShaderStatus);
        };
    });

    onDestroy(() => {
        cleanupInspectorResize();
    });
</script>

<div class="app-root" class:inspector-collapsed={$workspace.inspectorCollapsed} class:is-dock-resizing={$workspace.isInspectorResizing}>
    <TopBar
        activeSceneLabel={$workspace.activeSceneLabel}
        activeViewModeLabel={$workspace.activeViewModeLabel}
        inspectorCollapsed={$workspace.inspectorCollapsed}
        shaderStatusMode={$status.shaderStatusMode}
        shaderStatusText={$status.shaderStatusText}
        onResetView={resetView}
        onToggleInspector={toggleInspector}
    />

    <div class="workspace-shell" style={`--inspector-width: ${$workspace.inspectorWidth}px;`}>
        <ViewportPanel
            activeSceneLabel={$workspace.activeSceneLabel}
            activeViewModeLabel={$workspace.activeViewModeLabel}
            {sceneOptions}
            {sceneId}
            {viewMode}
            printerLabel={slicerSettings.printerModelName}
            materialLabel={slicerSettings.filamentProfileName}
            overlayVisible={$workspace.overlayVisible}
            actionPending={$status.actionPending}
            commandStatus={$status.outputStatus}
            inspectorCollapsed={$workspace.inspectorCollapsed}
            onResetView={resetView}
            onToggleInspector={toggleInspector}
            onCommitScene={commitScene}
            onCommitViewMode={commitViewMode}
            onToggleOverlay={toggleOverlay}
            onGenerateVaseGcode={generateVaseGcode}
            onBenchmarkVaseGcode={benchmarkVaseGcode}
        />

        {#if !$workspace.inspectorCollapsed}
            <button
                class="dock-resizer"
                type="button"
                aria-label="Resize inspector"
                on:pointerdown={startInspectorResize}
                on:dblclick={resetInspectorWidth}
                on:keydown={handleDockKeydown}
            ></button>

            <InspectorPanel activeTab={$workspace.activeTab} state={inspectorState} handlers={inspectorHandlers} onSelectTab={selectTab} />
        {/if}
    </div>

    <StatusStrip
        workspaceStatus={$status.workspaceStatus}
        outputStatus={$status.outputStatus}
        actionPending={$status.actionPending}
        shaderStatusDetail={$status.shaderStatusDetail}
    />
</div>