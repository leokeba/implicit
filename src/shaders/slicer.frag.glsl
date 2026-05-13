precision highp float;

uniform vec2 uTextureSize;
uniform float uFrameModulo;
uniform float uFramePeriod;
uniform float uMinY;
uniform float uMaxY;
uniform float uScale;
uniform float uMaxRadius;
uniform float uNozzleDiameter;
uniform float uFlowRate;
uniform float uLayerHeight;
uniform float uLineWidth;
uniform float uFirstLayerLineWidth;
uniform vec2 uSliceMin;
uniform vec2 uSliceMax;
uniform float uSliceY;
uniform float uSliceYStep;
uniform float uSliceGridSize;
uniform float uDistanceRange;
uniform float uIsoSnapEpsilon;

__SDF_PRIMITIVES_GLSL__

__UTILS_GLSL__

__SCENE_GLSL__

vec4 encodeSignedDistance(float distance, float distanceRange) {
    float normalized = clamp((distance / max(distanceRange, 1e-6)) * 0.5 + 0.5, 0.0, 1.0);
    float value = floor(normalized * 65535.0 + 0.5);
    float hi = floor(value / 256.0);
    float lo = mod(value, 256.0);
    return vec4(hi / 255.0, lo / 255.0, normalized, 1.0);
}

void main() {
    vec2 fragCoord = gl_FragCoord.xy - vec2(0.5);
    float xT = fragCoord.x / max(uTextureSize.x - 1.0, 1.0);
    float sliceGridSize = max(uSliceGridSize, 1.0);
    float sliceIndex = floor(fragCoord.y / sliceGridSize);
    float localSliceY = mod(fragCoord.y, sliceGridSize);
    float zT = localSliceY / max(sliceGridSize - 1.0, 1.0);
    float x = mix(uSliceMin.x, uSliceMax.x, xT);
    float z = mix(uSliceMin.y, uSliceMax.y, zT);
    float distance = mapScene(vec3(x, uSliceY + sliceIndex * uSliceYStep, z));

    if (uIsoSnapEpsilon > 0.0 && abs(distance) < uIsoSnapEpsilon) {
        distance = 0.0;
    }

    gl_FragColor = encodeSignedDistance(distance, uDistanceRange);
}
