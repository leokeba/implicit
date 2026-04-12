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
        case 'postprocessEnabled':
            return String(state.postprocessEnabled);
        case 'postprocessAutoUpdate':
            return String(state.postprocessAutoUpdate);
        case 'printerConnectionAutoStart':
            return String(state.printerConnection.autoStartPrint);
        case 'printerConnection':
            return state.printerConnection[field.key];
        case 'sceneControl':
            return state.sceneControlValues[field.key] ?? 0;
        case 'postprocessControl':
            return state.postprocessControlValues[field.key] ?? 0;
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
        case 'postprocessText':
            return state.postprocessSource;
    }
}

export function readFieldOptions(field: InspectorFieldSchema, state: InspectorSchemaState): InspectorFieldOption[] {
    if (field.kind !== 'select') {
        return [];
    }

    if (
        field.target === 'viewMode' ||
        field.target === 'slicerMode' ||
        field.target === 'slicerBoolean' ||
        field.target === 'postprocessEnabled' ||
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
