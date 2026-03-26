// Scene-owned slicer defaults. Parsed by TypeScript at startup.
#define SCENE_DEFAULT_MIN_Y -1.0
#define SCENE_DEFAULT_MAX_Y 1.0
#define SCENE_DEFAULT_MAX_RADIUS 1.1
#define SCENE_DEFAULT_NOZZLE_DIAMETER_MM 0.4
#define SCENE_DEFAULT_FLOW_RATE 1.0
#define SCENE_DEFAULT_LAYER_HEIGHT_MM 0.24

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
    float layer = fract(p.y + uScale / uLayerHeight+angle);
    return layer;
}

float mapScene(vec3 p) {
    return sdCappedCylinder(p, 1., 1.) + sin(spiralPosition(p) * 10.0) * 0.01;
    // Scene can react to live slicer uniforms in both render and slicing passes.
    float adaptiveLayer = clamp(uLayerHeight, 0.05, 1.0);
    float adaptiveNozzle = clamp(uNozzleDiameter, 0.2, 1.2);
    float adaptiveFlow = clamp(uFlowRate, 0.01, 5.0);

    float h = 1.45;
    float v = saturate(1.0 - abs(p.y) / h);
    float bulb = pow(v, 0.58);

    float baseRadius = mix(0.06, 0.50, bulb);

    float radial = length(p.xz);
    float phi = atan(p.z, p.x);
    float globalTwist = p.y * 2.05;

    float shell = 1e9;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float panelPhase = globalTwist + fi * 2.0943951 + 0.22 * sin(p.y * 1.4 + fi * 1.1);
        float panelHalfWidth = mix(1.12, 0.64, bulb);
        float panelThickness = mix(0.020, 0.034, bulb) * mix(0.8, 1.25, (adaptiveLayer - 0.05) / 0.95);

        float rib = (0.008 + 0.004 * (adaptiveNozzle - 0.2)) * sin(phi * 9.0 - p.y * (18.0 + adaptiveFlow) + fi * 1.7);
        float localRadius = baseRadius + rib;

        float dAngular = (abs(wrapPi(phi - panelPhase)) - panelHalfWidth) * max(localRadius, 0.02);
        float dRadial = abs(radial - localRadius) - panelThickness;
        float panelField = max(dAngular, dRadial);
        shell = min(shell, panelField);
    }

    shell = max(shell, abs(p.y) - h);
    return shell;
}
