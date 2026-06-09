import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Default Scene',

    uniforms: {
        uSceneRadius: { default: 1, min: 0.35, max: 1.6, step: 0.05, label: 'Radius', section: 'Shape', description: 'Default scene profile controls.' },
        uSceneHalfHeight: { default: 1, min: 0.35, max: 1.8, step: 0.05, label: 'Half height', section: 'Shape' },
        uSceneNoiseScale: { default: 1.3, min: 0.25, max: 4, step: 0.05, label: 'Noise scale', section: 'Field', description: 'Frequency of the default postprocess noise field.' },
        uSceneNoiseContrast: { default: 1, min: 0, max: 2, step: 0.05, label: 'Noise contrast', section: 'Field', description: 'Push the default noise field toward flatter or punchier modulation.' },
        uSceneNoiseMode: { default: 0, options: ['Simplex', 'Ridged'], label: 'Noise mode', section: 'Field', description: 'Switch between smooth simplex noise and a ridged variant for modulation.' },
    },

    fields: {
        noise: { fn: 'sampleToolpathNoise', min: 0, max: 1, label: 'Noise', description: 'Normalized field sampled along the raw spiral toolpath for postprocess modulation.' },
    },

    slicer: {
        minY: -1,
        maxY: 1,
        maxRadius: 1.1,
        modelScale: 25,
    },
});
