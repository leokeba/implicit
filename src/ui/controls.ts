import type { AnimationParams, RaymarchParams, ViewportParams } from '../core/renderer';

import type { FilamentProfile } from '../core/filament-profiles';
import type { PrinterModel } from '../core/printer-models';
import type { SceneOption } from '../core/shader-pipeline';
import type { VaseSlicerSettings } from '../core/slicer';

type ControlTabId = 'scene' | 'camera' | 'render' | 'print' | 'machine' | 'material' | 'output';

const CONTROL_TAB_STORAGE_KEY = 'implicit-ui-active-tab';

const CONTROL_TABS: Array<{ id: ControlTabId; label: string }> = [
    { id: 'scene', label: 'Scene' },
    { id: 'camera', label: 'Camera' },
    { id: 'render', label: 'Render' },
    { id: 'print', label: 'Print' },
    { id: 'machine', label: 'Machine' },
    { id: 'material', label: 'Material' },
    { id: 'output', label: 'Output' },
];

function isControlTabId(value: string): value is ControlTabId {
    return CONTROL_TABS.some((tab) => tab.id === value);
}

export class Controls {
    private activeTabId: ControlTabId;
    private tabButtons: Partial<Record<ControlTabId, HTMLButtonElement>>;
    private tabPanels: Partial<Record<ControlTabId, HTMLElement>>;

    constructor() {
        this.activeTabId = this.readStoredTab();
        this.tabButtons = {};
        this.tabPanels = {};
    }

    public getActiveTabId(): string {
        return this.activeTabId;
    }

    public selectTab(tabId: string): void {
        if (!isControlTabId(tabId)) {
            return;
        }

        this.setActiveTab(tabId);
    }

    public init(
        currentViewMode: number,
        onViewModeChange: (viewMode: number) => void,
        sceneOptions: SceneOption[],
        currentSceneId: string,
        onSceneChange: (sceneId: string) => VaseSlicerSettings,
        initialRaymarchParams: RaymarchParams,
        onRaymarchParamsChange: (next: Partial<RaymarchParams>) => void,
        initialViewportParams: ViewportParams,
        onViewportParamsChange: (next: Partial<ViewportParams>) => void,
        initialAnimationParams: AnimationParams,
        onAnimationParamsChange: (next: Partial<AnimationParams>) => void,
        onResetView: () => void,
        printerModels: PrinterModel[],
        currentPrinterModelId: string,
        onPrinterModelChange: (printerModelId: string) => VaseSlicerSettings,
        filamentProfiles: FilamentProfile[],
        currentFilamentProfileId: string,
        onFilamentProfileChange: (filamentProfileId: string) => VaseSlicerSettings,
        initialSlicerParams: VaseSlicerSettings,
        onSlicerParamsChange: (next: Partial<VaseSlicerSettings>) => void,
        onGenerateVaseGcode: () => { filename: string; bytes: number; points: number },
        onBenchmarkVaseGcode: (iterations: number, warmupRuns: number) => {
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
        },
        onWorkspaceStatus: (message: string) => void
    ): void {
        const controlsHost = document.getElementById('controls');
        if (!controlsHost) {
            return;
        }

        controlsHost.innerHTML = '';
        this.tabButtons = {};
        this.tabPanels = {};

        const shell = document.createElement('div');
        shell.className = 'controls-shell';

        const controlsHeader = document.createElement('div');
        controlsHeader.className = 'controls-header';

        const title = document.createElement('h2');
        title.textContent = 'Inspector';

        const note = document.createElement('p');
        note.className = 'controls-note';
        note.textContent = 'Task-oriented tabs replace the old stacked form so the viewport can stay dominant.';

        controlsHeader.appendChild(title);
        controlsHeader.appendChild(note);
        shell.appendChild(controlsHeader);

        const tabBar = document.createElement('div');
        tabBar.className = 'tab-bar';
        shell.appendChild(tabBar);

        const panelHost = document.createElement('div');
        panelHost.className = 'tab-panels';
        shell.appendChild(panelHost);

        const createTabPanel = (tabId: ControlTabId): HTMLElement => {
            const panel = document.createElement('section');
            panel.className = 'tab-panel';
            panel.dataset.tabId = tabId;
            this.tabPanels[tabId] = panel;
            panelHost.appendChild(panel);
            return panel;
        };

        const createGroup = (panel: HTMLElement, titleText: string, captionText?: string): HTMLDivElement => {
            const group = document.createElement('section');
            group.className = 'inspector-group';

            const titleElement = document.createElement('h3');
            titleElement.textContent = titleText;
            group.appendChild(titleElement);

            if (captionText) {
                const caption = document.createElement('p');
                caption.className = 'group-caption';
                caption.textContent = captionText;
                group.appendChild(caption);
            }

            const grid = document.createElement('div');
            grid.className = 'field-grid';
            group.appendChild(grid);
            panel.appendChild(group);
            return grid;
        };

        const appendFieldRow = (
            grid: HTMLElement,
            id: string,
            labelText: string,
            control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
            multiline: boolean = false
        ): void => {
            const label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = labelText;

            const row = document.createElement('div');
            row.className = multiline ? 'field-row field-row-textarea' : 'field-row';

            control.id = id;
            row.appendChild(label);
            row.appendChild(control);
            grid.appendChild(row);
        };

        const addNumberField = (
            grid: HTMLElement,
            id: string,
            label: string,
            value: number,
            step: string,
            min: string,
            max: string,
            onChange: (value: number) => void
        ): HTMLInputElement => {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = step;
            input.min = min;
            input.max = max;
            input.value = String(value);
            input.addEventListener('change', () => {
                onChange(Number(input.value));
            });
            appendFieldRow(grid, id, label, input);
            return input;
        };

        const addTextField = (
            grid: HTMLElement,
            id: string,
            label: string,
            value: string,
            onChange: (value: string) => void
        ): HTMLTextAreaElement => {
            const input = document.createElement('textarea');
            input.rows = 5;
            input.value = value;
            input.addEventListener('change', () => {
                onChange(input.value);
            });
            appendFieldRow(grid, id, label, input, true);
            return input;
        };

        CONTROL_TABS.forEach((tab) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tab-button';
            button.textContent = tab.label;
            button.dataset.tabId = tab.id;
            button.addEventListener('click', () => {
                this.setActiveTab(tab.id);
            });
            this.tabButtons[tab.id] = button;
            tabBar.appendChild(button);
            createTabPanel(tab.id);
        });

        const scenePanel = this.tabPanels.scene as HTMLElement;
        const cameraPanel = this.tabPanels.camera as HTMLElement;
        const renderPanel = this.tabPanels.render as HTMLElement;
        const printPanel = this.tabPanels.print as HTMLElement;
        const machinePanel = this.tabPanels.machine as HTMLElement;
        const materialPanel = this.tabPanels.material as HTMLElement;
        const outputPanel = this.tabPanels.output as HTMLElement;

        const sceneGrid = createGroup(scenePanel, 'Scene Controls', 'Scene choice and surface visualization stay close to the viewport workflow.');

        const viewModeSelect = document.createElement('select');
        [
            { value: '0', label: 'Shaded' },
            { value: '1', label: 'RGB Normals' },
            { value: '2', label: 'Glass' },
        ].forEach((optionInfo) => {
            const option = document.createElement('option');
            option.value = optionInfo.value;
            option.text = optionInfo.label;
            viewModeSelect.appendChild(option);
        });
        viewModeSelect.value = String(currentViewMode === 1 || currentViewMode === 2 ? currentViewMode : 0);
        viewModeSelect.addEventListener('change', () => {
            onViewModeChange(Number(viewModeSelect.value));
        });
        appendFieldRow(sceneGrid, 'view-mode-select', 'View mode', viewModeSelect);

        const sceneSelect = document.createElement('select');
        sceneOptions.forEach((scene) => {
            const option = document.createElement('option');
            option.value = scene.id;
            option.text = scene.name;
            sceneSelect.appendChild(option);
        });
        if (sceneOptions.length > 0) {
            const hasCurrent = sceneOptions.some((scene) => scene.id === currentSceneId);
            sceneSelect.value = hasCurrent ? currentSceneId : sceneOptions[0].id;
        }
        appendFieldRow(sceneGrid, 'scene-select', 'Scene preset', sceneSelect);

        const cameraGrid = createGroup(cameraPanel, 'Navigation Tuning', 'These controls tune how the orbit camera behaves in the workspace.');
        addNumberField(cameraGrid, 'viewport-orbit-sensitivity', 'Orbit speed', initialViewportParams.orbitSensitivity, '0.001', '0.001', '0.06', (value) => onViewportParamsChange({ orbitSensitivity: value }));
        addNumberField(cameraGrid, 'viewport-pan-sensitivity', 'Pan speed', initialViewportParams.panSensitivity, '0.1', '0.2', '5.0', (value) => onViewportParamsChange({ panSensitivity: value }));
        addNumberField(cameraGrid, 'viewport-zoom-sensitivity', 'Wheel zoom speed', initialViewportParams.zoomSensitivity, '0.0001', '0.0002', '0.02', (value) => onViewportParamsChange({ zoomSensitivity: value }));
        addNumberField(cameraGrid, 'viewport-dolly-sensitivity', 'Dolly speed', initialViewportParams.dollySensitivity, '0.0005', '0.0005', '0.04', (value) => onViewportParamsChange({ dollySensitivity: value }));

        const cameraActions = document.createElement('div');
        cameraActions.className = 'action-row';
        const resetViewButton = document.createElement('button');
        resetViewButton.type = 'button';
        resetViewButton.className = 'action-button action-button-secondary';
        resetViewButton.textContent = 'Reset View';
        resetViewButton.addEventListener('click', onResetView);
        cameraActions.appendChild(resetViewButton);
        cameraPanel.appendChild(cameraActions);

        const renderRaymarchGrid = createGroup(renderPanel, 'Raymarch', 'Quality knobs that shape the viewport render cost and surface accuracy.');
        addNumberField(renderRaymarchGrid, 'raymarch-max-steps', 'Max steps', initialRaymarchParams.maxSteps, '1', '8', '512', (value) => onRaymarchParamsChange({ maxSteps: value }));
        addNumberField(renderRaymarchGrid, 'raymarch-hit-epsilon', 'Hit epsilon', initialRaymarchParams.hitEpsilon, '0.0001', '0.0001', '0.02', (value) => onRaymarchParamsChange({ hitEpsilon: value }));
        addNumberField(renderRaymarchGrid, 'raymarch-max-distance', 'Max distance', initialRaymarchParams.maxDistance, '0.1', '1', '200', (value) => onRaymarchParamsChange({ maxDistance: value }));
        addNumberField(renderRaymarchGrid, 'raymarch-focal-length', 'Focal length', initialRaymarchParams.focalLength, '0.01', '0.2', '5.0', (value) => onRaymarchParamsChange({ focalLength: value }));
        addNumberField(renderRaymarchGrid, 'raymarch-step-scale', 'Step scale', initialRaymarchParams.stepScale, '0.01', '0.1', '1.0', (value) => onRaymarchParamsChange({ stepScale: value }));
        addNumberField(renderRaymarchGrid, 'raymarch-min-step', 'Min step', initialRaymarchParams.minStep, '0.0001', '0.00001', '0.05', (value) => onRaymarchParamsChange({ minStep: value }));
        addNumberField(renderRaymarchGrid, 'raymarch-normal-epsilon', 'Normal epsilon', initialRaymarchParams.normalEpsilon, '0.0001', '0.00005', '0.05', (value) => onRaymarchParamsChange({ normalEpsilon: value }));
        addNumberField(renderRaymarchGrid, 'raymarch-refine-steps', 'Refine steps', initialRaymarchParams.refineSteps, '1', '0', '12', (value) => onRaymarchParamsChange({ refineSteps: value }));

        const animationGrid = createGroup(renderPanel, 'Animation', 'Redraw throttling and frame periodicity for animated scenes.');
        addNumberField(animationGrid, 'animation-target-frame-rate', 'Target FPS', initialAnimationParams.targetFrameRate, '1', '0', '120', (value) => onAnimationParamsChange({ targetFrameRate: value }));
        addNumberField(animationGrid, 'animation-frame-period', 'Frame periodicity', initialAnimationParams.framePeriod, '1', '1', '4096', (value) => onAnimationParamsChange({ framePeriod: value }));

        const slicerNumericInputs: Partial<Record<keyof VaseSlicerSettings, HTMLInputElement>> = {};
        const slicerTextInputs: Partial<Record<keyof VaseSlicerSettings, HTMLTextAreaElement>> = {};

        const printGeometryGrid = createGroup(printPanel, 'Print Geometry', 'Shape and sampling parameters that affect the generated contour.');
        const slicerModeSelect = document.createElement('select');
        [
            { value: 'planar', label: 'Planar contour (strict)' },
            { value: 'cylindrical', label: 'Cylindrical radial (legacy)' },
        ].forEach((optionInfo) => {
            const option = document.createElement('option');
            option.value = optionInfo.value;
            option.text = optionInfo.label;
            slicerModeSelect.appendChild(option);
        });
        slicerModeSelect.value = initialSlicerParams.slicerMode;
        slicerModeSelect.addEventListener('change', () => {
            onSlicerParamsChange({ slicerMode: slicerModeSelect.value as VaseSlicerSettings['slicerMode'] });
        });
        appendFieldRow(printGeometryGrid, 'slicer-mode', 'Slicer mode', slicerModeSelect);

        const addSlicerField = (
            grid: HTMLElement,
            key: keyof VaseSlicerSettings,
            id: string,
            label: string,
            value: number,
            step: string,
            min: string,
            max: string,
            onChange: (value: number) => void
        ): void => {
            slicerNumericInputs[key] = addNumberField(grid, id, label, value, step, min, max, onChange);
        };

        const addSlicerTextField = (
            grid: HTMLElement,
            key: keyof VaseSlicerSettings,
            id: string,
            label: string,
            value: string,
            onChange: (value: string) => void
        ): void => {
            slicerTextInputs[key] = addTextField(grid, id, label, value, onChange);
        };

        addSlicerField(printGeometryGrid, 'minY', 'slicer-min-y', 'Min Y (SDF)', initialSlicerParams.minY, '0.01', '-5.0', '5.0', (value) => onSlicerParamsChange({ minY: value }));
        addSlicerField(printGeometryGrid, 'maxY', 'slicer-max-y', 'Max Y (SDF)', initialSlicerParams.maxY, '0.01', '-5.0', '5.0', (value) => onSlicerParamsChange({ maxY: value }));
        addSlicerField(printGeometryGrid, 'modelScale', 'slicer-model-scale', 'Scale (mm/unit)', initialSlicerParams.modelScale, '1', '1', '400', (value) => onSlicerParamsChange({ modelScale: value }));
        addSlicerField(printGeometryGrid, 'layerHeight', 'slicer-layer-height', 'Layer height', initialSlicerParams.layerHeight, '0.01', '0.05', '1.0', (value) => onSlicerParamsChange({ layerHeight: value }));
        addSlicerField(printGeometryGrid, 'nozzleDiameter', 'slicer-nozzle-diameter', 'Nozzle diameter', initialSlicerParams.nozzleDiameter, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ nozzleDiameter: value }));
        addSlicerField(printGeometryGrid, 'lineWidth', 'slicer-line-width', 'Line width', initialSlicerParams.lineWidth, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ lineWidth: value }));
        addSlicerField(printGeometryGrid, 'firstLayerLineWidth', 'slicer-first-layer-line-width', 'First layer line width', initialSlicerParams.firstLayerLineWidth, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ firstLayerLineWidth: value }));
        addSlicerField(printGeometryGrid, 'pointsPerLayer', 'slicer-points', 'Points per layer', initialSlicerParams.pointsPerLayer, '1', '48', '2048', (value) => onSlicerParamsChange({ pointsPerLayer: value }));
        addSlicerField(printGeometryGrid, 'maxRadius', 'slicer-max-radius', 'Slice half-extent', initialSlicerParams.maxRadius, '0.01', '0.1', '3.0', (value) => onSlicerParamsChange({ maxRadius: value }));
        addSlicerField(printGeometryGrid, 'radialSteps', 'slicer-radial-steps', 'Slice grid', initialSlicerParams.radialSteps, '1', '32', '512', (value) => onSlicerParamsChange({ radialSteps: value }));
        addSlicerField(printGeometryGrid, 'hitEpsilon', 'slicer-hit-eps', 'Iso epsilon', initialSlicerParams.hitEpsilon, '0.0001', '0.0001', '0.02', (value) => onSlicerParamsChange({ hitEpsilon: value }));

        const printAdhesionGrid = createGroup(printPanel, 'Adhesion And Merge', 'Brim and simplification controls stay together in the print workflow.');
        addSlicerField(printAdhesionGrid, 'brimWidthMm', 'slicer-brim-width', 'Brim width (mm)', initialSlicerParams.brimWidthMm, '0.1', '0', '30', (value) => onSlicerParamsChange({ brimWidthMm: value }));
        addSlicerField(printAdhesionGrid, 'brimGapMm', 'slicer-brim-gap', 'Brim gap (mm)', initialSlicerParams.brimGapMm, '0.05', '0', '5', (value) => onSlicerParamsChange({ brimGapMm: value }));
        addSlicerField(printAdhesionGrid, 'moveMergeMinMoveMm', 'slicer-merge-min-move', 'Merge min move (mm)', initialSlicerParams.moveMergeMinMoveMm, '0.005', '0.005', '1.0', (value) => onSlicerParamsChange({ moveMergeMinMoveMm: value }));
        addSlicerField(printAdhesionGrid, 'moveMergeMaxDeviationMm', 'slicer-merge-max-deviation', 'Merge max deviation (mm)', initialSlicerParams.moveMergeMaxDeviationMm, '0.001', '0.001', '0.5', (value) => onSlicerParamsChange({ moveMergeMaxDeviationMm: value }));
        addSlicerField(printAdhesionGrid, 'moveMergeMaxTurnDeg', 'slicer-merge-max-turn', 'Merge max turn (deg)', initialSlicerParams.moveMergeMaxTurnDeg, '0.1', '0.5', '45', (value) => onSlicerParamsChange({ moveMergeMaxTurnDeg: value }));
        addSlicerField(printAdhesionGrid, 'moveMergeKeepStride', 'slicer-merge-keep-stride', 'Merge keep stride', initialSlicerParams.moveMergeKeepStride, '1', '1', '200', (value) => onSlicerParamsChange({ moveMergeKeepStride: value }));

        const machineGrid = createGroup(machinePanel, 'Machine Setup', 'Machine geometry, preset selection, and bed placement belong here.');
        const printerSelect = document.createElement('select');
        printerModels.forEach((model) => {
            const option = document.createElement('option');
            option.value = model.id;
            option.text = model.name;
            printerSelect.appendChild(option);
        });
        if (printerModels.length > 0) {
            const hasCurrent = printerModels.some((model) => model.id === currentPrinterModelId);
            printerSelect.value = hasCurrent ? currentPrinterModelId : printerModels[0].id;
        }
        appendFieldRow(machineGrid, 'slicer-printer-model', 'Printer model', printerSelect);
        addSlicerField(machineGrid, 'bedWidthMm', 'slicer-bed-width', 'Bed width (mm)', initialSlicerParams.bedWidthMm, '1', '50', '1000', (value) => onSlicerParamsChange({ bedWidthMm: value }));
        addSlicerField(machineGrid, 'bedDepthMm', 'slicer-bed-depth', 'Bed depth (mm)', initialSlicerParams.bedDepthMm, '1', '50', '1000', (value) => onSlicerParamsChange({ bedDepthMm: value }));
        addSlicerField(machineGrid, 'maxPrintHeightMm', 'slicer-max-print-height', 'Max height (mm)', initialSlicerParams.maxPrintHeightMm, '1', '10', '1000', (value) => onSlicerParamsChange({ maxPrintHeightMm: value }));
        addSlicerField(machineGrid, 'centerX', 'slicer-center-x', 'Bed center X', initialSlicerParams.centerX, '0.1', '0', '400', (value) => onSlicerParamsChange({ centerX: value }));
        addSlicerField(machineGrid, 'centerZ', 'slicer-center-z', 'Bed center Y', initialSlicerParams.centerZ, '0.1', '0', '400', (value) => onSlicerParamsChange({ centerZ: value }));
        addSlicerField(machineGrid, 'travelSpeedMmPerSec', 'slicer-travel-speed', 'Travel speed (mm/s)', initialSlicerParams.travelSpeedMmPerSec, '1', '10', '300', (value) => onSlicerParamsChange({ travelSpeedMmPerSec: value }));

        const machineGcodeGrid = createGroup(machinePanel, 'Machine G-code', 'Templates support placeholders like {nozzleTempC}, {bedTempC}, and {fanPwm}.');
        addSlicerTextField(machineGcodeGrid, 'startGcode', 'slicer-start-gcode', 'Start G-code', initialSlicerParams.startGcode, (value) => onSlicerParamsChange({ startGcode: value }));
        addSlicerTextField(machineGcodeGrid, 'endGcode', 'slicer-end-gcode', 'End G-code', initialSlicerParams.endGcode, (value) => onSlicerParamsChange({ endGcode: value }));

        const materialGrid = createGroup(materialPanel, 'Material Setup', 'Thermals and extrusion settings are grouped under the filament profile.');
        const filamentSelect = document.createElement('select');
        filamentProfiles.forEach((profile) => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.text = profile.name;
            filamentSelect.appendChild(option);
        });
        if (filamentProfiles.length > 0) {
            const hasCurrent = filamentProfiles.some((profile) => profile.id === currentFilamentProfileId);
            filamentSelect.value = hasCurrent ? currentFilamentProfileId : filamentProfiles[0].id;
        }
        appendFieldRow(materialGrid, 'slicer-filament-profile', 'Filament profile', filamentSelect);
        addSlicerField(materialGrid, 'filamentDiameter', 'slicer-filament', 'Filament diameter', initialSlicerParams.filamentDiameter, '0.01', '1.0', '3.0', (value) => onSlicerParamsChange({ filamentDiameter: value }));
        addSlicerField(materialGrid, 'nozzleTempC', 'slicer-nozzle', 'Nozzle temp', initialSlicerParams.nozzleTempC, '1', '150', '300', (value) => onSlicerParamsChange({ nozzleTempC: value }));
        addSlicerField(materialGrid, 'bedTempC', 'slicer-bed', 'Bed temp', initialSlicerParams.bedTempC, '1', '0', '130', (value) => onSlicerParamsChange({ bedTempC: value }));
        addSlicerField(materialGrid, 'fanPercent', 'slicer-fan', 'Fan %', initialSlicerParams.fanPercent, '1', '0', '100', (value) => onSlicerParamsChange({ fanPercent: value }));
        addSlicerField(materialGrid, 'flowRate', 'slicer-flow', 'Flow rate', initialSlicerParams.flowRate, '0.01', '0.01', '5.0', (value) => onSlicerParamsChange({ flowRate: value }));
        addSlicerField(materialGrid, 'printSpeedMmPerSec', 'slicer-print-speed', 'Print speed (mm/s)', initialSlicerParams.printSpeedMmPerSec, '1', '5', '200', (value) => onSlicerParamsChange({ printSpeedMmPerSec: value }));
        addSlicerField(materialGrid, 'firstLayerPrintSpeedMmPerSec', 'slicer-first-layer-speed', 'First layer speed (mm/s)', initialSlicerParams.firstLayerPrintSpeedMmPerSec, '1', '5', '200', (value) => onSlicerParamsChange({ firstLayerPrintSpeedMmPerSec: value }));

        const outputGrid = createGroup(outputPanel, 'Export And Benchmark', 'Run the slicer and inspect results without leaving the workspace.');

        const outputIntro = document.createElement('p');
        outputIntro.className = 'group-caption';
        outputIntro.textContent = 'Planar contour mode is the strict algorithm. Cylindrical radial mode remains useful for star-convex profiles.';
        outputPanel.appendChild(outputIntro);

        const benchmarkIterations = document.createElement('input');
        benchmarkIterations.type = 'number';
        benchmarkIterations.className = 'action-input';
        benchmarkIterations.min = '1';
        benchmarkIterations.max = '20';
        benchmarkIterations.step = '1';
        benchmarkIterations.value = '3';
        benchmarkIterations.setAttribute('aria-label', 'Benchmark iterations');
        appendFieldRow(outputGrid, 'benchmark-iterations', 'Measured runs', benchmarkIterations);

        const benchmarkWarmups = document.createElement('input');
        benchmarkWarmups.type = 'number';
        benchmarkWarmups.className = 'action-input';
        benchmarkWarmups.min = '0';
        benchmarkWarmups.max = '10';
        benchmarkWarmups.step = '1';
        benchmarkWarmups.value = '1';
        benchmarkWarmups.setAttribute('aria-label', 'Benchmark warmup runs');
        appendFieldRow(outputGrid, 'benchmark-warmups', 'Warmup runs', benchmarkWarmups);

        const outputActions = document.createElement('div');
        outputActions.className = 'action-row';

        const generateButton = document.createElement('button');
        generateButton.type = 'button';
        generateButton.className = 'action-button';
        generateButton.textContent = 'Generate Vase G-code';

        const benchmarkButton = document.createElement('button');
        benchmarkButton.type = 'button';
        benchmarkButton.className = 'action-button action-button-secondary';
        benchmarkButton.textContent = 'Benchmark';

        outputActions.appendChild(generateButton);
        outputActions.appendChild(benchmarkButton);
        outputPanel.appendChild(outputActions);

        const outputStatus = document.createElement('div');
        outputStatus.className = 'output-console';
        outputStatus.textContent = 'Ready.';
        outputPanel.appendChild(outputStatus);

        const syncSlicerUiFromSettings = (next: VaseSlicerSettings): void => {
            (Object.keys(slicerNumericInputs) as Array<keyof VaseSlicerSettings>).forEach((key) => {
                const input = slicerNumericInputs[key];
                const value = next[key];
                if (!input || typeof value !== 'number') {
                    return;
                }

                input.value = String(value);
            });

            (Object.keys(slicerTextInputs) as Array<keyof VaseSlicerSettings>).forEach((key) => {
                const input = slicerTextInputs[key];
                const value = next[key];
                if (!input || typeof value !== 'string') {
                    return;
                }

                input.value = value;
            });

            printerSelect.value = next.printerModelId;
            filamentSelect.value = next.filamentProfileId;
            slicerModeSelect.value = next.slicerMode;
        };

        sceneSelect.addEventListener('change', () => {
            const next = onSceneChange(sceneSelect.value);
            syncSlicerUiFromSettings(next);
        });

        printerSelect.addEventListener('change', () => {
            const next = onPrinterModelChange(printerSelect.value);
            syncSlicerUiFromSettings(next);
        });

        filamentSelect.addEventListener('change', () => {
            const next = onFilamentProfileChange(filamentSelect.value);
            syncSlicerUiFromSettings(next);
        });

        const setActionsEnabled = (enabled: boolean): void => {
            generateButton.disabled = !enabled;
            benchmarkButton.disabled = !enabled;
            benchmarkIterations.disabled = !enabled;
            benchmarkWarmups.disabled = !enabled;
        };

        const runSlicerAction = (pendingLabel: string, action: () => string): void => {
            setActionsEnabled(false);
            outputStatus.textContent = pendingLabel;
            onWorkspaceStatus(pendingLabel);
            window.setTimeout(() => {
                try {
                    const message = action();
                    outputStatus.textContent = message;
                    onWorkspaceStatus(message);
                } catch (error) {
                    const message = error instanceof Error ? `Slicer error: ${error.message}` : 'Slicer error: Unknown slicer error';
                    outputStatus.textContent = message;
                    onWorkspaceStatus(message);
                } finally {
                    setActionsEnabled(true);
                }
            }, 0);
        };

        generateButton.addEventListener('click', () => {
            runSlicerAction('Generating G-code...', () => {
                const result = onGenerateVaseGcode();
                return `Exported ${result.filename} (${(result.bytes / 1024).toFixed(1)} KB, ${result.points} points).`;
            });
        });

        benchmarkButton.addEventListener('click', () => {
            const iterations = Math.max(1, Number(benchmarkIterations.value) || 1);
            const warmupRuns = Math.max(0, Number(benchmarkWarmups.value) || 0);
            const measuredLabel = `${iterations} measured run${iterations === 1 ? '' : 's'}`;
            const warmupLabel = `${warmupRuns} warmup run${warmupRuns === 1 ? '' : 's'}`;
            runSlicerAction(`Benchmarking ${measuredLabel} after ${warmupLabel}...`, () => {
                const summary = onBenchmarkVaseGcode(iterations, warmupRuns);
                return `Benchmark settled on ${summary.measuredRuns} measured run${summary.measuredRuns === 1 ? '' : 's'} after ${summary.warmupRuns} warmup run${summary.warmupRuns === 1 ? '' : 's'}: avg ${summary.averageMs.toFixed(1)} ms, median ${summary.medianMs.toFixed(1)} ms, min ${summary.minMs.toFixed(1)} ms, max ${summary.maxMs.toFixed(1)} ms, spread ${summary.spreadMs.toFixed(1)} ms. Phase avg: sample ${summary.averageContourSamplingMs.toFixed(1)} ms, toolpath ${summary.averageToolpathBuildMs.toFixed(1)} ms, gcode ${summary.averageGcodeBuildMs.toFixed(1)} ms. Last output: ${(summary.bytes / 1024).toFixed(1)} KB, ${summary.points} points, ${summary.layers} layers.`;
            });
        });

        syncSlicerUiFromSettings(initialSlicerParams);
        controlsHost.appendChild(shell);
        this.setActiveTab(this.activeTabId, false);
    }

    private setActiveTab(tabId: ControlTabId, emitEvent: boolean = true): void {
        const nextButton = this.tabButtons[tabId];
        const nextPanel = this.tabPanels[tabId];
        if (!nextButton || !nextPanel) {
            return;
        }

        this.activeTabId = tabId;
        this.storeActiveTab(tabId);

        CONTROL_TABS.forEach((tab) => {
            const button = this.tabButtons[tab.id];
            const panel = this.tabPanels[tab.id];
            const isActive = tab.id === tabId;
            if (button) {
                button.classList.toggle('is-active', isActive);
                button.setAttribute('aria-pressed', String(isActive));
            }
            if (panel) {
                panel.hidden = !isActive;
            }
        });

        if (emitEvent) {
            window.dispatchEvent(new CustomEvent('implicit:tab-change', {
                detail: { tabId },
            }));
        }
    }

    private readStoredTab(): ControlTabId {
        try {
            const stored = localStorage.getItem(CONTROL_TAB_STORAGE_KEY);
            if (stored && isControlTabId(stored)) {
                return stored;
            }
        } catch {
            // Ignore storage access issues.
        }

        return 'scene';
    }

    private storeActiveTab(tabId: ControlTabId): void {
        try {
            localStorage.setItem(CONTROL_TAB_STORAGE_KEY, tabId);
        } catch {
            // Ignore storage access issues.
        }
    }
}