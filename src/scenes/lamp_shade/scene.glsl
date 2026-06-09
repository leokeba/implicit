// float mapScene(vec3 p) {
//     vec3 transform = vec3(1., 0.5, 1.);
//     // p = opElongate(p, transform);
//     p *= transform;
//     float angle = atan(p.z, p.x);
//     float deform = 0.02 * sin(30. * angle + 10. * p.y);
//     return sdSphere(p, 1.) + deform;
// }

float mapScene(vec3 p) {
    float halfHeight = 1.55;
    float y01 = clamp((p.y / halfHeight) * 0.5 + 0.5, 0.0, 1.0);

    // Mid-height bulge with tapered ends.
    float core = pow(sin(y01 * 3.14159265), uSceneBodyExponent);

    // Sweep the bean cross-section around the center axis.
    float turns = uSceneTwistTurns;
    float phase = (y01 - 0.5) * 6.2831853 * turns;
    float spiralRadius = mix(0.05, uSceneOrbitRadius, core);
    vec2 center = spiralRadius * vec2(cos(phase), sin(phase));

    vec2 q = p.xz - center;
    q *= rot2(phase * 0.65);

    // Bean-like cross-section that stays smaller than its spiral orbit radius.
    float bodyRadius = mix(0.02, 0.39, core);
    float a = atan(q.y, q.x);
    float beanWarp = 1.0 + 0.10 * cos(a - 0.25) + 0.03 * cos(2.0 * a + 0.7);
    float profile = length(q) - bodyRadius * beanWarp;

    // Hard vertical limits; radius taper keeps these visually soft.
    float cap = abs(p.y) - halfHeight;
    return max(profile, cap);
}
