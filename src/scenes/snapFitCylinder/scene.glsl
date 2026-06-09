float sinusoidalSnapBand(float distanceFromCap, float bandHeight) {
    float t = clamp(1.0 - (distanceFromCap / max(bandHeight, 1e-6)), 0.0, 1.0);
    return sin(t * 3.14159265);
}

float sinusoidalSnapProfile(float y, float bodyHalfHeight, float ringHeight, float amplitude, float lineWidthScene) {
    float distanceFromBottom = y + bodyHalfHeight;
    float distanceFromTop = bodyHalfHeight - y;

    float bottomShape = sinusoidalSnapBand(distanceFromBottom, ringHeight);
    float topShape = sinusoidalSnapBand(distanceFromTop, ringHeight);
    float topFitOffset = lineWidthScene * smoothstep(0.0, 1.0, topShape);

    float bottomOffset = -amplitude * bottomShape;
    float topOffset = -(amplitude * topShape) - topFitOffset;
    return bottomOffset + topOffset;
}

float sdProfiledCappedCylinder(vec3 p, float bodyHalfHeight, float baseRadius, float ringHeight, float amplitude, float lineWidthScene) {
    float radius = baseRadius + sinusoidalSnapProfile(p.y, bodyHalfHeight, ringHeight, amplitude, lineWidthScene);
    vec2 d = vec2(length(p.xz) - radius, abs(p.y) - bodyHalfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float mapScene(vec3 p) {
    float layerWidthScene = sceneLineWidth();
    float bodyHalfHeight = 1.0;
    float baseRadius = 1.1;
    float ringHeight = 5.0 / max(uScale, 1e-6);
    float snapAmplitude = max(layerWidthScene * 1., 0.6 / max(uScale, 1e-6));
    return sdProfiledCappedCylinder(p, bodyHalfHeight, baseRadius, ringHeight, snapAmplitude, layerWidthScene);
}
