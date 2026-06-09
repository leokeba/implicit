import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Deformed Sphere',

    slicer: {
        minY: -1,
        maxY: 1,
        maxRadius: 2,
        modelScale: 25,
        nozzleDiameter: 0.4,
        flowRate: 1,
        layerHeight: 0.2,
    },
});
