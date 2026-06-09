import { defineScene } from 'implicit/scene';

export default defineScene({
    title: 'Threaded Coupler',

    uniforms: {
        uScenePieceOffset: { default: 1.45, min: 1.05, max: 2.2, step: 0.05, label: 'Piece offset', section: 'Layout', description: 'Horizontal separation between the threaded plug and sleeve so they print as two loose parts.' },
        uSceneHalfHeight: { default: 0.95, min: 0.45, max: 1.35, step: 0.05, label: 'Thread height', section: 'Thread' },
        uSceneCoreRadius: { default: 0.32, min: 0.18, max: 0.55, step: 0.01, label: 'Core radius', section: 'Thread' },
        uSceneThreadDepth: { default: 0.09, min: 0.03, max: 0.16, step: 0.005, label: 'Thread depth', section: 'Thread' },
        uScenePitch: { default: 0.22, min: 0.12, max: 0.36, step: 0.01, label: 'Pitch', section: 'Thread', description: 'Axial distance covered by one helical turn.' },
        uSceneClearance: { default: 0.025, min: 0.01, max: 0.06, step: 0.0025, label: 'Clearance', section: 'Fit', description: 'Radial slack added to the sleeve so the parts can screw together after printing.' },
        uSceneLeadIn: { default: 0.18, min: 0.06, max: 0.35, step: 0.01, label: 'Lead-in', section: 'Fit', description: 'Tapers the thread away near the ends to make the start easier to catch.' },
        uSceneSleeveWall: { default: 0.17, min: 0.1, max: 0.4, step: 0.01, label: 'Sleeve wall', section: 'Sleeve' },
        uSceneGripThickness: { default: 0.12, min: 0.05, max: 0.28, step: 0.01, label: 'Grip thickness', section: 'Sleeve' },
        uSceneHandedness: { default: 0, options: ['Right hand', 'Left hand'], label: 'Handedness', section: 'Thread', description: 'Flips the helix direction for both mating parts.' },
        uSceneCrestSharpness: { default: 1.55, min: 0.8, max: 2.8, step: 0.1, label: 'Crest sharpness', section: 'Thread', description: 'Controls how triangular or blunt the thread profile feels.' },
    },

    fields: {
        gripNoise: { fn: 'sampleToolpathNoise', min: 0, max: 1, label: 'Grip noise', description: 'Subtle modulation field derived from the two-piece thread layout.' },
    },

    slicer: {
        minY: -1.45,
        maxY: 1.1,
        maxRadius: 2.9,
        modelScale: 14,
    },
});
