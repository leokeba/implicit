import {
    buildScriptDocument,
    type PostprocessScriptDocument,
    type PostprocessScriptLanguage,
} from '../core/postprocess-registry';

export type { PostprocessScriptDocument } from '../core/postprocess-registry';

export function createPostprocessDocument(
    existingDocuments: PostprocessScriptDocument[],
    language: PostprocessScriptLanguage = 'typescript',
    requestedName?: string,
): PostprocessScriptDocument {
    const baseName = (requestedName ?? 'New Postprocess').trim() || 'New Postprocess';
    const existingIds = new Set(existingDocuments.map((document) => document.id));
    const baseId = toScriptId(baseName);

    let nextId = baseId;
    let suffix = 2;
    while (existingIds.has(nextId)) {
        nextId = `${baseId}_${suffix}`;
        suffix += 1;
    }

    const extension = language === 'javascript' ? 'js' : 'ts';
    const document = buildScriptDocument(`${nextId}.${extension}`, buildDefaultPostprocessSource(nextId, language));
    return document;
}

function buildDefaultPostprocessSource(scriptId: string, language: PostprocessScriptLanguage): string {
    const label = toScriptLabel(scriptId);
    if (language === 'javascript') {
        return `// ${label}
// Mutate context.points in place or return a new array.
// point.metrics.shapeLayerProgress gives smooth 0..1 progress across the full print.
// Scene field samples (manifest \`fields\`) are available at point.sceneFields.<key>.
// Per-segment control: point.speedMmPerSec, point.extrusionScale,
// point.dwellAfterMs (G4 pause), point.travel (G0, no extrusion),
// point.extrusionPerMmOverride (flow decoupled from layer height).
// context.surface.at(u, yMm) returns the model wall position + outward
// normal at any height, so vertically displaced points can stay on the surface.

export const controls = {
    strength: { default: 1.0, min: 0.0, max: 2.0, step: 0.05 },
};

export function transform(context) {
    const strength = context.params.strength ?? 1.0;
    return {
        points: context.points.map((point) => ({
            ...point,
            extrusionScale: (point.extrusionScale ?? 1) * strength,
        })),
        notes: [\`Applied strength=\${strength.toFixed(2)}\`],
    };
}
`;
    }

    return `// ${label}
// Mutate context.points in place or return a new array.
// point.metrics.shapeLayerProgress gives smooth 0..1 progress across the full print.
// Scene field samples (manifest \`fields\`) are available at point.sceneFields.<key>.
// Per-segment control: point.speedMmPerSec, point.extrusionScale,
// point.dwellAfterMs (G4 pause), point.travel (G0, no extrusion),
// point.extrusionPerMmOverride (flow decoupled from layer height).
// context.surface.at(u, yMm) returns the model wall position + outward
// normal at any height, so vertically displaced points can stay on the surface.
import type { ToolpathPostprocessContext } from 'implicit/scene';

export const controls = {
    strength: { default: 1.0, min: 0.0, max: 2.0, step: 0.05 },
};

export function transform(context: ToolpathPostprocessContext) {
    const strength = context.params.strength ?? 1.0;
    return {
        points: context.points.map((point) => ({
            ...point,
            extrusionScale: (point.extrusionScale ?? 1) * strength,
        })),
        notes: [\`Applied strength=\${strength.toFixed(2)}\`],
    };
}
`;
}

function toScriptId(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'postprocess';
}

function toScriptLabel(value: string): string {
    return value
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ') || 'Postprocess';
}
