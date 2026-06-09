float mapScene(vec3 p) {
    // p.xz *= rot2(uFrameModulo*SDF_PI*2./30.);
    // p.x += cos01(p.y/4.) * 0.2;
    vec2 uv = cylinderSurfaceToPlane(p * vec3(1., 0.25, 1.) + vec3(0., 0.5, 0.));
    float amplitude = smoothstep(0.0, uSceneBeltWidth, 0.5 - abs(uv.y - 0.5));
    p.xz *= rot2(p.y);
    p.xy /= 1. + simplexNoise(p*0.7+10.) * uSceneNoiseDepth * amplitude;
    // p.xy /= 0.8 + amplitude * 0.2;
    float profile = smoothstep(0.0, 0.5, 0.5 - abs(uv.y - 0.5));
    profile = cos01(uv.y+0.5);
    float cylinder = sdCappedCylinder(p, 3., 0.5 + profile);
    float innerCylinder = sdCappedCylinder(p, 3., 0.4 + profile);
    float hollowCylinder = opSubtraction(cylinder, innerCylinder);
    float rectangle = sdBox(p + vec3(1.,0.,0.), vec3(1., 3., 0.2));
    float shell = opRoundSubtraction(hollowCylinder, rectangle, 0.1);
    // uv.x += cos01(p.y*0.25) * 0.1;
    // float waves = sin01(uv.x * 60. + uv.y * 3.);// * sin01(uv.x * 29. + uv.y * 11.);

    // cylinder -= 0.1 * waves * amplitude;
    // shell -= simplexNoise(p*0.7+10.) * uSceneNoiseDepth * amplitude;
    // cylinder += sin01(uv.x);
    return shell;
}
