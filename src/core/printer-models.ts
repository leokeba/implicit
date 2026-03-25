import type { VaseSlicerSettings } from './slicer';

export interface PrinterModel {
    id: string;
    name: string;
    plateWidthMm: number;
    plateDepthMm: number;
    maxHeightMm: number;
    startGcode: string[];
    endGcode: string[];
}

interface PrinterModelFile {
    id?: unknown;
    name?: unknown;
    plateWidthMm?: unknown;
    plateDepthMm?: unknown;
    maxHeightMm?: unknown;
    startGcode?: unknown;
    endGcode?: unknown;
}

const printerModelRawModules = import.meta.glob('../printers/models/*.json', {
    eager: true,
    as: 'raw',
}) as Record<string, string>;

export function loadPrinterModels(): PrinterModel[] {
    const models: PrinterModel[] = [];

    for (const [path, raw] of Object.entries(printerModelRawModules)) {
        const parsed = safeParsePrinterModel(path, raw);
        if (!parsed) {
            continue;
        }
        models.push(parsed);
    }

    models.sort((a, b) => a.name.localeCompare(b.name));
    return models;
}

export function applyPrinterModel(
    settings: VaseSlicerSettings,
    model: PrinterModel
): VaseSlicerSettings {
    return {
        ...settings,
        printerModelId: model.id,
        printerModelName: model.name,
        bedWidthMm: model.plateWidthMm,
        bedDepthMm: model.plateDepthMm,
        maxPrintHeightMm: model.maxHeightMm,
        centerX: model.plateWidthMm * 0.5,
        centerZ: model.plateDepthMm * 0.5,
        startGcode: model.startGcode.join('\n'),
        endGcode: model.endGcode.join('\n'),
    };
}

function safeParsePrinterModel(path: string, raw: string): PrinterModel | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch (error) {
        console.warn(`Skipping invalid printer model JSON: ${path}`, error);
        return null;
    }

    if (!value || typeof value !== 'object') {
        console.warn(`Skipping malformed printer model object: ${path}`);
        return null;
    }

    const model = value as PrinterModelFile;

    const id = typeof model.id === 'string' ? model.id.trim() : '';
    const name = typeof model.name === 'string' ? model.name.trim() : '';
    const plateWidthMm = toFiniteNumber(model.plateWidthMm);
    const plateDepthMm = toFiniteNumber(model.plateDepthMm);
    const maxHeightMm = toFiniteNumber(model.maxHeightMm);
    const startGcode = toGcodeLines(model.startGcode);
    const endGcode = toGcodeLines(model.endGcode);

    if (!id || !name || plateWidthMm <= 0 || plateDepthMm <= 0 || maxHeightMm <= 0) {
        console.warn(`Skipping incomplete printer model: ${path}`);
        return null;
    }

    return {
        id,
        name,
        plateWidthMm,
        plateDepthMm,
        maxHeightMm,
        startGcode,
        endGcode,
    };
}

function toFiniteNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toGcodeLines(value: unknown): string[] {
    if (typeof value === 'string') {
        return value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    }

    if (Array.isArray(value)) {
        return value
            .filter((line): line is string => typeof line === 'string')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    }

    return [];
}
