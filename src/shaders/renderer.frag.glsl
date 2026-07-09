precision highp float;

varying vec2 vUv;

__ENGINE_UNIFORMS_GLSL__

__SDF_PRIMITIVES_GLSL__

__UTILS_GLSL__

__SCENE_GLSL__

__RAYMARCH_GLSL__

__ENVIRONMENT_GLSL__

__MATERIALS_GLSL__

void main() {
    vec2 uv = (gl_FragCoord.xy / uResolution.xy) * 2.0 - 1.0;

    vec3 ro = uCameraPos;
    vec3 target = uCameraTarget;
    vec3 forward = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);
    float aspect = uResolution.x / uResolution.y;
    vec3 rd = normalize(forward * uFocalLength + right * (uv.x * aspect) + up * uv.y);

    vec3 hitPos = vec3(0.0);
    float t = raymarch(ro, rd, hitPos);

    vec3 color;
    if (t > 0.0) {
        vec3 normal = estimateNormal(hitPos);
        color = shadeByMode(uViewMode, hitPos, normal, rd);
    } else {
        if (uViewMode == 2) {
            color = sampleEnvironment(rd);
        } else {
            float bg = 0.25 + 0.75 * pow(1.0 - max(rd.y, -0.2), 2.0);
            vec3 darkNear = vec3(0.03, 0.05, 0.1);
            vec3 darkFar = vec3(0.09, 0.12, 0.2);
            vec3 lightNear = vec3(0.77, 0.83, 0.92);
            vec3 lightFar = vec3(0.9, 0.94, 0.98);
            vec3 nearColor = mix(darkNear, lightNear, uUiLightTheme);
            vec3 farColor = mix(darkFar, lightFar, uUiLightTheme);
            color = mix(nearColor, farColor, bg);
        }
    }

    // No ambient uTime pulse here: reading uTime in shared code would mark
    // every scene animated and force continuous rendering. Scenes that use
    // uTime themselves still animate at full rate.
    gl_FragColor = vec4(color, 1.0);
}
