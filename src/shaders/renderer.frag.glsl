precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uTime;
uniform float uFrameModulo;
uniform float uFramePeriod;
uniform vec3 uCameraPos;
uniform vec3 uCameraTarget;
uniform int uViewMode;
uniform int uMaxSteps;
uniform float uHitEpsilon;
uniform float uMaxDistance;
uniform float uFocalLength;
uniform float uStepScale;
uniform float uMinStep;
uniform float uNormalEpsilon;
uniform int uRefineSteps;
uniform float uMinY;
uniform float uMaxY;
uniform float uScale;
uniform float uMaxRadius;
uniform float uNozzleDiameter;
uniform float uFlowRate;
uniform float uLayerHeight;
uniform float uLineWidth;
uniform float uFirstLayerLineWidth;
uniform float uUiLightTheme;

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

    float pulse = (uViewMode == 2 || uViewMode == 3) ? 0.0 : 0.02 * sin(uTime * 0.8);
    gl_FragColor = vec4(color + pulse, 1.0);
}
