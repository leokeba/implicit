import { writable } from 'svelte/store';

import {
    compactShaderStatusMessage,
    normalizeShaderStatusMessage,
    type PresetChangeResult,
    type SceneChangeResult,
    type ShaderStatusMode,
} from '../studio-controller';

export interface StatusState {
    workspaceStatus: string;
    outputStatus: string;
    shaderStatusMode: ShaderStatusMode;
    shaderStatusText: string;
    shaderStatusDetail: string;
    actionPending: boolean;
    progressVisible: boolean;
    progressPercent: number;
    progressPhaseLabel: string;
    progressDetail: string;
    benchmarkIterations: number;
    benchmarkWarmups: number;
}

export interface CommandProgressUpdate {
    percent: number;
    phaseLabel: string;
    detail: string;
}

function buildInitialState(): StatusState {
    return {
        workspaceStatus: 'Ready. Viewport and inspector are active.',
        outputStatus: 'Ready.',
        shaderStatusMode: 'ready',
        shaderStatusText: 'Shader: Ready',
        shaderStatusDetail: 'No shader diagnostics.',
        actionPending: false,
        progressVisible: false,
        progressPercent: 0,
        progressPhaseLabel: '',
        progressDetail: '',
        benchmarkIterations: 3,
        benchmarkWarmups: 1,
    };
}

function formatCommandError(error: unknown): string {
    if (error instanceof Error) {
        return `Slicer error: ${error.message}`;
    }

    return 'Slicer error: Unknown slicer error';
}

export function createStatusModel() {
    const { subscribe, update } = writable<StatusState>(buildInitialState());

    function setShaderStatus(mode: ShaderStatusMode, message: string): void {
        const normalized = normalizeShaderStatusMessage(message);
        update((state) => ({
            ...state,
            shaderStatusMode: mode,
            shaderStatusText: `Shader: ${compactShaderStatusMessage(normalized)}`,
            shaderStatusDetail:
                mode === 'error'
                    ? normalized
                    : mode === 'compiling'
                        ? 'Compiling active scene shaders...'
                        : 'No shader diagnostics.',
        }));
    }

    return {
        subscribe,
        setWorkspaceStatus(workspaceStatus: string): void {
            update((state) => ({
                ...state,
                workspaceStatus,
            }));
        },
        setShaderStatus,
        applySceneChange(result: SceneChangeResult): void {
            update((state) => ({
                ...state,
                workspaceStatus: result.workspaceStatus,
            }));

            setShaderStatus(result.ok ? 'ok' : 'error', result.shaderMessage);
        },
        applyPresetChange(result: PresetChangeResult): void {
            update((state) => ({
                ...state,
                workspaceStatus: result.workspaceStatus,
            }));
        },
        setBenchmarkIterations(benchmarkIterations: number): void {
            update((state) => ({
                ...state,
                benchmarkIterations: Math.max(1, Math.trunc(benchmarkIterations || 1)),
            }));
        },
        setBenchmarkWarmups(benchmarkWarmups: number): void {
            update((state) => ({
                ...state,
                benchmarkWarmups: Math.max(0, Math.trunc(benchmarkWarmups || 0)),
            }));
        },
        async runCommand(
            pendingLabel: string,
            action: (reportProgress: (next: CommandProgressUpdate) => void) => string | Promise<string>
        ): Promise<string> {
            update((state) => ({
                ...state,
                actionPending: true,
                outputStatus: pendingLabel,
                workspaceStatus: pendingLabel,
                progressVisible: false,
                progressPercent: 0,
                progressPhaseLabel: '',
                progressDetail: '',
            }));

            const reportProgress = (next: CommandProgressUpdate): void => {
                update((state) => ({
                    ...state,
                    progressVisible: true,
                    progressPercent: clamp(Math.round(next.percent), 0, 100),
                    progressPhaseLabel: next.phaseLabel,
                    progressDetail: next.detail,
                }));
            };

            try {
                const message = await action(reportProgress);
                update((state) => ({
                    ...state,
                    actionPending: false,
                    outputStatus: message,
                    workspaceStatus: message,
                    progressVisible: false,
                }));
                return message;
            } catch (error) {
                const message = formatCommandError(error);
                update((state) => ({
                    ...state,
                    actionPending: false,
                    outputStatus: message,
                    workspaceStatus: message,
                    progressVisible: false,
                }));
                return message;
            }
        },
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}