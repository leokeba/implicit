vec3 sampleEnvironment(vec3 dir) {
    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 skyTop = vec3(0.08, 0.16, 0.33);
    vec3 skyMid = vec3(0.22, 0.31, 0.52);
    vec3 groundDark = vec3(0.045, 0.05, 0.07);
    vec3 groundBright = vec3(0.12, 0.14, 0.19);

    vec3 sky = mix(skyMid, skyTop, smoothstep(0.45, 1.0, t));
    vec3 ground = mix(groundDark, groundBright, smoothstep(-0.35, 0.15, dir.y));
    vec3 env = mix(ground, sky, smoothstep(0.0, 0.56, t));

    vec3 keyDir = normalize(vec3(0.55, 0.72, 0.38));
    vec3 fillDir = normalize(vec3(-0.62, 0.58, 0.46));
    float key = pow(max(dot(dir, keyDir), 0.0), 72.0);
    float fill = pow(max(dot(dir, fillDir), 0.0), 48.0);
    env += vec3(1.0, 0.96, 0.9) * key * 1.35;
    env += vec3(0.72, 0.82, 1.0) * fill * 0.85;

    float floorMask = smoothstep(0.25, -0.55, dir.y);
    vec2 fp = normalize(dir.xz + vec2(1e-5));
    float bands = 0.5 + 0.5 * sin(18.0 * fp.x + 4.0 * fp.y);
    env += vec3(0.05, 0.06, 0.08) * bands * floorMask * 0.55;

    return env;
}
