import { defineScene } from 'implicit/scene';

// Thread geometry is a printing concern, not a proportion: it stays constant
// in millimeters no matter how large the cylinder gets.
const PITCH_MM = 7.;
const THREAD_DEPTH_MM = 3.;
const SLICE_MARGIN_MM = 2;

export default defineScene({
    title: 'Screw Thread Cylinder',

    params: {
        heightMm: { default: 50, min: 10, max: 500, step: 1, label: 'Height (mm)', section: 'Size' },
        diameterMm: { default: 50, min: 15, max: 400, step: 1, label: 'Outer diameter (mm)', section: 'Size', description: 'Outside diameter measured over the thread crests.' },
    },

    // Fixed values (no sliders); preprocess overrides all of them.
    uniforms: {
        uBodyHalfHeight: 1.0,
        uCoreRadius: 0.95,
        uPitch: 0.18,
        uThreadDepth: 0.05,
    },

    slicer: {
        nozzleDiameter: 0.8,
    },

    // Scene units are normalized by the largest printed dimension, so both
    // the body height and the slice extent stay O(1) at any aspect ratio
    // (the slicer clamps maxRadius to 3 scene units and its sampling
    // tolerances assume a roughly unit-sized scene). The mm-constant thread
    // geometry is converted into scene units against that scale.
    preprocess({ params }) {
        const outerRadiusMm = params.diameterMm / 2;
        const modelScale = Math.max(params.heightMm, params.diameterMm) / 2;
        const bodyHalfHeight = params.heightMm / (2 * modelScale);
        return {
            slicer: {
                modelScale,
                minY: -bodyHalfHeight,
                maxY: bodyHalfHeight,
                maxRadius: (outerRadiusMm + SLICE_MARGIN_MM) / modelScale,
            },
            uniforms: {
                uBodyHalfHeight: bodyHalfHeight,
                uCoreRadius: (outerRadiusMm - THREAD_DEPTH_MM) / modelScale,
                uPitch: PITCH_MM / modelScale,
                uThreadDepth: THREAD_DEPTH_MM / modelScale,
            },
        };
    },
});
