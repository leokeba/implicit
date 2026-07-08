import { applyFilamentProfile, loadFilamentProfiles, type FilamentProfile } from './core/filament-profiles';
import { applyPrinterModel, loadPrinterModels, type PrinterModel } from './core/printer-models';
import { snapToNearestOptionValue } from './core/control-options';
import {
    resolvePipelineSteps,
    type ResolvedPipelineStep,
} from './core/postprocess-registry';
import Renderer from './core/renderer';
import type { AnimationParams, RaymarchParams, ViewportParams } from './core/renderer';
import { hashString } from './core/script-host';
import {
    getActiveSceneFiles,
    getActiveSceneId,
    getActiveSceneManifest,
    getActiveSceneManifestError,
    getAvailableScenes,
    getSceneBundles,
    getSceneControlDefinitions,
    replaceSceneBundles,
    setActiveSceneById,
    upsertSceneFile,
    type SceneBundle,
    type SceneControlDefinition,
    type SceneOption,
} from './core/shader-pipeline';
import {
    Slicer,
    type VaseBaseToolpath,
    type SliceDebugSnapshot,
    type SliceProgressUpdate,
    type VaseSlicerSettings,
} from './core/slicer';
import type { ScalarControlSpec, SceneManifest } from './scene-runtime';
import { Preview } from './ui';
import { summarizeBenchmarkRuns } from './studio/benchmark-summary';
import { buildSlicerFilename, downloadTextFile } from './studio/file-export';
import { attachRenderLifecycleHandlers, shouldRenderPreview } from './studio/render-lifecycle';
import { convertToolpathToScenePoints } from './studio/toolpath-overlay';

export interface SlicerBenchmarkSummary {
    totalRuns: number;
    measuredRuns: number;
    warmupRuns: number;
    averageMs: number;
    medianMs: number;
    minMs: number;
    maxMs: number;
    spreadMs: number;
    averageContourSamplingMs: number;
    averageToolpathBuildMs: number;
    averageGcodeBuildMs: number;
    points: number;
    layers: number;
    bytes: number;
}

export type ShaderStatusMode = 'ready' | 'compiling' | 'ok' | 'error';

/** Sparse session-only overrides applied on top of the file-derived configuration. */
export interface SceneOverrides {
    slicer: Partial<VaseSlicerSettings>;
    uniforms: Record<string, number>;
    params: Record<string, number>;
    stepParams: Record<number, Record<string, number>>;
    disabledSteps: number[];
    printerId: string | null;
    filamentId: string | null;
}

export interface PipelineStepView {
    index: number;
    name: string;
    scriptId: string | null;
    enabled: boolean;
    controls: ScalarControlSpec[];
    params: Record<string, number>;
    overriddenParamKeys: string[];
    error: string | null;
}

export interface SceneConfigView {
    settings: VaseSlicerSettings;
    uniformControls: SceneControlDefinition[];
    uniformValues: Record<string, number>;
    paramControls: ScalarControlSpec[];
    paramValues: Record<string, number>;
    pipeline: PipelineStepView[];
    overriddenSlicerKeys: string[];
    overriddenUniformKeys: string[];
    overriddenParamKeys: string[];
    overrideCount: number;
    printerOverridden: boolean;
    filamentOverridden: boolean;
    manifestError: string | null;
    preprocessError: string | null;
}

export interface StudioSnapshot {
    viewMode: number;
    sceneId: string;
    sceneOptions: SceneOption[];
    raymarchParams: RaymarchParams;
    viewportParams: ViewportParams;
    animationParams: AnimationParams;
    printerModels: PrinterModel[];
    filamentProfiles: FilamentProfile[];
    config: SceneConfigView;
}

export interface SceneChangeResult {
    ok: boolean;
    sceneId: string;
    config: SceneConfigView;
    shaderMessage: string;
    workspaceStatus: string;
}

export interface SlicerSettingsUpdateResult {
    settings: VaseSlicerSettings;
    validationMessage: string | null;
}

export interface SceneRegistrySyncResult {
    ok: boolean;
    sceneId: string;
    sceneOptions: SceneOption[];
    config: SceneConfigView;
    shaderMessage: string;
}

export interface PresetChangeResult {
    config: SceneConfigView;
    workspaceStatus: string;
}

const MAX_SHADER_ERROR_CHARS = 6000;

export function normalizeShaderStatusMessage(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) {
        return 'Unknown shader error';
    }

    if (trimmed.length <= MAX_SHADER_ERROR_CHARS) {
        return trimmed;
    }

    return `${trimmed.slice(0, MAX_SHADER_ERROR_CHARS)}\n\n...truncated`;
}

export function compactShaderStatusMessage(message: string): string {
    const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || 'Shader status changed';
    const maxInlineLen = 88;
    if (firstLine.length <= maxInlineLen) {
        return firstLine;
    }

    return `${firstLine.slice(0, maxInlineLen - 1)}...`;
}

function emptyOverrides(): SceneOverrides {
    return {
        slicer: {},
        uniforms: {},
        params: {},
        stepParams: {},
        disabledSteps: [],
        printerId: null,
        filamentId: null,
    };
}

export class StudioController {
    private renderer: Renderer;
    private slicer: Slicer;
    private preview: Preview;
    private printerModels: PrinterModel[];
    private filamentProfiles: FilamentProfile[];
    private sceneOptions: SceneOption[];
    private isSlicing: boolean;
    private renderFrameHandle: number | null;
    private initialized: boolean;
    private renderLifecycleCleanup: (() => void) | null;
    private cachedBaseToolpath: { cacheKey: string; baseToolpath: VaseBaseToolpath } | null;

    /** Session overrides for the active scene, keyed per scene by the App snapshot. */
    private overrides: SceneOverrides;

    // Resolved (file-derived + overrides) state for the active scene.
    private resolvedSettings: VaseSlicerSettings;
    private resolvedUniformValues: Record<string, number>;
    private resolvedParamValues: Record<string, number>;
    private resolvedPipeline: ResolvedPipelineStep[];
    private preprocessError: string | null;

    constructor() {
        this.renderer = new Renderer();
        this.slicer = new Slicer();
        this.preview = new Preview();
        this.printerModels = loadPrinterModels();
        this.filamentProfiles = loadFilamentProfiles();
        this.sceneOptions = getAvailableScenes();
        this.isSlicing = false;
        this.renderFrameHandle = null;
        this.initialized = false;
        this.renderLifecycleCleanup = null;
        this.cachedBaseToolpath = null;
        this.overrides = emptyOverrides();
        this.resolvedSettings = this.slicer.getDefaultVaseSettings();
        this.resolvedUniformValues = {};
        this.resolvedParamValues = {};
        this.resolvedPipeline = [];
        this.preprocessError = null;

        this.resolveConfiguration();
    }

    public init(): void {
        if (this.initialized) {
            return;
        }

        this.preview.init();
        this.renderer.init(this.preview.getCanvas());
        this.resolveConfiguration();
        this.renderLifecycleCleanup = attachRenderLifecycleHandlers(() => this.updatePreviewRenderState());
        this.updatePreviewRenderState();
        this.initialized = true;
    }

    public getSnapshot(): StudioSnapshot {
        return {
            viewMode: this.renderer.getViewMode(),
            sceneId: getActiveSceneId(),
            sceneOptions: [...this.sceneOptions],
            raymarchParams: this.renderer.getRaymarchParams(),
            viewportParams: this.renderer.getViewportParams(),
            animationParams: this.renderer.getAnimationParams(),
            printerModels: [...this.printerModels],
            filamentProfiles: [...this.filamentProfiles],
            config: this.getConfigView(),
        };
    }

    public getConfigView(): SceneConfigView {
        return {
            settings: { ...this.resolvedSettings },
            uniformControls: getSceneControlDefinitions(),
            uniformValues: { ...this.resolvedUniformValues },
            paramControls: getActiveSceneManifest().params.map((spec) => ({ ...spec })),
            paramValues: { ...this.resolvedParamValues },
            pipeline: this.resolvedPipeline.map((step) => ({
                index: step.index,
                name: step.name,
                scriptId: step.scriptId,
                enabled: step.enabled,
                controls: step.controls.map((control) => ({ ...control })),
                params: { ...step.params },
                overriddenParamKeys: [...step.overriddenParamKeys],
                error: step.error,
            })),
            overriddenSlicerKeys: Object.keys(this.overrides.slicer),
            overriddenUniformKeys: Object.keys(this.overrides.uniforms),
            overriddenParamKeys: Object.keys(this.overrides.params),
            overrideCount: this.countOverrides(),
            printerOverridden: this.overrides.printerId !== null,
            filamentOverridden: this.overrides.filamentId !== null,
            manifestError: getActiveSceneManifestError(),
            preprocessError: this.preprocessError,
        };
    }

    public getSceneLabel(sceneId: string): string {
        return this.sceneOptions.find((scene) => scene.id === sceneId)?.name ?? sceneId;
    }

    public getSceneBundles(): SceneBundle[] {
        return getSceneBundles();
    }

    public getViewModeLabel(viewMode: number): string {
        if (viewMode === 1) {
            return 'RGB Normals';
        }

        if (viewMode === 2) {
            return 'Glass';
        }

        if (viewMode === 3) {
            return 'Modifier Values';
        }

        return 'Shaded';
    }

    public setViewMode(viewMode: number): string {
        this.renderer.setViewMode(viewMode);
        return `Viewport mode: ${this.getViewModeLabel(viewMode)}.`;
    }

    /** Exports the active scene's session overrides for snapshot persistence. */
    public exportOverrides(): SceneOverrides {
        return {
            slicer: { ...this.overrides.slicer },
            uniforms: { ...this.overrides.uniforms },
            params: { ...this.overrides.params },
            stepParams: Object.fromEntries(
                Object.entries(this.overrides.stepParams).map(([index, values]) => [index, { ...values }])
            ),
            disabledSteps: [...this.overrides.disabledSteps],
            printerId: this.overrides.printerId,
            filamentId: this.overrides.filamentId,
        };
    }

    public restoreOverrides(overrides: Partial<SceneOverrides> | null | undefined): void {
        const base = emptyOverrides();
        this.overrides = {
            slicer: { ...base.slicer, ...(overrides?.slicer ?? {}) },
            uniforms: { ...base.uniforms, ...(overrides?.uniforms ?? {}) },
            params: { ...base.params, ...(overrides?.params ?? {}) },
            stepParams: { ...(overrides?.stepParams ?? {}) },
            disabledSteps: Array.isArray(overrides?.disabledSteps) ? [...overrides.disabledSteps] : [],
            printerId: overrides?.printerId ?? null,
            filamentId: overrides?.filamentId ?? null,
        };
        this.resolveConfiguration();
    }

    public changeScene(sceneId: string, overrides?: Partial<SceneOverrides> | null): SceneChangeResult {
        const previousSceneId = getActiveSceneId();
        if (sceneId === previousSceneId) {
            return {
                ok: true,
                sceneId,
                config: this.getConfigView(),
                shaderMessage: 'Ready',
                workspaceStatus: `Scene already loaded: ${this.getSceneLabel(sceneId)}.`,
            };
        }

        if (!setActiveSceneById(sceneId)) {
            return {
                ok: false,
                sceneId: previousSceneId,
                config: this.getConfigView(),
                shaderMessage: `Scene '${sceneId}' was not found.`,
                workspaceStatus: `Scene load failed: ${sceneId}.`,
            };
        }

        const result = this.renderer.hotReloadShaders({});
        if (!result.ok && result.message !== 'Renderer not initialized') {
            setActiveSceneById(previousSceneId);
            this.renderer.hotReloadShaders({});
            return {
                ok: false,
                sceneId: previousSceneId,
                config: this.getConfigView(),
                shaderMessage: result.message,
                workspaceStatus: `Scene load failed: ${this.getSceneLabel(sceneId)}.`,
            };
        }

        this.overrides = { ...emptyOverrides(), ...(overrides ?? {}) } as SceneOverrides;
        this.cachedBaseToolpath = null;
        this.resolveConfiguration();
        return {
            ok: true,
            sceneId,
            config: this.getConfigView(),
            shaderMessage: `Loaded scene: ${sceneId}`,
            workspaceStatus: `Scene loaded: ${this.getSceneLabel(sceneId)}.`,
        };
    }

    public syncSceneBundles(bundles: SceneBundle[]): SceneRegistrySyncResult {
        replaceSceneBundles(bundles);
        this.sceneOptions = getAvailableScenes();
        this.resolveConfiguration();

        const result = this.reloadRendererShaders();
        return {
            ok: result.ok,
            sceneId: getActiveSceneId(),
            sceneOptions: [...this.sceneOptions],
            config: this.getConfigView(),
            shaderMessage: result.message,
        };
    }

    public updateSceneFile(sceneId: string, fileName: string, source: string): SceneRegistrySyncResult & { bundle: SceneBundle } {
        const bundle = upsertSceneFile(sceneId, fileName, source);
        this.sceneOptions = getAvailableScenes();

        let result = { ok: true, message: 'Scene file updated.' };
        if (bundle.id === getActiveSceneId()) {
            this.resolveConfiguration();
            result = this.reloadRendererShaders();
        }

        return {
            ok: result.ok,
            sceneId: getActiveSceneId(),
            sceneOptions: [...this.sceneOptions],
            config: this.getConfigView(),
            shaderMessage: result.message,
            bundle,
        };
    }

    public updateRaymarchParams(next: Partial<RaymarchParams>): void {
        this.renderer.updateRaymarchParams(next);
    }

    public updateViewportParams(next: Partial<ViewportParams>): void {
        this.renderer.updateViewportParams(next);
    }

    public updateAnimationParams(next: Partial<AnimationParams>): void {
        this.renderer.updateAnimationParams(next);
    }

    public updateSlicerParams(next: Partial<VaseSlicerSettings>): SlicerSettingsUpdateResult {
        this.overrides.slicer = { ...this.overrides.slicer, ...next };
        const requestedSettings = { ...this.resolvedSettings, ...next };
        this.resolveConfiguration();
        return {
            settings: { ...this.resolvedSettings },
            validationMessage: buildSlicerSettingsValidationMessage(requestedSettings, this.resolvedSettings),
        };
    }

    public updateUniformValue(key: string, value: number): void {
        this.overrides.uniforms = { ...this.overrides.uniforms, [key]: value };
        this.resolveConfiguration();
    }

    public updateParamValue(key: string, value: number): void {
        this.overrides.params = { ...this.overrides.params, [key]: value };
        this.resolveConfiguration();
    }

    public updateStepParam(stepIndex: number, key: string, value: number): void {
        this.overrides.stepParams = {
            ...this.overrides.stepParams,
            [stepIndex]: { ...(this.overrides.stepParams[stepIndex] ?? {}), [key]: value },
        };
        this.resolveConfiguration();
    }

    public setStepEnabled(stepIndex: number, enabled: boolean): void {
        const disabled = new Set(this.overrides.disabledSteps);
        if (enabled) {
            disabled.delete(stepIndex);
        } else {
            disabled.add(stepIndex);
        }
        this.overrides.disabledSteps = [...disabled];
        this.resolveConfiguration();
    }

    public changePrinterModel(printerModelId: string): PresetChangeResult {
        const nextModel = this.printerModels.find((model) => model.id === printerModelId);
        if (!nextModel) {
            return {
                config: this.getConfigView(),
                workspaceStatus: `Printer preset not found: ${printerModelId}.`,
            };
        }

        this.overrides.printerId = printerModelId;
        this.resolveConfiguration();
        return {
            config: this.getConfigView(),
            workspaceStatus: `Printer preset loaded: ${nextModel.name}.`,
        };
    }

    public changeFilamentProfile(filamentProfileId: string): PresetChangeResult {
        const nextProfile = this.filamentProfiles.find((profile) => profile.id === filamentProfileId);
        if (!nextProfile) {
            return {
                config: this.getConfigView(),
                workspaceStatus: `Material preset not found: ${filamentProfileId}.`,
            };
        }

        this.overrides.filamentId = filamentProfileId;
        this.resolveConfiguration();
        return {
            config: this.getConfigView(),
            workspaceStatus: `Material preset loaded: ${nextProfile.name}.`,
        };
    }

    public resetOverride(scope: 'slicer' | 'uniform' | 'param', key: string): void {
        if (scope === 'slicer') {
            const { [key as keyof VaseSlicerSettings]: _removed, ...rest } = this.overrides.slicer;
            this.overrides.slicer = rest;
        } else if (scope === 'uniform') {
            const { [key]: _removed, ...rest } = this.overrides.uniforms;
            this.overrides.uniforms = rest;
        } else {
            const { [key]: _removed, ...rest } = this.overrides.params;
            this.overrides.params = rest;
        }
        this.resolveConfiguration();
    }

    public resetStepParamOverride(stepIndex: number, key: string): void {
        const stepOverrides = { ...(this.overrides.stepParams[stepIndex] ?? {}) };
        delete stepOverrides[key];
        this.overrides.stepParams = { ...this.overrides.stepParams, [stepIndex]: stepOverrides };
        this.resolveConfiguration();
    }

    public resetAllOverrides(): string {
        this.overrides = emptyOverrides();
        this.resolveConfiguration();
        return 'All session overrides reset to scene-defined values.';
    }

    public resetView(): string {
        this.renderer.resetCameraView();
        return 'Viewport reset to default orbit.';
    }

    /** Re-runs the resolution ladder, e.g. after the postprocess registry changed. */
    public refreshConfiguration(): void {
        this.resolveConfiguration();
    }

    public setToolpathOverlayVisible(visible: boolean): void {
        this.preview.setOverlayVisible(visible);
    }

    public getLastSliceDebugSnapshot(): SliceDebugSnapshot | null {
        return this.slicer.getLastSliceDebugSnapshot();
    }

    public async generateVaseGcode(
        onProgress?: (update: SliceProgressUpdate) => void
    ): Promise<{ filename: string; bytes: number; points: number }> {
        const artifact = await this.buildVaseGcodeArtifact('__adhoc__', onProgress);
        downloadTextFile(artifact.filename, artifact.gcode);
        return {
            filename: artifact.filename,
            bytes: artifact.bytes,
            points: artifact.points,
        };
    }

    public async buildVaseGcodeArtifact(
        cacheKey: string,
        onProgress?: (update: SliceProgressUpdate) => void
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number; warnings: string[] }> {
        return this.runWhilePreviewPausedAsync(async () => {
            const baseResult = await this.slicer.generateVaseBaseToolpathWithProgress(this.resolvedSettings, onProgress);
            this.cachedBaseToolpath = {
                cacheKey,
                baseToolpath: {
                    ...baseResult.baseToolpath,
                    points: baseResult.baseToolpath.points.map((point) => ({ ...point })),
                },
            };
            return this.finishArtifactFromBase(baseResult.baseToolpath);
        });
    }

    public async buildVaseGcodeArtifactFromCachedBase(
        cacheKey: string,
    ): Promise<{ filename: string; gcode: string; bytes: number; points: number; warnings: string[] }> {
        return this.runWhilePreviewPausedAsync(async () => {
            if (!this.cachedBaseToolpath || this.cachedBaseToolpath.cacheKey !== cacheKey) {
                throw new Error('No cached slice is available. Generate toolpath first.');
            }

            const baseToolpath = {
                ...this.cachedBaseToolpath.baseToolpath,
                points: this.cachedBaseToolpath.baseToolpath.points.map((point) => ({ ...point })),
            };
            return this.finishArtifactFromBase(baseToolpath);
        });
    }

    public benchmarkVaseGcode(iterations: number, warmupRuns: number): SlicerBenchmarkSummary {
        return this.runWhilePreviewPaused(() => {
            const benchmark = this.slicer.benchmarkVaseGcode(
                this.resolvedSettings,
                iterations,
                warmupRuns,
                this.getEnabledPipelineSteps(),
            );
            this.preview.setToolpathOverlayWorldPoints(
                convertToolpathToScenePoints(benchmark.lastResult.toolpath.points, benchmark.settings)
            );
            return summarizeBenchmarkRuns(benchmark.runs, benchmark.warmupRuns, benchmark.measuredRuns);
        });
    }

    public resizeViewport(): void {
        this.renderer.resize();
    }

    /**
     * Resolution ladder, lowest to highest precedence:
     * slicer defaults -> printer/filament presets -> manifest slicer block ->
     * manifest preprocess() -> session overrides.
     */
    private resolveConfiguration(): void {
        const manifest = getActiveSceneManifest();

        // Settings base: defaults + presets + manifest static block.
        let settings = this.slicer.getDefaultVaseSettings();
        const printer = this.resolvePrinterModel(manifest);
        if (printer) {
            settings = applyPrinterModel(settings, printer);
        }
        const filament = this.resolveFilamentProfile(manifest);
        if (filament) {
            settings = applyFilamentProfile(settings, filament);
        }
        settings = { ...settings, ...manifest.slicer };

        // Param and uniform bases from manifest defaults + overrides.
        const paramValues = this.resolveScalarValues(manifest.params, this.overrides.params);
        const uniformDefaults = this.resolveScalarValues(manifest.uniforms, this.overrides.uniforms);

        // Preprocess: sees override-adjusted inputs, loses to explicit overrides.
        this.preprocessError = null;
        let preprocessSlicer: Partial<VaseSlicerSettings> = {};
        let preprocessUniforms: Record<string, number> = {};
        if (manifest.preprocess) {
            try {
                const output = manifest.preprocess({
                    params: { ...paramValues },
                    uniforms: { ...uniformDefaults },
                    slicer: { ...settings, ...this.overrides.slicer },
                }) ?? {};
                preprocessSlicer = output.slicer ?? {};
                preprocessUniforms = output.uniforms ?? {};
            } catch (error) {
                this.preprocessError = error instanceof Error ? error.message : String(error);
            }
        }

        this.resolvedSettings = this.slicer.normalizeVaseSettings({
            ...settings,
            ...preprocessSlicer,
            ...this.overrides.slicer,
        });
        if (this.resolvedSettings.maxY <= this.resolvedSettings.minY) {
            this.resolvedSettings.maxY = this.resolvedSettings.minY + Math.max(0.001, this.resolvedSettings.layerHeight);
        }

        this.resolvedUniformValues = {
            ...uniformDefaults,
            ...preprocessUniforms,
            ...this.overrides.uniforms,
        };
        this.resolvedParamValues = paramValues;

        this.resolvedPipeline = resolvePipelineSteps({
            manifest,
            sceneId: getActiveSceneId(),
            sceneFiles: getActiveSceneFiles(),
            sceneParams: { ...paramValues },
            stepParamOverrides: this.overrides.stepParams,
            disabledSteps: new Set(this.overrides.disabledSteps),
        });

        this.pushSceneStateToEngines();
    }

    private resolveScalarValues(specs: ScalarControlSpec[], overrides: Record<string, number>): Record<string, number> {
        const values: Record<string, number> = {};
        for (const spec of specs) {
            const override = overrides[spec.key];
            values[spec.key] = typeof override === 'number' && Number.isFinite(override)
                ? clampScalarValue(override, spec)
                : spec.defaultValue;
        }

        return values;
    }

    private resolvePrinterModel(manifest: SceneManifest): PrinterModel | null {
        const targetId = this.overrides.printerId ?? manifest.printer;
        if (targetId) {
            const match = this.printerModels.find((model) => model.id === targetId);
            if (match) {
                return match;
            }
        }

        return this.printerModels[0] ?? null;
    }

    private resolveFilamentProfile(manifest: SceneManifest): FilamentProfile | null {
        const targetId = this.overrides.filamentId ?? manifest.filament;
        if (targetId) {
            const match = this.filamentProfiles.find((profile) => profile.id === targetId);
            if (match) {
                return match;
            }
        }

        return this.filamentProfiles[0] ?? null;
    }

    private pushSceneStateToEngines(): void {
        const controlDefinitions = getSceneControlDefinitions();
        this.renderer.setSceneControlState(controlDefinitions, this.resolvedUniformValues);
        this.slicer.setSceneControlState(controlDefinitions, this.resolvedUniformValues);
        this.renderer.setSceneSlicerUniformState({
            minY: this.resolvedSettings.minY,
            maxY: this.resolvedSettings.maxY,
            modelScale: this.resolvedSettings.modelScale,
            maxRadius: this.resolvedSettings.maxRadius,
            nozzleDiameter: this.resolvedSettings.nozzleDiameter,
            flowRate: this.resolvedSettings.flowRate,
            layerHeight: this.resolvedSettings.layerHeight,
            lineWidth: this.resolvedSettings.lineWidth,
            firstLayerLineWidth: this.resolvedSettings.firstLayerLineWidth,
        });
    }

    private getEnabledPipelineSteps(): ResolvedPipelineStep[] {
        return this.resolvedPipeline.filter((step) => step.enabled && !step.error);
    }

    private finishArtifactFromBase(baseToolpath: VaseBaseToolpath): { filename: string; gcode: string; bytes: number; points: number; warnings: string[] } {
        const result = this.slicer.generateVaseGcodeFromBaseToolpath(
            baseToolpath,
            this.resolvedSettings,
            this.getEnabledPipelineSteps(),
            this.buildReproducibilityHeader(),
        );
        this.preview.setToolpathOverlayWorldPoints(
            convertToolpathToScenePoints(result.toolpath.points, this.resolvedSettings)
        );
        const filename = buildSlicerFilename(
            this.resolvedSettings,
            getActiveSceneManifest(),
            { ...this.resolvedParamValues, ...this.resolvedUniformValues },
            this.getEnabledPipelineSteps().map((step) => step.scriptId ?? step.name),
        );
        return {
            filename,
            gcode: result.gcode,
            bytes: result.gcode.length,
            points: result.toolpath.points.length,
            warnings: result.warnings,
        };
    }

    /** Header lines that make the exported file traceable back to its sources. */
    private buildReproducibilityHeader(): string[] {
        const sceneId = getActiveSceneId();
        const files = getActiveSceneFiles();
        const lines: string[] = [
            'IMPLICIT_BLOCK_START',
            `implicit_scene = ${sceneId}`,
        ];

        for (const fileName of Object.keys(files).sort()) {
            lines.push(`implicit_file = ${sceneId}/${fileName} fnv1a:${hashString(files[fileName] ?? '')}`);
        }

        for (const step of this.getEnabledPipelineSteps()) {
            const paramText = Object.entries(step.params)
                .map(([key, value]) => `${key}=${formatHeaderNumber(value)}`)
                .join(' ');
            lines.push(`implicit_postprocess = ${step.scriptId ?? step.name}${paramText ? ` ${paramText}` : ''}`);
        }

        const overrideLines = this.describeOverrides();
        if (overrideLines.length === 0) {
            lines.push('implicit_overrides = none');
        } else {
            for (const overrideLine of overrideLines) {
                lines.push(`implicit_override = ${overrideLine}`);
            }
        }

        lines.push(`implicit_settings = ${JSON.stringify(this.resolvedSettings)}`);
        lines.push(`implicit_uniforms = ${JSON.stringify(this.resolvedUniformValues)}`);
        lines.push(`implicit_params = ${JSON.stringify(this.resolvedParamValues)}`);
        lines.push('IMPLICIT_BLOCK_END');
        return lines;
    }

    private describeOverrides(): string[] {
        const entries: string[] = [];
        for (const [key, value] of Object.entries(this.overrides.slicer)) {
            entries.push(`slicer.${key} = ${String(value)}`);
        }
        for (const [key, value] of Object.entries(this.overrides.uniforms)) {
            entries.push(`uniform.${key} = ${formatHeaderNumber(value)}`);
        }
        for (const [key, value] of Object.entries(this.overrides.params)) {
            entries.push(`param.${key} = ${formatHeaderNumber(value)}`);
        }
        for (const [stepIndex, values] of Object.entries(this.overrides.stepParams)) {
            for (const [key, value] of Object.entries(values)) {
                entries.push(`step[${stepIndex}].${key} = ${formatHeaderNumber(value)}`);
            }
        }
        for (const stepIndex of this.overrides.disabledSteps) {
            entries.push(`step[${stepIndex}] disabled`);
        }
        if (this.overrides.printerId) {
            entries.push(`printer = ${this.overrides.printerId}`);
        }
        if (this.overrides.filamentId) {
            entries.push(`filament = ${this.overrides.filamentId}`);
        }

        return entries;
    }

    private countOverrides(): number {
        return this.describeOverrides().length;
    }

    private startRenderingLoop(): void {
        if (this.renderFrameHandle !== null) {
            return;
        }

        const render = (nowMs: number) => {
            if (!shouldRenderPreview(this.isSlicing)) {
                this.renderFrameHandle = null;
                return;
            }

            this.renderFrameHandle = requestAnimationFrame(render);
            if (this.renderer.render(nowMs)) {
                this.preview.renderOverlayInScene(this.renderer.getCameraState());
            }
        };
        this.renderFrameHandle = requestAnimationFrame(render);
    }

    private stopRenderingLoop(): void {
        if (this.renderFrameHandle === null) {
            return;
        }

        cancelAnimationFrame(this.renderFrameHandle);
        this.renderFrameHandle = null;
    }

    private updatePreviewRenderState(): void {
        const shouldRender = shouldRenderPreview(this.isSlicing);
        this.renderer.setPaused(!shouldRender);
        this.preview.setRenderingActive(shouldRender);
        if (shouldRender) {
            this.startRenderingLoop();
            return;
        }

        this.stopRenderingLoop();
    }

    private runWhilePreviewPaused<T>(action: () => T): T {
        this.isSlicing = true;
        this.updatePreviewRenderState();
        try {
            return action();
        } finally {
            this.isSlicing = false;
            this.updatePreviewRenderState();
        }
    }

    private async runWhilePreviewPausedAsync<T>(action: () => Promise<T>): Promise<T> {
        this.isSlicing = true;
        this.updatePreviewRenderState();
        try {
            return await action();
        } finally {
            this.isSlicing = false;
            this.updatePreviewRenderState();
        }
    }

    private reloadRendererShaders(): { ok: boolean; message: string } {
        const result = this.renderer.hotReloadShaders({});
        if (!result.ok && result.message !== 'Renderer not initialized') {
            return result;
        }

        return {
            ok: true,
            message: result.ok ? result.message : 'Ready',
        };
    }
}

function buildSlicerSettingsValidationMessage(
    requested: Partial<VaseSlicerSettings>,
    actual: VaseSlicerSettings,
): string | null {
    const requestedMaxRadius = requested.maxRadius;
    if (typeof requestedMaxRadius !== 'number' || !Number.isFinite(requestedMaxRadius)) {
        return null;
    }

    if (Math.abs(requestedMaxRadius - actual.maxRadius) <= 1e-9) {
        return null;
    }

    if (requestedMaxRadius > actual.maxRadius) {
        return `Slice half-extent is limited to ${actual.maxRadius.toFixed(1)} SDF units in the current slicer. Requested ${requestedMaxRadius.toFixed(2)}; using ${actual.maxRadius.toFixed(2)}.`;
    }

    return `Slice half-extent must be at least ${actual.maxRadius.toFixed(1)} SDF units. Requested ${requestedMaxRadius.toFixed(2)}; using ${actual.maxRadius.toFixed(2)}.`;
}

function clampScalarValue(value: number, spec: ScalarControlSpec): number {
    if (spec.options && spec.options.length > 0) {
        return snapToNearestOptionValue(value, spec.options);
    }

    if (!spec.hasControl) {
        return value;
    }

    return Math.min(spec.max, Math.max(spec.min, value));
}

function formatHeaderNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
