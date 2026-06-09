const float TOWER_TOTAL_HEIGHT = 40.0;
const float TOWER_HALF_HEIGHT = TOWER_TOTAL_HEIGHT * 0.5;
const float TOWER_RADIUS = 1.5;
const float NOISE_SHADE_REFERENCE_SCALE = 100.0;

float towerPartHeight() {
    return TOWER_TOTAL_HEIGHT / max(uPartCount, 1.0);
}

vec3 towerGlobalPoint(vec3 localP) {
    float partCenter = -TOWER_HALF_HEIGHT + (uPartIndex + 0.5) * towerPartHeight();
    return vec3(localP.x, localP.y + partCenter, localP.z);
}

float towerNoiseAmplitude(vec3 localP) {
    float normalizedY = clamp(localP.y / towerPartHeight() + 0.5, 0.0, 1.0);
    vec2 uv = cylinderSurfaceToPlane(vec3(localP.x, normalizedY, localP.z));
    return smoothstep(0.0, uSceneBeltWidth, 0.5 - abs(uv.y - 0.5));
}

float fullTowerDistance(vec3 localP, vec3 globalP) {
    float cylinder = sdCappedCylinder(globalP, TOWER_HALF_HEIGHT, TOWER_RADIUS);
    float amplitude = towerNoiseAmplitude(localP);
    float referenceScaleRatio = uScale / NOISE_SHADE_REFERENCE_SCALE;
    float displacement = simplexNoise(globalP * (0.7 * referenceScaleRatio) + 10.0) * uSceneNoiseDepth * amplitude;
    return cylinder - displacement;
}

float mapScene(vec3 p) {
    vec3 globalP = towerGlobalPoint(p);
    float sculpture = fullTowerDistance(p, globalP);
    float partBounds = abs(p.y) - towerPartHeight() * 0.5;
    return max(sculpture, partBounds);
}
