import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Noise Tower Parts',

    uniforms: {
        uSceneNoiseDepth: { default: 0.065, min: 0.01, max: 5, step: 0.005, label: 'Noise depth', section: 'Surface', description: 'Controls the depth of the surface breakup.' },
        uSceneBeltWidth: { default: 0.24, min: 0.08, max: 0.48, step: 0.01, label: 'Belt width', section: 'Surface', description: 'Controls how much of the height receives the breakup pattern.' },
        uPartIndex: { default: 0, min: 0, max: 7, step: 1, label: 'Part index', section: 'Parts', description: 'Which slice of the full tower this print covers.' },
        uPartCount: { default: 8, min: 1, max: 12, step: 1, label: 'Part count', section: 'Parts' },
    },

    slicer: {
        minY: -2.5,
        maxY: 2.5,
        maxRadius: 2,
        modelScale: 100,
        flowRate: 1,
    },

    export: {
        filenameSuffix: 'part-{part1}-of-{count}',
    },
});
