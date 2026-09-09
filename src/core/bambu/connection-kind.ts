/**
 * Which backend a configured printer is driven through.
 *
 * `moonraker` uploads G-code over HTTP and can start the print itself.
 * `bambu-connect` writes a `.gcode.3mf` to a folder and hands the path to the
 * Bambu Connect desktop app over its `bambu-connect://import-file` URL scheme
 * — the only route Bambu sanctions for third-party software while the printer
 * stays in cloud mode.
 */
export type PrinterConnectionKind = 'moonraker' | 'bambu-connect';

export const PRINTER_CONNECTION_KINDS: readonly PrinterConnectionKind[] = ['moonraker', 'bambu-connect'];

export function isPrinterConnectionKind(value: unknown): value is PrinterConnectionKind {
    return value === 'moonraker' || value === 'bambu-connect';
}
