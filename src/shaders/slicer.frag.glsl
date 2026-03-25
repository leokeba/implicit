precision highp float;

uniform vec2 uTextureSize;
uniform float uMinY;
uniform float uMaxY;
uniform float uMaxRadius;
uniform int uRadialSteps;
uniform float uHitEpsilon;

const int MAX_RADIAL_STEPS = 512;
const int MAX_BISECT_STEPS = 12;

__SCENE_GLSL__

vec4 encodeRadius(float radius, float maxRadius) {
    float normalized = clamp(radius / maxRadius, 0.0, 1.0);
    float value = floor(normalized * 65535.0 + 0.5);
    float hi = floor(value / 256.0);
    float lo = mod(value, 256.0);
    return vec4(hi / 255.0, lo / 255.0, normalized, 1.0);
}

float refineRadius(float y, float theta, float rNear, float rFar) {
    float a = rNear;
    float b = rFar;

    for (int i = 0; i < MAX_BISECT_STEPS; i++) {
        float m = 0.5 * (a + b);
        vec3 pM = vec3(cos(theta) * m, y, sin(theta) * m);
        float dM = mapScene(pM);
        if (abs(dM) < uHitEpsilon) {
            return m;
        }

        vec3 pA = vec3(cos(theta) * a, y, sin(theta) * a);
        float dA = mapScene(pA);
        if (sign(dA) == sign(dM)) {
            a = m;
        } else {
            b = m;
        }
    }

    return 0.5 * (a + b);
}

void main() {
    vec2 fragCoord = gl_FragCoord.xy - vec2(0.5);
    float angleIndex = fragCoord.x;
    float layerIndex = fragCoord.y;

    float angleT = angleIndex / max(uTextureSize.x - 1.0, 1.0);
    float layerT = layerIndex / max(uTextureSize.y - 1.0, 1.0);

    float theta = angleT * 6.28318530718;
    float y = mix(uMinY, uMaxY, layerT);

    float prevR = 0.0;
    float prevD = mapScene(vec3(0.0, y, 0.0));
    float bestRadius = -1.0;

    int steps = uRadialSteps;
    if (steps < 8) {
        steps = 8;
    }
    if (steps > MAX_RADIAL_STEPS) {
        steps = MAX_RADIAL_STEPS;
    }
    for (int i = 0; i < MAX_RADIAL_STEPS; i++) {
        if (i >= steps) {
            break;
        }

        float r = (float(i + 1) / float(steps)) * uMaxRadius;
        vec3 p = vec3(cos(theta) * r, y, sin(theta) * r);
        float d = mapScene(p);

        if (abs(d) < uHitEpsilon) {
            bestRadius = max(bestRadius, r);
        }

        if (sign(prevD) != sign(d)) {
            float refined = refineRadius(y, theta, prevR, r);
            bestRadius = max(bestRadius, refined);
        }

        prevR = r;
        prevD = d;
    }

    if (bestRadius > 0.0) {
        gl_FragColor = encodeRadius(bestRadius, uMaxRadius);
        return;
    }

    gl_FragColor = vec4(0.0);
}
