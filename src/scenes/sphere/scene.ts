import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Sphere',

    uniforms: {
        uSceneFlatten: {
            default: 1,
            min: 0.3,
            max: 1,
            step: 0.05,
            label: 'Flatten',
            section: 'Shape',
            description: 'Vertical squash. Below 1 the poles flatten out, widening the shallow-slope bands where single-wall revolutions cannot reach each other.',
        },
    },

    slicer: {
        // The sphere sits on the bed: minY is the bottom pole, so the first
        // contour is a point and the slope climbs from horizontal.
        minY: -1,
        maxY: 1,
        maxRadius: 1.1,
        modelScale: 25,
        layerHeight: 0.2,
    },
});
