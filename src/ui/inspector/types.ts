import type { AnimationParams, RaymarchParams, ViewportParams } from '../../core/renderer';
import type { SceneControlDefinition, SceneControlValueMap, SceneOption } from '../../core/shader-pipeline';
import type { SliceDebugSnapshot, VaseSlicerSettings } from '../../core/slicer';

import type { FilamentProfile } from '../../core/filament-profiles';
import type { PostprocessControlDefinition } from '../../core/toolpath-postprocess';
import type { PostprocessScriptDocument } from '../postprocess-documents';
import type { PrinterModel } from '../../core/printer-models';

export type ControlTabId = 'scene' | 'camera' | 'render' | 'print' | 'machine' | 'material' | 'postprocess' | 'output';

export type NumericSlicerKey =
    | 'minY'
    | 'maxY'
    | 'modelScale'
    | 'layerHeight'
    | 'nozzleDiameter'
    | 'lineWidth'
    | 'firstLayerLineWidth'
    | 'pointsPerLayer'
    | 'maxRadius'
    | 'radialSteps'
    | 'sliceTargetGridPitchMm'
    | 'hitEpsilon'
    | 'sliceIsoSnapFactor'
    | 'brimWidthMm'
    | 'brimGapMm'
    | 'moveMergeMinMoveMm'
    | 'moveMergeMaxDeviationMm'
    | 'moveMergeMaxTurnDeg'
    | 'moveMergeKeepStride'
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
    sceneControlDefinitions: SceneControlDefinition[];
    sceneControlValues: SceneControlValueMap;
    printerModels: PrinterModel[];
    filamentProfiles: FilamentProfile[];
    postprocessDocuments: PostprocessScriptDocument[];
    postprocessControlDefinitions: PostprocessControlDefinition[];
    postprocessControlValues: Record<string, number>;
    sceneId: string;
    viewMode: number;
    raymarchParams: RaymarchParams;
    viewportParams: ViewportParams;
    animationParams: AnimationParams;
    slicerSettings: VaseSlicerSettings;
    activePostprocessScriptId: string;
    postprocessEnabled: boolean;
    postprocessSource: string;
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
    updateSceneControlValue: (controlKey: string, value: number) => void;
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
    commitPostprocessScript: (scriptId: string) => void;
    updatePostprocessEnabled: (value: boolean) => void;
    updatePostprocessAutoUpdate: (value: boolean) => void;
    updatePostprocessSource: (value: string) => void;
    updatePostprocessControlValue: (controlKey: string, value: number) => void;
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
    | (NumberFieldBase & { target: 'sceneControl'; key: string })
    | (NumberFieldBase & { target: 'postprocessControl'; key: string })
    | (NumberFieldBase & { target: 'command'; key: 'benchmarkIterations' | 'benchmarkWarmups' })
    | (SelectFieldBase & { target: 'scene'; optionsSource: 'sceneOptions' })
    | (SelectFieldBase & { target: 'viewMode'; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'slicerMode'; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'slicerBoolean'; key: BooleanSlicerKey; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'printerModel'; optionsSource: 'printerModels' })
    | (SelectFieldBase & { target: 'filamentProfile'; optionsSource: 'filamentProfiles' })
    | (SelectFieldBase & { target: 'postprocessScript'; optionsSource: 'postprocessDocuments' })
    | (SelectFieldBase & { target: 'postprocessEnabled'; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'postprocessAutoUpdate'; options: InspectorFieldOption[] })
    | (SelectFieldBase & { target: 'printerConnectionAutoStart'; options: InspectorFieldOption[] })
    | (TextFieldBase & { target: 'printerConnection'; key: PrinterConnectionStringKey })
    | (TextareaFieldBase & { target: 'slicerText'; key: keyof Pick<VaseSlicerSettings, 'startGcode' | 'endGcode'> })
    | (TextareaFieldBase & { target: 'postprocessText' });

export interface InspectorSummaryItemSchema {
    label: string;
    read: (state: InspectorSchemaState) => string;
}

export interface InspectorSectionSchema {
    id: string;
    title: string;
    caption: string;
    fields: InspectorFieldSchema[];
}

export interface InspectorActionSchema {
    id: 'resetView' | 'generateVaseGcode' | 'downloadGeneratedGcode' | 'sendVaseGcodeToPrinter' | 'benchmarkVaseGcode' | 'createPostprocessScript' | 'savePostprocessScript' | 'revertPostprocessScript';
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
