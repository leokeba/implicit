float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float wrapPi(float a) {
    return mod(a + 3.14159265, 6.2831853) - 3.14159265;
}

float mapScene(vec3 p) {
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
        float panelThickness = mix(0.020, 0.034, bulb);

        float rib = 0.008 * sin(phi * 9.0 - p.y * 19.4 + fi * 1.7);
        float localRadius = baseRadius + rib;

        float dAngular = (abs(wrapPi(phi - panelPhase)) - panelHalfWidth) * max(localRadius, 0.02);
        float dRadial = abs(radial - localRadius) - panelThickness;
        float panelField = max(dAngular, dRadial);
        shell = min(shell, panelField);
    }

    shell = max(shell, abs(p.y) - h);
    return shell;
}
