float mapScene(vec3 p) {
    p = p.xzy;
    float scene = 0.;
    float rad = length(p.xz);
    p.y += cos01(rad*2.) * 0.15;
    scene = sdRoundedCylinder(p, 1., 0.1, 0.);
    return scene;
}
