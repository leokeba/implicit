// Scene-owned slicer defaults. Parsed by TypeScript at startup.
#define SCENE_DEFAULT_MIN_Y -1.0
#define SCENE_DEFAULT_MAX_Y 1.0
#define SCENE_DEFAULT_MAX_RADIUS 1.1
#define SCENE_DEFAULT_MODEL_SCALE 25.0
// @control {"key":"radius","label":"Radius","uniform":"uSceneRadius","min":0.35,"max":1.6,"step":0.05,"default":1.0,"section":"Shape","description":"Default scene profile controls."}
// @control {"key":"halfHeight","label":"Half height","uniform":"uSceneHalfHeight","min":0.35,"max":1.8,"step":0.05,"default":1.0,"section":"Shape"}
// @control {"key":"noiseScale","label":"Noise scale","uniform":"uSceneNoiseScale","min":0.25,"max":4.0,"step":0.05,"default":1.3,"section":"Field","description":"Frequency of the default postprocess noise field."}
// @control {"key":"noiseContrast","label":"Noise contrast","uniform":"uSceneNoiseContrast","min":0.0,"max":2.0,"step":0.05,"default":1.0,"section":"Field","description":"Push the default noise field toward flatter or punchier modulation."}
// @control {"key":"noiseMode","label":"Noise mode","uniform":"uSceneNoiseMode","default":0.0,"options":["Simplex","Ridged"],"section":"Field","description":"Switch between smooth simplex noise and a ridged variant for modulation."}
// @field {"key":"noise","label":"Noise","fn":"sampleToolpathNoise","type":"float","min":0.0,"max":1.0,"description":"Normalized field sampled along the raw spiral toolpath for postprocess modulation."}

uniform float uSceneRadius;
uniform float uSceneHalfHeight;
uniform float uSceneNoiseScale;
uniform float uSceneNoiseContrast;
uniform float uSceneNoiseMode;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float wrapPi(float a) {
    return mod(a + 3.14159265, 6.2831853) - 3.14159265;
}

float sampleToolpathNoise(vec3 p) {
    float baseNoise = simplexNoise(p * max(uSceneNoiseScale, 1e-4)) * 0.5 + 0.5;
    if (uSceneNoiseMode >= 0.5) {
        baseNoise = 1.0 - abs((baseNoise * 2.0) - 1.0);
    }

    float centered = (baseNoise * 2.0) - 1.0;
    float contrasted = centered * max(uSceneNoiseContrast, 0.0);
    return saturate((contrasted * 0.5) + 0.5);
}

float mapScene(vec3 p) {
    return sdCappedCylinder(p, uSceneHalfHeight, uSceneRadius);
}
