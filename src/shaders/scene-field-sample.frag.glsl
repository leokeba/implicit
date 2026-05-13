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
uniform float uFieldMinValue;
uniform float uFieldMaxValue;

varying vec3 vPointPosition;

__SDF_PRIMITIVES_GLSL__

__UTILS_GLSL__

__SCENE_GLSL__

__FIELD_COMPONENT_GLSL__

vec4 encodeScalarFieldValue(float value, float minValue, float maxValue) {
    float safeMaxValue = max(maxValue, minValue + 1e-6);
    float normalized = clamp((value - minValue) / (safeMaxValue - minValue), 0.0, 1.0);
    float packedValue = floor(normalized * 65535.0 + 0.5);
    float hi = floor(packedValue / 256.0);
    float lo = mod(packedValue, 256.0);
    return vec4(hi / 255.0, lo / 255.0, normalized, 1.0);
}

void main() {
    float value = sampleSceneFieldComponent(vPointPosition);
    gl_FragColor = encodeScalarFieldValue(value, uFieldMinValue, uFieldMaxValue);
}