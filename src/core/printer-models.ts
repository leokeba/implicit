import type { VaseSlicerSettings } from './slicer';

export interface PrinterModel {
    id: string;
    name: string;
    plateWidthMm: number;
    plateDepthMm: number;
    maxHeightMm: number;
    defaultPrintSpeedMmPerSec?: number;
    defaultTravelSpeedMmPerSec?: number;
    startGcode: string[];
    endGcode: string[];
}

interface PrinterModelFile {
    id?: unknown;
    name?: unknown;
    plateWidthMm?: unknown;
    plateDepthMm?: unknown;
    maxHeightMm?: unknown;
    defaultPrintSpeedMmPerSec?: unknown;
    defaultTravelSpeedMmPerSec?: unknown;
    startGcode?: unknown;
    endGcode?: unknown;
}

const printerModelModules = import.meta.globEager('../printers/models/*.json') as Record<string, unknown>;

export function loadPrinterModels(): PrinterModel[] {
    const models: PrinterModel[] = [];

    for (const [path, moduleValue] of Object.entries(printerModelModules)) {
        const parsed = safeParsePrinterModel(path, moduleValue);
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
    const nextSettings: VaseSlicerSettings = {
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

    if (typeof model.defaultPrintSpeedMmPerSec === 'number') {
        nextSettings.printSpeedMmPerSec = model.defaultPrintSpeedMmPerSec;
    }
    if (typeof model.defaultTravelSpeedMmPerSec === 'number') {
        nextSettings.travelSpeedMmPerSec = model.defaultTravelSpeedMmPerSec;
    }

    return nextSettings;
}

function safeParsePrinterModel(path: string, moduleValue: unknown): PrinterModel | null {
    const value = extractModuleData(moduleValue);

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
    const defaultPrintSpeedMmPerSec = toOptionalPositiveNumber(model.defaultPrintSpeedMmPerSec);
    const defaultTravelSpeedMmPerSec = toOptionalPositiveNumber(model.defaultTravelSpeedMmPerSec);
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
        defaultPrintSpeedMmPerSec,
        defaultTravelSpeedMmPerSec,
        startGcode,
        endGcode,
    };
}

function extractModuleData(moduleValue: unknown): unknown {
    if (!moduleValue || typeof moduleValue !== 'object') {
        return moduleValue;
    }

    const withDefault = moduleValue as { default?: unknown };
    return withDefault.default ?? moduleValue;
}

function toFiniteNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toOptionalPositiveNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }
    return value;
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
