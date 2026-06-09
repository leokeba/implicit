import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Fresnel',

    uniforms: {
        uSceneRadius: { default: 1, min: 0.35, max: 1.6, step: 0.05, label: 'Radius', section: 'Shape', description: 'Default scene profile controls.' },
        uSceneHalfHeight: { default: 1, min: 0.35, max: 1.8, step: 0.05, label: 'Half height', section: 'Shape' },
    },

    slicer: {
        minY: -1.8,
        maxY: 1.9,
        maxRadius: 2,
        modelScale: 25,
        nozzleDiameter: 0.8,
        layerHeight: 0.6,
        lineWidth: 1,
        firstLayerLineWidth: 1,
    },
});
