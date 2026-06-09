import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Noise Shade',

    uniforms: {
        uSceneNoiseDepth: { default: 0.2, min: 0.02, max: 0.35, step: 0.01, label: 'Noise depth', section: 'Surface', description: 'Controls the depth of the surface breakup.' },
        uSceneBeltWidth: { default: 0.2, min: 0.08, max: 0.45, step: 0.01, label: 'Belt width', section: 'Surface' },
    },

    slicer: {
        minY: -2,
        maxY: 2,
        maxRadius: 2,
        modelScale: 25,
        nozzleDiameter: 0.4,
        flowRate: 1,
        layerHeight: 0.2,
    },
});
