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
            handlers.commitPostprocessScript(rawValue);
            return;
        case 'postprocessEnabled':
            handlers.updatePostprocessEnabled(rawValue === 'true');
            return;
        case 'sceneControl':
            handlers.updateSceneControlValue(field.key, coerceNumber(rawValue));
            return;
        case 'postprocessControl':
            handlers.updatePostprocessControlValue(field.key, coerceNumber(rawValue));
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
        case 'postprocessText':
            handlers.updatePostprocessSource(rawValue);
            return;
    }
}

export function triggerInspectorAction(action: InspectorActionSchema, handlers: InspectorSchemaHandlers): void | Promise<void> {
    switch (action.id) {
        case 'resetView':
            return handlers.resetView();
        case 'generateVaseGcode':
            return handlers.generateVaseGcode();
        case 'benchmarkVaseGcode':
            return handlers.benchmarkVaseGcode();
        case 'createPostprocessScript':
            return handlers.createPostprocessScript();
        case 'savePostprocessScript':
            return handlers.savePostprocessScript();
        case 'revertPostprocessScript':
            return handlers.revertPostprocessScript();
    }
}
