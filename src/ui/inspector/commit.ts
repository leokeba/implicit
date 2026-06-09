import type { InspectorActionSchema, InspectorFieldSchema, InspectorSchemaHandlers } from './types';

function coerceNumber(rawValue: string): number {
    const normalized = rawValue.trim().replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function commitFieldValue(field: InspectorFieldSchema, rawValue: string, handlers: InspectorSchemaHandlers): void {
    switch (field.target) {
        case 'scene':
            handlers.commitScene(rawValue);
            return;
        case 'viewMode':
            handlers.commitViewMode(Number(rawValue));
            return;
        case 'slicerMode':
            handlers.updateSlicerMode(rawValue);
            return;
        case 'slicerBoolean':
            handlers.updateSlicerBoolean(field.key, rawValue === 'true');
            return;
        case 'printerModel':
            handlers.commitPrinterModel(rawValue);
            return;
        case 'filamentProfile':
            handlers.commitFilamentProfile(rawValue);
            return;
        case 'postprocessScript':
            handlers.selectPostprocessScript(rawValue);
            return;
        case 'postprocessAutoUpdate':
            handlers.updatePostprocessAutoUpdate(rawValue === 'true');
            return;
        case 'printerConnectionAutoStart':
            handlers.updatePrinterConnectionAutoStart(rawValue === 'true');
            return;
        case 'printerConnection':
            handlers.updatePrinterConnectionString(field.key, rawValue);
            return;
        case 'uniform':
            handlers.updateUniformValue(field.key, coerceNumber(rawValue));
            return;
        case 'sceneParam':
            handlers.updateParamValue(field.key, coerceNumber(rawValue));
            return;
        case 'stepControl':
            handlers.updateStepParam(field.stepIndex, field.key, coerceNumber(rawValue));
            return;
        case 'stepEnabled':
            handlers.setStepEnabled(field.stepIndex, rawValue === 'true');
            return;
        case 'viewport':
            handlers.updateViewportField(field.key, coerceNumber(rawValue));
            return;
        case 'raymarch':
            handlers.updateRaymarchField(field.key, coerceNumber(rawValue));
            return;
        case 'animation':
            handlers.updateAnimationField(field.key, coerceNumber(rawValue));
            return;
        case 'slicer':
            handlers.updateSlicerNumber(field.key, coerceNumber(rawValue));
            return;
        case 'command':
            if (field.key === 'benchmarkIterations') {
                handlers.setBenchmarkIterations(coerceNumber(rawValue));
                return;
            }

            handlers.setBenchmarkWarmups(coerceNumber(rawValue));
            return;
        case 'slicerText':
            handlers.updateSlicerString(field.key, rawValue);
            return;
    }
}

export function resetFieldOverride(field: InspectorFieldSchema, handlers: InspectorSchemaHandlers): void {
    switch (field.target) {
        case 'slicer':
        case 'slicerText':
        case 'slicerBoolean':
            handlers.resetFieldOverride('slicer', field.key);
            return;
        case 'slicerMode':
            handlers.resetFieldOverride('slicer', 'slicerMode');
            return;
        case 'uniform':
            handlers.resetFieldOverride('uniform', field.key);
            return;
        case 'sceneParam':
            handlers.resetFieldOverride('param', field.key);
            return;
        case 'stepControl':
            handlers.resetStepParamOverride(field.stepIndex, field.key);
            return;
        default:
            return;
    }
}

export function triggerInspectorAction(action: InspectorActionSchema, handlers: InspectorSchemaHandlers): void | Promise<void> {
    switch (action.id) {
        case 'resetView':
            return handlers.resetView();
        case 'generateVaseGcode':
            return handlers.generateVaseGcode();
        case 'downloadGeneratedGcode':
            return handlers.downloadGeneratedGcode();
        case 'sendVaseGcodeToPrinter':
            return handlers.sendVaseGcodeToPrinter();
        case 'benchmarkVaseGcode':
            return handlers.benchmarkVaseGcode();
        case 'createPostprocessScript':
            return handlers.createPostprocessScript();
        case 'savePostprocessScript':
            return handlers.savePostprocessScript();
        case 'revertPostprocessScript':
            return handlers.revertPostprocessScript();
        case 'resetAllOverrides':
            return handlers.resetAllOverrides();
    }
}
