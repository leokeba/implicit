import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Screw Thread Cylinder',

    slicer: {
        minY: -1,
        maxY: 1,
        maxRadius: 1.2,
        modelScale: 25,
        nozzleDiameter: 0.8,
    },
});
