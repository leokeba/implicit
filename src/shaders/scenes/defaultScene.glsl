// Scene-owned slicer defaults. Parsed by TypeScript at startup.
#define SCENE_DEFAULT_MIN_Y -1.0
#define SCENE_DEFAULT_MAX_Y 1.0
#define SCENE_DEFAULT_MAX_RADIUS 1.1
#define SCENE_DEFAULT_MODEL_SCALE 25.0

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float wrapPi(float a) {
    return mod(a + 3.14159265, 6.2831853) - 3.14159265;
}

float mapScene(vec3 p) {
    return sdCappedCylinder(p, 1., 1.);
}
