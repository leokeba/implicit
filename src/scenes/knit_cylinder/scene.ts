import { defineScene, usePostprocess } from 'implicit/scene';

// Plain 50 x 50 mm cylinder for validating knit/loop postprocess patterns
// on the simplest possible wall before moving to sculpted shapes.
export default defineScene({
    title: 'Knit Cylinder',

    slicer: {
        minY: -1,
        maxY: 1,
        maxRadius: 1.2,
        modelScale: 25,
        nozzleDiameter: 0.4,
        flowRate: 1,
        layerHeight: 0.2,
        spiralPitchMm: 2.5,
    },

    postprocess: [
        usePostprocess('knit-loops'),
    ],
});
