import type {
    ControlTabId,
    InspectorFieldOption,
    InspectorSchemaState,
    InspectorTabSchema,
} from './types';
import { buildPipelineSections, buildSceneControlSections } from './dynamic-sections';

import type { VaseSlicerSettings } from '../../core/slicer';

export const VIEW_MODE_OPTIONS: InspectorFieldOption[] = [
    { value: '0', label: 'Shaded' },
    { value: '1', label: 'RGB Normals' },
    { value: '2', label: 'Glass' },
    { value: '3', label: 'Modifier Values' },
];

const SLICER_MODE_OPTIONS: InspectorFieldOption[] = [
    { value: 'planar', label: 'Planar (strict)' },
    { value: 'surface', label: 'Surface (non-planar)' },
    { value: 'cylindrical', label: 'Cylindrical (legacy)' },
];

const BOOLEAN_TOGGLE_OPTIONS: InspectorFieldOption[] = [
    { value: 'true', label: 'On' },
    { value: 'false', label: 'Off' },
];

function findSceneLabel(state: InspectorSchemaState): string {
    return state.sceneOptions.find((scene) => scene.id === state.sceneId)?.name ?? state.sceneId;
}

function getViewModeLabel(viewMode: number): string {
    return VIEW_MODE_OPTIONS.find((option) => Number(option.value) === viewMode)?.label ?? 'Shaded';
}

/** Locale-aware so chip values match how the browser renders number inputs. */
function formatFixed(value: number, digits = 2): string {
    if (!Number.isFinite(value)) {
        value = 0;
    }
    return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatBedSize(settings: VaseSlicerSettings): string {
    return `${Math.round(settings.bedWidthMm)} x ${Math.round(settings.bedDepthMm)} mm`;
}

/** Printed footprint estimate: slice window plus brim, in machine millimetres. */
function partFootprintMm(settings: VaseSlicerSettings): number {
    const brim = settings.brimWidthMm > 0 ? settings.brimWidthMm + settings.brimGapMm : 0;
    return (2 * settings.maxRadius * settings.modelScale) + (2 * brim);
}

function partExceedsBed(settings: VaseSlicerSettings): boolean {
    const footprint = partFootprintMm(settings);
    return footprint > settings.bedWidthMm || footprint > settings.bedDepthMm;
}

function formatPartEnvelope(settings: VaseSlicerSettings): string {
    const footprint = partFootprintMm(settings);
    const height = Math.max(0, settings.maxY - settings.minY) * settings.modelScale;
    const size = `~${Math.round(footprint)} x ${Math.round(height)} mm`;
    return partExceedsBed(settings) ? `${size} - exceeds bed` : size;
}

export const INSPECTOR_TABS: InspectorTabSchema[] = [
    {
        id: 'scene',
        label: 'Scene',
        summary: [
            { label: 'Scene', read: findSceneLabel },
            { label: 'View', read: (state) => getViewModeLabel(state.viewMode) },
        ],
        // Scene and view selection live in the top bar; this tab holds the
        // per-scene controls appended dynamically from the scene manifest.
        sections: [],
    },
    {
        id: 'camera',
        label: 'Camera',
        summary: [
            { label: 'Orbit', read: (state) => formatFixed(state.viewportParams.orbitSensitivity, 3) },
            { label: 'Dolly', read: (state) => formatFixed(state.viewportParams.dollySensitivity, 3) },
        ],
        sections: [
            {
                id: 'navigation-tuning',
                title: 'Navigation Tuning',
                caption: 'These controls tune how the orbit camera behaves in the workspace.',
                fields: [
                    { kind: 'number', target: 'viewport', key: 'orbitSensitivity', id: 'viewport-orbit-sensitivity', label: 'Orbit speed', step: '0.001', min: '0.001', max: '0.06' },
                    { kind: 'number', target: 'viewport', key: 'panSensitivity', id: 'viewport-pan-sensitivity', label: 'Pan speed', step: '0.1', min: '0.2', max: '5.0' },
                    { kind: 'number', target: 'viewport', key: 'zoomSensitivity', id: 'viewport-zoom-sensitivity', label: 'Wheel zoom speed', step: '0.0001', min: '0.0002', max: '0.02' },
                    { kind: 'number', target: 'viewport', key: 'dollySensitivity', id: 'viewport-dolly-sensitivity', label: 'Dolly speed', step: '0.0005', min: '0.0005', max: '0.04' },
                ],
            },
        ],
        actions: [{ id: 'resetView', label: 'Reset View', tone: 'secondary' }],
    },
    {
        id: 'render',
        label: 'Render',
        summary: [
            { label: 'Max steps', read: (state) => String(state.raymarchParams.maxSteps) },
            { label: 'Target FPS', read: (state) => String(state.animationParams.targetFrameRate) },
        ],
        sections: [
            {
                id: 'raymarch',
                title: 'Raymarch',
                caption: 'Quality knobs that shape the viewport render cost and surface accuracy.',
                fields: [
                    { kind: 'number', target: 'raymarch', key: 'maxSteps', id: 'raymarch-max-steps', label: 'Max steps', step: '1', min: '8', max: '512' },
                    { kind: 'number', target: 'raymarch', key: 'hitEpsilon', id: 'raymarch-hit-epsilon', label: 'Hit epsilon', step: '0.0001', min: '0.0001', max: '0.02' },
                    { kind: 'number', target: 'raymarch', key: 'maxDistance', id: 'raymarch-max-distance', label: 'Max distance', step: '0.1', min: '1', max: '200' },
                    { kind: 'number', target: 'raymarch', key: 'focalLength', id: 'raymarch-focal-length', label: 'Focal length', step: '0.01', min: '0.2', max: '5.0' },
                    { kind: 'number', target: 'raymarch', key: 'stepScale', id: 'raymarch-step-scale', label: 'Step scale', step: '0.01', min: '0.1', max: '1.0' },
                    { kind: 'number', target: 'raymarch', key: 'minStep', id: 'raymarch-min-step', label: 'Min step', step: '0.0001', min: '0.00001', max: '0.05' },
                    { kind: 'number', target: 'raymarch', key: 'normalEpsilon', id: 'raymarch-normal-epsilon', label: 'Normal epsilon', step: '0.0001', min: '0.00005', max: '0.05' },
                    { kind: 'number', target: 'raymarch', key: 'refineSteps', id: 'raymarch-refine-steps', label: 'Refine steps', step: '1', min: '0', max: '12' },
                ],
            },
            {
                id: 'animation',
                title: 'Animation',
                caption: 'Redraw throttling and frame periodicity for animated scenes.',
                fields: [
                    { kind: 'number', target: 'animation', key: 'targetFrameRate', id: 'animation-target-frame-rate', label: 'Target FPS', step: '1', min: '0', max: '120' },
                    { kind: 'number', target: 'animation', key: 'framePeriod', id: 'animation-frame-period', label: 'Frame periodicity', step: '1', min: '1', max: '4096' },
                ],
            },
        ],
    },
    {
        id: 'print',
        label: 'Print',
        summary: [
            { label: 'Mode', read: (state) => state.slicerSettings.slicerMode },
            { label: 'Layer', read: (state) => `${formatFixed(state.slicerSettings.layerHeight, 2)} mm` },
            { label: 'Line', read: (state) => `${formatFixed(state.slicerSettings.lineWidth, 2)} mm` },
            {
                label: 'Part',
                read: (state) => formatPartEnvelope(state.slicerSettings),
                warn: (state) => partExceedsBed(state.slicerSettings),
            },
        ],
        sections: [
            {
                id: 'print-geometry',
                title: 'Print Geometry',
                caption: 'Shape and sampling parameters that affect the generated contour.',
                fields: [
                    { kind: 'select', target: 'slicerMode', id: 'slicer-mode', label: 'Slicer mode', options: SLICER_MODE_OPTIONS },
                    { kind: 'number', target: 'slicer', key: 'surfaceMinBeadOverlap', id: 'slicer-surface-overlap', label: 'Surface bead overlap', step: '0.05', min: '0.05', max: '0.95' },
                    { kind: 'number', target: 'slicer', key: 'minY', id: 'slicer-min-y', label: 'Min Y (SDF)', step: '0.01', min: '-5.0', max: '5.0' },
                    { kind: 'number', target: 'slicer', key: 'maxY', id: 'slicer-max-y', label: 'Max Y (SDF)', step: '0.01', min: '-5.0', max: '5.0' },
                    { kind: 'number', target: 'slicer', key: 'modelScale', id: 'slicer-model-scale', label: 'Scale (mm/unit)', step: '1', min: '1', max: '400' },
                    { kind: 'number', target: 'slicer', key: 'layerHeight', id: 'slicer-layer-height', label: 'Layer height', step: '0.01', min: '0.05', max: '1.0' },
                    { kind: 'number', target: 'slicer', key: 'maxLayerHeightMm', id: 'slicer-max-layer-height', label: 'Max layer height (0 = uniform)', step: '0.05', min: '0', max: '1.5' },
                    { kind: 'number', target: 'slicer', key: 'spiralPitchMm', id: 'slicer-spiral-pitch', label: 'Spiral pitch (0 = layer height)', step: '0.1', min: '0', max: '10' },
                    { kind: 'number', target: 'slicer', key: 'nozzleDiameter', id: 'slicer-nozzle-diameter', label: 'Nozzle diameter', step: '0.01', min: '0.2', max: '1.2' },
                    { kind: 'number', target: 'slicer', key: 'lineWidth', id: 'slicer-line-width', label: 'Line width', step: '0.01', min: '0.2', max: '1.2' },
                    { kind: 'number', target: 'slicer', key: 'firstLayerLineWidth', id: 'slicer-first-layer-line-width', label: 'First layer line width', step: '0.01', min: '0.2', max: '1.2' },
                    { kind: 'number', target: 'slicer', key: 'targetSegmentMm', id: 'slicer-target-segment', label: 'Target segment (mm)', step: '0.05', min: '0.05', max: '2.0' },
                    { kind: 'number', target: 'slicer', key: 'bottomLayers', id: 'slicer-bottom-layers', label: 'Bottom layers', step: '1', min: '0', max: '3' },
                    { kind: 'number', target: 'slicer', key: 'maxRadius', id: 'slicer-max-radius', label: 'Slice half-extent', step: '0.01', min: '0.1', max: '3.0' },
                ],
            },
            {
                id: 'print-sampling',
                title: 'Sampling And Debug',
                caption: 'These controls isolate grid artifacts from alignment and path-merging artifacts.',
                fields: [
                    { kind: 'number', target: 'slicer', key: 'hitEpsilon', id: 'slicer-hit-eps', label: 'Iso epsilon', step: '0.0001', min: '0.0001', max: '0.02' },
                    { kind: 'number', target: 'slicer', key: 'sliceIsoSnapFactor', id: 'slicer-iso-snap-factor', label: 'Iso snap factor', step: '0.05', min: '0.0', max: '4.0' },
                    { kind: 'select', target: 'slicerBoolean', key: 'enableContourAlignment', id: 'slicer-align-contours', label: 'Align contours', options: BOOLEAN_TOGGLE_OPTIONS },
                    { kind: 'select', target: 'slicerBoolean', key: 'enableMoveMerging', id: 'slicer-enable-merge', label: 'Merge moves', options: BOOLEAN_TOGGLE_OPTIONS },
                ],
            },
            {
                id: 'print-adhesion',
                title: 'Adhesion And Merge',
                caption: 'Bed adhesion and toolpath simplification.',
                fields: [
                    { kind: 'number', target: 'slicer', key: 'brimWidthMm', id: 'slicer-brim-width', label: 'Brim width (mm)', step: '0.1', min: '0', max: '30' },
                    { kind: 'number', target: 'slicer', key: 'brimGapMm', id: 'slicer-brim-gap', label: 'Brim gap (mm)', step: '0.05', min: '0', max: '5' },
                    { kind: 'number', target: 'slicer', key: 'moveMergeMinMoveMm', id: 'slicer-merge-min-move', label: 'Merge min move (mm)', step: '0.005', min: '0.005', max: '1.0' },
                    { kind: 'number', target: 'slicer', key: 'moveMergeMaxDeviationMm', id: 'slicer-merge-max-deviation', label: 'Merge max deviation (mm)', step: '0.001', min: '0.001', max: '0.5' },
                    { kind: 'number', target: 'slicer', key: 'moveMergeMaxTurnDeg', id: 'slicer-merge-max-turn', label: 'Merge max turn (deg)', step: '0.1', min: '0.5', max: '45' },
                    { kind: 'number', target: 'slicer', key: 'moveMergeKeepStride', id: 'slicer-merge-keep-stride', label: 'Merge keep stride', step: '1', min: '1', max: '200' },
                ],
            },
        ],
    },
    {
        id: 'machine',
        label: 'Machine',
        summary: [
            { label: 'Printer', read: (state) => state.slicerSettings.printerModelName },
            { label: 'Bed', read: (state) => formatBedSize(state.slicerSettings) },
        ],
        sections: [
            {
                id: 'machine-setup',
                title: 'Machine Setup',
                caption: 'Printer preset, build volume, and bed placement.',
                fields: [
                    { kind: 'select', target: 'printerModel', id: 'slicer-printer-model', label: 'Printer model', optionsSource: 'printerModels' },
                    { kind: 'number', target: 'slicer', key: 'bedWidthMm', id: 'slicer-bed-width', label: 'Bed width (mm)', step: '1', min: '50', max: '1000' },
                    { kind: 'number', target: 'slicer', key: 'bedDepthMm', id: 'slicer-bed-depth', label: 'Bed depth (mm)', step: '1', min: '50', max: '1000' },
                    { kind: 'number', target: 'slicer', key: 'maxPrintHeightMm', id: 'slicer-max-print-height', label: 'Max height (mm)', step: '1', min: '10', max: '1000' },
                    { kind: 'number', target: 'slicer', key: 'centerX', id: 'slicer-center-x', label: 'Bed center X', step: '0.1', min: '0', max: '400' },
                    { kind: 'number', target: 'slicer', key: 'centerZ', id: 'slicer-center-z', label: 'Bed center Y', step: '0.1', min: '0', max: '400' },
                    { kind: 'number', target: 'slicer', key: 'travelSpeedMmPerSec', id: 'slicer-travel-speed', label: 'Travel speed (mm/s)', step: '1', min: '10', max: '300' },
                ],
            },
            {
                id: 'machine-gcode',
                title: 'Machine G-code',
                caption: 'Templates support placeholders like {nozzleTempC}, {bedTempC}, and {fanPwm}.',
                fields: [
                    { kind: 'textarea', target: 'slicerText', key: 'startGcode', id: 'slicer-start-gcode', label: 'Start G-code', rows: 5 },
                    { kind: 'textarea', target: 'slicerText', key: 'endGcode', id: 'slicer-end-gcode', label: 'End G-code', rows: 5 },
                ],
            },
            {
                id: 'machine-printer-connection',
                title: 'Printer Connection',
                caption: 'Configure Moonraker connection details for one-click prints.',
                fields: [
                    { kind: 'text', target: 'printerConnection', key: 'baseUrl', id: 'printer-connection-base-url', label: 'Moonraker URL', placeholder: 'http://printer.local:7125', inputType: 'url' },
                    { kind: 'text', target: 'printerConnection', key: 'apiKey', id: 'printer-connection-api-key', label: 'API key (optional)', placeholder: 'Leave blank for trusted LAN', inputType: 'password' },
                    { kind: 'text', target: 'printerConnection', key: 'uploadPath', id: 'printer-connection-upload-path', label: 'Upload subfolder (optional)', placeholder: 'implicit' },
                    { kind: 'select', target: 'printerConnectionAutoStart', id: 'printer-connection-auto-start', label: 'Auto-start after upload', options: BOOLEAN_TOGGLE_OPTIONS },
                ],
            },
        ],
    },
    {
        id: 'material',
        label: 'Material',
        summary: [
            { label: 'Profile', read: (state) => state.slicerSettings.filamentProfileName },
            { label: 'Temps', read: (state) => `${Math.round(state.slicerSettings.nozzleTempC)} / ${Math.round(state.slicerSettings.bedTempC)} C` },
        ],
        sections: [
            {
                id: 'material-setup',
                title: 'Material Setup',
                caption: 'Temperatures and extrusion settings for the selected filament.',
                fields: [
                    { kind: 'select', target: 'filamentProfile', id: 'slicer-filament-profile', label: 'Filament profile', optionsSource: 'filamentProfiles' },
                    { kind: 'number', target: 'slicer', key: 'filamentDiameter', id: 'slicer-filament', label: 'Filament diameter', step: '0.01', min: '1.0', max: '3.0' },
                    { kind: 'number', target: 'slicer', key: 'nozzleTempC', id: 'slicer-nozzle', label: 'Nozzle temp', step: '1', min: '150', max: '300' },
                    { kind: 'number', target: 'slicer', key: 'bedTempC', id: 'slicer-bed', label: 'Bed temp', step: '1', min: '0', max: '130' },
                    { kind: 'number', target: 'slicer', key: 'fanPercent', id: 'slicer-fan', label: 'Fan %', step: '1', min: '0', max: '100' },
                    { kind: 'number', target: 'slicer', key: 'flowRate', id: 'slicer-flow', label: 'Flow rate', step: '0.01', min: '0.01', max: '5.0' },
                    { kind: 'number', target: 'slicer', key: 'printSpeedMmPerSec', id: 'slicer-print-speed', label: 'Print speed (mm/s)', step: '1', min: '5', max: '200' },
                    { kind: 'number', target: 'slicer', key: 'firstLayerPrintSpeedMmPerSec', id: 'slicer-first-layer-speed', label: 'First layer speed (mm/s)', step: '1', min: '5', max: '200' },
                    { kind: 'number', target: 'slicer', key: 'minLayerTimeSec', id: 'slicer-min-layer-time', label: 'Min layer time (s)', step: '0.1', min: '0', max: '120' },
                    { kind: 'number', target: 'slicer', key: 'retractMm', id: 'slicer-retract', label: 'Retract (mm)', step: '0.1', min: '0', max: '10' },
                    { kind: 'number', target: 'slicer', key: 'retractSpeedMmPerSec', id: 'slicer-retract-speed', label: 'Retract speed (mm/s)', step: '1', min: '5', max: '80' },
                    { kind: 'number', target: 'slicer', key: 'primeMm', id: 'slicer-prime', label: 'Prime (mm)', step: '0.1', min: '0', max: '5' },
                ],
            },
        ],
    },
    {
        id: 'postprocess',
        label: 'Postprocess',
        summary: [
            { label: 'Steps', read: (state) => String(state.pipeline.length) },
            { label: 'Active', read: (state) => String(state.pipeline.filter((step) => step.enabled && !step.error).length) },
            { label: 'Storage', read: (state) => state.postprocessStorageLabel },
        ],
        sections: [
            {
                id: 'postprocess-editing',
                title: 'Script Editing',
                caption: 'The pipeline itself is declared in the scene manifest (scene.ts). Pick a generic script here to open it in the editor panel.',
                fields: [
                    { kind: 'select', target: 'postprocessScript', id: 'postprocess-script-select', label: 'Edit script', optionsSource: 'postprocessDocuments' },
                    { kind: 'select', target: 'postprocessAutoUpdate', id: 'postprocess-auto-update', label: 'Auto-update generated G-code', options: BOOLEAN_TOGGLE_OPTIONS },
                ],
            },
        ],
        note: 'Steps run in manifest order on the raw spiral path before move merging and extrusion recompute. Scripts export controls plus transform(context); context.params carries the step parameters and point.sceneFields carries manifest field samples.',
        actions: [
            { id: 'createPostprocessScript', label: 'New Script' },
            { id: 'revertPostprocessScript', label: 'Revert', tone: 'secondary' },
            { id: 'savePostprocessScript', label: 'Save Script' },
        ],
    },
    {
        id: 'output',
        label: 'Output',
        summary: [
            { label: 'Measured', read: (state) => `${state.benchmarkIterations} run${state.benchmarkIterations === 1 ? '' : 's'}` },
            { label: 'Warmups', read: (state) => `${state.benchmarkWarmups}` },
        ],
        sections: [
            {
                id: 'export-benchmark',
                title: 'Export And Benchmark',
                caption: 'Run the slicer and inspect results without leaving the workspace.',
                fields: [
                    { kind: 'number', target: 'command', key: 'benchmarkIterations', id: 'benchmark-iterations', label: 'Measured runs', step: '1', min: '1', max: '20', disabledWhenPending: true },
                    { kind: 'number', target: 'command', key: 'benchmarkWarmups', id: 'benchmark-warmups', label: 'Warmup runs', step: '1', min: '0', max: '10', disabledWhenPending: true },
                ],
            },
        ],
        note: 'Planar contour mode is the strict algorithm. Cylindrical radial mode remains useful for star-convex profiles.',
        actions: [
            { id: 'generateVaseGcode', label: 'Generate Vase G-code', disabledWhenPending: true },
            { id: 'benchmarkVaseGcode', label: 'Benchmark', tone: 'secondary', disabledWhenPending: true },
        ],
        consoleSource: 'outputStatus',
    },
];

export function getInspectorTabSchema(tabId: ControlTabId): InspectorTabSchema {
    return INSPECTOR_TABS.find((tab) => tab.id === tabId) ?? INSPECTOR_TABS[0];
}

export function buildInspectorTabSchema(tabId: ControlTabId, state: InspectorSchemaState): InspectorTabSchema {
    const baseTab = getInspectorTabSchema(tabId);
    if (tabId === 'output') {
        const outputActions: InspectorTabSchema['actions'] = [
            { id: 'generateVaseGcode', label: state.exportActionLabel, disabledWhenPending: true },
        ];

        if (state.hasGeneratedGcode) {
            outputActions.push({ id: 'downloadGeneratedGcode', label: 'Download', disabledWhenPending: true });
        }

        if (state.printerConfigured && state.printerAvailable) {
            outputActions.push({ id: 'sendVaseGcodeToPrinter', label: 'Print', disabledWhenPending: true });
        }

        outputActions.push({ id: 'benchmarkVaseGcode', label: 'Benchmark', tone: 'secondary', disabledWhenPending: true });

        return {
            ...baseTab,
            actions: outputActions,
        };
    }

    if (tabId === 'postprocess') {
        const pipelineSections = buildPipelineSections(state.pipeline);
        return {
            ...baseTab,
            sections: [...pipelineSections, ...baseTab.sections],
        };
    }

    if (tabId !== 'scene') {
        return withOverrideActions(baseTab, state);
    }

    const sceneControlSections = buildSceneControlSections(state.uniformControls, state.paramControls);
    const summary = [...baseTab.summary];
    if (state.overrideCount > 0) {
        summary.push({ label: 'Overrides', read: () => String(state.overrideCount) });
    }

    return withOverrideActions({
        ...baseTab,
        summary,
        sections: [...baseTab.sections, ...sceneControlSections],
        note: state.manifestError
            ? `Manifest error: ${state.manifestError}`
            : state.preprocessError
                ? `Preprocess error: ${state.preprocessError}`
                : baseTab.note,
    }, state);
}

function withOverrideActions(tab: InspectorTabSchema, state: InspectorSchemaState): InspectorTabSchema {
    if (state.overrideCount === 0 || (tab.id !== 'scene' && tab.id !== 'print' && tab.id !== 'machine' && tab.id !== 'material')) {
        return tab;
    }

    return {
        ...tab,
        actions: [
            ...(tab.actions ?? []),
            { id: 'resetAllOverrides', label: `Reset ${state.overrideCount} Override${state.overrideCount === 1 ? '' : 's'}`, tone: 'secondary' },
        ],
    };
}
