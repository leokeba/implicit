precision highp float;

attribute vec3 aPointPosition;
attribute float aPointIndex;

uniform vec2 uTextureSize;

varying vec3 vPointPosition;

void main() {
    float width = max(uTextureSize.x, 1.0);
    float height = max(uTextureSize.y, 1.0);
    float x = mod(aPointIndex, width);
    float y = floor(aPointIndex / width);
    vec2 uv = (vec2(x, y) + vec2(0.5)) / vec2(width, height);
    vec2 clip = uv * 2.0 - 1.0;

    gl_Position = vec4(clip, 0.0, 1.0);
    gl_PointSize = 1.0;
    vPointPosition = aPointPosition;
}