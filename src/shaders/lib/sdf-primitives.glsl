// Inigo Quilez-style signed distance primitives and CSG operators.
// Keep this file focused on reusable geometry building blocks for mapScene().

const float SDF_PI = 3.14159265359;

float saturate01(float x) {
    return clamp(x, 0.0, 1.0);
}

float dot2(vec2 v) {
    return dot(v, v);
}

float dot2(vec3 v) {
    return dot(v, v);
}

float ndot(vec2 a, vec2 b) {
    return a.x * b.x - a.y * b.y;
}

mat2 rot2(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
}

// --- 2D primitives ---

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundedBox(vec2 p, vec2 b, vec4 r) {
    r.xy = (p.x > 0.0) ? r.xy : r.zw;
    r.x = (p.y > 0.0) ? r.x : r.y;
    vec2 q = abs(p) - b + r.x;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

float sdChamferBox(vec2 p, vec2 b, float chamfer) {
    p = abs(p) - b;
    p = (p.y > p.x) ? p.yx : p.xy;
    p.y += chamfer;

    const float k = 1.0 - 1.41421356237;
    if (p.y < 0.0 && p.y + p.x * k < 0.0) {
        return p.x;
    }
    if (p.x < p.y) {
        return (p.x + p.y) * 0.70710678118;
    }
    return length(p);
}

float sdOrientedBox(vec2 p, vec2 a, vec2 b, float th) {
    float l = length(b - a);
    vec2 d = (b - a) / max(l, 1e-7);
    vec2 q = p - (a + b) * 0.5;
    q = mat2(d.x, -d.y, d.y, d.x) * q;
    q = abs(q) - vec2(l, th) * 0.5;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

float sdRhombus(vec2 p, vec2 b) {
    b.y = -b.y;
    p = abs(p);
    float h = clamp((dot(b, p) + b.y * b.y) / dot(b, b), 0.0, 1.0);
    p -= b * vec2(h, h - 1.0);
    return length(p) * sign(p.x);
}

float sdTrapezoid(vec2 p, float r1, float r2, float he) {
    vec2 k1 = vec2(r2, he);
    vec2 k2 = vec2(r2 - r1, 2.0 * he);
    p.x = abs(p.x);
    vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
    vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0.0, 1.0);
    float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
    return s * sqrt(min(dot2(ca), dot2(cb)));
}

float sdParallelogram(vec2 p, float wi, float he, float sk) {
    vec2 e = vec2(sk, he);
    p = (p.y < 0.0) ? -p : p;
    vec2 w = p - e;
    w.x -= clamp(w.x, -wi, wi);
    vec2 d = vec2(dot(w, w), -w.y);
    float s = p.x * e.y - p.y * e.x;
    p = (s < 0.0) ? -p : p;
    vec2 v = p - vec2(wi, 0.0);
    v -= e * clamp(dot(v, e) / dot(e, e), -1.0, 1.0);
    d = min(d, vec2(dot(v, v), wi * he - abs(s)));
    return sqrt(d.x) * sign(-d.y);
}

float sdEquilateralTriangle(vec2 p, float r) {
    const float k = 1.73205080757;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) {
        p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
    }
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

float sdTriangleIsosceles(vec2 p, vec2 q) {
    p.x = abs(p.x);
    vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
    vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
    float s = -sign(q.y);
    vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
    return -sqrt(d.x) * sign(d.y);
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
    vec2 e0 = p1 - p0;
    vec2 e1 = p2 - p1;
    vec2 e2 = p0 - p2;
    vec2 v0 = p - p0;
    vec2 v1 = p - p1;
    vec2 v2 = p - p2;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(
        min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
        vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x))
    );
    return -sqrt(d.x) * sign(d.y);
}

float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
    p.x = abs(p.x);
    float b = (r1 - r2) / h;
    float a = sqrt(max(1.0 - b * b, 0.0));
    float k = dot(p, vec2(-b, a));
    if (k < 0.0) {
        return length(p) - r1;
    }
    if (k > a * h) {
        return length(p - vec2(0.0, h)) - r2;
    }
    return dot(p, vec2(a, b)) - r1;
}

float sdPentagon(vec2 p, float r) {
    const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
    p.x = abs(p.x);
    p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
    p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
    p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
    return length(p) * sign(p.y);
}

float sdHexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

float sdOctogon(vec2 p, float r) {
    const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
    p = abs(p);
    p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
    p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

float sdHexagram(vec2 p, float r) {
    const vec4 k = vec4(-0.5, 0.8660254038, 0.5773502692, 1.7320508076);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= 2.0 * min(dot(k.yx, p), 0.0) * k.yx;
    p -= vec2(clamp(p.x, r * k.z, r * k.w), r);
    return length(p) * sign(p.y);
}

float sdPentagram(vec2 p, float r) {
    const float k1x = 0.809016994;
    const float k2x = 0.309016994;
    const float k1y = 0.587785252;
    const float k2y = 0.951056516;
    const float k1z = 0.726542528;
    const vec2 v1 = vec2(k1x, -k1y);
    const vec2 v2 = vec2(-k1x, -k1y);
    const vec2 v3 = vec2(k2x, -k2y);

    p.x = abs(p.x);
    p -= 2.0 * max(dot(v1, p), 0.0) * v1;
    p -= 2.0 * max(dot(v2, p), 0.0) * v2;
    p.x = abs(p.x);
    p.y -= r;
    return length(p - v3 * clamp(dot(p, v3), 0.0, k1z * r)) * sign(p.y * v3.x - p.x * v3.y);
}

float sdStar(vec2 p, float r, float n, float m) {
    float an = SDF_PI / n;
    float en = SDF_PI / m;
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));

    float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}

float sdPie(vec2 p, vec2 c, float r) {
    p.x = abs(p.x);
    float l = length(p) - r;
    float m = length(p - c * clamp(dot(p, c), 0.0, r));
    return max(l, m * sign(c.y * p.x - c.x * p.y));
}

float sdCutDisk(vec2 p, float r, float h) {
    float w = sqrt(max(r * r - h * h, 0.0));
    p.x = abs(p.x);
    float s = max((h - r) * p.x * p.x + w * w * (h + r - 2.0 * p.y), h * p.x - w * p.y);
    if (s < 0.0) {
        return length(p) - r;
    }
    if (p.x < w) {
        return h - p.y;
    }
    return length(p - vec2(w, h));
}

float sdArc(vec2 p, vec2 sc, float ra, float rb) {
    p.x = abs(p.x);
    return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}

float sdRing(vec2 p, vec2 n, float r, float th) {
    p.x = abs(p.x);
    p = mat2(n.x, n.y, -n.y, n.x) * p;
    return max(abs(length(p) - r) - th * 0.5, length(vec2(p.x, max(0.0, abs(r - p.y) - th * 0.5))) * sign(p.x));
}

float sdHorseshoe(vec2 p, vec2 c, float r, vec2 w) {
    p.x = abs(p.x);
    float l = length(p);
    p = mat2(-c.x, c.y, c.y, c.x) * p;
    p = vec2((p.y > 0.0 || p.x > 0.0) ? p.x : l * sign(-c.x), (p.x > 0.0) ? p.y : l);
    p = vec2(p.x, abs(p.y - r)) - w;
    return length(max(p, 0.0)) + min(0.0, max(p.x, p.y));
}

float sdVesica(vec2 p, float w, float h) {
    float d = 0.5 * (w * w - h * h) / h;
    p = abs(p);
    vec3 c = (w * p.y < d * (p.x - w)) ? vec3(0.0, w, 0.0) : vec3(-d, 0.0, d + h);
    return length(p - c.yx) - c.z;
}

float sdOrientedVesica(vec2 p, vec2 a, vec2 b, float w) {
    float r = 0.5 * length(b - a);
    float d = 0.5 * (r * r - w * w) / w;
    vec2 v = (b - a) / max(r, 1e-7);
    vec2 c = (b + a) * 0.5;
    vec2 q = 0.5 * abs(mat2(v.y, v.x, -v.x, v.y) * (p - c));
    vec3 h = (r * q.x < d * (q.y - r)) ? vec3(0.0, r, 0.0) : vec3(-d, 0.0, d + w);
    return length(q - h.xy) - h.z;
}

float sdMoon(vec2 p, float d, float ra, float rb) {
    p.y = abs(p.y);
    float a = (ra * ra - rb * rb + d * d) / (2.0 * d);
    float b = sqrt(max(ra * ra - a * a, 0.0));
    if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0)) {
        return length(p - vec2(a, b));
    }
    return max(length(p) - ra, -(length(p - vec2(d, 0.0)) - rb));
}

float sdRoundedCross(vec2 p, float h) {
    float k = 0.5 * (h + 1.0 / h);
    p = abs(p);
    if (p.x < 1.0 && p.y < p.x * (k - h) + h) {
        return k - sqrt(dot2(p - vec2(1.0, k)));
    }
    return sqrt(min(dot2(p - vec2(0.0, h)), dot2(p - vec2(1.0, 0.0))));
}

float sdEgg(vec2 p, float he, float ra, float rb, float bu) {
    float r = 0.5 * (he + ra + rb) / bu;
    float da = r - ra;
    float db = r - rb;
    float y = (db * db - da * da - he * he) / (2.0 * he);
    float x = sqrt(max(da * da - y * y, 0.0));

    p.x = abs(p.x);
    float k = p.y * x - p.x * y;
    if (k > 0.0 && k < he * (p.x + x)) {
        return length(p + vec2(x, y)) - r;
    }
    return min(length(p) - ra, length(vec2(p.x, p.y - he)) - rb);
}

float sdHeart(vec2 p) {
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) {
        return sqrt(dot2(p - vec2(0.25, 0.75))) - 0.35355339059;
    }
    return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

float sdCross(vec2 p, vec2 b, float r) {
    p = abs(p);
    p = (p.y > p.x) ? p.yx : p.xy;
    vec2 q = p - b;
    float k = max(q.y, q.x);
    vec2 w = (k > 0.0) ? q : vec2(b.y - p.x, -k);
    return sign(k) * length(max(w, 0.0)) + r;
}

float sdRoundedX(vec2 p, float w, float r) {
    p = abs(p);
    return length(p - min(p.x + p.y, w) * 0.5) - r;
}

const int SDF_MAX_POLY_VERTS = 64;

float sdPolygon(vec2 p, vec2 v[SDF_MAX_POLY_VERTS], int n) {
    float d = dot2(p - v[0]);
    float s = 1.0;

    // WebGL1 requires array indices to be constants or loop indices.
    // Resolve v[n - 1] via a loop-index-only pass.
    vec2 prev = v[0];
    for (int i = 1; i < SDF_MAX_POLY_VERTS; i++) {
        if (i >= n) {
            break;
        }
        prev = v[i];
    }

    for (int i = 0; i < SDF_MAX_POLY_VERTS; i++) {
        if (i >= n) {
            break;
        }

        vec2 curr = v[i];
        vec2 e = prev - curr;
        vec2 w = p - curr;
        vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
        d = min(d, dot(b, b));

        bvec3 c = bvec3(p.y >= curr.y, p.y < prev.y, e.x * w.y > e.y * w.x);
        if (all(c) || all(not(c))) {
            s = -s;
        }

        prev = curr;
    }
    return s * sqrt(d);
}

float sdEllipse(vec2 p, vec2 ab) {
    p = abs(p);
    if (p.x > p.y) {
        p = p.yx;
        ab = ab.yx;
    }
    float l = ab.y * ab.y - ab.x * ab.x;
    float m = ab.x * p.x / l;
    float m2 = m * m;
    float n = ab.y * p.y / l;
    float n2 = n * n;
    float c = (m2 + n2 - 1.0) / 3.0;
    float c3 = c * c * c;

    float q = c3 + m2 * n2 * 2.0;
    float d = c3 + m2 * n2;
    float g = m + m * n2;
    float co;

    if (d < 0.0) {
        float h = acos(q / c3) / 3.0;
        float s = cos(h);
        float t = sin(h) * 1.73205080757;
        float rx = sqrt(max(-c * (s + t + 2.0) + m2, 0.0));
        float ry = sqrt(max(-c * (s - t + 2.0) + m2, 0.0));
        co = (ry + sign(l) * rx + abs(g) / (rx * ry) - m) * 0.5;
    } else {
        float h = 2.0 * m * n * sqrt(d);
        float s = sign(q + h) * pow(abs(q + h), 1.0 / 3.0);
        float u = sign(q - h) * pow(abs(q - h), 1.0 / 3.0);
        float rx = -s - u - c * 4.0 + 2.0 * m2;
        float ry = (s - u) * 1.73205080757;
        float rm = sqrt(rx * rx + ry * ry);
        co = (ry / sqrt(max(rm - rx, 0.0)) + 2.0 * g / rm - m) * 0.5;
    }

    vec2 r = ab * vec2(co, sqrt(max(1.0 - co * co, 0.0)));
    return length(r - p) * sign(p.y - r.y);
}

float sdParabola(vec2 pos, float k) {
    pos.x = abs(pos.x);
    float ik = 1.0 / k;
    float p = ik * (pos.y - 0.5 * ik) / 3.0;
    float q = 0.25 * ik * ik * pos.x;
    float h = q * q - p * p * p;
    float x;
    if (h > 0.0) {
        float r = pow(q + sqrt(h), 1.0 / 3.0);
        x = r + p / r;
    } else {
        float r = sqrt(p);
        x = 2.0 * r * cos(acos(q / (p * r)) / 3.0);
    }
    return length(pos - vec2(x, k * x * x)) * sign(pos.x - x);
}

float sdParabolaSegment(vec2 pos, float wi, float he) {
    pos.x = abs(pos.x);
    float ik = wi * wi / he;
    float p = ik * (he - pos.y - 0.5 * ik) / 3.0;
    float q = pos.x * ik * ik / 4.0;
    float h = q * q - p * p * p;
    float x;
    if (h > 0.0) {
        float r = pow(q + sqrt(h), 1.0 / 3.0);
        x = r + p / r;
    } else {
        float r = sqrt(p);
        x = 2.0 * r * cos(acos(q / (p * r)) / 3.0);
    }
    x = min(x, wi);
    return length(pos - vec2(x, he - x * x / ik)) * sign(ik * (pos.y - he) + pos.x * pos.x);
}

float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
    vec2 a = B - A;
    vec2 b = A - 2.0 * B + C;
    vec2 c = a * 2.0;
    vec2 d = A - pos;

    float kk = 1.0 / dot(b, b);
    float kx = kk * dot(a, b);
    float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
    float kz = kk * dot(d, a);

    float res;
    float p = ky - kx * kx;
    float p3 = p * p * p;
    float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
    float h = q * q + 4.0 * p3;

    if (h >= 0.0) {
        h = sqrt(h);
        vec2 x = (vec2(h, -h) - q) * 0.5;
        vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
        float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        res = dot2(d + (c + b * t) * t);
    } else {
        float z = sqrt(-p);
        float v = acos(q / (p * z * 2.0)) / 3.0;
        float m = cos(v);
        float n = sin(v) * 1.73205080757;
        vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
        res = min(dot2(d + (c + b * t.x) * t.x), dot2(d + (c + b * t.y) * t.y));
    }
    return sqrt(res);
}

float sdBlobbyCross(vec2 pos, float he) {
    pos = abs(pos);
    pos = vec2(abs(pos.x - pos.y), 1.0 - pos.x - pos.y) * 0.70710678118;

    float p = (he - pos.y - 0.25 / he) / (6.0 * he);
    float q = pos.x / (he * he * 16.0);
    float h = q * q - p * p * p;

    float x;
    if (h > 0.0) {
        float r = sqrt(h);
        x = pow(q + r, 1.0 / 3.0) - pow(abs(q - r), 1.0 / 3.0) * sign(r - q);
    } else {
        float r = sqrt(p);
        x = 2.0 * r * cos(acos(q / (p * r)) / 3.0);
    }
    x = min(x, 0.70710678118);

    vec2 z = vec2(x, he * (1.0 - 2.0 * x * x)) - pos;
    return length(z) * sign(z.y);
}

float sdTunnel(vec2 p, vec2 wh) {
    p.x = abs(p.x);
    p.y = -p.y;
    vec2 q = p - wh;

    float d1 = dot2(vec2(max(q.x, 0.0), q.y));
    q.x = (p.y > 0.0) ? q.x : length(p) - wh.x;
    float d2 = dot2(vec2(q.x, max(q.y, 0.0)));
    float d = sqrt(min(d1, d2));

    return (max(q.x, q.y) < 0.0) ? -d : d;
}

float sdStairs(vec2 p, vec2 wh, float n) {
    vec2 ba = wh * n;
    float d = min(dot2(p - vec2(clamp(p.x, 0.0, ba.x), 0.0)), dot2(p - vec2(ba.x, clamp(p.y, 0.0, ba.y))));
    float s = sign(max(-p.y, p.x - ba.x));

    float dia = length(wh);
    p = mat2(wh.x, -wh.y, wh.y, wh.x) * p / dia;
    float id = clamp(floor(p.x / dia + 0.5), 0.0, n - 1.0);
    p.x -= id * dia;
    p = mat2(wh.x, wh.y, -wh.y, wh.x) * p / dia;

    float hh = wh.y * 0.5;
    p.y -= hh;
    if (p.y > hh * sign(p.x)) {
        s = 1.0;
    }
    p = (id < 0.5 || p.x > 0.0) ? p : -p;
    d = min(d, dot2(p - vec2(0.0, clamp(p.y, -hh, hh))));
    d = min(d, dot2(p - vec2(clamp(p.x, 0.0, wh.x), hh)));
    return sqrt(d) * s;
}

float sdQuadraticCircle(vec2 p) {
    p = abs(p);
    if (p.y > p.x) {
        p = p.yx;
    }

    float a = p.x - p.y;
    float b = p.x + p.y;
    float c = (2.0 * b - 1.0) / 3.0;
    float h = a * a + c * c * c;
    float t;

    if (h >= 0.0) {
        h = sqrt(h);
        t = sign(h - a) * pow(abs(h - a), 1.0 / 3.0) - pow(h + a, 1.0 / 3.0);
    } else {
        float z = sqrt(-c);
        float v = acos(a / (c * z)) / 3.0;
        t = -z * (cos(v) + sin(v) * 1.73205080757);
    }

    t *= 0.5;
    vec2 w = vec2(-t, t) + 0.75 - t * t - p;
    return length(w) * sign(a * a * 0.5 + b - 1.5);
}

float sdHyberbola(vec2 p, float k, float he) {
    p = abs(p);
    p = vec2(p.x - p.y, p.x + p.y) * 0.70710678118;

    float x2 = p.x * p.x / 16.0;
    float y2 = p.y * p.y / 16.0;
    float r = k * (4.0 * k - p.x * p.y) / 12.0;
    float q = (x2 - y2) * k * k;
    float h = q * q + r * r * r;

    float u;
    if (h < 0.0) {
        float m = sqrt(-r);
        u = m * cos(acos(q / (r * m)) / 3.0);
    } else {
        float m = pow(sqrt(h) - q, 1.0 / 3.0);
        u = (m - r / m) * 0.5;
    }

    float w = sqrt(u + x2);
    float b = k * p.y - x2 * p.x * 2.0;
    float t = p.x * 0.25 - w + sqrt(max(2.0 * x2 - u + b / w * 0.25, 0.0));
    t = max(t, sqrt(he * he * 0.5 + k) - he * 0.70710678118);
    float dist = length(p - vec2(t, k / t));
    return (p.x * p.y < k) ? dist : -dist;
}

float sdCoolS(vec2 p) {
    float six = (p.y < 0.0) ? -p.x : p.x;
    p.x = abs(p.x);
    p.y = abs(p.y) - 0.2;

    float rex = p.x - min(floor(p.x / 0.4 + 0.5), 0.4);
    float aby = abs(p.y - 0.2) - 0.6;

    float d = dot2(vec2(six, -p.y) - clamp(0.5 * (six - p.y), 0.0, 0.2));
    d = min(d, dot2(vec2(p.x, -aby) - clamp(0.5 * (p.x - aby), 0.0, 0.4)));
    d = min(d, dot2(vec2(rex, p.y - clamp(p.y, 0.0, 0.4))));

    float s = 2.0 * p.x + aby + abs(aby + 0.4) - 0.4;
    return sqrt(d) * sign(s);
}

float sdCircleWave(vec2 p, float tb, float ra) {
    tb = SDF_PI * 5.0 / 6.0 * max(tb, 0.0001);
    vec2 co = ra * vec2(sin(tb), cos(tb));
    p.x = abs(mod(p.x, co.x * 4.0) - co.x * 2.0);
    vec2 p1 = p;
    vec2 p2 = vec2(abs(p.x - 2.0 * co.x), -p.y + 2.0 * co.y);
    float d1 = ((co.y * p1.x > co.x * p1.y) ? length(p1 - co) : abs(length(p1) - ra));
    float d2 = ((co.y * p2.x > co.x * p2.y) ? length(p2 - co) : abs(length(p2) - ra));
    return min(d1, d2);
}

float opRound2D(float d, float r) {
    return d - r;
}

// Back-compat wrappers used by early project scene code.
float sdBox2D(vec2 p, vec2 b) {
    return sdBox(p, b);
}

float sdRoundedBox2D(vec2 p, vec2 b, vec4 r) {
    return sdRoundedBox(p, b, r);
}

float sdSegment2D(vec2 p, vec2 a, vec2 b) {
    return sdSegment(p, a, b);
}

float sdRhombus2D(vec2 p, vec2 b) {
    return sdRhombus(p, b);
}

float sdEquilateralTriangle2D(vec2 p) {
    return sdEquilateralTriangle(p, 1.0);
}

float sdHexagon2D(vec2 p, float r) {
    return sdHexagon(p, r);
}

float sdPentagon2D(vec2 p, float r) {
    return sdPentagon(p, r);
}

float sdStar5_2D(vec2 p, float r, float rf) {
    return sdStar(p, r, 5.0, 2.0 + clamp(rf, 0.0, 1.0) * 3.0);
}

// --- 3D primitives ---

float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float sdPlane(vec3 p, vec4 n) {
    return dot(p, n.xyz) + n.w;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdBoxFrame(vec3 p, vec3 b, float e) {
    p = abs(p) - b;
    vec3 q = abs(p + e) - e;
    return min(
        min(
            length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
            length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)
        ),
        length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0)
    );
}

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdCappedTorus(vec3 p, vec2 sc, float ra, float rb) {
    p.x = abs(p.x);
    float k = (sc.y * p.x > sc.x * p.y) ? dot(p.xy, sc) : length(p.xy);
    return sqrt(dot(p, p) + ra * ra - 2.0 * ra * k) - rb;
}

float sdLink(vec3 p, float le, float r1, float r2) {
    vec3 q = vec3(p.x, max(abs(p.y) - le, 0.0), p.z);
    return length(vec2(length(q.xy) - r1, q.z)) - r2;
}

float sdCylinder(vec3 p, vec3 c) {
    return length(p.xz - c.xy) - c.z;
}

float sdCappedCylinder(vec3 p, float h, float r) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdRoundedCylinder(vec3 p, float ra, float rb, float h) {
    vec2 d = vec2(length(p.xz) - 2.0 * ra + rb, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rb;
}

float sdInfiniteCone(vec3 p, vec2 c) {
    vec2 q = vec2(length(p.xz), -p.y);
    float d = max(dot(q, c), p.y);
    return d;
}

float sdCappedCone(vec3 p, float h, float r1, float r2) {
    vec2 q = vec2(length(p.xz), p.y);
    vec2 k1 = vec2(r2, h);
    vec2 k2 = vec2(r2 - r1, 2.0 * h);
    vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h);
    vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
    float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

float sdRoundCone(vec3 p, float r1, float r2, float h) {
    vec2 q = vec2(length(p.xz), p.y);
    float b = (r1 - r2) / h;
    float a = sqrt(1.0 - b * b);
    float k = dot(q, vec2(-b, a));
    if (k < 0.0) {
        return length(q) - r1;
    }
    if (k > a * h) {
        return length(q - vec2(0.0, h)) - r2;
    }
    return dot(q, vec2(a, b)) - r1;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

float sdVerticalCapsule(vec3 p, float h, float r) {
    p.y -= clamp(p.y, 0.0, h);
    return length(p) - r;
}

float sdHexPrism(vec3 p, vec2 h) {
    const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
    p = abs(p);
    p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
    vec2 d = vec2(
        length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x),
        p.z - h.y
    );
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdTriPrism(vec3 p, vec2 h) {
    vec3 q = abs(p);
    return max(q.z - h.y, max(q.x * 0.866025 + p.y * 0.5, -p.y) - h.x * 0.5);
}

float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    float m = p.x + p.y + p.z - s;
    vec3 q;
    if (3.0 * p.x < m) {
        q = p.xyz;
    } else if (3.0 * p.y < m) {
        q = p.yzx;
    } else if (3.0 * p.z < m) {
        q = p.zxy;
    } else {
        return m * 0.57735027;
    }
    float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
    return length(vec3(q.x, q.y - s + k, q.z - k));
}

float sdPyramid(vec3 p, float h) {
    float m2 = h * h + 0.25;

    p.xz = abs(p.xz);
    p.xz = (p.z > p.x) ? p.zx : p.xz;
    p.xz -= 0.5;

    vec3 q = vec3(p.z, h * p.y - 0.5 * p.x, h * p.x + 0.5 * p.y);

    float s = max(-q.x, 0.0);
    float t = clamp((q.y - 0.5 * p.z) / (m2 + 0.25), 0.0, 1.0);

    float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
    float b = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);

    float d2 = (min(q.y, -q.x * m2 - q.y * 0.5) > 0.0) ? 0.0 : min(a, b);

    return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y));
}

float sdEllipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

float sdRhombus(vec3 p, vec2 la, float h, float ra) {
    p = abs(p);
    vec2 b = vec2(la.x, la.y);
    float f = clamp((ndot(b - 2.0 * p.xz, b) / dot(b, b)), -1.0, 1.0);
    vec2 q = vec2(length(p.xz - 0.5 * b * vec2(1.0 - f, 1.0 + f)) * sign(p.x * b.y + p.z * b.x - b.x * b.y) - ra, p.y - h);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
}

float sdSolidAngle(vec3 p, vec2 c, float ra) {
    vec2 q = vec2(length(p.xz), p.y);
    float l = length(q) - ra;
    float m = length(q - c * clamp(dot(q, c), 0.0, ra));
    return max(l, m * sign(c.y * q.x - c.x * q.y));
}

// --- CSG and blend operators ---

float opUnion(float d1, float d2) {
    return min(d1, d2);
}

float opSubtraction(float d1, float d2) {
    return max(-d2, d1);
}

float opIntersection(float d1, float d2) {
    return max(d1, d2);
}

float opSmoothUnion(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}

float opSmoothSubtraction(float d1, float d2, float k) {
    float h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
    return mix(d2, -d1, h) + k * h * (1.0 - h);
}

float opSmoothIntersection(float d1, float d2, float k) {
    float h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) + k * h * (1.0 - h);
}

float opRoundUnion(float d1, float d2, float r) {
    vec2 u = max(vec2(r - d1, r - d2), vec2(0.0));
    return max(r, min(d1, d2)) - length(u);
}

float opRoundSubtraction(float d1, float d2, float r) {
    vec2 u = max(vec2(r + d1, r - d2), vec2(0.0));
    return min(-r, max(d1, -d2)) + length(u);
}

float opRoundIntersection(float d1, float d2, float r) {
    vec2 u = max(vec2(r + d1, r + d2), vec2(0.0));
    return min(-r, max(d1, d2)) + length(u);
}

float opChamferUnion(float d1, float d2, float r) {
    return min(min(d1, d2), (d1 - r + d2) * 0.70710678);
}

float opChamferSubtraction(float d1, float d2, float r) {
    return max(max(d1, -d2), (d1 + r - d2) * 0.70710678);
}

float opChamferIntersection(float d1, float d2, float r) {
    return max(max(d1, d2), (d1 + r + d2) * 0.70710678);
}

float opStairsUnion(float d1, float d2, float r, float n) {
    float s = r / n;
    float u = d2 - r;
    return min(min(d1, d2), 0.5 * (u + d1 + abs(mod(u - d1 + s, 2.0 * s) - s)));
}

float opStairsIntersection(float d1, float d2, float r, float n) {
    return -opStairsUnion(-d1, -d2, r, n);
}

float opStairsSubtraction(float d1, float d2, float r, float n) {
    return -opStairsUnion(-d1, d2, r, n);
}

float opOnion(float d, float thickness) {
    return abs(d) - thickness;
}

// Domain operators (space transforms)

vec3 opElongate(vec3 p, vec3 h) {
    return p - clamp(p, -h, h);
}

vec3 opRep(vec3 p, vec3 c) {
    return mod(p + 0.5 * c, c) - 0.5 * c;
}

vec3 opRepLim(vec3 p, float c, vec3 l) {
    vec3 q = p / c;
    vec3 rq = sign(q) * floor(abs(q) + 0.5);
    return p - c * clamp(rq, -l, l);
}

vec2 opSymPolar(in vec2 p, float repetitions) {
    float angle = 2.0 * SDF_PI / repetitions;
    float a = atan(p.y, p.x) + 0.5 * angle;
    float r = length(p);
    float c = floor(a / angle);
    a = mod(a, angle) - 0.5 * angle;
    return vec2(cos(a), sin(a)) * r;
}
