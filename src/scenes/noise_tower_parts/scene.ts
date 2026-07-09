import { defineScene } from 'implicit/scene';

// Thread geometry is a printing concern, not a proportion: it stays constant
// in millimeters no matter how large the cylinder gets.
const PITCH_MM = 11.;
const THREAD_DEPTH_MM = 4.;
const SLICE_MARGIN_MM = 50;

export default defineScene({
    title: 'Noise Tower Parts',

    params: {
        heightMm: { default: 480, min: 10, max: 500, step: 1, label: 'Height (mm)', section: 'Size' },
        diameterMm: { default: 350, min: 15, max: 400, step: 1, label: 'Outer diameter (mm)', section: 'Size', description: 'Outside diameter measured over the thread crests.' },
        detentWidthDeg: { default: 5, min: 0, max: 60, step: 1, label: 'Detent width (°)', section: 'Thread', description: 'Full angular extent of the detent slot carved into the thread crest.' },
        detentDepth: { default: 0, min: 0, max: 1, step: 0.05, label: 'Detent depth', section: 'Thread', description: 'Fraction of the thread depth removed at the center of the slot.' },
    },
    
    uniforms: {
        uSceneNoiseDepth: { default: 0.15, min: 0.01, max: 5, step: 0.005, label: 'Noise depth', section: 'Surface', description: 'Controls the depth of the surface breakup.' },
        uSceneBeltWidth: { default: 0.24, min: 0.08, max: 0.48, step: 0.01, label: 'Belt width', section: 'Surface', description: 'Controls how much of the height receives the breakup pattern.' },
        uPartIndex: { default: 0, min: 0, max: 11, step: 1, label: 'Part index', section: 'Parts', description: 'Which slice of the full tower this print covers.' },
        uPartCount: { default: 8, min: 1, max: 12, step: 1, label: 'Part count', section: 'Parts' },
        uBodyHalfHeight: 1.0,
        uCoreRadius: 0.95,
        uPitch: 0.18,
        uThreadDepth: 0.05,
        uDetentWidth: 0.087,
        uDetentDepth: 1.0,
    },

    slicer: {
        nozzleDiameter: 0.8,
        layerHeight: 0.5,
        lineWidth: 1.,
        firstLayerLineWidth: 1.,
        brimWidthMm: 15
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
                uDetentWidth: (params.detentWidthDeg * Math.PI) / 180,
                uDetentDepth: params.detentDepth,
            },
        };
    },

    export: {
        filenameSuffix: 'part-{part1}-of-{count}',
    },
});
