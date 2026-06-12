// Returns a 0..1 mask that goes to 1 inside a narrow angular slot at theta=0
// across the detent's full axial span, and to 0 everywhere else. Multiplied
// into the thread amplitude so the helical ridge vanishes for ~5° of arc at
// the slot — when two assembled parts rotate, the mating crests fall into the
// flat for the lock position and have to climb back up to keep rotating.
const float DETENT_HALF_WIDTH_RAD = 0.044; // ~2.5° → 5° full slot

float threadDetentMask(vec3 p, float distanceFromCap, float lockCenter, float lockHalfHeight) {
    float angle = atan(p.z, p.x);
    float angularMask = exp(-pow(angle / DETENT_HALF_WIDTH_RAD, 2.0));

    // Keep the detent vertical by using the axial term only as a band gate,
    // not as part of a radial falloff with the angle.
    float axialDistance = abs(distanceFromCap - lockCenter);
    float axialMask = 1.0 - smoothstep(lockHalfHeight, lockHalfHeight * 1.35, axialDistance);

    return angularMask * axialMask;
}

float sdScrewThreadedCylinder(
    vec3 p,
    float bodyHalfHeight,
    float coreRadius,
    float pitch,
    float threadDepth,
    float bandHeight,
    float lineWidthScene
) {
    float distanceFromBottom = p.y + bodyHalfHeight;
    float distanceFromTop = bodyHalfHeight - p.y;

    // Only the upper side of each thread band tapers: for the bottom band that
    // is the inner edge toward the body; for the top band that is the cap.
    float threadTaperHeight = pitch * 0.5;
    float topTaperHeight = bandHeight * 1.5 + threadTaperHeight;

    float bottomBand = innerThreadTaper(distanceFromBottom, bandHeight, threadTaperHeight);
    float topBand = capThreadTaper(distanceFromTop, threadTaperHeight)
        * innerThreadTaper(distanceFromTop, bandHeight, threadTaperHeight);
    float threadMask = max(bottomBand, topBand);

    float profile = sinusoidalThreadProfile(p, pitch);

    // Start the top tolerance taper before the thread runout, so the fit neck
    // is already established before the top thread reaches full height.
    // Increase `clearanceLineWidths` if printed parts still don't slip together.
    float clearanceLineWidths = 1.8;
    float clearancePlateauLineWidths = 10.0;
    float clearanceTransitionEnd = min(
        max(lineWidthScene * clearancePlateauLineWidths, threadTaperHeight),
        max(topTaperHeight - lineWidthScene, threadTaperHeight)
    );
    float topFitOffset = lineWidthScene * clearanceLineWidths
        * (1. - smoothstep(pitch * 2., bodyHalfHeight * 2. - pitch * 2., distanceFromTop));

    // Detents sit on each band's crest. With matching centers, the top and
    // bottom detents coincide exactly when the threads are fully engaged.
    float detentHalfHeight = pitch * 0.3;
    float bottomDetentCenter = bandHeight * 0.5;
    float topDetentCenter = bandHeight * 0.5;
    float detentMask = max(
        threadDetentMask(p, distanceFromBottom, bottomDetentCenter, detentHalfHeight),
        threadDetentMask(p, distanceFromTop, topDetentCenter, detentHalfHeight)
    );
    // detentMask = 0.;

    float radius = coreRadius + threadDepth * profile * threadMask * (1.0 - detentMask) - topFitOffset;
    vec2 d = vec2(length(p.xz) - radius, abs(p.y) - bodyHalfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float mapScene(vec3 p) {
    float layerWidthScene = sceneLineWidth();
    // Band ~ one pitch tall, so the thread rises and falls across about one turn at each end.
    float bandHeight = uPitch * 2.;
    return sdScrewThreadedCylinder(p, uBodyHalfHeight, uCoreRadius, uPitch, uThreadDepth, bandHeight, layerWidthScene);
}
