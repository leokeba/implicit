import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Isolator Shade',

    uniforms: {
        uSceneCellScaleAround: { default: 11, min: 5, max: 24, step: 1, label: 'Cells around', section: 'Emboss', description: 'Approximate number of bio cells wrapping around the shade.' },
        uSceneCellScaleHeight: { default: 16, min: 6, max: 30, step: 1, label: 'Cells high', section: 'Emboss', description: 'Approximate number of bio cells distributed vertically.' },
        uSceneRidgeWidth: { default: 0.028, min: 0.008, max: 0.08, step: 0.002, label: 'Ridge width', section: 'Emboss', description: 'Controls how thick the embossed veins are.' },
        uSceneEmbossDepth: { default: 0.034, min: 0, max: 0.09, step: 0.002, label: 'Emboss depth', section: 'Emboss', description: 'Pushes the ridge network outward from the carrier surface.' },
        uSceneWarpAmount: { default: 0.09, min: 0, max: 0.3, step: 0.01, label: 'Warp amount', section: 'Emboss', description: 'Introduces organic drift so the cell network feels grown instead of tiled.' },
    },

    fields: {
        noise: { fn: 'sampleToolpathNoise', min: 0, max: 1, label: 'Noise', description: 'Normalized field sampled along the raw spiral toolpath for postprocess modulation.' },
    },

    slicer: {
        minY: -2,
        maxY: 2,
        maxRadius: 2,
        modelScale: 25,
        flowRate: 1,
    },
});
