<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';

    import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
    import {
        SCENE_GLSL_FILE,
        type SceneBundle,
    } from './core/shader-pipeline';
    import type { VaseSlicerSettings } from './core/slicer';
    import {
        listPostprocessScripts,
        setPostprocessScripts,
        upsertPostprocessScript,
        type PostprocessScriptDocument,
    } from './core/postprocess-registry';
    import DocumentEditorPanel from './components/DocumentEditorPanel.svelte';
    import InspectorPanel from './components/InspectorPanel.svelte';
    import StatusStrip from './components/StatusStrip.svelte';
    import TopBar from './components/TopBar.svelte';
    import ViewportPanel from './components/ViewportPanel.svelte';
    import {
        type SceneConfigView,
        type SceneOverrides,
        type SceneRegistrySyncResult,
        type SlicerSettingsUpdateResult,
        type StudioController,
    } from './studio-controller';
    import {
        type BooleanSlicerKey,
        type ControlTabId,
        type InspectorSchemaHandlers,
        type InspectorSchemaState,
        type NumericSlicerKey,
    } from './ui/inspector-schema';
    import { areSceneBundlesEqual } from './ui/scene-documents';
    import {
        arePostprocessCollectionsEqual,
        createPostprocessDocument,
    } from './ui/postprocess-documents';
    import {
        bundledWorkspaceBackend,
        probeDevServerBackend,
        type WorkspaceBackend,
    } from './ui/workspace-backend';
    import {
        isLocalFolderSupported,
        pickLocalFolderBackend,
        restoreLocalFolderBackend,
        type StoredLocalFolder,
    } from './ui/local-folder-backend';
    import {
        buildSceneGlslTemplate,
        buildSceneManifestTemplate,
        formatEta,
        toSceneId,
    } from './app/helpers';
    import { createStatusModel } from './ui/status-model';
    import { createWorkspaceStore } from './ui/workspace-store';
    import { checkMoonrakerAvailability, downloadTextFile, uploadGcodeToMoonraker } from './studio/file-export';

    export let studio: StudioController;

    const EDITOR_SIDE_LAYOUT_MIN_WIDTH = 1440;
    const COMPACT_WORKSPACE_MAX_WIDTH = 1180;

    const snapshot = studio.getSnapshot();

    let sceneOptions = snapshot.sceneOptions;
    let printerModels = snapshot.printerModels;
    let filamentProfiles = snapshot.filamentProfiles;
    let sceneId = snapshot.sceneId;
    let viewMode = snapshot.viewMode;
    let raymarchParams = snapshot.raymarchParams;
    let viewportParams = snapshot.viewportParams;
    let animationParams = snapshot.animationParams;
    let config: SceneConfigView = snapshot.config;

    // Scene folder documents.
    let sceneBundles: SceneBundle[] = studio.getSceneBundles();
    let persistedSceneBundles: SceneBundle[] = sceneBundles;
    let workspaceBackend: WorkspaceBackend = bundledWorkspaceBackend;
    let pendingLocalFolder: StoredLocalFolder | null = null;
    let sceneEditorStatus = 'Scene editor ready.';
    let sceneEditorSavePending = false;
    let activeSceneFileName: string = SCENE_GLSL_FILE;

    // Generic postprocess script documents (editing targets).
    let postprocessDocuments: PostprocessScriptDocument[] = listPostprocessScripts();
    let persistedPostprocessDocuments = postprocessDocuments;
    let postprocessStatus = 'Postprocess scripts ready.';
    let postprocessSavePending = false;
    let activePostprocessScriptId = postprocessDocuments[0]?.id ?? '';
    let editorDocumentMode: 'scene' | 'postprocess' = 'scene';
    let postprocessAutoUpdate = false;

    // Session overrides per scene, persisted in the runtime snapshot.
    let sceneOverridesBySceneId: Record<string, Partial<SceneOverrides>> = {};

    const workspace = createWorkspaceStore({
        activeSceneLabel: studio.getSceneLabel(sceneId),
        activeViewModeLabel: studio.getViewModeLabel(viewMode),
    });
    const status = createStatusModel();
    const APP_RUNTIME_STORAGE_KEY = 'implicit.runtimeState.v2';
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
        activePostprocessScriptId?: string;
        postprocessAutoUpdate?: boolean;
        editorDocumentMode?: 'scene' | 'postprocess';
        activeSceneFileName?: string;
        viewerFullscreen?: boolean;
        sceneOverrides?: Record<string, Partial<SceneOverrides>>;
    }

    let resizeCleanup: (() => void) | null = null;
    let editorResizeCleanup: (() => void) | null = null;
    let sceneRepositoryPollHandle: number | null = null;
    let postprocessRepositoryPollHandle: number | null = null;
    let printerAvailabilityPollHandle: number | null = null;
    let editorDockSide = false;
    let sliceDebugSnapshot = studio.getLastSliceDebugSnapshot();
    let compactWorkspaceLayout = false;
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
    let postprocessAutoUpdateTimer: number | null = null;
    let postprocessAutoUpdatePending = false;
    let viewerFullscreen = false;
    let hasToolpath = false;

    function refreshConfig(): void {
        config = studio.getConfigView();
    }

    // Dependencies are passed as arguments so the reactive statement below
    // re-runs when they change; a zero-argument call would never invalidate.
    function buildSliceSignature(id: string, bundle: SceneBundle | null, view: SceneConfigView): string {
        return JSON.stringify({
            sceneId: id,
            sceneGlsl: bundle?.files[SCENE_GLSL_FILE] ?? '',
            uniformValues: view.uniformValues,
            settings: view.settings,
        });
    }

    function buildPostprocessSignature(view: SceneConfigView): string {
        return JSON.stringify(view.pipeline.map((step) => ({
            name: step.name,
            scriptId: step.scriptId,
            enabled: step.enabled,
            params: step.params,
            error: step.error,
        })));
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

    function persistRuntimeSnapshot(runtimeSnapshot: AppRuntimeSnapshot): void {
        if (typeof window === 'undefined') {
            return;
        }

        try {
            window.sessionStorage.setItem(APP_RUNTIME_STORAGE_KEY, JSON.stringify(runtimeSnapshot));
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
            activePostprocessScriptId,
            postprocessAutoUpdate,
            editorDocumentMode,
            activeSceneFileName,
            viewerFullscreen,
            sceneOverrides: {
                ...sceneOverridesBySceneId,
                [sceneId]: studio.exportOverrides(),
            },
        };
    }

    function restoreRuntimeSnapshot(runtimeSnapshot: AppRuntimeSnapshot): void {
        if (runtimeSnapshot.sceneOverrides && typeof runtimeSnapshot.sceneOverrides === 'object') {
            sceneOverridesBySceneId = runtimeSnapshot.sceneOverrides;
        }

        if (typeof runtimeSnapshot.sceneId === 'string' && sceneOptions.some((option) => option.id === runtimeSnapshot.sceneId)) {
            commitScene(runtimeSnapshot.sceneId);
        }

        const restoredOverrides = sceneOverridesBySceneId[sceneId];
        if (restoredOverrides) {
            studio.restoreOverrides(restoredOverrides);
            refreshConfig();
        }

        if (typeof runtimeSnapshot.viewMode === 'number') {
            viewMode = runtimeSnapshot.viewMode;
            studio.setViewMode(runtimeSnapshot.viewMode);
        }

        if (runtimeSnapshot.raymarchParams && typeof runtimeSnapshot.raymarchParams === 'object') {
            raymarchParams = { ...raymarchParams, ...runtimeSnapshot.raymarchParams };
            studio.updateRaymarchParams(runtimeSnapshot.raymarchParams);
        }

        if (runtimeSnapshot.viewportParams && typeof runtimeSnapshot.viewportParams === 'object') {
            viewportParams = { ...viewportParams, ...runtimeSnapshot.viewportParams };
            studio.updateViewportParams(runtimeSnapshot.viewportParams);
        }

        if (runtimeSnapshot.animationParams && typeof runtimeSnapshot.animationParams === 'object') {
            animationParams = { ...animationParams, ...runtimeSnapshot.animationParams };
            studio.updateAnimationParams(runtimeSnapshot.animationParams);
        }

        if (typeof runtimeSnapshot.activePostprocessScriptId === 'string'
            && postprocessDocuments.some((document) => document.id === runtimeSnapshot.activePostprocessScriptId)) {
            activePostprocessScriptId = runtimeSnapshot.activePostprocessScriptId;
        }

        if (typeof runtimeSnapshot.postprocessAutoUpdate === 'boolean') {
            postprocessAutoUpdate = runtimeSnapshot.postprocessAutoUpdate;
        }

        if (runtimeSnapshot.editorDocumentMode === 'scene' || runtimeSnapshot.editorDocumentMode === 'postprocess') {
            editorDocumentMode = runtimeSnapshot.editorDocumentMode;
        }

        if (typeof runtimeSnapshot.activeSceneFileName === 'string') {
            activeSceneFileName = runtimeSnapshot.activeSceneFileName;
        }

        if (typeof runtimeSnapshot.viewerFullscreen === 'boolean' && runtimeSnapshot.viewerFullscreen !== viewerFullscreen) {
            viewerFullscreen = runtimeSnapshot.viewerFullscreen;
            void resizeViewportAfterLayout();
        }
    }

    $: workspace.setActiveLabels(studio.getSceneLabel(sceneId), studio.getViewModeLabel(viewMode));
    $: studio.setToolpathOverlayVisible($workspace.overlayVisible);
    $: activeSceneBundle = sceneBundles.find((bundle) => bundle.id === sceneId) ?? null;
    $: persistedActiveSceneBundle = persistedSceneBundles.find((bundle) => bundle.id === sceneId) ?? null;
    $: sceneFileNames = activeSceneBundle ? sortSceneFileNames(Object.keys(activeSceneBundle.files)) : [];
    $: if (activeSceneBundle && !(activeSceneFileName in activeSceneBundle.files)) {
        activeSceneFileName = SCENE_GLSL_FILE in activeSceneBundle.files ? SCENE_GLSL_FILE : (sceneFileNames[0] ?? SCENE_GLSL_FILE);
    }
    $: activeSceneSource = activeSceneBundle?.files[activeSceneFileName] ?? null;
    $: sceneEditorDirty = Boolean(
        activeSceneBundle && activeSceneSource !== null &&
            activeSceneSource !== (persistedActiveSceneBundle?.files[activeSceneFileName] ?? null)
    );
    $: sceneEditorModeLabel = workspaceBackend.kind === 'dev-server'
        ? 'Folder Sync'
        : workspaceBackend.kind === 'local-folder'
            ? 'Local Folder'
            : 'Bundled (read-only save)';
    $: workspaceFolderActionLabel = workspaceBackend.kind !== 'bundled' || !isLocalFolderSupported()
        ? null
        : pendingLocalFolder
            ? `Reconnect '${pendingLocalFolder.name}'`
            : 'Connect Project Folder…';
    $: sceneEditorLanguage = activeSceneFileName.endsWith('.glsl')
        ? 'glsl' as const
        : activeSceneFileName.endsWith('.js')
            ? 'javascript' as const
            : 'typescript' as const;
    $: if (!postprocessDocuments.some((document) => document.id === activePostprocessScriptId)) {
        activePostprocessScriptId = postprocessDocuments[0]?.id ?? '';
    }
    $: activePostprocessDocument = postprocessDocuments.find((document) => document.id === activePostprocessScriptId) ?? null;
    $: persistedActivePostprocessDocument = persistedPostprocessDocuments.find((document) => document.id === activePostprocessScriptId) ?? null;
    $: postprocessDirty = Boolean(
        activePostprocessDocument &&
            (!persistedActivePostprocessDocument || activePostprocessDocument.source !== persistedActivePostprocessDocument.source)
    );
    $: postprocessModeLabel = sceneEditorModeLabel;
    $: printerConfigured = printerTarget.baseUrl.trim().length > 0;
    $: currentSliceSignature = buildSliceSignature(sceneId, activeSceneBundle, config);
    $: currentPostprocessSignature = buildPostprocessSignature(config);
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
        uniformControls: config.uniformControls,
        uniformValues: config.uniformValues,
        paramControls: config.paramControls,
        paramValues: config.paramValues,
        pipeline: config.pipeline,
        overriddenSlicerKeys: config.overriddenSlicerKeys,
        overriddenUniformKeys: config.overriddenUniformKeys,
        overriddenParamKeys: config.overriddenParamKeys,
        overrideCount: config.overrideCount,
        printerOverridden: config.printerOverridden,
        filamentOverridden: config.filamentOverridden,
        manifestError: config.manifestError,
        preprocessError: config.preprocessError,
        printerModels,
        filamentProfiles,
        postprocessDocuments,
        sceneId,
        viewMode,
        raymarchParams,
        viewportParams,
        animationParams,
        slicerSettings: config.settings,
        activePostprocessScriptId,
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

    function sortSceneFileNames(fileNames: string[]): string[] {
        const priority = (name: string): number => {
            if (name === SCENE_GLSL_FILE) {
                return 0;
            }
            if (name === 'scene.ts' || name === 'scene.js') {
                return 1;
            }
            return 2;
        };

        return fileNames.slice().sort((left, right) => priority(left) - priority(right) || left.localeCompare(right));
    }

    async function resizeViewportAfterLayout(): Promise<void> {
        await tick();
        studio.resizeViewport();
    }

    function syncWorkspaceLayout(): void {
        if (typeof window === 'undefined') {
            compactWorkspaceLayout = false;
            editorDockSide = false;
            return;
        }

        compactWorkspaceLayout = window.innerWidth <= COMPACT_WORKSPACE_MAX_WIDTH;
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
        if (nextSceneId !== sceneId) {
            sceneOverridesBySceneId = {
                ...sceneOverridesBySceneId,
                [sceneId]: studio.exportOverrides(),
            };
        }

        status.setShaderStatus('compiling', 'Compiling...');
        const result = studio.changeScene(nextSceneId, sceneOverridesBySceneId[nextSceneId] ?? null);
        sceneId = result.sceneId;
        config = result.config;
        status.applySceneChange(result);
        hasToolpath = studio.hasToolpathOverlay();
    }

    function applySceneRegistryResult(result: SceneRegistrySyncResult): void {
        sceneOptions = result.sceneOptions;
        sceneId = result.sceneId;
        config = result.config;
        status.setShaderStatus(result.ok ? 'ok' : 'error', result.shaderMessage);
    }

    function updateSceneFileSource(value: string): void {
        if (!activeSceneBundle) {
            return;
        }

        const targetSceneId = activeSceneBundle.id;
        const targetFileName = activeSceneFileName;
        sceneBundles = sceneBundles.map((bundle) =>
            bundle.id === targetSceneId
                ? { ...bundle, files: { ...bundle.files, [targetFileName]: value } }
                : bundle
        );

        const result = studio.updateSceneFile(targetSceneId, targetFileName, value);
        applySceneRegistryResult(result);
        sceneEditorStatus = result.ok ? 'Live preview updated.' : 'Compile failed. Fix the scene and save again.';
    }

    function selectSceneFile(fileName: string): void {
        activeSceneFileName = fileName;
    }

    function updateUniformValue(key: string, value: number): void {
        studio.updateUniformValue(key, value);
        refreshConfig();
    }

    function updateParamValue(key: string, value: number): void {
        studio.updateParamValue(key, value);
        refreshConfig();
    }

    function updateStepParam(stepIndex: number, key: string, value: number): void {
        studio.updateStepParam(stepIndex, key, value);
        refreshConfig();
        schedulePostprocessAutoUpdate();
    }

    function setStepEnabled(stepIndex: number, enabled: boolean): void {
        studio.setStepEnabled(stepIndex, enabled);
        refreshConfig();
        schedulePostprocessAutoUpdate();
    }

    function resetFieldOverride(scope: 'slicer' | 'uniform' | 'param', key: string): void {
        studio.resetOverride(scope, key);
        refreshConfig();
    }

    function resetStepParamOverride(stepIndex: number, key: string): void {
        studio.resetStepParamOverride(stepIndex, key);
        refreshConfig();
        schedulePostprocessAutoUpdate();
    }

    function resetAllOverrides(): void {
        status.setWorkspaceStatus(studio.resetAllOverrides());
        refreshConfig();
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
        config = result.config;
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
        config = result.config;
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
        refreshConfig();
        if (result.validationMessage) {
            status.setWorkspaceStatus(result.validationMessage);
        }
    }

    function selectPostprocessScript(scriptId: string): void {
        activePostprocessScriptId = scriptId;
        const nextDocument = postprocessDocuments.find((document) => document.id === scriptId);
        postprocessStatus = nextDocument
            ? `Editing postprocess script: ${nextDocument.name}.`
            : 'No postprocess script selected.';
        status.setWorkspaceStatus(postprocessStatus);
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

        const nextDocument = { ...activePostprocessDocument, source: value };
        postprocessDocuments = postprocessDocuments.map((document) =>
            document.id === nextDocument.id ? nextDocument : document
        );
        upsertPostprocessScript(nextDocument);
        studio.refreshConfiguration();
        refreshConfig();
        postprocessStatus = 'Postprocess script updated locally. Save to persist changes.';
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
        hasToolpath = studio.hasToolpathOverlay();
    }

    async function buildFullArtifactWithProgress(
        reportProgress: (update: { percent: number; phaseLabel: string; detail: string }) => void,
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number; warnings: string[] }> {
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
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number; warnings: string[] }> {
        reportProgress({
            percent: 12,
            phaseLabel: 'Postprocess',
            detail: 'Applying updated postprocess pipeline...',
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
                const warningSuffix = artifact.warnings.length > 0
                    ? ` Warning${artifact.warnings.length === 1 ? '' : 's'}: ${artifact.warnings.join(' ')}`
                    : '';
                return `${actionVerb} ${artifact.filename} (${(artifact.bytes / 1024).toFixed(1)} KB, ${artifact.points} points). Use Download to save locally.${warningSuffix}`;
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
            hasToolpath = studio.hasToolpathOverlay();
            return `Benchmark settled on ${summary.measuredRuns} measured run${summary.measuredRuns === 1 ? '' : 's'} after ${summary.warmupRuns} warmup run${summary.warmupRuns === 1 ? '' : 's'}: avg ${summary.averageMs.toFixed(1)} ms, median ${summary.medianMs.toFixed(1)} ms, min ${summary.minMs.toFixed(1)} ms, max ${summary.maxMs.toFixed(1)} ms, spread ${summary.spreadMs.toFixed(1)} ms. Phase avg: sample ${summary.averageContourSamplingMs.toFixed(1)} ms, toolpath ${summary.averageToolpathBuildMs.toFixed(1)} ms, gcode ${summary.averageGcodeBuildMs.toFixed(1)} ms. Last output: ${(summary.bytes / 1024).toFixed(1)} KB, ${summary.points} points, ${summary.layers} layers.`;
        });
    }

    function mergeSceneBundle(target: SceneBundle[], nextBundle: SceneBundle): SceneBundle[] {
        const merged = target.some((bundle) => bundle.id === nextBundle.id)
            ? target.map((bundle) => (bundle.id === nextBundle.id ? nextBundle : bundle))
            : [...target, nextBundle];
        return merged.sort((left, right) => left.id.localeCompare(right.id));
    }

    async function saveActiveSceneFile(): Promise<void> {
        if (!activeSceneBundle || !sceneEditorDirty || sceneEditorSavePending) {
            return;
        }

        if (!workspaceBackend.writable) {
            sceneEditorStatus = 'Connect a project folder or run the dev server to save scene files to disk.';
            status.setWorkspaceStatus(sceneEditorStatus);
            return;
        }

        sceneEditorSavePending = true;
        sceneEditorStatus = `Saving ${activeSceneFileName} to ${workspaceBackend.scenesLabel}/${activeSceneBundle.id}...`;

        try {
            const savedBundle = await workspaceBackend.saveSceneFile(
                activeSceneBundle.id,
                activeSceneFileName,
                activeSceneBundle.files[activeSceneFileName] ?? ''
            );

            sceneBundles = mergeSceneBundle(sceneBundles, savedBundle);
            persistedSceneBundles = mergeSceneBundle(persistedSceneBundles, savedBundle);
            applySceneRegistryResult(studio.syncSceneBundles(sceneBundles));
            sceneEditorStatus = `Saved ${activeSceneFileName} to ${workspaceBackend.scenesLabel}/${savedBundle.id}.`;
            status.setWorkspaceStatus(sceneEditorStatus);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Scene save failed.';
            sceneEditorStatus = message;
            status.setWorkspaceStatus(message);
        } finally {
            sceneEditorSavePending = false;
        }
    }

    function revertActiveSceneFile(): void {
        if (!activeSceneBundle || !persistedActiveSceneBundle) {
            return;
        }

        const persistedSource = persistedActiveSceneBundle.files[activeSceneFileName];
        if (typeof persistedSource !== 'string') {
            return;
        }

        updateSceneFileSource(persistedSource);
        sceneEditorStatus = `Reverted ${activeSceneFileName} to the last saved version.`;
        status.setWorkspaceStatus(sceneEditorStatus);
    }

    async function saveActivePostprocessDocument(): Promise<void> {
        if (!activePostprocessDocument || !postprocessDirty || postprocessSavePending) {
            return;
        }

        if (!workspaceBackend.writable) {
            postprocessStatus = 'Connect a project folder or run the dev server to save postprocess scripts to disk.';
            status.setWorkspaceStatus(postprocessStatus);
            return;
        }

        postprocessSavePending = true;
        postprocessStatus = 'Saving postprocess script to folder...';

        try {
            const savedDocument = await workspaceBackend.savePostprocessDocument(activePostprocessDocument);
            postprocessDocuments = postprocessDocuments
                .map((document) => (document.id === savedDocument.id ? savedDocument : document))
                .sort((left, right) => left.name.localeCompare(right.name));
            persistedPostprocessDocuments = persistedPostprocessDocuments.some((document) => document.id === savedDocument.id)
                ? persistedPostprocessDocuments.map((document) => (document.id === savedDocument.id ? savedDocument : document))
                : [...persistedPostprocessDocuments, savedDocument].sort((left, right) => left.name.localeCompare(right.name));
            upsertPostprocessScript(savedDocument);
            studio.refreshConfiguration();
            refreshConfig();
            postprocessStatus = `Saved ${savedDocument.fileName} to ${workspaceBackend.postprocessLabel}.`;
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
        if (!activePostprocessDocument || !persistedActivePostprocessDocument) {
            return;
        }

        updatePostprocessSource(persistedActivePostprocessDocument.source);
        postprocessStatus = `Reverted ${persistedActivePostprocessDocument.fileName} to the last saved version.`;
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
        upsertPostprocessScript(nextDocument);
        activePostprocessScriptId = nextDocument.id;
        editorDocumentMode = 'postprocess';
        workspace.selectTab('postprocess');
        workspace.setEditorVisible(true);
        postprocessStatus = `Created ${nextDocument.fileName}. Reference it from a scene manifest with usePostprocess('${nextDocument.id}').`;
        status.setWorkspaceStatus(postprocessStatus);

        if (workspaceBackend.writable) {
            await saveActivePostprocessDocument();
        }
    }

    async function createAndActivateScene(): Promise<void> {
        if (typeof window === 'undefined') {
            return;
        }

        const requestedName = window.prompt('Scene name', 'New Scene');
        if (requestedName === null) {
            return;
        }

        const existingIds = new Set(sceneBundles.map((bundle) => bundle.id));
        let nextSceneId = toSceneId(requestedName);
        let suffix = 2;
        while (existingIds.has(nextSceneId)) {
            nextSceneId = `${toSceneId(requestedName)}_${suffix}`;
            suffix += 1;
        }

        const glslSource = buildSceneGlslTemplate(requestedName);
        const manifestSource = buildSceneManifestTemplate(requestedName);

        if (workspaceBackend.writable) {
            try {
                await workspaceBackend.saveSceneFile(nextSceneId, SCENE_GLSL_FILE, glslSource);
                const savedBundle = await workspaceBackend.saveSceneFile(nextSceneId, 'scene.ts', manifestSource);
                sceneBundles = mergeSceneBundle(sceneBundles, savedBundle);
                persistedSceneBundles = mergeSceneBundle(persistedSceneBundles, savedBundle);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Scene creation failed.';
                sceneEditorStatus = message;
                status.setWorkspaceStatus(message);
                return;
            }
        } else {
            const newBundle: SceneBundle = {
                id: nextSceneId,
                name: requestedName.trim() || nextSceneId,
                files: { [SCENE_GLSL_FILE]: glslSource, 'scene.ts': manifestSource },
            };
            sceneBundles = mergeSceneBundle(sceneBundles, newBundle);
        }

        applySceneRegistryResult(studio.syncSceneBundles(sceneBundles));
        editorDocumentMode = 'scene';
        workspace.selectTab('scene');
        workspace.setEditorVisible(true);
        commitScene(nextSceneId);
        activeSceneFileName = SCENE_GLSL_FILE;
        sceneEditorStatus = workspaceBackend.writable
            ? `Created ${workspaceBackend.scenesLabel}/${nextSceneId}/ with scene.glsl and scene.ts.`
            : `Created scene '${nextSceneId}' in memory. Connect a project folder or run the dev server to persist it.`;
        status.setWorkspaceStatus(sceneEditorStatus);
        await resizeViewportAfterLayout();
    }

    async function createSceneFile(): Promise<void> {
        if (typeof window === 'undefined' || !activeSceneBundle) {
            return;
        }

        const suggestion = 'scene.ts' in activeSceneBundle.files ? 'helper.ts' : 'scene.ts';
        const requestedFileName = window.prompt('New scene file name (.glsl, .ts, .js)', suggestion);
        if (requestedFileName === null) {
            return;
        }

        const fileName = requestedFileName.trim();
        if (!/^[a-z0-9][a-z0-9 _.()-]*\.(glsl|ts|js)$/i.test(fileName)) {
            sceneEditorStatus = `Invalid scene file name: ${fileName}`;
            status.setWorkspaceStatus(sceneEditorStatus);
            return;
        }

        if (fileName in activeSceneBundle.files) {
            activeSceneFileName = fileName;
            return;
        }

        const initialSource = fileName === 'scene.ts'
            ? buildSceneManifestTemplate(activeSceneBundle.name)
            : `// ${fileName}\n`;

        const targetSceneId = activeSceneBundle.id;
        sceneBundles = sceneBundles.map((bundle) =>
            bundle.id === targetSceneId
                ? { ...bundle, files: { ...bundle.files, [fileName]: initialSource } }
                : bundle
        );
        applySceneRegistryResult(studio.updateSceneFile(targetSceneId, fileName, initialSource));
        activeSceneFileName = fileName;

        if (workspaceBackend.writable) {
            try {
                const savedBundle = await workspaceBackend.saveSceneFile(targetSceneId, fileName, initialSource);
                sceneBundles = mergeSceneBundle(sceneBundles, savedBundle);
                persistedSceneBundles = mergeSceneBundle(persistedSceneBundles, savedBundle);
                sceneEditorStatus = `Created ${workspaceBackend.scenesLabel}/${targetSceneId}/${fileName}.`;
            } catch (error) {
                sceneEditorStatus = error instanceof Error ? error.message : 'Scene file creation failed.';
            }
        } else {
            sceneEditorStatus = `Created ${fileName} in memory. Connect a project folder or run the dev server to persist it.`;
        }
        status.setWorkspaceStatus(sceneEditorStatus);
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
        updateUniformValue,
        updateParamValue,
        updateStepParam,
        setStepEnabled,
        resetFieldOverride,
        resetStepParamOverride,
        resetAllOverrides,
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
        selectPostprocessScript,
        updatePostprocessAutoUpdate,
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

    function describeWorkspaceStatuses(backend: WorkspaceBackend): { scene: string; postprocess: string } {
        if (backend.kind === 'bundled') {
            const hint = isLocalFolderSupported()
                ? 'connect a project folder or run the dev server to save changes'
                : 'run the dev server to save changes';
            return {
                scene: `Editing bundled scenes in memory; ${hint}.`,
                postprocess: `Editing bundled postprocess scripts in memory; ${hint}.`,
            };
        }

        return {
            scene: `Editing scene folders directly from ${backend.scenesLabel}.`,
            postprocess: `Editing postprocess files directly from ${backend.postprocessLabel}.`,
        };
    }

    async function activateWorkspaceBackend(backend: WorkspaceBackend): Promise<void> {
        workspaceBackend = backend;

        const scenes = await backend.listScenes();
        if (scenes) {
            persistedSceneBundles = scenes;
            sceneBundles = scenes;
            applySceneRegistryResult(studio.syncSceneBundles(scenes));
        }

        const documents = await backend.listPostprocessDocuments();
        if (documents) {
            persistedPostprocessDocuments = documents;
            postprocessDocuments = documents;
            setPostprocessScripts(documents);
            studio.refreshConfiguration();
            refreshConfig();
        }

        const statuses = describeWorkspaceStatuses(backend);
        sceneEditorStatus = statuses.scene;
        postprocessStatus = statuses.postprocess;
        status.setWorkspaceStatus(sceneEditorStatus);
    }

    async function connectWorkspaceFolder(): Promise<void> {
        if (!isLocalFolderSupported()) {
            return;
        }

        try {
            const backend = pendingLocalFolder
                ? await pendingLocalFolder.reconnect()
                : await pickLocalFolderBackend();
            pendingLocalFolder = null;

            if (backend) {
                await activateWorkspaceBackend(backend);
            } else {
                sceneEditorStatus = 'Folder access was not granted; staying on the bundled snapshot.';
                status.setWorkspaceStatus(sceneEditorStatus);
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            sceneEditorStatus = error instanceof Error ? error.message : 'Folder connection failed.';
            status.setWorkspaceStatus(sceneEditorStatus);
        }
    }

    onMount(() => {
        syncWorkspaceLayout();

        const handleWindowResize = () => {
            const previousDockSide = editorDockSide;
            const previousCompactLayout = compactWorkspaceLayout;
            syncWorkspaceLayout();
            if (previousDockSide !== editorDockSide || previousCompactLayout !== compactWorkspaceLayout) {
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

        const refreshWorkspaceScenes = async (): Promise<void> => {
            if (!workspaceBackend.writable || sceneEditorDirty) {
                return;
            }

            const nextBundles = await workspaceBackend.listScenes();
            if (!nextBundles || areSceneBundlesEqual(nextBundles, persistedSceneBundles)) {
                return;
            }

            persistedSceneBundles = nextBundles;
            sceneBundles = nextBundles;
            applySceneRegistryResult(studio.syncSceneBundles(nextBundles));
        };

        const refreshWorkspacePostprocessScripts = async (): Promise<void> => {
            if (!workspaceBackend.writable || postprocessDirty) {
                return;
            }

            const nextDocuments = await workspaceBackend.listPostprocessDocuments();
            if (!nextDocuments || arePostprocessCollectionsEqual(nextDocuments, persistedPostprocessDocuments)) {
                return;
            }

            persistedPostprocessDocuments = nextDocuments;
            postprocessDocuments = nextDocuments;
            setPostprocessScripts(nextDocuments);
            studio.refreshConfiguration();
            refreshConfig();
        };

        void (async () => {
            try {
                let initialBackend = await probeDevServerBackend();
                if (!initialBackend && isLocalFolderSupported()) {
                    const restored = await restoreLocalFolderBackend();
                    if (restored.status === 'connected') {
                        initialBackend = restored.backend;
                    } else if (restored.status === 'needs-permission') {
                        pendingLocalFolder = restored.folder;
                    }
                }
                if (disposed) {
                    return;
                }

                await activateWorkspaceBackend(initialBackend ?? bundledWorkspaceBackend);

                studio.init();
                printerTarget = readPrinterTarget();
                if (!printerTarget.baseUrl.trim()) {
                    await applyPrinterModelConnectionDefaults(config.settings.printerModelId);
                }
                await refreshPrinterAvailability();
                status.setShaderStatus('ready', 'Ready');

                const runtimeSnapshot = readRuntimeSnapshot();
                if (runtimeSnapshot) {
                    restoreRuntimeSnapshot(runtimeSnapshot);
                }
                runtimeSnapshotHydrated = true;
                persistRuntimeSnapshot(captureRuntimeSnapshot());

                // Polling is cheap and self-guarding (the refreshers no-op on
                // read-only backends), so it always runs: a folder connected
                // later starts syncing without extra wiring.
                sceneRepositoryPollHandle = window.setInterval(() => {
                    void refreshWorkspaceScenes();
                }, 1200);
                postprocessRepositoryPollHandle = window.setInterval(() => {
                    void refreshWorkspacePostprocessScripts();
                }, 1200);
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

<div class="app-root" class:inspector-collapsed={$workspace.inspectorCollapsed} class:is-dock-resizing={$workspace.isInspectorResizing} class:is-editor-resizing={$workspace.isEditorResizing} class:editor-visible={$workspace.editorVisible} class:viewer-fullscreen={viewerFullscreen} class:compact-workspace={compactWorkspaceLayout}>
    <TopBar
        {sceneOptions}
        {sceneId}
        {viewMode}
        {printerModels}
        {filamentProfiles}
        printerModelId={config.settings.printerModelId}
        filamentProfileId={config.settings.filamentProfileId}
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
                        documentName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.name ?? null : activeSceneBundle?.name ?? null}
                        documentFileName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.fileName ?? null : activeSceneFileName}
                        source={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.source ?? null : activeSceneSource}
                        helperText={editorDocumentMode === 'postprocess'
                            ? 'Generic toolpath scripts referenced from scene manifests with usePostprocess(id).'
                            : 'scene.glsl defines the surface; scene.ts orchestrates uniforms, slicing, and the postprocess pipeline.'}
                        createLabel={editorDocumentMode === 'postprocess' ? 'New Script' : 'New Scene'}
                        saveLabel={editorDocumentMode === 'postprocess' ? 'Save Script' : 'Save File'}
                        hideLabel="Hide Editor"
                        switchLabel={editorDocumentMode === 'postprocess' ? 'Switch to Scene' : 'Switch to Script'}
                        language={editorDocumentMode === 'postprocess' ? (activePostprocessDocument?.language ?? 'typescript') : sceneEditorLanguage}
                        fileOptions={editorDocumentMode === 'scene'
                            ? sceneFileNames.map((fileName) => ({ value: fileName, label: fileName }))
                            : postprocessDocuments.map((document) => ({ value: document.id, label: document.fileName }))}
                        activeFileOption={editorDocumentMode === 'scene' ? activeSceneFileName : activePostprocessScriptId}
                        onSelectFileOption={editorDocumentMode === 'scene' ? selectSceneFile : selectPostprocessScript}
                        addFileLabel={editorDocumentMode === 'scene' ? 'Add File' : null}
                        onAddFile={createSceneFile}
                        onChangeSource={editorDocumentMode === 'postprocess' ? updatePostprocessSource : updateSceneFileSource}
                        onCreate={editorDocumentMode === 'postprocess' ? createAndActivatePostprocessScript : createAndActivateScene}
                        onSave={editorDocumentMode === 'postprocess' ? saveActivePostprocessDocument : saveActiveSceneFile}
                        onRevert={editorDocumentMode === 'postprocess' ? revertActivePostprocessDocument : revertActiveSceneFile}
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
                {hasToolpath}
                toolpathVisible={$workspace.overlayVisible}
                onToggleToolpath={() => workspace.toggleOverlay()}
            />

            {#if !$workspace.inspectorCollapsed && !compactWorkspaceLayout}
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

        {#if compactWorkspaceLayout && !$workspace.inspectorCollapsed}
            <InspectorPanel activeTab={$workspace.activeTab} state={inspectorState} handlers={inspectorHandlers} onSelectTab={selectTab} />
        {/if}

        {#if $workspace.editorVisible && !editorDockSide}
            <DocumentEditorPanel
                panelLabel={editorDocumentMode === 'postprocess' ? 'Script Editor' : 'Scene Editor'}
                storageLabel={editorDocumentMode === 'postprocess' ? postprocessModeLabel : sceneEditorModeLabel}
                dirty={editorDocumentMode === 'postprocess' ? postprocessDirty : sceneEditorDirty}
                dirtyLabel={editorDocumentMode === 'postprocess' ? 'Unsaved Script' : 'Unsaved Scene'}
                savePending={editorDocumentMode === 'postprocess' ? postprocessSavePending : sceneEditorSavePending}
                statusText={editorDocumentMode === 'postprocess' ? postprocessStatus : sceneEditorStatus}
                documentName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.name ?? null : activeSceneBundle?.name ?? null}
                documentFileName={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.fileName ?? null : activeSceneFileName}
                source={editorDocumentMode === 'postprocess' ? activePostprocessDocument?.source ?? null : activeSceneSource}
                helperText={editorDocumentMode === 'postprocess'
                    ? 'Generic toolpath scripts referenced from scene manifests with usePostprocess(id).'
                    : 'scene.glsl defines the surface; scene.ts orchestrates uniforms, slicing, and the postprocess pipeline.'}
                createLabel={editorDocumentMode === 'postprocess' ? 'New Script' : 'New Scene'}
                saveLabel={editorDocumentMode === 'postprocess' ? 'Save Script' : 'Save File'}
                hideLabel="Hide Editor"
                switchLabel={editorDocumentMode === 'postprocess' ? 'Switch to Scene' : 'Switch to Script'}
                language={editorDocumentMode === 'postprocess' ? (activePostprocessDocument?.language ?? 'typescript') : sceneEditorLanguage}
                fileOptions={editorDocumentMode === 'scene'
                    ? sceneFileNames.map((fileName) => ({ value: fileName, label: fileName }))
                    : postprocessDocuments.map((document) => ({ value: document.id, label: document.fileName }))}
                activeFileOption={editorDocumentMode === 'scene' ? activeSceneFileName : activePostprocessScriptId}
                onSelectFileOption={editorDocumentMode === 'scene' ? selectSceneFile : selectPostprocessScript}
                addFileLabel={editorDocumentMode === 'scene' ? 'Add File' : null}
                onAddFile={createSceneFile}
                onChangeSource={editorDocumentMode === 'postprocess' ? updatePostprocessSource : updateSceneFileSource}
                onCreate={editorDocumentMode === 'postprocess' ? createAndActivatePostprocessScript : createAndActivateScene}
                onSave={editorDocumentMode === 'postprocess' ? saveActivePostprocessDocument : saveActiveSceneFile}
                onRevert={editorDocumentMode === 'postprocess' ? revertActivePostprocessDocument : revertActiveSceneFile}
                onSwitchDocument={switchEditorDocument}
                onClose={toggleEditor}
                onStartResize={startEditorResize}
            />
        {/if}
    </div>

    <StatusStrip
        workspaceStatus={$status.workspaceStatus}
        workspaceActionLabel={workspaceFolderActionLabel}
        onWorkspaceAction={connectWorkspaceFolder}
        outputStatus={$status.outputStatus}
        actionPending={$status.actionPending}
        progressVisible={$status.progressVisible}
        progressPercent={$status.progressPercent}
        progressPhaseLabel={$status.progressPhaseLabel}
        progressDetail={$status.progressDetail}
        shaderStatusDetail={$status.shaderStatusDetail}
    />

</div>
