import type { RaymarchParams, ViewportParams } from '../core/renderer';

import type { FilamentProfile } from '../core/filament-profiles';
import type { PrinterModel } from '../core/printer-models';
import type { SceneOption } from '../core/shader-pipeline';
import type { VaseSlicerSettings } from '../core/slicer';

export class Controls {
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
        printerModels: PrinterModel[],
        currentPrinterModelId: string,
        onPrinterModelChange: (printerModelId: string) => VaseSlicerSettings,
        filamentProfiles: FilamentProfile[],
        currentFilamentProfileId: string,
        onFilamentProfileChange: (filamentProfileId: string) => VaseSlicerSettings,
        initialSlicerParams: VaseSlicerSettings,
        onSlicerParamsChange: (next: Partial<VaseSlicerSettings>) => void,
        onGenerateVaseGcode: () => { filename: string; bytes: number; points: number }
    ): void {
        const controlsHost = document.getElementById('controls');
        if (!controlsHost) {
            return;
        }

        controlsHost.innerHTML = '';

        const shell = document.createElement('div');
        shell.className = 'controls-shell';

        const controlsHeader = document.createElement('div');
        controlsHeader.className = 'controls-header';

        const title = document.createElement('h2');
        title.textContent = 'Controls';

        const note = document.createElement('p');
        note.className = 'controls-note';
        note.textContent = 'Left-drag to orbit, right-drag (or Shift+drag) to pan, middle-drag to dolly, scroll to zoom, and press F to reset view.';

        controlsHeader.appendChild(title);
        controlsHeader.appendChild(note);

        const viewCard = document.createElement('section');
        viewCard.className = 'section-card';

        const viewModeRow = document.createElement('div');
        viewModeRow.className = 'view-mode-row';

        const sceneRow = document.createElement('div');
        sceneRow.className = 'view-mode-row';

        const viewModeTitle = document.createElement('h3');
        viewModeTitle.textContent = 'View';

        const viewModeHint = document.createElement('p');
        viewModeHint.className = 'section-caption';
        viewModeHint.textContent = 'Switch how the surface is visualized in the viewport.';

        const viewModeLabel = document.createElement('label');
        viewModeLabel.textContent = 'View mode';
        viewModeLabel.htmlFor = 'view-mode-select';

        const viewModeSelect = document.createElement('select');
        viewModeSelect.id = 'view-mode-select';

        const sceneLabel = document.createElement('label');
        sceneLabel.textContent = 'Scene';
        sceneLabel.htmlFor = 'scene-select';

        const sceneSelect = document.createElement('select');
        sceneSelect.id = 'scene-select';

        for (const scene of sceneOptions) {
            const option = document.createElement('option');
            option.value = scene.id;
            option.text = scene.name;
            sceneSelect.appendChild(option);
        }

        if (sceneOptions.length > 0) {
            const hasCurrent = sceneOptions.some((scene) => scene.id === currentSceneId);
            sceneSelect.value = hasCurrent ? currentSceneId : sceneOptions[0].id;
        }

        const shadedOption = document.createElement('option');
        shadedOption.value = '0';
        shadedOption.text = 'Shaded';

        const normalsOption = document.createElement('option');
        normalsOption.value = '1';
        normalsOption.text = 'RGB Normals';

        const glassOption = document.createElement('option');
        glassOption.value = '2';
        glassOption.text = 'Glass';

        viewModeSelect.appendChild(shadedOption);
        viewModeSelect.appendChild(normalsOption);
        viewModeSelect.appendChild(glassOption);
        viewModeSelect.value = String(currentViewMode === 1 || currentViewMode === 2 ? currentViewMode : 0);
        viewModeSelect.addEventListener('change', () => {
            onViewModeChange(Number(viewModeSelect.value));
        });

        viewModeRow.appendChild(viewModeLabel);
        viewModeRow.appendChild(viewModeSelect);

        sceneRow.appendChild(sceneLabel);
        sceneRow.appendChild(sceneSelect);

        viewCard.appendChild(viewModeTitle);
        viewCard.appendChild(viewModeRow);
        viewCard.appendChild(sceneRow);
        viewCard.appendChild(viewModeHint);

        const raymarchCard = document.createElement('section');
        raymarchCard.className = 'section-card';

        const raymarchTitle = document.createElement('h3');
        raymarchTitle.textContent = 'Raymarch';

        const raymarchGrid = document.createElement('div');
        raymarchGrid.className = 'field-grid';

        const addNumberField = (
            id: string,
            label: string,
            value: number,
            step: string,
            min: string,
            max: string,
            onChange: (value: number) => void
        ): void => {
            const fieldLabel = document.createElement('label');
            fieldLabel.htmlFor = id;
            fieldLabel.textContent = label;

            const fieldRow = document.createElement('div');
            fieldRow.className = 'field-row';

            const fieldInput = document.createElement('input');
            fieldInput.id = id;
            fieldInput.type = 'number';
            fieldInput.step = step;
            fieldInput.min = min;
            fieldInput.max = max;
            fieldInput.value = String(value);
            fieldInput.addEventListener('change', () => {
                onChange(Number(fieldInput.value));
            });

            fieldRow.appendChild(fieldLabel);
            fieldRow.appendChild(fieldInput);
            raymarchGrid.appendChild(fieldRow);
        };

        addNumberField(
            'raymarch-max-steps',
            'Max steps',
            initialRaymarchParams.maxSteps,
            '1',
            '8',
            '512',
            (value) => onRaymarchParamsChange({ maxSteps: value })
        );

        addNumberField(
            'raymarch-hit-epsilon',
            'Hit epsilon',
            initialRaymarchParams.hitEpsilon,
            '0.0001',
            '0.0001',
            '0.02',
            (value) => onRaymarchParamsChange({ hitEpsilon: value })
        );

        addNumberField(
            'raymarch-max-distance',
            'Max distance',
            initialRaymarchParams.maxDistance,
            '0.1',
            '1',
            '200',
            (value) => onRaymarchParamsChange({ maxDistance: value })
        );

        addNumberField(
            'raymarch-focal-length',
            'Focal length',
            initialRaymarchParams.focalLength,
            '0.01',
            '0.2',
            '5.0',
            (value) => onRaymarchParamsChange({ focalLength: value })
        );

        addNumberField(
            'raymarch-step-scale',
            'Step scale',
            initialRaymarchParams.stepScale,
            '0.01',
            '0.1',
            '1.0',
            (value) => onRaymarchParamsChange({ stepScale: value })
        );

        addNumberField(
            'raymarch-min-step',
            'Min step',
            initialRaymarchParams.minStep,
            '0.0001',
            '0.00001',
            '0.05',
            (value) => onRaymarchParamsChange({ minStep: value })
        );

        addNumberField(
            'raymarch-normal-epsilon',
            'Normal epsilon',
            initialRaymarchParams.normalEpsilon,
            '0.0001',
            '0.00005',
            '0.05',
            (value) => onRaymarchParamsChange({ normalEpsilon: value })
        );

        addNumberField(
            'raymarch-refine-steps',
            'Refine steps',
            initialRaymarchParams.refineSteps,
            '1',
            '0',
            '12',
            (value) => onRaymarchParamsChange({ refineSteps: value })
        );

        const raymarchHint = document.createElement('p');
        raymarchHint.className = 'section-caption';
        raymarchHint.textContent = 'Balance quality and speed. Higher max steps and smaller epsilons cost more.';

        const viewportCard = document.createElement('section');
        viewportCard.className = 'section-card';

        const viewportTitle = document.createElement('h3');
        viewportTitle.textContent = 'Viewport';

        const viewportGrid = document.createElement('div');
        viewportGrid.className = 'field-grid';

        const addViewportField = (
            id: string,
            label: string,
            value: number,
            step: string,
            min: string,
            max: string,
            onChange: (value: number) => void
        ): void => {
            const fieldLabel = document.createElement('label');
            fieldLabel.htmlFor = id;
            fieldLabel.textContent = label;

            const fieldRow = document.createElement('div');
            fieldRow.className = 'field-row';

            const fieldInput = document.createElement('input');
            fieldInput.id = id;
            fieldInput.type = 'number';
            fieldInput.step = step;
            fieldInput.min = min;
            fieldInput.max = max;
            fieldInput.value = String(value);
            fieldInput.addEventListener('change', () => {
                onChange(Number(fieldInput.value));
            });

            fieldRow.appendChild(fieldLabel);
            fieldRow.appendChild(fieldInput);
            viewportGrid.appendChild(fieldRow);
        };

        addViewportField(
            'viewport-orbit-sensitivity',
            'Orbit speed',
            initialViewportParams.orbitSensitivity,
            '0.001',
            '0.001',
            '0.06',
            (value) => onViewportParamsChange({ orbitSensitivity: value })
        );

        addViewportField(
            'viewport-pan-sensitivity',
            'Pan speed',
            initialViewportParams.panSensitivity,
            '0.1',
            '0.2',
            '5.0',
            (value) => onViewportParamsChange({ panSensitivity: value })
        );

        addViewportField(
            'viewport-zoom-sensitivity',
            'Wheel zoom speed',
            initialViewportParams.zoomSensitivity,
            '0.0001',
            '0.0002',
            '0.02',
            (value) => onViewportParamsChange({ zoomSensitivity: value })
        );

        addViewportField(
            'viewport-dolly-sensitivity',
            'Dolly speed',
            initialViewportParams.dollySensitivity,
            '0.0005',
            '0.0005',
            '0.04',
            (value) => onViewportParamsChange({ dollySensitivity: value })
        );

        const viewportHint = document.createElement('p');
        viewportHint.className = 'section-caption';
        viewportHint.textContent = 'Adjust interaction feel for orbiting, panning, wheel zoom, and dolly drag.';

        raymarchCard.appendChild(raymarchTitle);
        raymarchCard.appendChild(raymarchGrid);
        raymarchCard.appendChild(raymarchHint);

        viewportCard.appendChild(viewportTitle);
        viewportCard.appendChild(viewportGrid);
        viewportCard.appendChild(viewportHint);

        const slicerCard = document.createElement('section');
        slicerCard.className = 'section-card';

        const slicerTitle = document.createElement('h3');
        slicerTitle.textContent = 'Vase Slicer';

        const slicerGrid = document.createElement('div');
        slicerGrid.className = 'field-grid';

        const slicerNumericInputs: Partial<Record<keyof VaseSlicerSettings, HTMLInputElement>> = {};
        const slicerTextInputs: Partial<Record<keyof VaseSlicerSettings, HTMLTextAreaElement>> = {};

        const printerFieldLabel = document.createElement('label');
        printerFieldLabel.htmlFor = 'slicer-printer-model';
        printerFieldLabel.textContent = 'Printer model';

        const printerFieldRow = document.createElement('div');
        printerFieldRow.className = 'field-row';

        const printerSelect = document.createElement('select');
        printerSelect.id = 'slicer-printer-model';

        for (const model of printerModels) {
            const option = document.createElement('option');
            option.value = model.id;
            option.text = model.name;
            printerSelect.appendChild(option);
        }

        if (printerModels.length > 0) {
            const hasCurrent = printerModels.some((model) => model.id === currentPrinterModelId);
            printerSelect.value = hasCurrent ? currentPrinterModelId : printerModels[0].id;
        }

        printerFieldRow.appendChild(printerFieldLabel);
        printerFieldRow.appendChild(printerSelect);
        slicerGrid.appendChild(printerFieldRow);

        const filamentFieldLabel = document.createElement('label');
        filamentFieldLabel.htmlFor = 'slicer-filament-profile';
        filamentFieldLabel.textContent = 'Filament profile';

        const filamentFieldRow = document.createElement('div');
        filamentFieldRow.className = 'field-row';

        const filamentSelect = document.createElement('select');
        filamentSelect.id = 'slicer-filament-profile';

        for (const profile of filamentProfiles) {
            const option = document.createElement('option');
            option.value = profile.id;
            option.text = profile.name;
            filamentSelect.appendChild(option);
        }

        if (filamentProfiles.length > 0) {
            const hasCurrent = filamentProfiles.some((profile) => profile.id === currentFilamentProfileId);
            filamentSelect.value = hasCurrent ? currentFilamentProfileId : filamentProfiles[0].id;
        }

        filamentFieldRow.appendChild(filamentFieldLabel);
        filamentFieldRow.appendChild(filamentSelect);
        slicerGrid.appendChild(filamentFieldRow);

        const syncSlicerUiFromSettings = (next: VaseSlicerSettings): void => {
            for (const key of Object.keys(slicerNumericInputs) as Array<keyof VaseSlicerSettings>) {
                const input = slicerNumericInputs[key];
                const value = next[key];
                if (!input || typeof value !== 'number') {
                    continue;
                }
                input.value = String(value);
            }

            for (const key of Object.keys(slicerTextInputs) as Array<keyof VaseSlicerSettings>) {
                const input = slicerTextInputs[key];
                const value = next[key];
                if (!input || typeof value !== 'string') {
                    continue;
                }
                input.value = value;
            }

            printerSelect.value = next.printerModelId;
            filamentSelect.value = next.filamentProfileId;
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

        const addSlicerField = (
            key: keyof VaseSlicerSettings,
            id: string,
            label: string,
            value: number,
            step: string,
            min: string,
            max: string,
            onChange: (value: number) => void
        ): void => {
            const fieldLabel = document.createElement('label');
            fieldLabel.htmlFor = id;
            fieldLabel.textContent = label;

            const fieldRow = document.createElement('div');
            fieldRow.className = 'field-row';

            const fieldInput = document.createElement('input');
            fieldInput.id = id;
            fieldInput.type = 'number';
            fieldInput.step = step;
            fieldInput.min = min;
            fieldInput.max = max;
            fieldInput.value = String(value);
            fieldInput.addEventListener('change', () => {
                onChange(Number(fieldInput.value));
            });
            slicerNumericInputs[key] = fieldInput;

            fieldRow.appendChild(fieldLabel);
            fieldRow.appendChild(fieldInput);
            slicerGrid.appendChild(fieldRow);
        };

        const addSlicerTextField = (
            key: keyof VaseSlicerSettings,
            id: string,
            label: string,
            value: string,
            onChange: (value: string) => void
        ): void => {
            const fieldLabel = document.createElement('label');
            fieldLabel.htmlFor = id;
            fieldLabel.textContent = label;

            const fieldRow = document.createElement('div');
            fieldRow.className = 'field-row field-row-textarea';

            const fieldInput = document.createElement('textarea');
            fieldInput.id = id;
            fieldInput.value = value;
            fieldInput.rows = 5;
            fieldInput.addEventListener('change', () => {
                onChange(fieldInput.value);
            });
            slicerTextInputs[key] = fieldInput;

            fieldRow.appendChild(fieldLabel);
            fieldRow.appendChild(fieldInput);
            slicerGrid.appendChild(fieldRow);
        };

        addSlicerField('minY', 'slicer-min-y', 'Min Y (SDF)', initialSlicerParams.minY, '0.01', '-5.0', '5.0', (value) => onSlicerParamsChange({ minY: value }));
        addSlicerField('maxY', 'slicer-max-y', 'Max Y (SDF)', initialSlicerParams.maxY, '0.01', '-5.0', '5.0', (value) => onSlicerParamsChange({ maxY: value }));
        addSlicerField('modelScale', 'slicer-model-scale', 'Scale (mm/unit)', initialSlicerParams.modelScale, '1', '1', '400', (value) => onSlicerParamsChange({ modelScale: value }));
        addSlicerField('bedWidthMm', 'slicer-bed-width', 'Bed width (mm)', initialSlicerParams.bedWidthMm, '1', '50', '1000', (value) => onSlicerParamsChange({ bedWidthMm: value }));
        addSlicerField('bedDepthMm', 'slicer-bed-depth', 'Bed depth (mm)', initialSlicerParams.bedDepthMm, '1', '50', '1000', (value) => onSlicerParamsChange({ bedDepthMm: value }));
        addSlicerField('maxPrintHeightMm', 'slicer-max-print-height', 'Max height (mm)', initialSlicerParams.maxPrintHeightMm, '1', '10', '1000', (value) => onSlicerParamsChange({ maxPrintHeightMm: value }));
        addSlicerField('nozzleDiameter', 'slicer-nozzle-diameter', 'Nozzle dia', initialSlicerParams.nozzleDiameter, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ nozzleDiameter: value }));
        addSlicerField('layerHeight', 'slicer-layer-height', 'Layer height', initialSlicerParams.layerHeight, '0.01', '0.05', '1.0', (value) => onSlicerParamsChange({ layerHeight: value }));
        addSlicerField('pointsPerLayer', 'slicer-points', 'Points/layer', initialSlicerParams.pointsPerLayer, '1', '48', '2048', (value) => onSlicerParamsChange({ pointsPerLayer: value }));
        addSlicerField('maxRadius', 'slicer-max-radius', 'Max radius', initialSlicerParams.maxRadius, '0.01', '0.1', '3.0', (value) => onSlicerParamsChange({ maxRadius: value }));
        addSlicerField('radialSteps', 'slicer-radial-steps', 'Radial steps', initialSlicerParams.radialSteps, '1', '32', '512', (value) => onSlicerParamsChange({ radialSteps: value }));
        addSlicerField('hitEpsilon', 'slicer-hit-eps', 'Hit epsilon', initialSlicerParams.hitEpsilon, '0.0001', '0.0001', '0.02', (value) => onSlicerParamsChange({ hitEpsilon: value }));
        addSlicerField('centerX', 'slicer-center-x', 'Bed center X', initialSlicerParams.centerX, '0.1', '0', '400', (value) => onSlicerParamsChange({ centerX: value }));
        addSlicerField('centerZ', 'slicer-center-z', 'Bed center Y', initialSlicerParams.centerZ, '0.1', '0', '400', (value) => onSlicerParamsChange({ centerZ: value }));
        addSlicerField('lineWidth', 'slicer-line-width', 'Line width', initialSlicerParams.lineWidth, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ lineWidth: value }));
        addSlicerField('firstLayerLineWidth', 'slicer-first-layer-line-width', 'First layer line width', initialSlicerParams.firstLayerLineWidth, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ firstLayerLineWidth: value }));
        addSlicerField('filamentDiameter', 'slicer-filament', 'Filament dia', initialSlicerParams.filamentDiameter, '0.01', '1.0', '3.0', (value) => onSlicerParamsChange({ filamentDiameter: value }));
        addSlicerField('firstLayerPrintSpeedMmPerSec', 'slicer-first-layer-speed', 'First layer speed (mm/s)', initialSlicerParams.firstLayerPrintSpeedMmPerSec, '1', '5', '200', (value) => onSlicerParamsChange({ firstLayerPrintSpeedMmPerSec: value }));
        addSlicerField('printSpeedMmPerSec', 'slicer-print-speed', 'Print speed (mm/s)', initialSlicerParams.printSpeedMmPerSec, '1', '5', '200', (value) => onSlicerParamsChange({ printSpeedMmPerSec: value }));
        addSlicerField('travelSpeedMmPerSec', 'slicer-travel-speed', 'Travel speed (mm/s)', initialSlicerParams.travelSpeedMmPerSec, '1', '10', '300', (value) => onSlicerParamsChange({ travelSpeedMmPerSec: value }));
        addSlicerField('nozzleTempC', 'slicer-nozzle', 'Nozzle temp', initialSlicerParams.nozzleTempC, '1', '150', '300', (value) => onSlicerParamsChange({ nozzleTempC: value }));
        addSlicerField('bedTempC', 'slicer-bed', 'Bed temp', initialSlicerParams.bedTempC, '1', '0', '130', (value) => onSlicerParamsChange({ bedTempC: value }));
        addSlicerField('fanPercent', 'slicer-fan', 'Fan %', initialSlicerParams.fanPercent, '1', '0', '100', (value) => onSlicerParamsChange({ fanPercent: value }));
        addSlicerField('flowRate', 'slicer-flow', 'Flow rate', initialSlicerParams.flowRate, '0.01', '0.01', '5.0', (value) => onSlicerParamsChange({ flowRate: value }));
        addSlicerField('moveMergeMinMoveMm', 'slicer-merge-min-move', 'Merge min move (mm)', initialSlicerParams.moveMergeMinMoveMm, '0.005', '0.005', '1.0', (value) => onSlicerParamsChange({ moveMergeMinMoveMm: value }));
        addSlicerField('moveMergeMaxDeviationMm', 'slicer-merge-max-deviation', 'Merge max deviation (mm)', initialSlicerParams.moveMergeMaxDeviationMm, '0.001', '0.001', '0.5', (value) => onSlicerParamsChange({ moveMergeMaxDeviationMm: value }));
        addSlicerField('moveMergeMaxTurnDeg', 'slicer-merge-max-turn', 'Merge max turn (deg)', initialSlicerParams.moveMergeMaxTurnDeg, '0.1', '0.5', '45', (value) => onSlicerParamsChange({ moveMergeMaxTurnDeg: value }));
        addSlicerField('moveMergeKeepStride', 'slicer-merge-keep-stride', 'Merge keep stride', initialSlicerParams.moveMergeKeepStride, '1', '1', '200', (value) => onSlicerParamsChange({ moveMergeKeepStride: value }));
        addSlicerField('brimWidthMm', 'slicer-brim-width', 'Brim width (mm)', initialSlicerParams.brimWidthMm, '0.1', '0', '30', (value) => onSlicerParamsChange({ brimWidthMm: value }));
        addSlicerField('brimGapMm', 'slicer-brim-gap', 'Brim gap (mm)', initialSlicerParams.brimGapMm, '0.05', '0', '5', (value) => onSlicerParamsChange({ brimGapMm: value }));
        addSlicerTextField('startGcode', 'slicer-start-gcode', 'Start G-code', initialSlicerParams.startGcode, (value) => onSlicerParamsChange({ startGcode: value }));
        addSlicerTextField('endGcode', 'slicer-end-gcode', 'End G-code', initialSlicerParams.endGcode, (value) => onSlicerParamsChange({ endGcode: value }));

        const slicerHint = document.createElement('p');
        slicerHint.className = 'section-caption';
        slicerHint.textContent = 'Generates a spiral vase contour using GPU radius sampling and exports .gcode. Merge controls tune move simplification aggressiveness. Start/end templates support {nozzleTempC}, {bedTempC}, and {fanPwm}.';

        syncSlicerUiFromSettings(initialSlicerParams);

        const slicerActions = document.createElement('div');
        slicerActions.className = 'action-row';

        const generateButton = document.createElement('button');
        generateButton.type = 'button';
        generateButton.className = 'action-button';
        generateButton.textContent = 'Generate Vase G-code';

        const slicerStatus = document.createElement('p');
        slicerStatus.className = 'section-caption action-status';
        slicerStatus.textContent = 'Ready.';

        generateButton.addEventListener('click', () => {
            try {
                const result = onGenerateVaseGcode();
                slicerStatus.textContent = `Exported ${result.filename} (${(result.bytes / 1024).toFixed(1)} KB, ${result.points} points).`;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown slicer error';
                slicerStatus.textContent = `Slicer error: ${message}`;
            }
        });

        slicerActions.appendChild(generateButton);

        slicerCard.appendChild(slicerTitle);
        slicerCard.appendChild(slicerGrid);
        slicerCard.appendChild(slicerActions);
        slicerCard.appendChild(slicerHint);
        slicerCard.appendChild(slicerStatus);

        shell.appendChild(controlsHeader);
        shell.appendChild(viewCard);
        shell.appendChild(raymarchCard);
        shell.appendChild(viewportCard);
        shell.appendChild(slicerCard);
        controlsHost.appendChild(shell);
    }
}