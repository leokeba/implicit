import type {
    SceneControlDefinition,
    SceneFieldDefinition,
    SceneFieldType,
    SceneParamMap,
    SceneParamValue,
} from './types';

export function parseSceneDefaultParams(sceneSource: string): SceneParamMap {
    const params: SceneParamMap = {};
    const definePattern = /^\s*#define\s+SCENE_DEFAULT_([A-Z0-9_]+)\s+(.+?)\s*$/gm;

    let match: RegExpExecArray | null = definePattern.exec(sceneSource);
    while (match) {
        const macroSuffix = match[1] ?? '';
        const rawExpression = match[2] ?? '';
        const key = sceneParamKeyFromMacroSuffix(macroSuffix);
        const value = parseSceneParamLiteral(rawExpression);

        if (key.length > 0 && value !== undefined) {
            params[key] = value;
        }

        match = definePattern.exec(sceneSource);
    }

    return params;
}

export function readSceneNumberParam(params: SceneParamMap, keys: string[], positiveOnly = false): number | undefined {
    for (const key of keys) {
        const value = params[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            continue;
        }

        if (positiveOnly && value <= 0) {
            continue;
        }

        return value;
    }

    return undefined;
}

interface SceneControlConfigFile {
    key?: unknown;
    label?: unknown;
    uniform?: unknown;
    min?: unknown;
    max?: unknown;
    step?: unknown;
    default?: unknown;
    section?: unknown;
    description?: unknown;
}

interface SceneFieldConfigFile {
    key?: unknown;
    label?: unknown;
    fn?: unknown;
    type?: unknown;
    min?: unknown;
    max?: unknown;
    description?: unknown;
}

export function parseSceneControlDefinitions(sceneSource: string): SceneControlDefinition[] {
    const pattern = /^\s*\/\/\s*@control\s+(\{.+\})\s*$/gm;
    const controls: SceneControlDefinition[] = [];
    const seenKeys = new Set<string>();

    let match: RegExpExecArray | null = pattern.exec(sceneSource);
    while (match) {
        const parsed = safeParseSceneControlConfig(match[1] ?? '');
        if (!parsed || seenKeys.has(parsed.key)) {
            match = pattern.exec(sceneSource);
            continue;
        }

        seenKeys.add(parsed.key);
        controls.push(parsed);
        match = pattern.exec(sceneSource);
    }

    return controls;
}

export function parseSceneFieldDefinitions(sceneSource: string): SceneFieldDefinition[] {
    const pattern = /^\s*\/\/\s*@field\s+(\{.+\})\s*$/gm;
    const fields: SceneFieldDefinition[] = [];
    const seenKeys = new Set<string>();

    let match: RegExpExecArray | null = pattern.exec(sceneSource);
    while (match) {
        const parsed = safeParseSceneFieldConfig(match[1] ?? '');
        if (!parsed || seenKeys.has(parsed.key)) {
            match = pattern.exec(sceneSource);
            continue;
        }

        seenKeys.add(parsed.key);
        fields.push(parsed);
        match = pattern.exec(sceneSource);
    }

    return fields;
}

function sceneParamKeyFromMacroSuffix(macroSuffix: string): string {
    return macroSuffix
        .trim()
        .toLowerCase()
        .replace(/_+([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function parseSceneParamLiteral(rawExpression: string): SceneParamValue | undefined {
    const inlineCommentOffset = rawExpression.indexOf('//');
    const expression = (inlineCommentOffset >= 0 ? rawExpression.slice(0, inlineCommentOffset) : rawExpression).trim();
    if (!expression) {
        return undefined;
    }

    if ((expression.startsWith('"') && expression.endsWith('"')) || (expression.startsWith("'") && expression.endsWith("'"))) {
        return expression.slice(1, -1);
    }

    const normalized = expression.toLowerCase();
    if (normalized === 'true') {
        return true;
    }
    if (normalized === 'false') {
        return false;
    }

    const parsed = Number(expression);
    if (!Number.isFinite(parsed)) {
        return expression;
    }
    return parsed;
}

function safeParseSceneControlConfig(rawPayload: string): SceneControlDefinition | null {
    try {
        const parsed = JSON.parse(rawPayload) as SceneControlConfigFile;
        const key = typeof parsed.key === 'string' ? normalizeSceneControlKey(parsed.key) : '';
        if (!key) {
            return null;
        }

        const min = readFiniteNumber(parsed.min);
        const max = readFiniteNumber(parsed.max);
        const step = readFiniteNumber(parsed.step);
        if (min === null || max === null || step === null || max <= min || step <= 0) {
            return null;
        }

        const fallbackDefault = min + (max - min) * 0.5;
        const defaultValue = clampSceneControlValue(readFiniteNumber(parsed.default) ?? fallbackDefault, min, max);
        const uniform = typeof parsed.uniform === 'string' && parsed.uniform.trim().length > 0
            ? parsed.uniform.trim()
            : `uScene${key.charAt(0).toUpperCase()}${key.slice(1)}`;

        return {
            key,
            label: typeof parsed.label === 'string' && parsed.label.trim().length > 0 ? parsed.label.trim() : toSceneLabel(key),
            uniform,
            min,
            max,
            step,
            defaultValue,
            section: typeof parsed.section === 'string' && parsed.section.trim().length > 0 ? parsed.section.trim() : 'Scene Parameters',
            description: typeof parsed.description === 'string' && parsed.description.trim().length > 0 ? parsed.description.trim() : undefined,
        };
    } catch {
        return null;
    }
}

function safeParseSceneFieldConfig(rawPayload: string): SceneFieldDefinition | null {
    try {
        const parsed = JSON.parse(rawPayload) as SceneFieldConfigFile;
        const key = typeof parsed.key === 'string' ? normalizeSceneControlKey(parsed.key) : '';
        if (!key) {
            return null;
        }

        const fn = typeof parsed.fn === 'string' && parsed.fn.trim().length > 0
            ? parsed.fn.trim()
            : '';
        const type = normalizeSceneFieldType(parsed.type);
        const minValue = readFiniteNumber(parsed.min) ?? -1.0;
        const maxValue = readFiniteNumber(parsed.max) ?? 1.0;
        if (!fn || !type || maxValue <= minValue) {
            return null;
        }

        return {
            key,
            label: typeof parsed.label === 'string' && parsed.label.trim().length > 0 ? parsed.label.trim() : toSceneLabel(key),
            fn,
            type,
            minValue,
            maxValue,
            description: typeof parsed.description === 'string' && parsed.description.trim().length > 0 ? parsed.description.trim() : undefined,
        };
    } catch {
        return null;
    }
}

function normalizeSceneFieldType(value: unknown): SceneFieldType | null {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    switch (normalized) {
        case 'float':
        case 'vec2':
        case 'vec3':
        case 'vec4':
            return normalized as SceneFieldType;
        default:
            return null;
    }
}

function normalizeSceneControlKey(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .replace(/\s+(.)/g, (_, letter: string) => letter.toUpperCase())
        .replace(/\s/g, '')
        .replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampSceneControlValue(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function toSceneLabel(sceneId: string): string {
    const withSpaces = sceneId
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();
    if (!withSpaces) {
        return 'Scene';
    }

    return withSpaces
        .split(/\s+/)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}
