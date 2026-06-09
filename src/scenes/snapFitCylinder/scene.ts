import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Snap Fit Cylinder',

    slicer: {
        minY: -1,
        maxY: 1,
        maxRadius: 1.1,
        modelScale: 25,
        nozzleDiameter: 0.8,
    },
});
