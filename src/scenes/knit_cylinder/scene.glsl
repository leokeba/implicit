float mapScene(vec3 p) {
    float radius = 1.0;
    float halfHeight = 1.0;
    vec2 d = vec2(length(p.xz) - radius, abs(p.y) - halfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
