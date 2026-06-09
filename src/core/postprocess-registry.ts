import * as sceneRuntime from '../scene-runtime';
import { normalizeControls } from '../scene-runtime';
import type {
    PostprocessTransform,
    ScalarControlSpec,
    SceneManifest,
} from '../scene-runtime';
import { snapToNearestOptionValue } from './control-options';
import { evaluateSceneScriptModule } from './scene-manifest';
import { evaluateUserModule, hashString } from './script-host';
import type { SceneFiles } from './shader-pipeline';

export type PostprocessScriptLanguage = 'javascript' | 'typescript';

export interface PostprocessScriptDocument {
    id: string;
    name: string;
    fileName: string;
    language: PostprocessScriptLanguage;
    source: string;
}

export interface ResolvedPipelineStep {
    index: number;
    /** Display name: script name or inline step name. */
    name: string;
    /** Generic script id or './module' path; null for inline transforms. */
    scriptId: string | null;
    transform: PostprocessTransform | null;
    controls: ScalarControlSpec[];
    /** Effective parameter values: control defaults <- manifest pins <- session overrides. */
    params: Record<string, number>;
    /** Keys of params overridden in the session (not matching the file-derived value). */
    overriddenParamKeys: string[];
    enabled: boolean;
    error: string | null;
}

const bundledScriptModules = import.meta.glob('../postprocess-scripts/*.{js,ts}', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

const scriptRegistry = new Map<string, PostprocessScriptDocument>(
    Object.entries(bundledScriptModules).map(([modulePath, source]) => {
        const fileName = modulePath.split('/').pop() ?? 'postprocess.ts';
        const document = buildScriptDocument(fileName, typeof source === 'string' ? source : '');
        return [document.id, document];
    })
);

export function listPostprocessScripts(): PostprocessScriptDocument[] {
    return Array.from(scriptRegistry.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function getPostprocessScript(scriptId: string): PostprocessScriptDocument | null {
    return scriptRegistry.get(scriptId) ?? null;
}

/** Replaces the registry contents, e.g. after a filesystem sync. */
export function setPostprocessScripts(documents: PostprocessScriptDocument[]): void {
    scriptRegistry.clear();
    for (const document of documents) {
        scriptRegistry.set(document.id, { ...document });
    }
}

export function upsertPostprocessScript(document: PostprocessScriptDocument): void {
    scriptRegistry.set(document.id, { ...document });
}

export function buildScriptDocument(fileName: string, source: string): PostprocessScriptDocument {
    const id = fileName.replace(/\.(js|ts)$/i, '');
    return {
        id,
        name: toScriptLabel(id),
        fileName,
        language: fileName.toLowerCase().endsWith('.js') ? 'javascript' : 'typescript',
        source,
    };
}

export interface ResolvePipelineOptions {
    manifest: SceneManifest;
    sceneId: string;
    sceneFiles: SceneFiles;
    /** Scene param values; inline transforms receive these as context.params. */
    sceneParams: Record<string, number>;
    stepParamOverrides: Record<number, Record<string, number>>;
    disabledSteps: ReadonlySet<number>;
}

export function resolvePipelineSteps(options: ResolvePipelineOptions): ResolvedPipelineStep[] {
    return options.manifest.postprocess.map((step, index) => {
        const enabled = !options.disabledSteps.has(index);
        const overrides = options.stepParamOverrides[index] ?? {};

        if (step.kind === 'inline') {
            return {
                index,
                name: step.name,
                scriptId: null,
                transform: step.transform,
                controls: [],
                params: { ...options.sceneParams },
                overriddenParamKeys: [],
                enabled,
                error: null,
            };
        }

        try {
            const resolved = resolveScriptStep(step.script, options.sceneId, options.sceneFiles);
            const pinned: Record<string, number> = {};
            for (const control of resolved.controls) {
                pinned[control.key] = control.defaultValue;
            }
            for (const [key, value] of Object.entries(step.params)) {
                pinned[key] = clampToControl(resolved.controls, key, value);
            }

            const params = { ...pinned };
            const overriddenParamKeys: string[] = [];
            for (const [key, value] of Object.entries(overrides)) {
                const clamped = clampToControl(resolved.controls, key, value);
                if (clamped !== pinned[key]) {
                    params[key] = clamped;
                    overriddenParamKeys.push(key);
                }
            }

            return {
                index,
                name: resolved.name,
                scriptId: step.script,
                transform: resolved.transform,
                controls: resolved.controls,
                params,
                overriddenParamKeys,
                enabled,
                error: null,
            };
        } catch (error) {
            return {
                index,
                name: step.script,
                scriptId: step.script,
                transform: null,
                controls: [],
                params: { ...step.params },
                overriddenParamKeys: [],
                enabled: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });
}

interface ResolvedScript {
    name: string;
    transform: PostprocessTransform;
    controls: ScalarControlSpec[];
}

function resolveScriptStep(script: string, sceneId: string, sceneFiles: SceneFiles): ResolvedScript {
    const exports = script.startsWith('./')
        ? evaluateSceneScriptModule(sceneId, script, sceneFiles)
        : evaluateRegistryScript(script);

    const transform = exports.transform;
    if (typeof transform !== 'function') {
        throw new Error(`Postprocess script '${script}' must export a transform(context) function.`);
    }

    const controls = normalizeControlsExport(script, exports.controls);
    const name = script.startsWith('./')
        ? script.slice(2).replace(/\.(js|ts)$/i, '')
        : getPostprocessScript(script)?.name ?? script;

    return {
        name,
        transform: transform as PostprocessTransform,
        controls,
    };
}

function evaluateRegistryScript(scriptId: string): Record<string, unknown> {
    const document = getPostprocessScript(scriptId);
    if (!document) {
        const available = listPostprocessScripts().map((script) => script.id).join(', ');
        throw new Error(`Unknown postprocess script '${scriptId}'. Available: ${available || 'none'}.`);
    }

    return evaluateUserModule({
        source: document.source,
        fileName: document.fileName,
        cacheKey: `postprocess-script:${document.id}:${hashString(document.source)}`,
        require: (specifier) => {
            if (specifier === 'implicit/scene') {
                return sceneRuntime;
            }

            throw new Error(`Postprocess script '${scriptId}' cannot import '${specifier}'; only 'implicit/scene' is available.`);
        },
    });
}

function normalizeControlsExport(script: string, rawControls: unknown): ScalarControlSpec[] {
    if (rawControls === undefined || rawControls === null) {
        return [];
    }

    if (typeof rawControls !== 'object' || Array.isArray(rawControls)) {
        throw new Error(`Postprocess script '${script}' exports invalid controls; expected a record of control specs.`);
    }

    return normalizeControls(rawControls as Record<string, sceneRuntime.ScalarSpecInput>);
}

function clampToControl(controls: ScalarControlSpec[], key: string, value: number): number {
    const control = controls.find((candidate) => candidate.key === key);
    if (!control || !Number.isFinite(value)) {
        return Number.isFinite(value) ? value : 0;
    }

    if (control.options && control.options.length > 0) {
        return snapToNearestOptionValue(value, control.options);
    }

    return Math.min(control.max, Math.max(control.min, value));
}

function toScriptLabel(value: string): string {
    return value
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ') || 'Postprocess';
}
