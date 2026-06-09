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
