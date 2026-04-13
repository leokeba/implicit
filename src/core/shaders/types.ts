export type SceneParamValue = number | boolean | string;
export type SceneParamMap = Record<string, SceneParamValue>;
export type SceneControlValueMap = Record<string, number>;
export type SceneFieldType = 'float' | 'vec2' | 'vec3' | 'vec4';

export type SceneFieldValue = number | [number, number] | [number, number, number] | [number, number, number, number];

export interface SceneControlDefinition {
    key: string;
    label: string;
    uniform: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    section: string;
    description?: string;
}

export interface SceneFieldDefinition {
    key: string;
    label: string;
    fn: string;
    type: SceneFieldType;
    minValue: number;
    maxValue: number;
    description?: string;
}

export interface SceneSlicerDefaults {
    minY?: number;
    maxY?: number;
    modelScale?: number;
    maxRadius?: number;
    nozzleDiameterMm?: number;
    flowRate?: number;
    layerHeightMm?: number;
}

export interface SceneOption {
    id: string;
    name: string;
}

export interface SceneDocument extends SceneOption {
    fileName: string;
    source: string;
}
