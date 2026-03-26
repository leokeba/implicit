const int MAX_MARCH_STEPS = 512;
const int MAX_REFINE_STEPS = 12;
const int MAX_INTERIOR_STEPS = 128;

float mapRenderDistance(vec3 p) {
    float sceneD = mapScene(p);
    float yMin = min(uMinY, uMaxY);
    float yMax = max(uMinY, uMaxY);
    float ySlabD = max(yMin - p.y, p.y - yMax);
    return max(sceneD, ySlabD);
}

vec3 estimateNormal(vec3 p) {
    float e = max(uNormalEpsilon, uHitEpsilon * 1.5);
    vec2 h = vec2(e, 0.0);
    float dx = mapRenderDistance(p + vec3(h.x, h.y, h.y)) - mapRenderDistance(p - vec3(h.x, h.y, h.y));
    float dy = mapRenderDistance(p + vec3(h.y, h.x, h.y)) - mapRenderDistance(p - vec3(h.y, h.x, h.y));
    float dz = mapRenderDistance(p + vec3(h.y, h.y, h.x)) - mapRenderDistance(p - vec3(h.y, h.y, h.x));
    vec3 g = vec3(dx, dy, dz);
    return normalize(g + vec3(1e-9));
}

float refineSurface(vec3 ro, vec3 rd, float tNear, float tFar) {
    float a = tNear;
    float b = tFar;

    for (int i = 0; i < MAX_REFINE_STEPS; i++) {
        if (i >= uRefineSteps) {
            break;
        }

        float m = 0.5 * (a + b);
        float dm = mapRenderDistance(ro + rd * m);
        if (abs(dm) < uHitEpsilon) {
            return m;
        }

        float da = mapRenderDistance(ro + rd * a);
        if (sign(da) == sign(dm)) {
            a = m;
        } else {
            b = m;
        }
    }

    return 0.5 * (a + b);
}

float raymarch(vec3 ro, vec3 rd, out vec3 p) {
    float t = 0.0;
    float prevT = 0.0;
    float prevD = mapRenderDistance(ro);

    if (abs(prevD) < uHitEpsilon) {
        p = ro;
        return 0.0;
    }

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        if (i >= uMaxSteps) {
            break;
        }

        p = ro + rd * t;
        float d = mapRenderDistance(p);

        if (abs(d) < uHitEpsilon) {
            return t;
        }

        if (sign(prevD) != sign(d)) {
            t = refineSurface(ro, rd, prevT, t);
            p = ro + rd * t;
            return t;
        }

        float stepLen = max(abs(d) * uStepScale, uMinStep);
        prevT = t;
        prevD = d;
        t += stepLen;
        if (t > uMaxDistance) {
            break;
        }
    }

    return -1.0;
}

float marchInsideToExit(vec3 roInside, vec3 rdInside, out vec3 pExit) {
    float t = max(uHitEpsilon * 4.0, 0.001);
    float prevT = t;
    float prevD = mapRenderDistance(roInside + rdInside * t);

    for (int i = 0; i < MAX_INTERIOR_STEPS; i++) {
        pExit = roInside + rdInside * t;
        float d = mapRenderDistance(pExit);

        if (abs(d) < uHitEpsilon) {
            return t;
        }

        if (sign(prevD) != sign(d)) {
            return refineSurface(roInside, rdInside, prevT, t);
        }

        float stepLen = max(abs(d) * uStepScale, uMinStep);
        prevT = t;
        prevD = d;
        t += stepLen;

        if (t > uMaxDistance) {
            break;
        }
    }

    pExit = roInside + rdInside * t;
    return -1.0;
}
