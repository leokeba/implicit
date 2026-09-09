import { isPrinterConnectionKind, type PrinterConnectionKind } from '../core/bambu/connection-kind';
import type { PrinterModel } from '../core/printer-models';
import { checkMoonrakerAvailability } from '../ui/file-export';

const PRINTER_TARGET_STORAGE_KEY = 'implicit.printerTarget.v1';

/** Printer connection settings, persisted in localStorage across sessions. */
export interface PrinterTarget {
    kind: PrinterConnectionKind;
    /** Moonraker: base URL of the HTTP API. */
    baseUrl: string;
    apiKey: string;
    autoStartPrint: boolean;
    uploadPath: string;
    /**
     * Bambu Connect: absolute path of the handoff folder. The browser cannot
     * read the path behind a directory handle, so it is configured by hand and
     * cross-checked against the handle's folder name.
     */
    handoffFolderPath: string;
}

function emptyPrinterTarget(): PrinterTarget {
    return {
        kind: 'moonraker',
        baseUrl: '',
        apiKey: '',
        uploadPath: '',
        autoStartPrint: true,
        handoffFolderPath: '',
    };
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
            kind: isPrinterConnectionKind(parsed.kind) ? parsed.kind : 'moonraker',
            baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '',
            apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
            autoStartPrint: typeof parsed.autoStartPrint === 'boolean' ? parsed.autoStartPrint : true,
            uploadPath: typeof parsed.uploadPath === 'string' ? parsed.uploadPath.trim() : '',
            handoffFolderPath: typeof parsed.handoffFolderPath === 'string' ? parsed.handoffFolderPath.trim() : '',
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

/** Whether the target carries the settings its backend needs to run at all. */
export function isPrinterConfigured(target: PrinterTarget): boolean {
    return target.kind === 'moonraker'
        ? target.baseUrl.trim().length > 0
        : target.handoffFolderPath.trim().length > 0;
}

/**
 * False when no base URL is configured or the Moonraker probe fails. Bambu
 * Connect has nothing to probe — its readiness is the handoff folder's
 * permission state, which the caller owns.
 */
export async function checkPrinterAvailability(target: PrinterTarget): Promise<boolean> {
    if (target.kind !== 'moonraker') {
        return false;
    }

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
        typeof model.defaultConnectionKind === 'string' ||
        typeof model.defaultMoonrakerUrl === 'string' ||
        typeof model.defaultMoonrakerApiKey === 'string' ||
        typeof model.defaultMoonrakerUploadPath === 'string' ||
        typeof model.defaultMoonrakerAutoStartPrint === 'boolean';

    if (!hasConnectionDefaults) {
        return null;
    }

    return {
        kind: model.defaultConnectionKind ?? current.kind,
        baseUrl: model.defaultMoonrakerUrl ?? current.baseUrl,
        apiKey: model.defaultMoonrakerApiKey ?? current.apiKey,
        uploadPath: model.defaultMoonrakerUploadPath ?? current.uploadPath,
        autoStartPrint: typeof model.defaultMoonrakerAutoStartPrint === 'boolean'
            ? model.defaultMoonrakerAutoStartPrint
            : current.autoStartPrint,
        handoffFolderPath: current.handoffFolderPath,
    };
}
