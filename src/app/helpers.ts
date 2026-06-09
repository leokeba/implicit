export function formatEta(seconds: number): string {
    const clamped = Math.max(0, Math.round(seconds));
    if (clamped < 60) {
        return `${clamped}s`;
    }

    const minutes = Math.floor(clamped / 60);
    const remSeconds = clamped % 60;
    return `${minutes}m ${remSeconds}s`;
}

export function toSceneId(value: string): string {
    return value
        .trim()
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'scene';
}

export function buildSceneGlslTemplate(sceneName: string): string {
    const label = sceneName.trim() || 'New Scene';
    return `// ${label}
// Uniforms are declared in scene.ts and injected automatically.

float mapScene(vec3 p) {
    return length(p) - uRadius;
}
`;
}

export function buildSceneManifestTemplate(sceneName: string): string {
    const label = (sceneName.trim() || 'New Scene').replace(/'/g, "\\'");
    return `import { defineScene } from 'implicit/scene';

export default defineScene({
    title: '${label}',

    uniforms: {
        uRadius: { default: 0.8, min: 0.2, max: 1.0, step: 0.01 },
    },

    params: {
        heightMm: { default: 100, min: 30, max: 250, step: 5, section: 'Size' },
        radiusMm: { default: 45, min: 10, max: 120, step: 1, section: 'Size' },
    },

    // The surface lives in y [-1, 1]; size flows from the printed dimensions.
    preprocess({ params }) {
        const modelScale = params.heightMm / 2;
        return {
            slicer: {
                modelScale,
                minY: -1,
                maxY: 1,
                maxRadius: params.radiusMm / modelScale,
            },
        };
    },

    postprocess: [],
});
`;
}
