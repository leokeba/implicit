export type SceneParamValue = number | boolean | string;
export type SceneParamMap = Record<string, SceneParamValue>;
export type SceneControlValueMap = Record<string, number>;

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
