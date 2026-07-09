import type { InspectorFieldSchema, InspectorSectionSchema } from './types';
import type { PipelineStepView } from '../../studio/types';
import type { SceneControlDefinition } from '../../core/shader-pipeline';
import type { ScalarControlSpec } from '../../scene-runtime';

const STEP_TOGGLE_OPTIONS = [
    { value: 'true', label: 'Enabled' },
    { value: 'false', label: 'Disabled' },
];

export function buildSceneControlSections(
    uniformControls: SceneControlDefinition[],
    paramControls: ScalarControlSpec[],
): InspectorSectionSchema[] {
    interface SectionEntry {
        title: string;
        fields: InspectorFieldSchema[];
        descriptions: string[];
    }

    const bySection = new Map<string, SectionEntry>();
    const pushField = (section: string, description: string | undefined, field: InspectorFieldSchema) => {
        const entry = bySection.get(section) ?? { title: section, fields: [], descriptions: [] };
        entry.fields.push(field);
        if (description) {
            entry.descriptions.push(description);
        }
        bySection.set(section, entry);
    };

    for (const control of uniformControls) {
        if (control.hasControl === false) {
            continue;
        }

        pushField(control.section, control.description, buildScalarField('uniform', control.key, {
            label: control.label,
            min: control.min,
            max: control.max,
            step: control.step,
            options: control.options,
        }));
    }

    for (const control of paramControls) {
        if (!control.hasControl) {
            continue;
        }

        pushField(control.section, control.description, buildScalarField('sceneParam', control.key, control));
    }

    return Array.from(bySection.values()).map((entry) => ({
        id: `scene-${slugifySection(entry.title)}`,
        title: entry.title,
        caption: entry.descriptions.length > 0
            ? entry.descriptions.join(' ')
            : 'Controls declared by the active scene manifest.',
        fields: entry.fields,
    }));
}

export function buildPipelineSections(pipeline: PipelineStepView[]): InspectorSectionSchema[] {
    return pipeline.map((step) => {
        const fields: InspectorFieldSchema[] = [
            {
                kind: 'select',
                target: 'stepEnabled',
                stepIndex: step.index,
                id: `pipeline-step-${step.index}-enabled`,
                label: 'Step state',
                options: STEP_TOGGLE_OPTIONS,
            },
        ];

        for (const control of step.controls) {
            if (!control.hasControl) {
                continue;
            }

            fields.push(buildStepControlField(step.index, control));
        }

        const subtitle = step.scriptId ? `Runs '${step.scriptId}'.` : 'Inline transform defined in scene.ts.';
        return {
            id: `pipeline-step-${step.index}`,
            title: `Step ${step.index + 1}: ${step.name}`,
            caption: step.error ? `Error: ${step.error}` : subtitle,
            fields,
        };
    });
}

function buildScalarField(
    target: 'uniform' | 'sceneParam',
    key: string,
    control: { label: string; min: number; max: number; step: number; options?: Array<{ value: number; label: string }> },
): InspectorFieldSchema {
    if (control.options && control.options.length > 0) {
        return {
            kind: 'select',
            target,
            key,
            id: `scene-${target}-${key}`,
            label: control.label,
            options: control.options.map((option) => ({
                value: String(option.value),
                label: option.label,
            })),
        };
    }

    return {
        kind: 'number',
        target,
        key,
        id: `scene-${target}-${key}`,
        label: control.label,
        step: String(control.step),
        min: String(control.min),
        max: String(control.max),
    };
}

function buildStepControlField(stepIndex: number, control: ScalarControlSpec): InspectorFieldSchema {
    if (control.options && control.options.length > 0) {
        return {
            kind: 'select',
            target: 'stepControl',
            stepIndex,
            key: control.key,
            id: `pipeline-step-${stepIndex}-${control.key}`,
            label: control.label,
            options: control.options.map((option) => ({
                value: String(option.value),
                label: option.label,
            })),
        };
    }

    return {
        kind: 'number',
        target: 'stepControl',
        stepIndex,
        key: control.key,
        id: `pipeline-step-${stepIndex}-${control.key}`,
        label: control.label,
        step: String(control.step),
        min: String(control.min),
        max: String(control.max),
    };
}

function slugifySection(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'scene-controls';
}
