import type { PrinterModel } from '../core/printer-models';
import { checkMoonrakerAvailability } from '../studio/file-export';

const PRINTER_TARGET_STORAGE_KEY = 'implicit.printerTarget.v1';

/** Moonraker connection settings, persisted in localStorage across sessions. */
export interface PrinterTarget {
    baseUrl: string;
    apiKey: string;
    autoStartPrint: boolean;
    uploadPath: string;
}

function emptyPrinterTarget(): PrinterTarget {
    return { baseUrl: '', apiKey: '', uploadPath: '', autoStartPrint: true };
}

export function readPrinterTarget(): PrinterTarget {
    if (typeof window === 'undefined') {
        return emptyPrinterTarget();
    }

    try {
        const raw = window.localStorage.getItem(PRINTER_TARGET_STORAGE_KEY);
        if (!raw) {
            return emptyPrinterTarget();
        }

        const parsed = JSON.parse(raw) as Partial<PrinterTarget>;
        if (!parsed || typeof parsed !== 'object') {
            return emptyPrinterTarget();
        }

        return {
            baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '',
            apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
            autoStartPrint: typeof parsed.autoStartPrint === 'boolean' ? parsed.autoStartPrint : true,
            uploadPath: typeof parsed.uploadPath === 'string' ? parsed.uploadPath.trim() : '',
        };
    } catch {
        return emptyPrinterTarget();
    }
}

export function persistPrinterTarget(target: PrinterTarget): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(PRINTER_TARGET_STORAGE_KEY, JSON.stringify(target));
    } catch {
        // Ignore storage write failures.
    }
}

/** False when no base URL is configured or the Moonraker probe fails. */
export async function checkPrinterAvailability(target: PrinterTarget): Promise<boolean> {
    const configuredBaseUrl = target.baseUrl.trim();
    if (!configuredBaseUrl) {
        return false;
    }

    return checkMoonrakerAvailability(configuredBaseUrl, target.apiKey);
}

/**
 * Connection defaults from a printer model preset, merged over the current
 * target. Returns null when the model declares no connection defaults.
 */
export function applyPrinterModelConnectionDefaults(
    model: PrinterModel | undefined,
    current: PrinterTarget,
): PrinterTarget | null {
    if (!model) {
        return null;
    }

    const hasConnectionDefaults =
        typeof model.defaultMoonrakerUrl === 'string' ||
        typeof model.defaultMoonrakerApiKey === 'string' ||
        typeof model.defaultMoonrakerUploadPath === 'string' ||
        typeof model.defaultMoonrakerAutoStartPrint === 'boolean';

    if (!hasConnectionDefaults) {
        return null;
    }

    return {
        baseUrl: model.defaultMoonrakerUrl ?? current.baseUrl,
        apiKey: model.defaultMoonrakerApiKey ?? current.apiKey,
        uploadPath: model.defaultMoonrakerUploadPath ?? current.uploadPath,
        autoStartPrint: typeof model.defaultMoonrakerAutoStartPrint === 'boolean'
            ? model.defaultMoonrakerAutoStartPrint
            : current.autoStartPrint,
    };
}
