import type { InspectorFieldOption, InspectorFieldSchema, InspectorSchemaState } from './types';

export function readFieldValue(field: InspectorFieldSchema, state: InspectorSchemaState): string | number {
    switch (field.target) {
        case 'scene':
            return state.sceneId;
        case 'viewMode':
            return String(state.viewMode);
        case 'slicerMode':
            return state.slicerSettings.slicerMode;
        case 'slicerBoolean':
            return String(state.slicerSettings[field.key]);
        case 'printerModel':
            return state.slicerSettings.printerModelId;
        case 'filamentProfile':
            return state.slicerSettings.filamentProfileId;
        case 'postprocessScript':
            return state.activePostprocessScriptId;
        case 'postprocessAutoUpdate':
            return String(state.postprocessAutoUpdate);
        case 'printerConnectionAutoStart':
            return String(state.printerConnection.autoStartPrint);
        case 'printerConnection':
            return state.printerConnection[field.key];
        case 'uniform':
            return state.uniformValues[field.key] ?? 0;
        case 'sceneParam':
            return state.paramValues[field.key] ?? 0;
        case 'stepControl':
            return state.pipeline[field.stepIndex]?.params[field.key] ?? 0;
        case 'stepEnabled':
            return String(state.pipeline[field.stepIndex]?.enabled ?? true);
        case 'raymarch':
            return state.raymarchParams[field.key];
        case 'viewport':
            return state.viewportParams[field.key];
        case 'animation':
            return state.animationParams[field.key];
        case 'slicer':
            return state.slicerSettings[field.key];
        case 'command':
            return state[field.key];
        case 'slicerText':
            return state.slicerSettings[field.key];
    }
}

export function readFieldOptions(field: InspectorFieldSchema, state: InspectorSchemaState): InspectorFieldOption[] {
    if (field.kind !== 'select') {
        return [];
    }

    if (
        field.target === 'uniform' ||
        field.target === 'sceneParam' ||
        field.target === 'stepControl' ||
        field.target === 'stepEnabled' ||
        field.target === 'viewMode' ||
        field.target === 'slicerMode' ||
        field.target === 'slicerBoolean' ||
        field.target === 'postprocessAutoUpdate' ||
        field.target === 'printerConnectionAutoStart'
    ) {
        return field.options;
    }

    if (field.target === 'scene') {
        return state.sceneOptions.map((scene) => ({ value: scene.id, label: scene.name }));
    }

    if (field.target === 'printerModel') {
        return state.printerModels.map((printer) => ({ value: printer.id, label: printer.name }));
    }

    if (field.target === 'filamentProfile') {
        return state.filamentProfiles.map((profile) => ({ value: profile.id, label: profile.name }));
    }

    if (field.target === 'postprocessScript') {
        return state.postprocessDocuments.map((document) => ({ value: document.id, label: document.name }));
    }

    return [];
}

export function isFieldDisabled(field: InspectorFieldSchema, state: InspectorSchemaState): boolean {
    return Boolean(field.disabledWhenPending && state.actionPending);
}

/** True when the field's value deviates from the file-derived configuration. */
export function isFieldOverridden(field: InspectorFieldSchema, state: InspectorSchemaState): boolean {
    switch (field.target) {
        case 'slicer':
        case 'slicerText':
        case 'slicerBoolean':
            return state.overriddenSlicerKeys.includes(field.key);
        case 'slicerMode':
            return state.overriddenSlicerKeys.includes('slicerMode');
        case 'uniform':
            return state.overriddenUniformKeys.includes(field.key);
        case 'sceneParam':
            return state.overriddenParamKeys.includes(field.key);
        case 'stepControl':
            return state.pipeline[field.stepIndex]?.overriddenParamKeys.includes(field.key) ?? false;
        case 'printerModel':
            return state.printerOverridden;
        case 'filamentProfile':
            return state.filamentOverridden;
        default:
            return false;
    }
}

/** True when an overridden field supports one-click reset back to the scene value. */
export function canResetField(field: InspectorFieldSchema): boolean {
    return field.target === 'slicer'
        || field.target === 'slicerText'
        || field.target === 'slicerBoolean'
        || field.target === 'slicerMode'
        || field.target === 'uniform'
        || field.target === 'sceneParam'
        || field.target === 'stepControl';
}
