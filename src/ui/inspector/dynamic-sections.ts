import type { SceneControlDefinition } from '../../core/shader-pipeline';
import type { PostprocessControlDefinition } from '../../core/toolpath-postprocess';
import type { InspectorSectionSchema } from './types';

export function buildSceneControlSections(definitions: SceneControlDefinition[]): InspectorSectionSchema[] {
    const bySection = new Map<string, SceneControlDefinition[]>();

    for (const definition of definitions) {
        const sectionKey = definition.section || 'Scene Parameters';
        const existing = bySection.get(sectionKey) ?? [];
        existing.push(definition);
        bySection.set(sectionKey, existing);
    }

    return Array.from(bySection.entries()).map(([sectionTitle, sectionDefinitions]) => ({
        id: `scene-${slugifySection(sectionTitle)}`,
        title: sectionTitle,
        caption: sectionDefinitions.some((definition) => definition.description)
            ? sectionDefinitions.map((definition) => definition.description).filter(Boolean).join(' ')
            : 'Controls declared by the active scene shader.',
        fields: sectionDefinitions.map((definition) => ({
            kind: 'number' as const,
            target: 'sceneControl' as const,
            key: definition.key,
            id: `scene-control-${definition.key}`,
            label: definition.label,
            step: String(definition.step),
            min: String(definition.min),
            max: String(definition.max),
        })),
    }));
}

export function buildPostprocessControlSections(definitions: PostprocessControlDefinition[]): InspectorSectionSchema[] {
    const bySection = new Map<string, PostprocessControlDefinition[]>();

    for (const definition of definitions) {
        const sectionKey = definition.section || 'Script Parameters';
        const existing = bySection.get(sectionKey) ?? [];
        existing.push(definition);
        bySection.set(sectionKey, existing);
    }

    return Array.from(bySection.entries()).map(([sectionTitle, sectionDefinitions]) => ({
        id: `postprocess-${slugifySection(sectionTitle)}`,
        title: sectionTitle,
        caption: sectionDefinitions.some((definition) => definition.description)
            ? sectionDefinitions.map((definition) => definition.description).filter(Boolean).join(' ')
            : 'Controls declared by the active postprocess script.',
        fields: sectionDefinitions.map((definition) => ({
            kind: 'number' as const,
            target: 'postprocessControl' as const,
            key: definition.key,
            id: `postprocess-control-${definition.key}`,
            label: definition.label,
            step: String(definition.step),
            min: String(definition.min),
            max: String(definition.max),
        })),
    }));
}

function slugifySection(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'scene-controls';
}
