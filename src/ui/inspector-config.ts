export type ControlTabId = 'scene' | 'camera' | 'render' | 'print' | 'machine' | 'material' | 'output';

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
    | 'hitEpsilon'
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
    | 'firstLayerPrintSpeedMmPerSec';

export interface NumberField<Key extends string> {
    key: Key;
    id: string;
    label: string;
    step: string;
    min: string;
    max: string;
}

export const INSPECTOR_TABS: Array<{ id: ControlTabId; label: string }> = [
    { id: 'scene', label: 'Scene' },
    { id: 'camera', label: 'Camera' },
    { id: 'render', label: 'Render' },
    { id: 'print', label: 'Print' },
    { id: 'machine', label: 'Machine' },
    { id: 'material', label: 'Material' },
    { id: 'output', label: 'Output' },
];

export const VIEW_MODE_OPTIONS = [
    { value: '0', label: 'Shaded' },
    { value: '1', label: 'RGB Normals' },
    { value: '2', label: 'Glass' },
];

export const SLICER_MODE_OPTIONS = [
    { value: 'planar', label: 'Planar contour (strict)' },
    { value: 'cylindrical', label: 'Cylindrical radial (legacy)' },
];

export const RAYMARCH_FIELDS: Array<NumberField<string>> = [
    { key: 'maxSteps', id: 'raymarch-max-steps', label: 'Max steps', step: '1', min: '8', max: '512' },
    { key: 'hitEpsilon', id: 'raymarch-hit-epsilon', label: 'Hit epsilon', step: '0.0001', min: '0.0001', max: '0.02' },
    { key: 'maxDistance', id: 'raymarch-max-distance', label: 'Max distance', step: '0.1', min: '1', max: '200' },
    { key: 'focalLength', id: 'raymarch-focal-length', label: 'Focal length', step: '0.01', min: '0.2', max: '5.0' },
    { key: 'stepScale', id: 'raymarch-step-scale', label: 'Step scale', step: '0.01', min: '0.1', max: '1.0' },
    { key: 'minStep', id: 'raymarch-min-step', label: 'Min step', step: '0.0001', min: '0.00001', max: '0.05' },
    { key: 'normalEpsilon', id: 'raymarch-normal-epsilon', label: 'Normal epsilon', step: '0.0001', min: '0.00005', max: '0.05' },
    { key: 'refineSteps', id: 'raymarch-refine-steps', label: 'Refine steps', step: '1', min: '0', max: '12' },
];

export const VIEWPORT_FIELDS: Array<NumberField<string>> = [
    { key: 'orbitSensitivity', id: 'viewport-orbit-sensitivity', label: 'Orbit speed', step: '0.001', min: '0.001', max: '0.06' },
    { key: 'panSensitivity', id: 'viewport-pan-sensitivity', label: 'Pan speed', step: '0.1', min: '0.2', max: '5.0' },
    { key: 'zoomSensitivity', id: 'viewport-zoom-sensitivity', label: 'Wheel zoom speed', step: '0.0001', min: '0.0002', max: '0.02' },
    { key: 'dollySensitivity', id: 'viewport-dolly-sensitivity', label: 'Dolly speed', step: '0.0005', min: '0.0005', max: '0.04' },
];

export const ANIMATION_FIELDS: Array<NumberField<string>> = [
    { key: 'targetFrameRate', id: 'animation-target-frame-rate', label: 'Target FPS', step: '1', min: '0', max: '120' },
    { key: 'framePeriod', id: 'animation-frame-period', label: 'Frame periodicity', step: '1', min: '1', max: '4096' },
];

export const PRINT_GEOMETRY_FIELDS: Array<NumberField<NumericSlicerKey>> = [
    { key: 'minY', id: 'slicer-min-y', label: 'Min Y (SDF)', step: '0.01', min: '-5.0', max: '5.0' },
    { key: 'maxY', id: 'slicer-max-y', label: 'Max Y (SDF)', step: '0.01', min: '-5.0', max: '5.0' },
    { key: 'modelScale', id: 'slicer-model-scale', label: 'Scale (mm/unit)', step: '1', min: '1', max: '400' },
    { key: 'layerHeight', id: 'slicer-layer-height', label: 'Layer height', step: '0.01', min: '0.05', max: '1.0' },
    { key: 'nozzleDiameter', id: 'slicer-nozzle-diameter', label: 'Nozzle diameter', step: '0.01', min: '0.2', max: '1.2' },
    { key: 'lineWidth', id: 'slicer-line-width', label: 'Line width', step: '0.01', min: '0.2', max: '1.2' },
    { key: 'firstLayerLineWidth', id: 'slicer-first-layer-line-width', label: 'First layer line width', step: '0.01', min: '0.2', max: '1.2' },
    { key: 'pointsPerLayer', id: 'slicer-points', label: 'Points per layer', step: '1', min: '48', max: '2048' },
    { key: 'maxRadius', id: 'slicer-max-radius', label: 'Slice half-extent', step: '0.01', min: '0.1', max: '3.0' },
    { key: 'radialSteps', id: 'slicer-radial-steps', label: 'Slice grid', step: '1', min: '32', max: '512' },
    { key: 'hitEpsilon', id: 'slicer-hit-eps', label: 'Iso epsilon', step: '0.0001', min: '0.0001', max: '0.02' },
];

export const PRINT_ADHESION_FIELDS: Array<NumberField<NumericSlicerKey>> = [
    { key: 'brimWidthMm', id: 'slicer-brim-width', label: 'Brim width (mm)', step: '0.1', min: '0', max: '30' },
    { key: 'brimGapMm', id: 'slicer-brim-gap', label: 'Brim gap (mm)', step: '0.05', min: '0', max: '5' },
    { key: 'moveMergeMinMoveMm', id: 'slicer-merge-min-move', label: 'Merge min move (mm)', step: '0.005', min: '0.005', max: '1.0' },
    { key: 'moveMergeMaxDeviationMm', id: 'slicer-merge-max-deviation', label: 'Merge max deviation (mm)', step: '0.001', min: '0.001', max: '0.5' },
    { key: 'moveMergeMaxTurnDeg', id: 'slicer-merge-max-turn', label: 'Merge max turn (deg)', step: '0.1', min: '0.5', max: '45' },
    { key: 'moveMergeKeepStride', id: 'slicer-merge-keep-stride', label: 'Merge keep stride', step: '1', min: '1', max: '200' },
];

export const MACHINE_FIELDS: Array<NumberField<NumericSlicerKey>> = [
    { key: 'bedWidthMm', id: 'slicer-bed-width', label: 'Bed width (mm)', step: '1', min: '50', max: '1000' },
    { key: 'bedDepthMm', id: 'slicer-bed-depth', label: 'Bed depth (mm)', step: '1', min: '50', max: '1000' },
    { key: 'maxPrintHeightMm', id: 'slicer-max-print-height', label: 'Max height (mm)', step: '1', min: '10', max: '1000' },
    { key: 'centerX', id: 'slicer-center-x', label: 'Bed center X', step: '0.1', min: '0', max: '400' },
    { key: 'centerZ', id: 'slicer-center-z', label: 'Bed center Y', step: '0.1', min: '0', max: '400' },
    { key: 'travelSpeedMmPerSec', id: 'slicer-travel-speed', label: 'Travel speed (mm/s)', step: '1', min: '10', max: '300' },
];

export const MATERIAL_FIELDS: Array<NumberField<NumericSlicerKey>> = [
    { key: 'filamentDiameter', id: 'slicer-filament', label: 'Filament diameter', step: '0.01', min: '1.0', max: '3.0' },
    { key: 'nozzleTempC', id: 'slicer-nozzle', label: 'Nozzle temp', step: '1', min: '150', max: '300' },
    { key: 'bedTempC', id: 'slicer-bed', label: 'Bed temp', step: '1', min: '0', max: '130' },
    { key: 'fanPercent', id: 'slicer-fan', label: 'Fan %', step: '1', min: '0', max: '100' },
    { key: 'flowRate', id: 'slicer-flow', label: 'Flow rate', step: '0.01', min: '0.01', max: '5.0' },
    { key: 'printSpeedMmPerSec', id: 'slicer-print-speed', label: 'Print speed (mm/s)', step: '1', min: '5', max: '200' },
    { key: 'firstLayerPrintSpeedMmPerSec', id: 'slicer-first-layer-speed', label: 'First layer speed (mm/s)', step: '1', min: '5', max: '200' },
];