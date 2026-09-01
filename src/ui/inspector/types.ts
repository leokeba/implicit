import type { AnimationParams, RaymarchParams, ViewportParams } from '../../core/renderer';
import type { SceneControlDefinition, SceneOption } from '../../core/shader-pipeline';
import type { SliceDebugSnapshot, VaseSlicerSettings } from '../../core/slicer';

import type { FilamentProfile } from '../../core/filament-profiles';
import type { PostprocessScriptDocument } from '../../core/postprocess-registry';
import type { PrinterModel } from '../../core/printer-models';
import type { PipelineStepView } from '../../studio/types';
import type { ScalarControlSpec } from '../../scene-runtime';

export type ControlTabId = 'scene' | 'camera' | 'render' | 'print' | 'machine' | 'material' | 'postprocess' | 'output';

export type NumericSlicerKey =
    | 'minY'
    | 'maxY'
    | 'modelScale'
    | 'layerHeight'
    | 'nozzleDiameter'
    | 'lineWidth'
    | 'firstLayerLineWidth'
    | 'targetSegmentMm'
    | 'maxRadius'
    | 'hitEpsilon'
    | 'sliceIsoSnapFactor'
    | 'surfaceMinBeadOverlap'
    | 'brimWidthMm'
    | 'brimGapMm'
    | 'moveMergeMinMoveMm'
    | 'moveMergeMaxDeviationMm'
    | 'moveMergeMaxTurnDeg'
    | 'moveMergeKeepStride'
    | 'retractMm'
    | 'retractSpeedMmPerSec'
    | 'primeMm'
    | 'bottomLayers'
    | 'maxLayerHeightMm'
    | 'spiralPitchMm'
    | 'bedWidthMm'
    | 'bedDepthMm'
    | 'maxPrintHeightMm'
    | 'centerX'
    | 'centerZ'
    | 'travelSpeedMmPerSec'
    | 'filamentDiameter'
    | 'nozzleTempC'
    | 'bedTempC'
    | 'fanPercent'
    | 'flowRate'
    | 'printSpeedMmPerSec'
    | 'firstLayerPrintSpeedMmPerSec'
    | 'minLayerTimeSec';

export type BooleanSlicerKey =
    | 'enableContourAlignment'
    | 'enableMoveMerging';

export type PrinterConnectionStringKey = 'baseUrl' | 'apiKey' | 'uploadPath';

export interface InspectorSchemaState {
    sceneOptions: SceneOption[];
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
    printerModels: PrinterModel[];
    filamentProfiles: FilamentProfile[];
    postprocessDocuments: PostprocessScriptDocument[];
    sceneId: string;
    viewMode: number;
    raymarchParams: RaymarchParams;
    viewportParams: ViewportParams;
    animationParams: AnimationParams;
    slicerSettings: VaseSlicerSettings;
    activePostprocessScriptId: string;
    postprocessStatus: string;
    postprocessDirty: boolean;
    postprocessStorageLabel: string;
    postprocessSavePending: boolean;
    postprocessAutoUpdate: boolean;
    benchmarkIterations: number;
    benchmarkWarmups: number;
    actionPending: boolean;
    outputStatus: string;
    sliceDebugSnapshot: SliceDebugSnapshot | null;
    printerConnection: {
        baseUrl: string;
        apiKey: string;
        uploadPath: string;
        autoStartPrint: boolean;
    };
    printerConfigured: boolean;
    printerAvailable: boolean;
    exportActionLabel: string;
    hasGeneratedGcode: boolean;
}

export interface InspectorSchemaHandlers {
    commitViewMode: (viewMode: number) => void;
    commitScene: (sceneId: string) => void;
    updateUniformValue: (key: string, value: number) => void;
    updateParamValue: (key: string, value: number) => void;
    updateStepParam: (stepIndex: number, key: string, value: number) => void;
    setStepEnabled: (stepIndex: number, enabled: boolean) => void;
    resetFieldOverride: (scope: 'slicer' | 'uniform' | 'param', key: string) => void;
    resetStepParamOverride: (stepIndex: number, key: string) => void;
    resetAllOverrides: () => void;
    updateViewportField: (key: keyof ViewportParams, value: number) => void;
    resetView: () => void;
    updateRaymarchField: (key: keyof RaymarchParams, value: number) => void;
    updateAnimationField: (key: keyof AnimationParams, value: number) => void;
    updateSlicerMode: (value: string) => void;
    updateSlicerNumber: (key: NumericSlicerKey, value: number) => void;
    updateSlicerBoolean: (key: BooleanSlicerKey, value: boolean) => void;
    commitPrinterModel: (printerModelId: string) => void;
    updateSlicerString: (key: keyof Pick<VaseSlicerSettings, 'startGcode' | 'endGcode'>, value: string) => void;
    commitFilamentProfile: (filamentProfileId: string) => void;
    selectPostprocessScript: (scriptId: string) => void;
    updatePostprocessAutoUpdate: (value: boolean) => void;
    createPostprocessScript: () => void | Promise<void>;
    savePostprocessScript: () => void | Promise<void>;
    revertPostprocessScript: () => void;
    setBenchmarkIterations: (value: number) => void;
    setBenchmarkWarmups: (value: number) => void;
    updatePrinterConnectionString: (key: PrinterConnectionStringKey, value: string) => void;
    updatePrinterConnectionAutoStart: (value: boolean) => void;
    generateVaseGcode: () => void | Promise<void>;
    downloadGeneratedGcode: () => void | Promise<void>;
    sendVaseGcodeToPrinter: () => void | Promise<void>;
    benchmarkVaseGcode: () => void | Promise<void>;
}

export interface InspectorFieldOption {
    value: string;
    label: string;
}

interface FieldBase {
    id: string;
    label: string;
    disabledWhenPending?: boolean;
}

interface NumberFieldBase extends FieldBase {
    kind: 'number';
    step: string;
    min: string;
    max: string;
}

interface SelectFieldBase extends FieldBase {
    kind: 'select';
}

interface TextareaFieldBase extends FieldBase {
    kind: 'textarea';
    rows: number;
}

interface TextFieldBase extends FieldBase {
    kind: 'text';
    placeholder?: string;
    inputType?: 'text' | 'password' | 'url';
}

export type InspectorFieldSchema =
    | (NumberFieldBase & { target: 'raymarch'; key: keyof RaymarchParams })
    | (NumberFieldBase & { target: 'viewport'; key: keyof ViewportParams })
    | (NumberFieldBase & { target: 'animation'; key: keyof AnimationParams })
    | (NumberFieldBase & { target: 'slicer'; key: NumericSlicerKey })
    | (NumberFieldBase & { target: 'uniform'; key: string })
    | (SelectFieldBase & { target: 'uniform'; key: string; options: InspectorFieldOption[] })
    | (NumberFieldBase & { target: 'sceneParam'; key: string })
    | (SelectFieldBase & { target: 'sceneParam'; key: string; options: InspectorFieldOption[] })
    | (NumberFieldBase & { target: 'stepControl'; stepIndex: number; key: string })
    | (SelectFieldBase & { target: 'stepControl'; stepIndex: number; key: string; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'stepEnabled'; stepIndex: number; options: InspectorFieldOption[] })
    | (NumberFieldBase & { target: 'command'; key: 'benchmarkIterations' | 'benchmarkWarmups' })
    | (SelectFieldBase & { target: 'scene'; optionsSource: 'sceneOptions' })
    | (SelectFieldBase & { target: 'viewMode'; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'slicerMode'; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'slicerBoolean'; key: BooleanSlicerKey; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'printerModel'; optionsSource: 'printerModels' })
    | (SelectFieldBase & { target: 'filamentProfile'; optionsSource: 'filamentProfiles' })
    | (SelectFieldBase & { target: 'postprocessScript'; optionsSource: 'postprocessDocuments' })
    | (SelectFieldBase & { target: 'postprocessAutoUpdate'; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'printerConnectionAutoStart'; options: InspectorFieldOption[] })
    | (TextFieldBase & { target: 'printerConnection'; key: PrinterConnectionStringKey })
    | (TextareaFieldBase & { target: 'slicerText'; key: keyof Pick<VaseSlicerSettings, 'startGcode' | 'endGcode'> });

export interface InspectorSummaryItemSchema {
    label: string;
    read: (state: InspectorSchemaState) => string;
    warn?: (state: InspectorSchemaState) => boolean;
}

export interface InspectorSectionSchema {
    id: string;
    title: string;
    caption: string;
    fields: InspectorFieldSchema[];
}

export interface InspectorActionSchema {
    id: 'resetView' | 'generateVaseGcode' | 'downloadGeneratedGcode' | 'sendVaseGcodeToPrinter' | 'benchmarkVaseGcode' | 'createPostprocessScript' | 'savePostprocessScript' | 'revertPostprocessScript' | 'resetAllOverrides';
    label: string;
    tone?: 'secondary';
    disabledWhenPending?: boolean;
}

export interface InspectorTabSchema {
    id: ControlTabId;
    label: string;
    summary: InspectorSummaryItemSchema[];
    sections: InspectorSectionSchema[];
    note?: string;
    actions?: InspectorActionSchema[];
    consoleSource?: 'outputStatus';
}
