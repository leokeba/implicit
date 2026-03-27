// Scene-owned slicer defaults. Parsed by TypeScript at startup.
#define SCENE_DEFAULT_MIN_Y -1.0
#define SCENE_DEFAULT_MAX_Y 1.0
#define SCENE_DEFAULT_MAX_RADIUS 1.1
#define SCENE_DEFAULT_NOZZLE_DIAMETER_MM 0.4
#define SCENE_DEFAULT_FLOW_RATE 1.0
#define SCENE_DEFAULT_LAYER_HEIGHT_MM 0.2

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float wrapPi(float a) {
    return mod(a + 3.14159265, 6.2831853) - 3.14159265;
}

float angleUnit(vec2 p) {
    return atan(p.y, p.x) / 6.28318530718;
}

float spiralPosition(vec3 p) {
    float angle = fract(angleUnit(p.xz));
    float layer = fract(p.y * uScale / uLayerHeight +angle);
    return layer;
}

float mapScene(vec3 p) {
    return sdCappedCylinder(p, 1., 1.);
}
