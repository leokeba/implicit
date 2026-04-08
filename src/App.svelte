<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';

    import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
    import type { SceneDocument } from './core/shader-pipeline';
    import type { VaseSlicerSettings } from './core/slicer';
    import InspectorPanel from './components/InspectorPanel.svelte';
    import SceneEditorPanel from './components/SceneEditorPanel.svelte';
    import StatusStrip from './components/StatusStrip.svelte';
    import TopBar from './components/TopBar.svelte';
    import ViewportPanel from './components/ViewportPanel.svelte';
    import { type SceneRegistrySyncResult, type ShaderStatusMode, type StudioController } from './studio-controller';
    import {
        type ControlTabId,
        type InspectorSchemaHandlers,
        type InspectorSchemaState,
        type NumericSlicerKey,
    } from './ui/inspector-schema';
    import {
        createSceneDocument,
        hasDirtySceneDocuments,
        loadSceneRepository,
        reloadFilesystemSceneDocuments,
        saveSceneDocuments,
        type SceneDocumentStorageMode,
    } from './ui/scene-documents';
    import { createStatusModel } from './ui/status-model';
    import { createWorkspaceStore } from './ui/workspace-store';

    export let studio: StudioController;

    const EDITOR_SIDE_LAYOUT_MIN_WIDTH = 1440;

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
    const bundledSceneDocuments = studio.getSceneDocuments();
    let sceneDocuments = bundledSceneDocuments;
    let persistedSceneDocuments = bundledSceneDocuments;
    let sceneEditorMode: SceneDocumentStorageMode = 'browser';
    let sceneEditorStatus = 'Scene editor ready.';
    let sceneEditorSavePending = false;
    let activeSceneDocument: SceneDocument | null = sceneDocuments[0] ?? null;
    let persistedActiveSceneDocument: SceneDocument | null = persistedSceneDocuments[0] ?? null;
    let sceneEditorDirty = false;
    let sceneEditorModeLabel = 'Browser Drafts';

    const workspace = createWorkspaceStore({
        activeSceneLabel: studio.getSceneLabel(sceneId),
        activeViewModeLabel: studio.getViewModeLabel(viewMode),
    });
    const status = createStatusModel();

    let resizeCleanup: (() => void) | null = null;
    let editorResizeCleanup: (() => void) | null = null;
    let sceneRepositoryPollHandle: number | null = null;
    let editorDockSide = false;

    $: workspace.setActiveLabels(studio.getSceneLabel(sceneId), studio.getViewModeLabel(viewMode));
    $: studio.setToolpathOverlayVisible($workspace.overlayVisible);
    $: activeSceneDocument = sceneDocuments.find((document) => document.id === sceneId) ?? null;
    $: persistedActiveSceneDocument = persistedSceneDocuments.find((document) => document.id === sceneId) ?? null;
    $: sceneEditorDirty = Boolean(
        activeSceneDocument &&
            (!persistedActiveSceneDocument || activeSceneDocument.source !== persistedActiveSceneDocument.source)
    );
    $: sceneEditorModeLabel = sceneEditorMode === 'filesystem' ? 'Folder Sync' : 'Browser Drafts';
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

    function syncEditorDockSide(): void {
        if (typeof window === 'undefined') {
            editorDockSide = false;
            return;
        }

        editorDockSide = window.innerWidth >= EDITOR_SIDE_LAYOUT_MIN_WIDTH;
    }

    async function selectTab(tabId: ControlTabId): Promise<void> {
        workspace.selectTab(tabId);
        await resizeViewportAfterLayout();
    }

    async function toggleInspector(): Promise<void> {
        workspace.toggleInspector();
        await resizeViewportAfterLayout();
    }

    async function toggleEditor(): Promise<void> {
        workspace.toggleEditor();
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

    function applySceneRegistryResult(result: SceneRegistrySyncResult): void {
        sceneOptions = result.sceneOptions;
        sceneId = result.sceneId;
        slicerSettings = result.settings;
        sceneControlDefinitions = result.sceneControlDefinitions;
        sceneControlValues = result.sceneControlValues;
        status.setShaderStatus(result.ok ? 'ok' : 'error', result.shaderMessage);
    }

    function updateSceneDocumentSource(value: string): void {
        if (!activeSceneDocument) {
            return;
        }

        sceneDocuments = sceneDocuments.map((document) =>
            document.id === activeSceneDocument.id
                ? { ...document, source: value }
                : document
        );

        const result = studio.updateSceneDocumentSource(activeSceneDocument.id, value);
        applySceneRegistryResult(result);
        sceneEditorStatus = result.ok ? 'Live preview updated.' : 'Shader compile failed. Fix the scene and save again.';
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

    function mergePersistedSceneDocument(nextDocument: SceneDocument): void {
        const nextPersisted = persistedSceneDocuments.some((document) => document.id === nextDocument.id)
            ? persistedSceneDocuments.map((document) => (document.id === nextDocument.id ? nextDocument : document))
            : [...persistedSceneDocuments, nextDocument];
        persistedSceneDocuments = nextPersisted.sort((left, right) => left.name.localeCompare(right.name));
    }

    async function saveActiveSceneDocument(): Promise<void> {
        if (!activeSceneDocument || !sceneEditorDirty || sceneEditorSavePending) {
            return;
        }

        sceneEditorSavePending = true;
        sceneEditorStatus = sceneEditorMode === 'filesystem' ? 'Saving scene to folder...' : 'Saving scene to browser storage...';

        try {
            const nextDocuments = await saveSceneDocuments(
                sceneEditorMode,
                activeSceneDocument,
                bundledSceneDocuments,
                sceneDocuments
            );

            sceneDocuments = nextDocuments;
            if (sceneEditorMode === 'filesystem') {
                const savedDocument = nextDocuments.find((document) => document.id === activeSceneDocument.id);
                if (savedDocument) {
                    mergePersistedSceneDocument(savedDocument);
                }
            } else {
                persistedSceneDocuments = nextDocuments;
            }

            applySceneRegistryResult(studio.syncSceneDocuments(sceneDocuments));
            sceneEditorStatus = sceneEditorMode === 'filesystem'
                ? `Saved ${activeSceneDocument.fileName} to src/shaders/scenes.`
                : `Saved ${activeSceneDocument.name} to browser storage.`;
            status.setWorkspaceStatus(sceneEditorStatus);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Scene save failed.';
            sceneEditorStatus = message;
            status.setWorkspaceStatus(message);
        } finally {
            sceneEditorSavePending = false;
        }
    }

    function revertActiveSceneDocument(): void {
        if (!activeSceneDocument) {
            return;
        }

        const persisted = persistedSceneDocuments.find((document) => document.id === activeSceneDocument.id);
        if (!persisted) {
            return;
        }

        sceneDocuments = sceneDocuments.map((document) =>
            document.id === activeSceneDocument.id
                ? { ...document, source: persisted.source }
                : document
        );

        const result = studio.updateSceneDocumentSource(activeSceneDocument.id, persisted.source);
        applySceneRegistryResult(result);
        sceneEditorStatus = `Reverted ${persisted.fileName} to the last saved version.`;
        status.setWorkspaceStatus(sceneEditorStatus);
    }

    async function createAndActivateScene(): Promise<void> {
        if (typeof window === 'undefined') {
            return;
        }

        const requestedName = window.prompt('Scene name', activeSceneDocument ? `${activeSceneDocument.name} Variant` : 'New Scene');
        if (requestedName === null) {
            return;
        }

        const nextDocument = createSceneDocument(
            sceneDocuments,
            activeSceneDocument?.source ?? buildSceneTemplate(requestedName),
            requestedName
        );

        sceneDocuments = [...sceneDocuments, nextDocument].sort((left, right) => left.name.localeCompare(right.name));
        applySceneRegistryResult(studio.syncSceneDocuments(sceneDocuments));
        workspace.setEditorVisible(true);
        commitScene(nextDocument.id);
        sceneEditorStatus = `Created ${nextDocument.fileName}. Save it to persist the new scene.`;
        status.setWorkspaceStatus(sceneEditorStatus);
        await resizeViewportAfterLayout();

        await saveActiveSceneDocument();
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

    function cleanupEditorResize(): void {
        if (editorResizeCleanup) {
            editorResizeCleanup();
            editorResizeCleanup = null;
        }
        workspace.setEditorResizing(false);
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

    function startEditorResize(event: PointerEvent): void {
        event.preventDefault();
        cleanupEditorResize();
        workspace.setEditorResizing(true);

        let handlePointerMove: ((moveEvent: PointerEvent) => void) | null = null;

        if (editorDockSide) {
            const startX = event.clientX;
            const startWidth = $workspace.editorWidth;
            handlePointerMove = (moveEvent: PointerEvent) => {
                const delta = moveEvent.clientX - startX;
                workspace.setEditorWidth(startWidth + delta);
                studio.resizeViewport();
            };
        } else {
            const startY = event.clientY;
            const startHeight = $workspace.editorHeight;
            handlePointerMove = (moveEvent: PointerEvent) => {
                const delta = startY - moveEvent.clientY;
                workspace.setEditorHeight(startHeight + delta);
                studio.resizeViewport();
            };
        }

        const handlePointerUp = () => {
            cleanupEditorResize();
            void resizeViewportAfterLayout();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
        window.addEventListener('pointercancel', handlePointerUp, { once: true });

        editorResizeCleanup = () => {
            if (handlePointerMove) {
                window.removeEventListener('pointermove', handlePointerMove);
            }
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
        syncEditorDockSide();

        const handleShaderStatus = (event: Event) => {
            const customEvent = event as CustomEvent<{ mode?: ShaderStatusMode; message?: string }>;
            const mode = customEvent.detail?.mode;
            const message = customEvent.detail?.message;
            if (!mode || !message) {
                return;
            }

            status.setShaderStatus(mode, message);
        };

        const handleWindowResize = () => {
            const previousDockSide = editorDockSide;
            syncEditorDockSide();
            if (previousDockSide !== editorDockSide) {
                void resizeViewportAfterLayout();
            }
        };

        window.addEventListener('shader-hmr-status', handleShaderStatus);
        window.addEventListener('resize', handleWindowResize);

        let disposed = false;

        const refreshFilesystemScenes = async (silent: boolean = false): Promise<void> => {
            if (sceneEditorMode !== 'filesystem' || hasDirtySceneDocuments(sceneDocuments, persistedSceneDocuments)) {
                return;
            }

            const nextDocuments = await reloadFilesystemSceneDocuments();
            if (!nextDocuments || areSceneCollectionsEqual(nextDocuments, persistedSceneDocuments)) {
                return;
            }

            persistedSceneDocuments = nextDocuments;
            sceneDocuments = nextDocuments;
            applySceneRegistryResult(studio.syncSceneDocuments(nextDocuments));
            if (!silent) {
                sceneEditorStatus = 'Scene folder updated from disk.';
                status.setWorkspaceStatus(sceneEditorStatus);
            }
        };

        void (async () => {
            try {
                const repository = await loadSceneRepository(bundledSceneDocuments);
                if (disposed) {
                    return;
                }

                sceneEditorMode = repository.mode;
                persistedSceneDocuments = repository.documents;
                sceneDocuments = repository.documents;
                applySceneRegistryResult(studio.syncSceneDocuments(repository.documents));

                studio.init();
                status.setShaderStatus('ready', 'Ready');
                sceneEditorStatus = repository.mode === 'filesystem'
                    ? 'Editing scene files directly from src/shaders/scenes.'
                    : 'Editing bundled defaults with browser-backed drafts.';
                status.setWorkspaceStatus(sceneEditorStatus);

                if (repository.mode === 'filesystem') {
                    sceneRepositoryPollHandle = window.setInterval(() => {
                        void refreshFilesystemScenes(true);
                    }, 1200);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to initialize renderer';
                status.setShaderStatus('error', message);
                status.setWorkspaceStatus('Renderer initialization failed.');
                console.error('[Startup] Renderer initialization failed.', error);
            }
        })();

        return () => {
            disposed = true;
            window.removeEventListener('shader-hmr-status', handleShaderStatus);
            window.removeEventListener('resize', handleWindowResize);
            if (sceneRepositoryPollHandle !== null) {
                window.clearInterval(sceneRepositoryPollHandle);
                sceneRepositoryPollHandle = null;
            }
        };
    });

    onDestroy(() => {
        cleanupInspectorResize();
        cleanupEditorResize();
    });

    function buildSceneTemplate(sceneName: string): string {
        const label = sceneName.trim() || 'New Scene';
        return `// ${label}\n// @control {"key":"radius","label":"Radius","uniform":"uSceneRadius","min":0.2,"max":2.0,"step":0.01,"default":0.8,"section":"Scene Parameters"}\n\nuniform float uSceneRadius;\n\nfloat sceneSdf(vec3 p) {\n    return length(p) - uSceneRadius;\n}\n`;
    }

    function areSceneCollectionsEqual(left: SceneDocument[], right: SceneDocument[]): boolean {
        if (left.length !== right.length) {
            return false;
        }

        return left.every((document, index) => {
            const candidate = right[index];
            return Boolean(
                candidate &&
                    candidate.id === document.id &&
                    candidate.fileName === document.fileName &&
                    candidate.source === document.source
            );
        });
    }
</script>

<div class="app-root" class:inspector-collapsed={$workspace.inspectorCollapsed} class:is-dock-resizing={$workspace.isInspectorResizing} class:is-editor-resizing={$workspace.isEditorResizing} class:editor-visible={$workspace.editorVisible}>
    <TopBar
        {sceneOptions}
        {sceneId}
        {viewMode}
        {printerModels}
        {filamentProfiles}
        printerModelId={slicerSettings.printerModelId}
        filamentProfileId={slicerSettings.filamentProfileId}
        shaderStatusMode={$status.shaderStatusMode}
        shaderStatusText={$status.shaderStatusText}
        onCommitScene={commitScene}
        onCommitViewMode={commitViewMode}
        onCommitPrinterModel={commitPrinterModel}
        onCommitFilamentProfile={commitFilamentProfile}
    />

    <div class="workspace-stack" class:editor-docked-left={$workspace.editorVisible && editorDockSide} style={`--editor-height: ${$workspace.editorHeight}px; --editor-width: ${$workspace.editorWidth}px; --inspector-width: ${$workspace.inspectorWidth}px;`}>
        <div class="workspace-shell" class:editor-docked-left={$workspace.editorVisible && editorDockSide}>
            {#if $workspace.editorVisible && editorDockSide}
                <div class="workspace-editor-slot workspace-editor-slot-side">
                    <SceneEditorPanel
                        sceneDocument={activeSceneDocument}
                        storageMode={sceneEditorMode}
                        dirty={sceneEditorDirty}
                        savePending={sceneEditorSavePending}
                        statusText={sceneEditorStatus}
                        onChangeSource={updateSceneDocumentSource}
                        onCreateScene={createAndActivateScene}
                        onSaveScene={saveActiveSceneDocument}
                        onRevertScene={revertActiveSceneDocument}
                        onClose={toggleEditor}
                        onStartResize={startEditorResize}
                    />
                </div>

                <button
                    class="editor-dock-resizer"
                    type="button"
                    aria-label="Resize scene editor"
                    on:pointerdown={startEditorResize}
                    on:dblclick={() => { workspace.resetEditorWidth(); void resizeViewportAfterLayout(); }}
                ></button>
            {/if}

            <ViewportPanel
                actionPending={$status.actionPending}
                inspectorCollapsed={$workspace.inspectorCollapsed}
                editorVisible={$workspace.editorVisible}
                editorModeLabel={sceneEditorModeLabel}
                editorDirty={sceneEditorDirty}
                onResetView={resetView}
                onToggleInspector={toggleInspector}
                onToggleEditor={toggleEditor}
                onGenerateVaseGcode={generateVaseGcode}
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

        {#if $workspace.editorVisible && !editorDockSide}
            <SceneEditorPanel
                sceneDocument={activeSceneDocument}
                storageMode={sceneEditorMode}
                dirty={sceneEditorDirty}
                savePending={sceneEditorSavePending}
                statusText={sceneEditorStatus}
                onChangeSource={updateSceneDocumentSource}
                onCreateScene={createAndActivateScene}
                onSaveScene={saveActiveSceneDocument}
                onRevertScene={revertActiveSceneDocument}
                onClose={toggleEditor}
                onStartResize={startEditorResize}
            />
        {/if}
    </div>

    <StatusStrip
        workspaceStatus={$status.workspaceStatus}
        outputStatus={$status.outputStatus}
        actionPending={$status.actionPending}
        shaderStatusDetail={$status.shaderStatusDetail}
    />
</div>