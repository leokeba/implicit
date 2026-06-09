const float THREAD_TAU = 6.28318530718;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float threadHandednessSign() {
    return uSceneHandedness >= 0.5 ? -1.0 : 1.0;
}

float threadPhase(vec3 p) {
    float angleTurns = atan(p.z, p.x) / THREAD_TAU;
    return (p.y / max(uScenePitch, 1e-4)) - threadHandednessSign() * angleTurns;
}

float threadProfile(vec3 p) {
    float wrapped = abs(fract(threadPhase(p)) - 0.5) * 2.0;
    return pow(max(1.0 - wrapped, 0.0), max(uSceneCrestSharpness, 1e-3));
}

float threadEndMask(float y, float halfHeight) {
    float fadeStart = max(halfHeight - uSceneLeadIn, 0.0);
    return 1.0 - smoothstep(fadeStart, halfHeight, abs(y));
}

float sdVariableCylinder(vec3 p, float halfHeight, float radius) {
    return max(length(p.xz) - radius, abs(p.y) - halfHeight);
}

float sdThreadedPlug(vec3 p) {
    float profile = threadProfile(p);
    float radius = uSceneCoreRadius + (profile * uSceneThreadDepth * threadEndMask(p.y, uSceneHalfHeight));
    float threadedBody = sdVariableCylinder(p, uSceneHalfHeight, radius);

    float headHalfHeight = 0.17;
    float headRadius = uSceneCoreRadius + uSceneThreadDepth + 0.16;
    vec3 headLocal = p - vec3(0.0, -uSceneHalfHeight - headHalfHeight + 0.02, 0.0);
    float head = sdCappedCylinder(headLocal, headHalfHeight, headRadius);

    float noseHalfHeight = 0.09;
    vec3 noseLocal = p - vec3(0.0, uSceneHalfHeight - noseHalfHeight, 0.0);
    float nose = sdRoundedCylinder(noseLocal, uSceneCoreRadius + 0.02, 0.035, noseHalfHeight);

    return min(min(threadedBody, head), nose);
}

float sdThreadedSleeve(vec3 p) {
    float outerRadius = uSceneCoreRadius + uSceneThreadDepth + uSceneSleeveWall;
    float outer = sdCappedCylinder(p, uSceneHalfHeight, outerRadius);

    float entranceRelief = uSceneThreadDepth * smoothstep(uSceneHalfHeight - uSceneLeadIn, uSceneHalfHeight, abs(p.y));
    float cavityRadius = uSceneCoreRadius + uSceneClearance + (threadProfile(p) * uSceneThreadDepth) + entranceRelief;
    float cavity = sdVariableCylinder(p, uSceneHalfHeight + 0.02, cavityRadius);

    float sleeve = max(outer, -cavity);

    float gripHalfHeight = 0.16;
    vec3 gripLocal = p - vec3(0.0, -uSceneHalfHeight + gripHalfHeight - 0.02, 0.0);
    float gripRing = sdCappedCylinder(gripLocal, gripHalfHeight, outerRadius + uSceneGripThickness);

    return min(sleeve, gripRing);
}

float mapScene(vec3 p) {
    vec3 plugLocal = p - vec3(-uScenePieceOffset, 0.0, 0.0);
    vec3 sleeveLocal = p - vec3(uScenePieceOffset, 0.0, 0.0);

    float plug = sdThreadedPlug(plugLocal);
    float sleeve = sdThreadedSleeve(sleeveLocal);
    return min(plug, sleeve);
}

float sampleToolpathNoise(vec3 p) {
    float field = simplexNoise(vec3(p.x * 1.7, p.y * 2.1, p.z * 1.7));
    return saturate(field * 0.5 + 0.5);
}
