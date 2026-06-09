import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Lamp Shade Copy',

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
