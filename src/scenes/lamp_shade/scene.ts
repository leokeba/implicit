import { defineScene, usePostprocess } from 'implicit/scene';

export default defineScene({
    title: 'Lamp Shade',

    uniforms: {
        uSceneTwistTurns: { default: 1.7, min: 0.8, max: 3.2, step: 0.05, label: 'Twist turns', section: 'Profile', description: 'Controls how tightly the shade spirals around the center axis.' },
        uSceneOrbitRadius: { default: 0.46, min: 0.2, max: 0.7, step: 0.01, label: 'Orbit radius', section: 'Profile' },
        uSceneBodyExponent: { default: 0.68, min: 0.4, max: 1.2, step: 0.02, label: 'Body exponent', section: 'Profile' },
    },

    params: {
        heightMm: { default: 100, min: 40, max: 240, step: 5, section: 'Size', label: 'Height (mm)' },
        radiusMm: { default: 50, min: 15, max: 110, step: 1, section: 'Size', label: 'Max radius (mm)' },
    },

    slicer: {
        nozzleDiameter: 0.4,
        layerHeight: 0.2,
        flowRate: 1,
    },

    // The surface is hard-capped at |y| <= 1.55 in scene.glsl; print size
    // drives scale and bounds from there.
    preprocess({ params }) {
        const halfHeight = 1.55;
        const modelScale = params.heightMm / (2 * halfHeight);
        return {
            slicer: {
                modelScale,
                minY: -halfHeight,
                maxY: halfHeight,
                maxRadius: params.radiusMm / modelScale,
            },
        };
    },

    postprocess: [
        usePostprocess('sine-wave', { amplitudeMm: 0.4, wavesPerLayer: 7 }),
    ],
});
