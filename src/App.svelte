<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';

    import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
    import type { SceneDocument } from './core/shader-pipeline';
    import type { VaseSlicerSettings } from './core/slicer';
    import {
        buildPostprocessParameterValues,
        clampPostprocessControlValue,
        parsePostprocessControlDefinitions,
        type PostprocessControlDefinition,
        type ToolpathPostprocessConfig,
    } from './core/toolpath-postprocess';
    import DocumentEditorPanel from './components/DocumentEditorPanel.svelte';
    import InspectorPanel from './components/InspectorPanel.svelte';
    import StatusStrip from './components/StatusStrip.svelte';
    import TopBar from './components/TopBar.svelte';
    import ViewportPanel from './components/ViewportPanel.svelte';
    import { type SceneRegistrySyncResult, type SlicerSettingsUpdateResult, type StudioController } from './studio-controller';
    import {
        type BooleanSlicerKey,
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
    import {
        createPostprocessDocument,
        getBundledPostprocessDocuments,
        hasDirtyPostprocessDocuments,
        loadPostprocessRepository,
        reloadFilesystemPostprocessDocuments,
        savePostprocessDocument,
        type PostprocessScriptDocument,
        type PostprocessScriptStorageMode,
    } from './ui/postprocess-documents';
    import {
        arePostprocessCollectionsEqual,
        areSceneCollectionsEqual,
        buildSceneTemplate,
        formatEta,
    } from './app/helpers';
    import { createStatusModel } from './ui/status-model';
    import { createWorkspaceStore } from './ui/workspace-store';
    import { checkMoonrakerAvailability, downloadTextFile, uploadGcodeToMoonraker } from './studio/file-export';

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
    const bundledPostprocessDocuments = getBundledPostprocessDocuments();
    let sceneDocuments = bundledSceneDocuments;
    let persistedSceneDocuments = bundledSceneDocuments;
    let sceneEditorMode: SceneDocumentStorageMode = 'browser';
    let sceneEditorStatus = 'Scene editor ready.';
    let sceneEditorSavePending = false;
    let activeSceneDocument: SceneDocument | null = sceneDocuments[0] ?? null;
    let persistedActiveSceneDocument: SceneDocument | null = persistedSceneDocuments[0] ?? null;
    let sceneEditorDirty = false;
    let sceneEditorModeLabel = 'Browser Drafts';
    let postprocessDocuments = bundledPostprocessDocuments;
    let persistedPostprocessDocuments = bundledPostprocessDocuments;
    let postprocessMode: PostprocessScriptStorageMode = 'browser';
    let postprocessStatus = 'Postprocess scripts ready.';
    let postprocessSavePending = false;
    let activePostprocessScriptId = bundledPostprocessDocuments[0]?.id ?? '';
    let postprocessEnabled = false;
    let activePostprocessDocument: PostprocessScriptDocument | null = postprocessDocuments[0] ?? null;
    let persistedActivePostprocessDocument: PostprocessScriptDocument | null = persistedPostprocessDocuments[0] ?? null;
    let postprocessDirty = false;
    let postprocessModeLabel = 'Browser Drafts';
    let activePostprocessConfig: ToolpathPostprocessConfig | null = null;
    let postprocessControlDefinitions: PostprocessControlDefinition[] = [];
    let postprocessControlValueState: Record<string, Record<string, number>> = {};
    let postprocessControlValues: Record<string, number> = {};
    let editorDocumentMode: 'scene' | 'postprocess' = 'scene';

    const workspace = createWorkspaceStore({
        activeSceneLabel: studio.getSceneLabel(sceneId),
        activeViewModeLabel: studio.getViewModeLabel(viewMode),
    });
    const status = createStatusModel();
    const APP_RUNTIME_STORAGE_KEY = 'implicit.runtimeState.v1';
    const PRINTER_TARGET_STORAGE_KEY = 'implicit.printerTarget.v1';

    interface PrinterTarget {
        baseUrl: string;
        apiKey: string;
        autoStartPrint: boolean;
        uploadPath: string;
    }

    interface GeneratedGcodeArtifact {
        filename: string;
        gcode: string;
        bytes: number;
        points: number;
        sliceSignature: string;
        postprocessSignature: string;
    }

    interface AppRuntimeSnapshot {
        sceneId?: string;
        viewMode?: number;
        raymarchParams?: Partial<RaymarchParams>;
        viewportParams?: Partial<ViewportParams>;
        animationParams?: Partial<AnimationParams>;
        slicerSettings?: Partial<VaseSlicerSettings>;
        sceneControlValues?: Record<string, number>;
        activePostprocessScriptId?: string;
        postprocessEnabled?: boolean;
        postprocessAutoUpdate?: boolean;
        postprocessControlValueState?: Record<string, Record<string, number>>;
        editorDocumentMode?: 'scene' | 'postprocess';
    }

    let resizeCleanup: (() => void) | null = null;
    let editorResizeCleanup: (() => void) | null = null;
    let sceneRepositoryPollHandle: number | null = null;
    let postprocessRepositoryPollHandle: number | null = null;
    let printerAvailabilityPollHandle: number | null = null;
    let editorDockSide = false;
    let sliceDebugSnapshot = studio.getLastSliceDebugSnapshot();
    let runtimeSnapshotHydrated = false;
    let printerTarget: PrinterTarget = {
        baseUrl: '',
        apiKey: '',
        uploadPath: '',
        autoStartPrint: true,
    };
    let generatedGcodeArtifact: GeneratedGcodeArtifact | null = null;
    let printerAvailable = false;
    let printerConfigured = false;
    let currentSliceSignature = '';
    let currentPostprocessSignature = '';
    let hasGeneratedArtifactForCurrentSlice = false;
    let hasGeneratedArtifactForCurrentState = false;
    let generateActionLabel = 'Generate';
    let showDownloadButton = false;
    let postprocessAutoUpdate = false;
    let postprocessAutoUpdateTimer: number | null = null;
    let postprocessAutoUpdatePending = false;
    let viewerFullscreen = false;

    function buildSliceSignature(): string {
        return JSON.stringify({
            sceneId,
            sceneSource: activeSceneDocument?.source ?? '',
            sceneControlValues,
            slicerSettings,
        });
    }

    function buildPostprocessSignature(config: ToolpathPostprocessConfig | null): string {
        return JSON.stringify(config ?? null);
    }

    function readPrinterTarget(): PrinterTarget {
        if (typeof window === 'undefined') {
            return { baseUrl: '', apiKey: '', uploadPath: '', autoStartPrint: true };
        }

        try {
            const raw = window.localStorage.getItem(PRINTER_TARGET_STORAGE_KEY);
            if (!raw) {
                return { baseUrl: '', apiKey: '', uploadPath: '', autoStartPrint: true };
            }

            const parsed = JSON.parse(raw) as Partial<PrinterTarget>;
            if (!parsed || typeof parsed !== 'object') {
                return { baseUrl: '', apiKey: '', uploadPath: '', autoStartPrint: true };
            }

            return {
                baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '',
                apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
                autoStartPrint: typeof parsed.autoStartPrint === 'boolean' ? parsed.autoStartPrint : true,
                uploadPath: typeof parsed.uploadPath === 'string' ? parsed.uploadPath.trim() : '',
            };
        } catch {
            return { baseUrl: '', apiKey: '', uploadPath: '', autoStartPrint: true };
        }
    }

    function persistPrinterTarget(target: PrinterTarget): void {
        if (typeof window === 'undefined') {
            return;
        }

        try {
            window.localStorage.setItem(PRINTER_TARGET_STORAGE_KEY, JSON.stringify(target));
        } catch {
            // Ignore storage write failures.
        }
    }

    function persistCurrentPrinterTarget(): void {
        persistPrinterTarget(printerTarget);
    }

    async function refreshPrinterAvailability(): Promise<void> {
        const configuredBaseUrl = printerTarget.baseUrl.trim();
        if (!configuredBaseUrl) {
            printerAvailable = false;
            return;
        }

        printerAvailable = await checkMoonrakerAvailability(configuredBaseUrl, printerTarget.apiKey);
    }

    async function applyPrinterModelConnectionDefaults(printerModelId: string): Promise<void> {
        const model = printerModels.find((candidate) => candidate.id === printerModelId);
        if (!model) {
            return;
        }

        const hasConnectionDefaults =
            typeof model.defaultMoonrakerUrl === 'string' ||
            typeof model.defaultMoonrakerApiKey === 'string' ||
            typeof model.defaultMoonrakerUploadPath === 'string' ||
            typeof model.defaultMoonrakerAutoStartPrint === 'boolean';

        if (!hasConnectionDefaults) {
            return;
        }

        printerTarget = {
            baseUrl: model.defaultMoonrakerUrl ?? printerTarget.baseUrl,
            apiKey: model.defaultMoonrakerApiKey ?? printerTarget.apiKey,
            uploadPath: model.defaultMoonrakerUploadPath ?? printerTarget.uploadPath,
            autoStartPrint: typeof model.defaultMoonrakerAutoStartPrint === 'boolean'
                ? model.defaultMoonrakerAutoStartPrint
                : printerTarget.autoStartPrint,
        };

        persistCurrentPrinterTarget();
        await refreshPrinterAvailability();
    }

    function readRuntimeSnapshot(): AppRuntimeSnapshot | null {
        if (typeof window === 'undefined') {
            return null;
        }

        try {
            const raw = window.sessionStorage.getItem(APP_RUNTIME_STORAGE_KEY);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw) as AppRuntimeSnapshot;
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    function persistRuntimeSnapshot(snapshot: AppRuntimeSnapshot): void {
        if (typeof window === 'undefined') {
            return;
        }

        try {
            window.sessionStorage.setItem(APP_RUNTIME_STORAGE_KEY, JSON.stringify(snapshot));
        } catch {
            // Ignore storage write failures.
        }
    }

    function captureRuntimeSnapshot(): AppRuntimeSnapshot {
        return {
            sceneId,
            viewMode,
            raymarchParams,
            viewportParams,
            animationParams,
            slicerSettings,
            sceneControlValues,
            activePostprocessScriptId,
            postprocessEnabled,
            postprocessAutoUpdate,
            postprocessControlValueState,
            editorDocumentMode,
        };
    }

    function restoreRuntimeSnapshot(snapshot: AppRuntimeSnapshot): void {
        if (typeof snapshot.sceneId === 'string' && sceneOptions.some((option) => option.id === snapshot.sceneId)) {
            commitScene(snapshot.sceneId);
        }

        if (typeof snapshot.viewMode === 'number') {
            viewMode = snapshot.viewMode;
            studio.setViewMode(snapshot.viewMode);
        }

        if (snapshot.raymarchParams && typeof snapshot.raymarchParams === 'object') {
            raymarchParams = { ...raymarchParams, ...snapshot.raymarchParams };
            studio.updateRaymarchParams(snapshot.raymarchParams);
        }

        if (snapshot.viewportParams && typeof snapshot.viewportParams === 'object') {
            viewportParams = { ...viewportParams, ...snapshot.viewportParams };
            studio.updateViewportParams(snapshot.viewportParams);
        }

        if (snapshot.animationParams && typeof snapshot.animationParams === 'object') {
            animationParams = { ...animationParams, ...snapshot.animationParams };
            studio.updateAnimationParams(snapshot.animationParams);
        }

        if (snapshot.slicerSettings && typeof snapshot.slicerSettings === 'object') {
            const result = studio.updateSlicerParams(snapshot.slicerSettings);
            slicerSettings = result.settings;
        }

        if (snapshot.sceneControlValues && typeof snapshot.sceneControlValues === 'object') {
            for (const definition of sceneControlDefinitions) {
                const value = snapshot.sceneControlValues[definition.key];
                if (typeof value !== 'number' || Number.isNaN(value)) {
                    continue;
                }

                updateSceneControlValue(definition.key, value);
            }
        }

        if (typeof snapshot.activePostprocessScriptId === 'string'
            && postprocessDocuments.some((document) => document.id === snapshot.activePostprocessScriptId)) {
            activePostprocessScriptId = snapshot.activePostprocessScriptId;
        }

        if (typeof snapshot.postprocessEnabled === 'boolean') {
            postprocessEnabled = snapshot.postprocessEnabled;
        }

        if (typeof snapshot.postprocessAutoUpdate === 'boolean') {
            postprocessAutoUpdate = snapshot.postprocessAutoUpdate;
        }

        if (snapshot.postprocessControlValueState && typeof snapshot.postprocessControlValueState === 'object') {
            postprocessControlValueState = snapshot.postprocessControlValueState;
        }

        if (snapshot.editorDocumentMode === 'scene' || snapshot.editorDocumentMode === 'postprocess') {
            editorDocumentMode = snapshot.editorDocumentMode;
        }
    }

    $: workspace.setActiveLabels(studio.getSceneLabel(sceneId), studio.getViewModeLabel(viewMode));
    $: studio.setToolpathOverlayVisible($workspace.overlayVisible);
    $: activeSceneDocument = sceneDocuments.find((document) => document.id === sceneId) ?? null;
    $: persistedActiveSceneDocument = persistedSceneDocuments.find((document) => document.id === sceneId) ?? null;
    $: sceneEditorDirty = Boolean(
        activeSceneDocument &&
            (!persistedActiveSceneDocument || activeSceneDocument.source !== persistedActiveSceneDocument.source)
    );
    $: sceneEditorModeLabel = sceneEditorMode === 'filesystem' ? 'Folder Sync' : 'Browser Drafts';
    $: if (!postprocessDocuments.some((document) => document.id === activePostprocessScriptId)) {
        activePostprocessScriptId = postprocessDocuments[0]?.id ?? '';
    }
    $: activePostprocessDocument = postprocessDocuments.find((document) => document.id === activePostprocessScriptId) ?? null;
    $: persistedActivePostprocessDocument = persistedPostprocessDocuments.find((document) => document.id === activePostprocessScriptId) ?? null;
    $: postprocessDirty = Boolean(
        activePostprocessDocument &&
            (!persistedActivePostprocessDocument || activePostprocessDocument.source !== persistedActivePostprocessDocument.source)
    );
    $: postprocessModeLabel = postprocessMode === 'filesystem' ? 'Folder Sync' : 'Browser Drafts';
    $: postprocessControlDefinitions = parsePostprocessControlDefinitions(activePostprocessDocument?.source ?? '');
    $: postprocessControlValues = activePostprocessDocument
        ? buildPostprocessParameterValues(postprocessControlDefinitions, postprocessControlValueState[activePostprocessDocument.id])
        : {};
    $: activePostprocessConfig = activePostprocessDocument
        ? {
            enabled: postprocessEnabled,
            scriptId: activePostprocessDocument.id,
            scriptName: activePostprocessDocument.name,
            language: activePostprocessDocument.language,
            source: activePostprocessDocument.source,
            parameterValues: postprocessControlValues,
        }
        : null;
    $: studio.setToolpathPostprocessConfig(activePostprocessConfig);
    $: printerConfigured = printerTarget.baseUrl.trim().length > 0;
    $: currentSliceSignature = buildSliceSignature();
    $: currentPostprocessSignature = buildPostprocessSignature(activePostprocessConfig);
    $: hasGeneratedArtifactForCurrentSlice = Boolean(
        generatedGcodeArtifact && generatedGcodeArtifact.sliceSignature === currentSliceSignature
    );
    $: hasGeneratedArtifactForCurrentState = Boolean(
        generatedGcodeArtifact &&
            generatedGcodeArtifact.sliceSignature === currentSliceSignature &&
            generatedGcodeArtifact.postprocessSignature === currentPostprocessSignature
    );
    $: generateActionLabel = hasGeneratedArtifactForCurrentSlice && !hasGeneratedArtifactForCurrentState
        ? 'Update'
        : 'Generate';
    $: showDownloadButton = hasGeneratedArtifactForCurrentState;
    $: inspectorState = {
        sceneOptions,
        sceneControlDefinitions,
        sceneControlValues,
        printerModels,
        filamentProfiles,
        postprocessDocuments,
        postprocessControlDefinitions,
        postprocessControlValues,
        sceneId,
        viewMode,
        raymarchParams,
        viewportParams,
        animationParams,
        slicerSettings,
        activePostprocessScriptId,
        postprocessEnabled,
        postprocessSource: activePostprocessDocument?.source ?? '',
        postprocessStatus,
        postprocessDirty,
        postprocessStorageLabel: postprocessModeLabel,
        postprocessSavePending,
        postprocessAutoUpdate,
        benchmarkIterations: $status.benchmarkIterations,
        benchmarkWarmups: $status.benchmarkWarmups,
        actionPending: $status.actionPending,
        outputStatus: $status.outputStatus,
        sliceDebugSnapshot,
        printerConnection: {
            baseUrl: printerTarget.baseUrl,
            apiKey: printerTarget.apiKey,
            uploadPath: printerTarget.uploadPath,
            autoStartPrint: printerTarget.autoStartPrint,
        },
        printerConfigured,
        printerAvailable,
        exportActionLabel: generateActionLabel,
        hasGeneratedGcode: hasGeneratedArtifactForCurrentState,
    } satisfies InspectorSchemaState;
    $: if (postprocessAutoUpdatePending && !$status.actionPending) {
        postprocessAutoUpdatePending = false;
        queuePostprocessAutoUpdate();
    }
    $: if (runtimeSnapshotHydrated) {
        persistRuntimeSnapshot(captureRuntimeSnapshot());
    }

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            persistRuntimeSnapshot(captureRuntimeSnapshot());
        });
    }

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
        if (tabId === 'scene') {
            editorDocumentMode = 'scene';
        } else if (tabId === 'postprocess') {
            editorDocumentMode = 'postprocess';
        }

        workspace.selectTab(tabId);
        await resizeViewportAfterLayout();
    }

    async function toggleInspector(): Promise<void> {
        workspace.toggleInspector();
        await resizeViewportAfterLayout();
    }

    async function toggleEditor(): Promise<void> {
        if (!$workspace.editorVisible) {
            editorDocumentMode = $workspace.activeTab === 'postprocess' ? 'postprocess' : 'scene';
        }

        workspace.toggleEditor();
        await resizeViewportAfterLayout();
    }

    async function toggleViewerFullscreen(): Promise<void> {
        viewerFullscreen = !viewerFullscreen;
        await resizeViewportAfterLayout();
    }

    async function switchEditorDocument(): Promise<void> {
        editorDocumentMode = editorDocumentMode === 'postprocess' ? 'scene' : 'postprocess';
        workspace.selectTab(editorDocumentMode === 'postprocess' ? 'postprocess' : 'scene');

        if (!$workspace.editorVisible) {
            workspace.setEditorVisible(true);
        }

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
        void applyPrinterModelConnectionDefaults(printerModelId);
    }

    function updatePrinterConnectionString(key: 'baseUrl' | 'apiKey' | 'uploadPath', value: string): void {
        printerTarget = {
            ...printerTarget,
            [key]: value.trim(),
        };
        persistCurrentPrinterTarget();
        if (key === 'baseUrl' || key === 'apiKey') {
            void refreshPrinterAvailability();
        }
    }

    function updatePrinterConnectionAutoStart(value: boolean): void {
        printerTarget = {
            ...printerTarget,
            autoStartPrint: value,
        };
        persistCurrentPrinterTarget();
    }

    function commitFilamentProfile(filamentProfileId: string): void {
        const result = studio.changeFilamentProfile(filamentProfileId);
        slicerSettings = result.settings;
        status.applyPresetChange(result);
    }

    function updateSlicerNumber(key: NumericSlicerKey, value: number): void {
        applySlicerSettingsUpdate(studio.updateSlicerParams({ [key]: value } as Partial<VaseSlicerSettings>));
    }

    function updateSlicerBoolean(key: BooleanSlicerKey, value: boolean): void {
        applySlicerSettingsUpdate(studio.updateSlicerParams({ [key]: value } as Partial<VaseSlicerSettings>));
    }

    function updateSlicerString(key: keyof Pick<VaseSlicerSettings, 'startGcode' | 'endGcode'>, value: string): void {
        applySlicerSettingsUpdate(studio.updateSlicerParams({ [key]: value }));
    }

    function updateSlicerMode(value: string): void {
        const nextMode = value as VaseSlicerSettings['slicerMode'];
        applySlicerSettingsUpdate(studio.updateSlicerParams({ slicerMode: nextMode }));
    }

    function applySlicerSettingsUpdate(result: SlicerSettingsUpdateResult): void {
        slicerSettings = result.settings;
        if (result.validationMessage) {
            status.setWorkspaceStatus(result.validationMessage);
        }
    }

    function commitPostprocessScript(scriptId: string): void {
        activePostprocessScriptId = scriptId;
        const nextDocument = postprocessDocuments.find((document) => document.id === scriptId);
        postprocessStatus = nextDocument
            ? `Active postprocess script: ${nextDocument.name}.`
            : 'No active postprocess script selected.';
        status.setWorkspaceStatus(postprocessStatus);
        schedulePostprocessAutoUpdate();
    }

    function updatePostprocessEnabled(value: boolean): void {
        postprocessEnabled = value;
        postprocessStatus = value
            ? `Postprocess enabled${activePostprocessDocument ? `: ${activePostprocessDocument.name}.` : '.'}`
            : 'Postprocess disabled.';
        status.setWorkspaceStatus(postprocessStatus);
        schedulePostprocessAutoUpdate();
    }

    function updatePostprocessAutoUpdate(value: boolean): void {
        postprocessAutoUpdate = value;
        if (value) {
            queuePostprocessAutoUpdate();
            return;
        }

        if (postprocessAutoUpdateTimer !== null) {
            window.clearTimeout(postprocessAutoUpdateTimer);
            postprocessAutoUpdateTimer = null;
        }
        postprocessAutoUpdatePending = false;
    }

    function updatePostprocessSource(value: string): void {
        if (!activePostprocessDocument) {
            return;
        }

        postprocessDocuments = postprocessDocuments.map((document) =>
            document.id === activePostprocessDocument.id
                ? { ...document, source: value }
                : document
        );
        postprocessStatus = 'Postprocess script updated locally. Save to persist changes.';
        schedulePostprocessAutoUpdate();
    }

    function updatePostprocessControlValue(controlKey: string, value: number): void {
        if (!activePostprocessDocument) {
            return;
        }

        const definition = postprocessControlDefinitions.find((candidate) => candidate.key === controlKey);
        if (!definition) {
            return;
        }

        const nextScriptValues = {
            ...(postprocessControlValueState[activePostprocessDocument.id] ?? {}),
            [definition.key]: clampPostprocessControlValue(value, definition),
        };

        postprocessControlValueState = {
            ...postprocessControlValueState,
            [activePostprocessDocument.id]: nextScriptValues,
        };
        schedulePostprocessAutoUpdate();
    }

    function schedulePostprocessAutoUpdate(): void {
        // Wait for reactive signatures to update before checking auto-update guards.
        void tick().then(() => {
            queuePostprocessAutoUpdate();
        });
    }

    function queuePostprocessAutoUpdate(): void {
        if (!postprocessAutoUpdate || !hasGeneratedArtifactForCurrentSlice || hasGeneratedArtifactForCurrentState) {
            return;
        }

        if ($status.actionPending) {
            postprocessAutoUpdatePending = true;
            return;
        }

        if (postprocessAutoUpdateTimer !== null) {
            window.clearTimeout(postprocessAutoUpdateTimer);
        }

        postprocessAutoUpdateTimer = window.setTimeout(() => {
            postprocessAutoUpdateTimer = null;
            if (!postprocessAutoUpdate || !hasGeneratedArtifactForCurrentSlice || hasGeneratedArtifactForCurrentState || $status.actionPending) {
                return;
            }

            void generateVaseGcode();
        }, 300);
    }

    function setGeneratedArtifactForCurrentState(artifact: { filename: string; gcode: string; bytes: number; points: number }): void {
        generatedGcodeArtifact = {
            ...artifact,
            sliceSignature: currentSliceSignature,
            postprocessSignature: currentPostprocessSignature,
        };
    }

    async function buildFullArtifactWithProgress(
        reportProgress: (update: { percent: number; phaseLabel: string; detail: string }) => void,
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number }> {
        const progressStartMs = performance.now();
        let lastPhase = '';
        let samplingPhaseStartMs: number | null = null;
        let learnedTotalSliceSeconds: number | null = null;
        let displayedEtaSeconds: number | null = null;
        let lastEtaUpdateMs = progressStartMs;

        return studio.buildVaseGcodeArtifact(currentSliceSignature, (update) => {
            const nowMs = performance.now();
            const progress = Math.max(0, Math.min(1, update.overall));

            if (update.phase === 'sampling') {
                if (samplingPhaseStartMs === null) {
                    samplingPhaseStartMs = nowMs;
                }

                const samplingElapsedSeconds = Math.max(0, (nowMs - samplingPhaseStartMs) / 1000);
                const phaseProgress = update.total > 0 ? Math.max(0, Math.min(1, update.completed / update.total)) : 0;

                // Learn expected total slice duration from measured sampling throughput once enough data exists.
                if (update.completed >= 4 && phaseProgress >= 0.05) {
                    const estimatedSamplingTotalSeconds = samplingElapsedSeconds / phaseProgress;
                    const estimatedSliceTotalSeconds = estimatedSamplingTotalSeconds / 0.76;
                    learnedTotalSliceSeconds = learnedTotalSliceSeconds === null
                        ? estimatedSliceTotalSeconds
                        : (learnedTotalSliceSeconds * 0.6) + (estimatedSliceTotalSeconds * 0.4);
                }
            } else if (lastPhase === 'sampling' && samplingPhaseStartMs !== null && learnedTotalSliceSeconds === null) {
                const samplingElapsedSeconds = Math.max(0, (nowMs - samplingPhaseStartMs) / 1000);
                learnedTotalSliceSeconds = samplingElapsedSeconds / 0.76;
            }

            const elapsedSeconds = Math.max(0, (nowMs - progressStartMs) / 1000);
            const fallbackEtaSeconds = progress > 0.2
                ? Math.max(0, elapsedSeconds * ((1 / progress) - 1))
                : null;
            const rawEtaSeconds = learnedTotalSliceSeconds !== null
                ? Math.max(0, learnedTotalSliceSeconds - elapsedSeconds)
                : fallbackEtaSeconds;

            let etaSeconds: number | null = null;
            if (rawEtaSeconds !== null) {
                if (displayedEtaSeconds === null) {
                    displayedEtaSeconds = rawEtaSeconds;
                } else {
                    const deltaSeconds = Math.max(1e-3, (nowMs - lastEtaUpdateMs) / 1000);
                    const allowedRise = (deltaSeconds * 0.45) + 0.08;
                    if (rawEtaSeconds > displayedEtaSeconds + allowedRise) {
                        displayedEtaSeconds += allowedRise;
                    } else {
                        displayedEtaSeconds = rawEtaSeconds;
                    }
                }

                if (update.phase === 'finalizing') {
                    displayedEtaSeconds = Math.min(displayedEtaSeconds, 1);
                }

                etaSeconds = displayedEtaSeconds;
                lastEtaUpdateMs = nowMs;
            }

            lastPhase = update.phase;

            reportProgress({
                percent: progress * 100,
                phaseLabel: update.phaseLabel,
                detail: etaSeconds !== null
                    ? `${update.detail} ETA ${formatEta(etaSeconds)}`
                    : update.detail,
            });
        });
    }

    async function buildUpdatedArtifactFromCachedBase(
        reportProgress: (update: { percent: number; phaseLabel: string; detail: string }) => void,
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number }> {
        reportProgress({
            percent: 12,
            phaseLabel: 'Postprocess',
            detail: 'Applying updated postprocess script and controls...',
        });
        await tick();

        const artifact = await studio.buildVaseGcodeArtifactFromCachedBase(currentSliceSignature);

        reportProgress({
            percent: 100,
            phaseLabel: 'Finalizing',
            detail: 'Updated G-code artifact is ready.',
        });
        return artifact;
    }

    async function generateVaseGcode(): Promise<void> {
        const shouldUpdateFromCachedSlice = hasGeneratedArtifactForCurrentSlice && !hasGeneratedArtifactForCurrentState;

        await status.runCommand(shouldUpdateFromCachedSlice ? 'Updating G-code...' : 'Generating G-code...', async (reportProgress) => {
            try {
                const artifact = shouldUpdateFromCachedSlice
                    ? await buildUpdatedArtifactFromCachedBase(reportProgress)
                    : await buildFullArtifactWithProgress(reportProgress);

                setGeneratedArtifactForCurrentState(artifact);
                const actionVerb = shouldUpdateFromCachedSlice ? 'Updated' : 'Generated';
                return `${actionVerb} ${artifact.filename} (${(artifact.bytes / 1024).toFixed(1)} KB, ${artifact.points} points). Use Download to save locally.`;
            } finally {
                sliceDebugSnapshot = studio.getLastSliceDebugSnapshot();
                if (sliceDebugSnapshot) {
                    workspace.selectTab('output');
                }
            }
        });
    }

    async function downloadGeneratedGcode(): Promise<void> {
        if (!generatedGcodeArtifact || !hasGeneratedArtifactForCurrentState) {
            status.setWorkspaceStatus('Generate or Update first, then download.');
            return;
        }

        const artifact = generatedGcodeArtifact;

        await status.runCommand('Downloading G-code...', async () => {
            downloadTextFile(artifact.filename, artifact.gcode);
            return `Downloaded ${artifact.filename} (${(artifact.bytes / 1024).toFixed(1)} KB).`;
        });
    }

    async function sendVaseGcodeToPrinter(): Promise<void> {
        if (!printerConfigured) {
            status.setWorkspaceStatus('Set Moonraker URL in Machine > Printer Connection to enable Print.');
            return;
        }

        if (!printerAvailable) {
            await refreshPrinterAvailability();
        }

        if (!printerAvailable) {
            status.setWorkspaceStatus(`Printer is not reachable at ${printerTarget.baseUrl}.`);
            return;
        }

        await executeSendVaseGcodeToPrinter(printerTarget);
    }

    async function executeSendVaseGcodeToPrinter(configuredTarget: PrinterTarget): Promise<void> {
        const canSendCached = Boolean(generatedGcodeArtifact && hasGeneratedArtifactForCurrentState);

        await status.runCommand(canSendCached ? 'Sending to printer...' : 'Preparing and sending...', async (reportProgress) => {
            try {
                const artifact = canSendCached && generatedGcodeArtifact
                    ? generatedGcodeArtifact
                    : hasGeneratedArtifactForCurrentSlice && !hasGeneratedArtifactForCurrentState
                        ? await buildUpdatedArtifactFromCachedBase((next) => reportProgress({
                            ...next,
                            percent: Math.min(92, Math.max(0, next.percent * 0.92)),
                        }))
                        : await buildFullArtifactWithProgress((next) => reportProgress({
                            ...next,
                            percent: Math.min(92, Math.max(0, next.percent * 0.92)),
                        }));

                if (!canSendCached) {
                    setGeneratedArtifactForCurrentState(artifact);
                }

                reportProgress({
                    percent: 96,
                    phaseLabel: 'Upload',
                    detail: `Uploading ${artifact.filename} to ${configuredTarget.baseUrl}...`,
                });

                const uploadResult = await uploadGcodeToMoonraker(artifact.filename, artifact.gcode, {
                    baseUrl: configuredTarget.baseUrl,
                    apiKey: configuredTarget.apiKey,
                    print: configuredTarget.autoStartPrint,
                    path: configuredTarget.uploadPath,
                });

                const actionSuffix = uploadResult.printStarted
                    ? 'Print started.'
                    : uploadResult.printQueued
                        ? 'Print queued.'
                        : 'Upload complete.';

                return `Sent ${artifact.filename} to ${uploadResult.root}/${uploadResult.path}. ${actionSuffix}`;
            } finally {
                sliceDebugSnapshot = studio.getLastSliceDebugSnapshot();
                if (sliceDebugSnapshot) {
                    workspace.selectTab('output');
                }
            }
        });
    }

    async function benchmarkVaseGcode(): Promise<void> {
        const iterations = Math.max(1, $status.benchmarkIterations || 1);
        const warmups = Math.max(0, $status.benchmarkWarmups || 0);
        const measuredLabel = `${iterations} measured run${iterations === 1 ? '' : 's'}`;
        const warmupLabel = `${warmups} warmup run${warmups === 1 ? '' : 's'}`;
        await status.runCommand(`Benchmarking ${measuredLabel} after ${warmupLabel}...`, () => {
            const summary = studio.benchmarkVaseGcode(iterations, warmups);
            sliceDebugSnapshot = studio.getLastSliceDebugSnapshot();
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

    function mergePersistedPostprocessDocument(nextDocument: PostprocessScriptDocument): void {
        const nextPersisted = persistedPostprocessDocuments.some((document) => document.id === nextDocument.id)
            ? persistedPostprocessDocuments.map((document) => (document.id === nextDocument.id ? nextDocument : document))
            : [...persistedPostprocessDocuments, nextDocument];
        persistedPostprocessDocuments = nextPersisted.sort((left, right) => left.name.localeCompare(right.name));
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

    async function saveActivePostprocessDocument(): Promise<void> {
        if (!activePostprocessDocument || !postprocessDirty || postprocessSavePending) {
            return;
        }

        postprocessSavePending = true;
        postprocessStatus = postprocessMode === 'filesystem'
            ? 'Saving postprocess script to folder...'
            : 'Saving postprocess script to browser storage...';

        try {
            const nextDocuments = await savePostprocessDocument(
                postprocessMode,
                activePostprocessDocument,
                bundledPostprocessDocuments,
                postprocessDocuments,
            );

            postprocessDocuments = nextDocuments;
            if (postprocessMode === 'filesystem') {
                const savedDocument = nextDocuments.find((document) => document.id === activePostprocessDocument.id);
                if (savedDocument) {
                    mergePersistedPostprocessDocument(savedDocument);
                }
            } else {
                persistedPostprocessDocuments = nextDocuments;
            }

            postprocessStatus = postprocessMode === 'filesystem'
                ? `Saved ${activePostprocessDocument.fileName} to src/postprocess-scripts.`
                : `Saved ${activePostprocessDocument.name} to browser storage.`;
            status.setWorkspaceStatus(postprocessStatus);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Postprocess save failed.';
            postprocessStatus = message;
            status.setWorkspaceStatus(message);
        } finally {
            postprocessSavePending = false;
        }
    }

    function revertActivePostprocessDocument(): void {
        if (!activePostprocessDocument) {
            return;
        }

        const persisted = persistedPostprocessDocuments.find((document) => document.id === activePostprocessDocument.id);
        if (!persisted) {
            return;
        }

        postprocessDocuments = postprocessDocuments.map((document) =>
            document.id === activePostprocessDocument.id
                ? { ...document, source: persisted.source }
                : document
        );

        postprocessStatus = `Reverted ${persisted.fileName} to the last saved version.`;
        status.setWorkspaceStatus(postprocessStatus);
    }

    async function createAndActivatePostprocessScript(): Promise<void> {
        if (typeof window === 'undefined') {
            return;
        }

        const requestedName = window.prompt(
            'Postprocess script name',
            activePostprocessDocument ? `${activePostprocessDocument.name} Variant` : 'New Postprocess'
        );
        if (requestedName === null) {
            return;
        }

        const nextDocument = createPostprocessDocument(postprocessDocuments, 'typescript', requestedName);
        postprocessDocuments = [...postprocessDocuments, nextDocument].sort((left, right) => left.name.localeCompare(right.name));
        activePostprocessScriptId = nextDocument.id;
        postprocessEnabled = true;
        editorDocumentMode = 'postprocess';
        workspace.selectTab('postprocess');
        workspace.setEditorVisible(true);
        postprocessStatus = `Created ${nextDocument.fileName}. Save it to persist the new script.`;
        status.setWorkspaceStatus(postprocessStatus);

        if (postprocessMode === 'filesystem') {
            await saveActivePostprocessDocument();
        }
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
        editorDocumentMode = 'scene';
        workspace.selectTab('scene');
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

    function handleWindowKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || !viewerFullscreen) {
            return;
        }

        event.preventDefault();
        void toggleViewerFullscreen();
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
        updateSlicerBoolean,
        commitPrinterModel,
        updateSlicerString,
        commitFilamentProfile,
        commitPostprocessScript,
        updatePostprocessEnabled,
        updatePostprocessAutoUpdate,
        updatePostprocessSource,
        updatePostprocessControlValue,
        createPostprocessScript: createAndActivatePostprocessScript,
        savePostprocessScript: saveActivePostprocessDocument,
        revertPostprocessScript: revertActivePostprocessDocument,
        setBenchmarkIterations: (value) => status.setBenchmarkIterations(value),
        setBenchmarkWarmups: (value) => status.setBenchmarkWarmups(value),
        updatePrinterConnectionString,
        updatePrinterConnectionAutoStart,
        generateVaseGcode,
        downloadGeneratedGcode,
        sendVaseGcodeToPrinter,
        benchmarkVaseGcode,
    };

    onMount(() => {
        syncEditorDockSide();

        const handleWindowResize = () => {
            const previousDockSide = editorDockSide;
            syncEditorDockSide();
            if (previousDockSide !== editorDockSide) {
                void resizeViewportAfterLayout();
            }
        };

        const handlePersistRuntimeSnapshot = () => {
            if (!runtimeSnapshotHydrated) {
                return;
            }

            persistRuntimeSnapshot(captureRuntimeSnapshot());
        };

        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handlePersistRuntimeSnapshot);
        window.addEventListener('pagehide', handlePersistRuntimeSnapshot);

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

        const refreshFilesystemPostprocessScripts = async (silent: boolean = false): Promise<void> => {
            if (postprocessMode !== 'filesystem' || hasDirtyPostprocessDocuments(postprocessDocuments, persistedPostprocessDocuments)) {
                return;
            }

            const nextDocuments = await reloadFilesystemPostprocessDocuments();
            if (!nextDocuments || arePostprocessCollectionsEqual(nextDocuments, persistedPostprocessDocuments)) {
                return;
            }

            persistedPostprocessDocuments = nextDocuments;
            postprocessDocuments = nextDocuments;
            if (!silent) {
                postprocessStatus = 'Postprocess folder updated from disk.';
                status.setWorkspaceStatus(postprocessStatus);
            }
        };

        void (async () => {
            try {
                const [repository, postprocessRepository] = await Promise.all([
                    loadSceneRepository(bundledSceneDocuments),
                    loadPostprocessRepository(bundledPostprocessDocuments),
                ]);
                if (disposed) {
                    return;
                }

                sceneEditorMode = repository.mode;
                persistedSceneDocuments = repository.documents;
                sceneDocuments = repository.documents;
                applySceneRegistryResult(studio.syncSceneDocuments(repository.documents));

                postprocessMode = postprocessRepository.mode;
                persistedPostprocessDocuments = postprocessRepository.documents;
                postprocessDocuments = postprocessRepository.documents;
                activePostprocessScriptId = postprocessRepository.documents[0]?.id ?? activePostprocessScriptId;

                studio.init();
                printerTarget = readPrinterTarget();
                if (!printerTarget.baseUrl.trim()) {
                    await applyPrinterModelConnectionDefaults(slicerSettings.printerModelId);
                }
                await refreshPrinterAvailability();
                status.setShaderStatus('ready', 'Ready');
                sceneEditorStatus = repository.mode === 'filesystem'
                    ? 'Editing scene files directly from src/shaders/scenes.'
                    : 'Editing bundled defaults with browser-backed drafts.';
                status.setWorkspaceStatus(sceneEditorStatus);
                postprocessStatus = postprocessRepository.mode === 'filesystem'
                    ? 'Editing postprocess files directly from src/postprocess-scripts.'
                    : 'Editing bundled postprocess scripts with browser-backed drafts.';

                const runtimeSnapshot = readRuntimeSnapshot();
                if (runtimeSnapshot) {
                    restoreRuntimeSnapshot(runtimeSnapshot);
                }
                runtimeSnapshotHydrated = true;
                persistRuntimeSnapshot(captureRuntimeSnapshot());

                if (repository.mode === 'filesystem') {
                    sceneRepositoryPollHandle = window.setInterval(() => {
                        void refreshFilesystemScenes(true);
                    }, 1200);
                }

                if (postprocessRepository.mode === 'filesystem') {
                    postprocessRepositoryPollHandle = window.setInterval(() => {
                        void refreshFilesystemPostprocessScripts(true);
                    }, 1200);
                }

                printerAvailabilityPollHandle = window.setInterval(() => {
                    void refreshPrinterAvailability();
                }, 12000);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to initialize renderer';
                status.setShaderStatus('error', message);
                status.setWorkspaceStatus('Renderer initialization failed.');
                console.error('[Startup] Renderer initialization failed.', error);
            }
        })();

        return () => {
            disposed = true;
            window.removeEventListener('resize', handleWindowResize);
            window.removeEventListener('beforeunload', handlePersistRuntimeSnapshot);
            window.removeEventListener('pagehide', handlePersistRuntimeSnapshot);
            if (sceneRepositoryPollHandle !== null) {
                window.clearInterval(sceneRepositoryPollHandle);
                sceneRepositoryPollHandle = null;
            }
            if (postprocessRepositoryPollHandle !== null) {
                window.clearInterval(postprocessRepositoryPollHandle);
                postprocessRepositoryPollHandle = null;
            }
            if (printerAvailabilityPollHandle !== null) {
                window.clearInterval(printerAvailabilityPollHandle);
                printerAvailabilityPollHandle = null;
            }
        };
    });

    onDestroy(() => {
        cleanupInspectorResize();
        cleanupEditorResize();
        if (postprocessAutoUpdateTimer !== null) {
            window.clearTimeout(postprocessAutoUpdateTimer);
            postprocessAutoUpdateTimer = null;
        }
    });

</script>

<svelte:window on:keydown={handleWindowKeydown} />

<div class="app-root" class:inspector-collapsed={$workspace.inspectorCollapsed} class:is-dock-resizing={$workspace.isInspectorResizing} class:is-editor-resizing={$workspace.isEditorResizing} class:editor-visible={$workspace.editorVisible} class:viewer-fullscreen={viewerFullscreen}>
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
        actionPending={$status.actionPending}
        showDownloadButton={showDownloadButton}
        showPrintButton={printerConfigured && printerAvailable}
        onCommitScene={commitScene}
        onCommitViewMode={commitViewMode}
        onCommitPrinterModel={commitPrinterModel}
        onCommitFilamentProfile={commitFilamentProfile}
        onDownloadGeneratedGcode={downloadGeneratedGcode}
        onSendVaseGcodeToPrinter={sendVaseGcodeToPrinter}
    />

    <div class="workspace-stack" class:editor-docked-left={$workspace.editorVisible && editorDockSide} style={`--editor-height: ${$workspace.editorHeight}px; --editor-width: ${$workspace.editorWidth}px; --inspector-width: ${$workspace.inspectorWidth}px;`}>
        <div class="workspace-shell" class:editor-docked-left={$workspace.editorVisible && editorDockSide}>
            {#if $workspace.editorVisible && editorDockSide}
                <div class="workspace-editor-slot workspace-editor-slot-side">
                    <DocumentEditorPanel
                        panelLabel={editorDocumentMode === 'postprocess' ? 'Script Editor' : 'Scene Editor'}
                        storageLabel={editorDocumentMode === 'postprocess' ? postprocessModeLabel : sceneEditorModeLabel}
                        dirty={editorDocumentMode === 'postprocess' ? postprocessDirty : sceneEditorDirty}
                        dirtyLabel={editorDocumentMode === 'postprocess' ? 'Unsaved Script' : 'Unsaved Scene'}
                        savePending={editorDocumentMode === 'postprocess' ? postprocessSavePending : sceneEditorSavePending}
                        statusText={editorDocumentMode === 'postprocess' ? postprocessStatus : sceneEditorStatus}
                        documentName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.name ?? null : activeSceneDocument?.name ?? null}
                        documentFileName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.fileName ?? null : activeSceneDocument?.fileName ?? null}
                        source={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.source ?? null : activeSceneDocument?.source ?? null}
                        helperText={editorDocumentMode === 'postprocess'
                            ? (postprocessMode === 'filesystem'
                                ? 'Saving writes directly into src/postprocess-scripts so VS Code and exports stay in sync.'
                                : 'Saving keeps bundled script defaults and stores overrides or new scripts in browser storage.')
                            : (sceneEditorMode === 'filesystem'
                                ? 'Saving writes directly into src/shaders/scenes so VS Code and the viewport stay in sync.'
                                : 'Saving keeps bundled scene defaults and stores overrides or new scenes in browser storage.')}
                        createLabel={editorDocumentMode === 'postprocess' ? 'New Script' : 'New Scene'}
                        saveLabel={editorDocumentMode === 'postprocess' ? 'Save Script' : 'Save Scene'}
                        hideLabel="Hide Editor"
                        switchLabel={editorDocumentMode === 'postprocess' ? 'Switch to Scene' : 'Switch to Script'}
                        language={editorDocumentMode === 'postprocess' ? (activePostprocessDocument?.language ?? 'typescript') : 'glsl'}
                        onChangeSource={editorDocumentMode === 'postprocess' ? updatePostprocessSource : updateSceneDocumentSource}
                        onCreate={editorDocumentMode === 'postprocess' ? createAndActivatePostprocessScript : createAndActivateScene}
                        onSave={editorDocumentMode === 'postprocess' ? saveActivePostprocessDocument : saveActiveSceneDocument}
                        onRevert={editorDocumentMode === 'postprocess' ? revertActivePostprocessDocument : revertActiveSceneDocument}
                        onSwitchDocument={switchEditorDocument}
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
                {viewerFullscreen}
                onResetView={resetView}
                onToggleInspector={toggleInspector}
                onToggleEditor={toggleEditor}
                onToggleViewerFullscreen={toggleViewerFullscreen}
                onGenerateVaseGcode={generateVaseGcode}
                generateActionLabel={generateActionLabel}
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
            <DocumentEditorPanel
                panelLabel={editorDocumentMode === 'postprocess' ? 'Script Editor' : 'Scene Editor'}
                storageLabel={editorDocumentMode === 'postprocess' ? postprocessModeLabel : sceneEditorModeLabel}
                dirty={editorDocumentMode === 'postprocess' ? postprocessDirty : sceneEditorDirty}
                dirtyLabel={editorDocumentMode === 'postprocess' ? 'Unsaved Script' : 'Unsaved Scene'}
                savePending={editorDocumentMode === 'postprocess' ? postprocessSavePending : sceneEditorSavePending}
                statusText={editorDocumentMode === 'postprocess' ? postprocessStatus : sceneEditorStatus}
                documentName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.name ?? null : activeSceneDocument?.name ?? null}
                documentFileName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.fileName ?? null : activeSceneDocument?.fileName ?? null}
                source={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.source ?? null : activeSceneDocument?.source ?? null}
                helperText={editorDocumentMode === 'postprocess'
                    ? (postprocessMode === 'filesystem'
                        ? 'Saving writes directly into src/postprocess-scripts so VS Code and exports stay in sync.'
                        : 'Saving keeps bundled script defaults and stores overrides or new scripts in browser storage.')
                    : (sceneEditorMode === 'filesystem'
                        ? 'Saving writes directly into src/shaders/scenes so VS Code and the viewport stay in sync.'
                        : 'Saving keeps bundled scene defaults and stores overrides or new scenes in browser storage.')}
                createLabel={editorDocumentMode === 'postprocess' ? 'New Script' : 'New Scene'}
                saveLabel={editorDocumentMode === 'postprocess' ? 'Save Script' : 'Save Scene'}
                hideLabel="Hide Editor"
                switchLabel={editorDocumentMode === 'postprocess' ? 'Switch to Scene' : 'Switch to Script'}
                language={editorDocumentMode === 'postprocess' ? (activePostprocessDocument?.language ?? 'typescript') : 'glsl'}
                onChangeSource={editorDocumentMode === 'postprocess' ? updatePostprocessSource : updateSceneDocumentSource}
                onCreate={editorDocumentMode === 'postprocess' ? createAndActivatePostprocessScript : createAndActivateScene}
                onSave={editorDocumentMode === 'postprocess' ? saveActivePostprocessDocument : saveActiveSceneDocument}
                onRevert={editorDocumentMode === 'postprocess' ? revertActivePostprocessDocument : revertActiveSceneDocument}
                onSwitchDocument={switchEditorDocument}
                onClose={toggleEditor}
                onStartResize={startEditorResize}
            />
        {/if}
    </div>

    <StatusStrip
        workspaceStatus={$status.workspaceStatus}
        outputStatus={$status.outputStatus}
        actionPending={$status.actionPending}
        progressVisible={$status.progressVisible}
        progressPercent={$status.progressPercent}
        progressPhaseLabel={$status.progressPhaseLabel}
        progressDetail={$status.progressDetail}
        shaderStatusDetail={$status.shaderStatusDetail}
    />

</div>