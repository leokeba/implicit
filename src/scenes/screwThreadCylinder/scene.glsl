// The thread carries its own detent: inside a narrow angular slot at theta=0
// the crest dips toward the core along the entire helix, so when two
// assembled parts rotate, every engaged crest falls into the slot at the lock
// angle and has to climb back out to keep rotating. `width` is the slot's
// full angular extent; `depth` is the fraction of the thread depth removed
// at its center. Returns the amplitude factor to scale the thread by.
float threadDetentFactor(vec3 p, float width, float depth) {
    float angle = atan(p.z, p.x);
    float slot = 1.0 - smoothstep(0.0, max(width * 0.5, 1e-4), abs(angle));
    return 1.0 - depth * slot;
}

float sdScrewThreadedCylinder(
    vec3 p,
    float bodyHalfHeight,
    float coreRadius,
    float pitch,
    float threadDepth,
    float bandHeight,
    float detentWidth,
    float detentDepth,
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
    float clearanceLineWidths = 1.2;
    float clearancePlateauLineWidths = 10.0;
    float clearanceTransitionEnd = min(
        max(lineWidthScene * clearancePlateauLineWidths, threadTaperHeight),
        max(topTaperHeight - lineWidthScene, threadTaperHeight)
    );
    float topFitOffset = lineWidthScene * clearanceLineWidths
        * (1. - smoothstep(pitch * 2., bodyHalfHeight * 2. - pitch * 2., distanceFromTop));

    float detentFactor = threadDetentFactor(p, detentWidth, detentDepth);

    float radius = coreRadius + threadDepth * profile * threadMask * detentFactor - topFitOffset;
    vec2 d = vec2(length(p.xz) - radius, abs(p.y) - bodyHalfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float mapScene(vec3 p) {
    float layerWidthScene = sceneLineWidth();
    // Band ~ one pitch tall, so the thread rises and falls across about one turn at each end.
    float bandHeight = uPitch * 2.;
    return sdScrewThreadedCylinder(p, uBodyHalfHeight, uCoreRadius, uPitch, uThreadDepth, bandHeight, uDetentWidth, uDetentDepth, layerWidthScene);
}
