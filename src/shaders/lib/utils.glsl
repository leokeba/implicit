float angleUnit(vec2 p) {
    return atan(p.y, p.x) / 6.28318530718;
}

float spiralPosition(vec3 p) {
    float angle = angleUnit(p.xz);
    float layer = p.y / uLayerHeight;
    return angle + layer;
}