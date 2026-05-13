export interface RaymarchParams {
    maxSteps: number;
    hitEpsilon: number;
    maxDistance: number;
    focalLength: number;
    stepScale: number;
    minStep: number;
    normalEpsilon: number;
    refineSteps: number;
}

export interface ViewportParams {
    orbitSensitivity: number;
    panSensitivity: number;
    zoomSensitivity: number;
    dollySensitivity: number;
}

export interface AnimationParams {
    targetFrameRate: number;
    framePeriod: number;
}

export interface CameraState {
    position: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
    right: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    focalLength: number;
    viewportWidth: number;
    viewportHeight: number;
}

export interface SceneSlicerUniformState {
    minY: number;
    maxY: number;
    modelScale: number;
    maxRadius: number;
    nozzleDiameter: number;
    flowRate: number;
    layerHeight: number;
    lineWidth: number;
    firstLayerLineWidth: number;
}
