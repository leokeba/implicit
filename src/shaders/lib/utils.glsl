vec2 cartopol(vec2 p) {
    return vec2(length(p), atan(p.y, p.x));
}

vec2 poltocar(vec2 polar) {
    return vec2(cos(polar.y), sin(polar.y)) * polar.x;
}

float angleUnit(vec2 p) {
    return atan(p.y, p.x) / 6.28318530718;
}

float sin01(float t01) {
    float radians = fract(t01) * 6.28318530718;
    return 0.5 + 0.5 * sin(radians);
}

float cos01(float t01) {
    float radians = fract(t01) * 6.28318530718;
    return 0.5 + 0.5 * cos(radians);
}

vec2 cylinderSurfaceToPlane(vec3 p) {
    float u = fract(angleUnit(p.xz) + 1.0);
    float v = clamp(p.y, 0.0, 1.0);
    return vec2(u, v);
}

float spiralPosition(vec3 p) {
    float angle = angleUnit(p.xz);
    float layer = p.y / uLayerHeight;
    return angle + layer;
}

vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
}

float simplexNoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(
        permute(
            permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
            i.y + vec4(0.0, i1.y, i2.y, 1.0)
        ) +
        i.x + vec4(0.0, i1.x, i2.x, 1.0)
    );

    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float simplexNoise(vec2 v) {
    return simplexNoise(vec3(v, 0.0));
}

const int NOISE_MAX_OCTAVES = 8;

float fbm(vec3 p, int octaves, float lacunarity, float gain) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    float ampSum = 0.0;

    for (int i = 0; i < NOISE_MAX_OCTAVES; i++) {
        if (i >= octaves) {
            break;
        }

        sum += simplexNoise(p * freq) * amp;
        ampSum += amp;
        freq *= lacunarity;
        amp *= gain;
    }

    return (ampSum > 0.0) ? (sum / ampSum) : 0.0;
}

float fbm(vec2 p, int octaves, float lacunarity, float gain) {
    return fbm(vec3(p, 0.0), octaves, lacunarity, gain);
}

float fbm(vec3 p) {
    return fbm(p, 5, 2.0, 0.5);
}

float fbm(vec2 p) {
    return fbm(vec3(p, 0.0));
}

float turbulence(vec3 p, int octaves, float lacunarity, float gain) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    float ampSum = 0.0;

    for (int i = 0; i < NOISE_MAX_OCTAVES; i++) {
        if (i >= octaves) {
            break;
        }

        sum += abs(simplexNoise(p * freq)) * amp;
        ampSum += amp;
        freq *= lacunarity;
        amp *= gain;
    }

    return (ampSum > 0.0) ? (sum / ampSum) : 0.0;
}

float turbulence(vec2 p, int octaves, float lacunarity, float gain) {
    return turbulence(vec3(p, 0.0), octaves, lacunarity, gain);
}

float turbulence(vec3 p) {
    return turbulence(p, 5, 2.0, 0.5);
}

float turbulence(vec2 p) {
    return turbulence(vec3(p, 0.0));
}