float fresnelSchlick(float cosTheta, float f0) {
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

vec3 shadeShaded(vec3 normal, vec3 viewDir) {
    vec3 lightDir = normalize(vec3(0.9, 1.0, 0.6));
    float diff = max(dot(normal, lightDir), 0.0);
    float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
    return vec3(0.18, 0.55, 0.95) * (0.25 + 0.9 * diff) + vec3(0.35, 0.75, 1.0) * rim * 0.25;
}

vec3 shadeGlass(vec3 hitPos, vec3 normal, vec3 rayDir) {
    float ior = 1.46;
    float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
    float cosTheta = clamp(dot(-rayDir, normal), 0.0, 1.0);
    float fresnel = fresnelSchlick(cosTheta, f0);

    vec3 reflDir = reflect(rayDir, normal);
    vec3 reflection = sampleEnvironment(reflDir);

    vec3 refrIn = refract(rayDir, normal, 1.0 / ior);
    vec3 transmission = sampleEnvironment(reflDir);

    if (dot(refrIn, refrIn) > 1e-7) {
        vec3 pEnter = hitPos - normal * (uHitEpsilon * 6.0);
        vec3 pExit = vec3(0.0);
        float tInside = marchInsideToExit(pEnter, refrIn, pExit);

        if (tInside > 0.0) {
            vec3 nExit = estimateNormal(pExit);
            vec3 refrOut = refract(refrIn, nExit, ior);
            if (dot(refrOut, refrOut) < 1e-7) {
                refrOut = reflect(refrIn, nExit);
            }

            transmission = sampleEnvironment(refrOut);
            vec3 sigmaA = vec3(1.2, 0.55, 0.35);
            vec3 absorb = exp(-sigmaA * tInside * 0.85);
            transmission *= absorb;

            vec3 caDir = normalize(refrOut + nExit * 0.01);
            vec3 caEnv = sampleEnvironment(caDir);
            transmission = mix(transmission, vec3(caEnv.r, transmission.g, caEnv.b), 0.16);
        }
    }

    vec3 color = mix(transmission, reflection, fresnel);

    vec3 lightDir = normalize(vec3(0.6, 0.95, 0.35));
    vec3 hVec = normalize(lightDir - rayDir);
    float spec = pow(max(dot(normal, hVec), 0.0), 120.0);
    color += vec3(1.0) * spec * 0.08;

    return color;
}

vec3 shadeByMode(int viewMode, vec3 hitPos, vec3 normal, vec3 rayDir) {
    if (viewMode == 1) {
        return normal * 0.5 + 0.5;
    }

    if (viewMode == 2) {
        return shadeGlass(hitPos, normal, rayDir);
    }

    return shadeShaded(normal, -rayDir);
}
