import type { RaymarchParams, ViewportParams } from '../core/renderer';

import type { VaseSlicerSettings } from '../core/slicer';

export class Controls {
    public init(
        currentViewMode: number,
        onViewModeChange: (viewMode: number) => void,
        initialRaymarchParams: RaymarchParams,
        onRaymarchParamsChange: (next: Partial<RaymarchParams>) => void,
        initialViewportParams: ViewportParams,
        onViewportParamsChange: (next: Partial<ViewportParams>) => void,
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

        viewCard.appendChild(viewModeTitle);
        viewCard.appendChild(viewModeRow);
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

        const addSlicerField = (
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
            slicerGrid.appendChild(fieldRow);
        };

        addSlicerField('slicer-min-y', 'Min Y (SDF)', initialSlicerParams.minY, '0.01', '-5.0', '5.0', (value) => onSlicerParamsChange({ minY: value }));
        addSlicerField('slicer-max-y', 'Max Y (SDF)', initialSlicerParams.maxY, '0.01', '-5.0', '5.0', (value) => onSlicerParamsChange({ maxY: value }));
        addSlicerField('slicer-model-scale', 'Scale (mm/unit)', initialSlicerParams.modelScale, '1', '1', '400', (value) => onSlicerParamsChange({ modelScale: value }));
        addSlicerField('slicer-nozzle-diameter', 'Nozzle dia', initialSlicerParams.nozzleDiameter, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ nozzleDiameter: value }));
        addSlicerField('slicer-layer-height', 'Layer height', initialSlicerParams.layerHeight, '0.01', '0.05', '1.0', (value) => onSlicerParamsChange({ layerHeight: value }));
        addSlicerField('slicer-points', 'Points/layer', initialSlicerParams.pointsPerLayer, '1', '48', '2048', (value) => onSlicerParamsChange({ pointsPerLayer: value }));
        addSlicerField('slicer-max-radius', 'Max radius', initialSlicerParams.maxRadius, '0.01', '0.1', '3.0', (value) => onSlicerParamsChange({ maxRadius: value }));
        addSlicerField('slicer-radial-steps', 'Radial steps', initialSlicerParams.radialSteps, '1', '32', '512', (value) => onSlicerParamsChange({ radialSteps: value }));
        addSlicerField('slicer-hit-eps', 'Hit epsilon', initialSlicerParams.hitEpsilon, '0.0001', '0.0001', '0.02', (value) => onSlicerParamsChange({ hitEpsilon: value }));
        addSlicerField('slicer-center-x', 'Bed center X', initialSlicerParams.centerX, '0.1', '0', '400', (value) => onSlicerParamsChange({ centerX: value }));
        addSlicerField('slicer-center-z', 'Bed center Y', initialSlicerParams.centerZ, '0.1', '0', '400', (value) => onSlicerParamsChange({ centerZ: value }));
        addSlicerField('slicer-line-width', 'Line width', initialSlicerParams.lineWidth, '0.01', '0.2', '1.2', (value) => onSlicerParamsChange({ lineWidth: value }));
        addSlicerField('slicer-filament', 'Filament dia', initialSlicerParams.filamentDiameter, '0.01', '1.0', '3.0', (value) => onSlicerParamsChange({ filamentDiameter: value }));
        addSlicerField('slicer-print-speed', 'Print speed (mm/s)', initialSlicerParams.printSpeedMmPerSec, '1', '5', '200', (value) => onSlicerParamsChange({ printSpeedMmPerSec: value }));
        addSlicerField('slicer-travel-speed', 'Travel speed (mm/s)', initialSlicerParams.travelSpeedMmPerSec, '1', '10', '300', (value) => onSlicerParamsChange({ travelSpeedMmPerSec: value }));
        addSlicerField('slicer-nozzle', 'Nozzle temp', initialSlicerParams.nozzleTempC, '1', '150', '300', (value) => onSlicerParamsChange({ nozzleTempC: value }));
        addSlicerField('slicer-bed', 'Bed temp', initialSlicerParams.bedTempC, '1', '0', '130', (value) => onSlicerParamsChange({ bedTempC: value }));
        addSlicerField('slicer-fan', 'Fan %', initialSlicerParams.fanPercent, '1', '0', '100', (value) => onSlicerParamsChange({ fanPercent: value }));
        addSlicerField('slicer-flow', 'Flow rate', initialSlicerParams.flowRate, '0.01', '0.01', '5.0', (value) => onSlicerParamsChange({ flowRate: value }));

        const slicerHint = document.createElement('p');
        slicerHint.className = 'section-caption';
        slicerHint.textContent = 'Generates a spiral vase contour using GPU radius sampling and exports .gcode.';

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