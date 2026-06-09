// float mapScene(vec3 p) {
//     vec3 transform = vec3(1., 0.5, 1.);
//     // p = opElongate(p, transform);
//     p *= transform;
//     float angle = atan(p.z, p.x);
//     float deform = 0.02 * sin(30. * angle + 10. * p.y);
//     return sdSphere(p, 1.) + deform;
// }

float mapScene(vec3 p) {
    p.xz *= rot2(uFrameModulo*SDF_PI*2./30.);
    p.x += cos01(p.y/4.) * 0.2;
    float cylinder = sdCappedCylinder(p, 2., 1.);
    vec2 uv = cylinderSurfaceToPlane(p * vec3(1., 0.25, 1.) + vec3(0., 0.5, 0.));
    uv.x += cos01(p.y*0.25) * 0.1;
    float waves = sin01(uv.x * 60. + uv.y * 3.);// * sin01(uv.x * 29. + uv.y * 11.);
    float amplitude = smoothstep(0.0, 0.2, 0.5 - abs(uv.y - 0.5));
    cylinder -= 0.1 * waves * amplitude;
    // cylinder -= simplexNoise(p*0.25+10.) * 0.2 * amplitude;
    // cylinder += sin01(uv.x);
    return cylinder;
}
