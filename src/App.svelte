<script lang="ts">
    import { onMount, tick } from 'svelte';

    import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
    import type { VaseSlicerSettings } from './core/slicer';
    import InspectorPanel from './components/InspectorPanel.svelte';
    import StatusStrip from './components/StatusStrip.svelte';
    import TopBar from './components/TopBar.svelte';
    import ViewportPanel from './components/ViewportPanel.svelte';
    import {
        compactShaderStatusMessage,
        normalizeShaderStatusMessage,
        type ShaderStatusMode,
        type StudioController,
    } from './studio-controller';
    import type { ControlTabId, NumericSlicerKey } from './ui/inspector-config';

    export let studio: StudioController;

    const CONTROL_TAB_STORAGE_KEY = 'implicit-ui-active-tab';

    function readStoredTab(): ControlTabId {
        try {
            const stored = localStorage.getItem(CONTROL_TAB_STORAGE_KEY) as ControlTabId | null;
            if (stored) {
                return stored;
            }
        } catch {
            // Ignore storage errors.
        }

        return 'scene';
    }

    const snapshot = studio.getSnapshot();

    let activeTab: ControlTabId = readStoredTab();
    let inspectorCollapsed = false;
    let actionPending = false;

    let sceneOptions = snapshot.sceneOptions;
    let printerModels = snapshot.printerModels;
    let filamentProfiles = snapshot.filamentProfiles;
    let sceneId = snapshot.sceneId;
    let viewMode = snapshot.viewMode;
    let raymarchParams = snapshot.raymarchParams;
    let viewportParams = snapshot.viewportParams;
    let animationParams = snapshot.animationParams;
    let slicerSettings = snapshot.slicerSettings;

    let benchmarkIterations = 3;
    let benchmarkWarmups = 1;
    let outputStatus = 'Ready.';
    let workspaceStatus = 'Ready. Viewport and inspector are active.';

    let shaderStatusMode: ShaderStatusMode = 'ready';
    let shaderStatusText = 'Shader: Ready';
    let shaderStatusDetail = 'No shader diagnostics.';

    $: activeSceneLabel = studio.getSceneLabel(sceneId);
    $: activeViewModeLabel = studio.getViewModeLabel(viewMode);
    $: persistActiveTab(activeTab);

    function persistActiveTab(tabId: ControlTabId): void {
        try {
            localStorage.setItem(CONTROL_TAB_STORAGE_KEY, tabId);
        } catch {
            // Ignore storage errors.
        }
    }

    function setShaderStatus(mode: ShaderStatusMode, message: string): void {
        const normalized = normalizeShaderStatusMessage(message);
        shaderStatusMode = mode;
        shaderStatusText = `Shader: ${compactShaderStatusMessage(normalized)}`;
        if (mode === 'error') {
            shaderStatusDetail = normalized;
            return;
        }

        if (mode === 'compiling') {
            shaderStatusDetail = 'Compiling active scene shaders...';
            return;
        }

        shaderStatusDetail = 'No shader diagnostics.';
    }

    function selectTab(tabId: ControlTabId): void {
        activeTab = tabId;
        inspectorCollapsed = false;
        studio.resizeViewport();
    }

    function toggleInspector(): void {
        inspectorCollapsed = !inspectorCollapsed;
        studio.resizeViewport();
    }

    function commitViewMode(nextViewMode: number): void {
        viewMode = nextViewMode;
        workspaceStatus = studio.setViewMode(nextViewMode);
    }

    function commitScene(nextSceneId: string): void {
        setShaderStatus('compiling', 'Compiling...');
        const result = studio.changeScene(nextSceneId);
        sceneId = result.sceneId;
        slicerSettings = result.settings;
        workspaceStatus = result.workspaceStatus;
        setShaderStatus(result.ok ? 'ok' : 'error', result.shaderMessage);
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
        workspaceStatus = studio.resetView();
    }

    function commitPrinterModel(printerModelId: string): void {
        const result = studio.changePrinterModel(printerModelId);
        slicerSettings = result.settings;
        workspaceStatus = result.workspaceStatus;
    }

    function commitFilamentProfile(filamentProfileId: string): void {
        const result = studio.changeFilamentProfile(filamentProfileId);
        slicerSettings = result.settings;
        workspaceStatus = result.workspaceStatus;
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

    async function runSlicerAction(pendingLabel: string, action: () => string): Promise<void> {
        actionPending = true;
        outputStatus = pendingLabel;
        workspaceStatus = pendingLabel;
        await tick();
        try {
            const message = action();
            outputStatus = message;
            workspaceStatus = message;
        } catch (error) {
            const message = error instanceof Error ? `Slicer error: ${error.message}` : 'Slicer error: Unknown slicer error';
            outputStatus = message;
            workspaceStatus = message;
        } finally {
            actionPending = false;
        }
    }

    async function generateVaseGcode(): Promise<void> {
        await runSlicerAction('Generating G-code...', () => {
            const result = studio.generateVaseGcode();
            return `Exported ${result.filename} (${(result.bytes / 1024).toFixed(1)} KB, ${result.points} points).`;
        });
    }

    async function benchmarkVaseGcode(): Promise<void> {
        const iterations = Math.max(1, benchmarkIterations || 1);
        const warmups = Math.max(0, benchmarkWarmups || 0);
        const measuredLabel = `${iterations} measured run${iterations === 1 ? '' : 's'}`;
        const warmupLabel = `${warmups} warmup run${warmups === 1 ? '' : 's'}`;
        await runSlicerAction(`Benchmarking ${measuredLabel} after ${warmupLabel}...`, () => {
            const summary = studio.benchmarkVaseGcode(iterations, warmups);
            return `Benchmark settled on ${summary.measuredRuns} measured run${summary.measuredRuns === 1 ? '' : 's'} after ${summary.warmupRuns} warmup run${summary.warmupRuns === 1 ? '' : 's'}: avg ${summary.averageMs.toFixed(1)} ms, median ${summary.medianMs.toFixed(1)} ms, min ${summary.minMs.toFixed(1)} ms, max ${summary.maxMs.toFixed(1)} ms, spread ${summary.spreadMs.toFixed(1)} ms. Phase avg: sample ${summary.averageContourSamplingMs.toFixed(1)} ms, toolpath ${summary.averageToolpathBuildMs.toFixed(1)} ms, gcode ${summary.averageGcodeBuildMs.toFixed(1)} ms. Last output: ${(summary.bytes / 1024).toFixed(1)} KB, ${summary.points} points, ${summary.layers} layers.`;
        });
    }

    onMount(() => {
        const handleShaderStatus = (event: Event) => {
            const customEvent = event as CustomEvent<{ mode?: ShaderStatusMode; message?: string }>;
            const mode = customEvent.detail?.mode;
            const message = customEvent.detail?.message;
            if (!mode || !message) {
                return;
            }

            setShaderStatus(mode, message);
        };

        window.addEventListener('shader-hmr-status', handleShaderStatus);

        try {
            studio.init();
            setShaderStatus('ready', 'Ready');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to initialize renderer';
            setShaderStatus('error', message);
            workspaceStatus = 'Renderer initialization failed.';
            console.error('[Startup] Renderer initialization failed.', error);
        }

        return () => {
            window.removeEventListener('shader-hmr-status', handleShaderStatus);
        };
    });
</script>

<div class="app-root" class:inspector-collapsed={inspectorCollapsed}>
    <TopBar
        activeSceneLabel={activeSceneLabel}
        activeViewModeLabel={activeViewModeLabel}
        inspectorCollapsed={inspectorCollapsed}
        shaderStatusMode={shaderStatusMode}
        shaderStatusText={shaderStatusText}
        onResetView={resetView}
        onToggleInspector={toggleInspector}
    />

    <div class="workspace-shell">
        <ViewportPanel
            inspectorCollapsed={inspectorCollapsed}
            onResetView={resetView}
            onToggleInspector={toggleInspector}
        />

        <InspectorPanel
            activeTab={activeTab}
            sceneOptions={sceneOptions}
            printerModels={printerModels}
            filamentProfiles={filamentProfiles}
            sceneId={sceneId}
            viewMode={viewMode}
            raymarchParams={raymarchParams}
            viewportParams={viewportParams}
            animationParams={animationParams}
            slicerSettings={slicerSettings}
            benchmarkIterations={benchmarkIterations}
            benchmarkWarmups={benchmarkWarmups}
            actionPending={actionPending}
            outputStatus={outputStatus}
            onSelectTab={selectTab}
            onCommitViewMode={commitViewMode}
            onCommitScene={commitScene}
            onUpdateViewportField={updateViewportField}
            onResetView={resetView}
            onUpdateRaymarchField={updateRaymarchField}
            onUpdateAnimationField={updateAnimationField}
            onUpdateSlicerMode={updateSlicerMode}
            onUpdateSlicerNumber={updateSlicerNumber}
            onCommitPrinterModel={commitPrinterModel}
            onUpdateSlicerString={updateSlicerString}
            onCommitFilamentProfile={commitFilamentProfile}
            onSetBenchmarkIterations={(value) => benchmarkIterations = value}
            onSetBenchmarkWarmups={(value) => benchmarkWarmups = value}
            onGenerateVaseGcode={generateVaseGcode}
            onBenchmarkVaseGcode={benchmarkVaseGcode}
        />
    </div>

    <StatusStrip workspaceStatus={workspaceStatus} shaderStatusDetail={shaderStatusDetail} />
</div>