float baseSphere(vec3 p) {
    vec3 transform = vec3(1., 0.5, 1.);
    // p = opElongate(p, transform);
    p *= transform;
    float angle = atan(p.z, p.x);
    float deform = 0.02 * sin(30. * angle + 10. * p.y);
    return sdSphere(p, 1.) + deform;
}

float mapScene(vec3 p) {
    return opSubtraction(baseSphere(p), baseSphere(p - vec3(0.2, 0., 0.))) - 0.05;
}
