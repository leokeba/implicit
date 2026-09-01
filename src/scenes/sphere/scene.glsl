// A plain sphere resting on the bed: the shape planar vase-mode slicing
// cannot print. Its slope runs from 0 degrees at both poles to 90 at the
// equator, and wherever the slope drops below atan(layerHeight / lineWidth)
// consecutive revolutions stop touching.
//
// uSceneFlatten squashes it into an oblate spheroid, which widens the
// shallow bands at the poles and makes the failure easier to see.

float mapScene(vec3 p) {
    p.y = (p.y + 1.0) / max(0.05, uSceneFlatten) - 1.0;
    return sdSphere(p, 1.0) * max(0.05, uSceneFlatten);
}
