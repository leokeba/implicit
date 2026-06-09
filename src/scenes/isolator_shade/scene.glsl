vec2 hash22(vec2 p) {
    float x = sin(dot(p, vec2(127.1, 311.7)));
    float y = sin(dot(p, vec2(269.5, 183.3)));
    return fract(vec2(x, y) * 43758.5453123);
}

vec2 warpCellUv(vec2 uv, float repeatX) {
    vec2 sampleUv = vec2(uv.x * repeatX, uv.y * uSceneCellScaleHeight);
    float angle = uv.x * SDF_PI * 2.0;

    // Keep the warp seam-safe, but much cheaper than two FBM evaluations per mapScene call.
    vec2 warp = vec2(
        sin(angle * 2.0 + uv.y * 5.1),
        cos(angle * 3.0 - uv.y * 4.3)
    );
    sampleUv += warp * (uSceneWarpAmount * 0.16);
    sampleUv.x += uv.y * 1.35;
    return sampleUv;
}

float bioCellEdgeDistance(vec2 uv) {
    float repeatX = max(1.0, floor(uSceneCellScaleAround + 0.5));
    vec2 sampleUv = warpCellUv(uv, repeatX);
    vec2 cell = floor(sampleUv);
    float first = 1e9;
    float second = 1e9;

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 offset = vec2(float(i), float(j));
            vec2 rawCell = cell + offset;
            vec2 wrappedCell = rawCell;
            wrappedCell.x = mod(wrappedCell.x + repeatX, repeatX);

            vec2 feature = hash22(wrappedCell);
            feature.y = mix(0.18, 0.82, feature.y);

            vec2 delta = rawCell + feature - sampleUv;
            delta.x -= repeatX * floor(delta.x / repeatX + 0.5);
            float dist2 = dot(delta, delta);
            if (dist2 < first) {
                second = first;
                first = dist2;
            } else if (dist2 < second) {
                second = dist2;
            }
        }
    }

    float nearest = sqrt(first);
    float edgeDistance = sqrt(second) - nearest;
    return edgeDistance;
}

float mapScene(vec3 p) {
    // p.xz *= rot2(uFrameModulo*SDF_PI*2./30.);
    // p.x += cos01(p.y/4.) * 0.2;
    vec2 uv = cylinderSurfaceToPlane(p * vec3(1., 0.25, 1.) + vec3(0., 0.5, 0.));
    // uv.x += uv.y;
    float depth01 = clamp(uSceneEmbossDepth / 0.09, 0.0, 1.0);
    float amplitude = smoothstep(0.0, 0.5, 0.5 - abs(pow(uv.y, 1.) - 0.5));
    float cylinder = sdCappedCylinder(p, 2., 1. + amplitude);
    float edgeDistance = bioCellEdgeDistance(uv);
    float bodyMask = smoothstep(0.0, 0.42, 0.5 - abs(uv.y - 0.5));
    float capFade = smoothstep(0.02, 0.16, uv.y) * (1.0 - smoothstep(0.84, 0.98, uv.y));
    float ridgeMask = 1.0 - smoothstep(uSceneRidgeWidth * 0.45, uSceneRidgeWidth * 0.95, edgeDistance);
    float shoulderStart = mix(uSceneRidgeWidth * 1.25, uSceneRidgeWidth * 0.7, depth01);
    float shoulderEnd = mix(uSceneRidgeWidth * 3.4, uSceneRidgeWidth * 2.1, depth01);
    float basinStart = mix(uSceneRidgeWidth * 2.6, uSceneRidgeWidth * 1.35, depth01);
    float basinEnd = mix(uSceneRidgeWidth * 7.2, uSceneRidgeWidth * 4.8, depth01);
    float shoulder = smoothstep(shoulderStart, shoulderEnd, edgeDistance);
    float basinDepth = smoothstep(basinStart, basinEnd, edgeDistance);
    float basinExponent = mix(1.0, 1.8, depth01);
    basinDepth = 1.0 - pow(1.0 - clamp(basinDepth, 0.0, 1.0), basinExponent);
    float cellInset = shoulder * basinDepth * (1.0 - ridgeMask) * bodyMask * capFade;
    // uv.x += cos01(p.y*0.25) * 0.1;
    // float waves = sin01(uv.x * 60. + uv.y * 3.);// * sin01(uv.x * 29. + uv.y * 11.);
    // cylinder -= amplitude;
    // cylinder -= 0.1 * waves * amplitude;
    // cylinder -= simplexNoise(p*0.7+10.) * 0.2 * amplitude;
    // cylinder += sin01(uv.x);
    float depthScale = mix(0.35, 1.0, depth01);
    cylinder += cellInset * uSceneEmbossDepth * depthScale;
    return cylinder;
}

float sampleToolpathNoise(vec3 p) {
    return simplexNoise(p * 0.7) * 0.5 + 0.5;
}
