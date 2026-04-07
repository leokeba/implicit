// Scene-owned slicer defaults. Parsed by TypeScript at startup.
#define SCENE_DEFAULT_MIN_Y -1.0
#define SCENE_DEFAULT_MAX_Y 1.0
#define SCENE_DEFAULT_MAX_RADIUS 1.1
#define SCENE_DEFAULT_MODEL_SCALE 25.0
// @control {"key":"radius","label":"Radius","uniform":"uSceneRadius","min":0.35,"max":1.6,"step":0.05,"default":1.0,"section":"Shape","description":"Default scene profile controls."}
// @control {"key":"halfHeight","label":"Half height","uniform":"uSceneHalfHeight","min":0.35,"max":1.8,"step":0.05,"default":1.0,"section":"Shape"}

uniform float uSceneRadius;
uniform float uSceneHalfHeight;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float wrapPi(float a) {
    return mod(a + 3.14159265, 6.2831853) - 3.14159265;
}

float mapScene(vec3 p) {
    return sdCappedCylinder(p, uSceneHalfHeight, uSceneRadius);
}
