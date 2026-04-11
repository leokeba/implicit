import type { VaseSlicerSettings } from '../slicer';

export function getDefaultStartGcode(): string[] {
    return [
        'G90',
        'M82',
        'G21',
        'M104 S{nozzleTempC}',
        'M140 S{bedTempC}',
        'M190 S{bedTempC}',
        'M109 S{nozzleTempC}',
        'G28',
        'G92 E0',
        'M106 S{fanPwm}',
    ];
}

export function getDefaultEndGcode(): string[] {
    return [
        'M104 S0',
        'M140 S0',
        'M107',
        'M84',
    ];
}

export function parseGcodeLines(template: string, fallback: string[]): string[] {
    const lines = template
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    return lines.length > 0 ? lines : fallback;
}

export function expandGcodeTemplate(line: string, settings: VaseSlicerSettings): string {
    const tokenValues: Record<string, string> = {
        nozzleTempC: settings.nozzleTempC.toFixed(0),
        bedTempC: settings.bedTempC.toFixed(0),
        fanPwm: String(Math.round((settings.fanPercent / 100) * 255)),
        fanPercent: settings.fanPercent.toFixed(0),
        printFeedrate: mmPerSecToFeedrate(settings.printSpeedMmPerSec).toFixed(0),
        travelFeedrate: mmPerSecToFeedrate(settings.travelSpeedMmPerSec).toFixed(0),
        bedCenterX: settings.centerX.toFixed(3),
        bedCenterY: settings.centerZ.toFixed(3),
        bedWidthMm: settings.bedWidthMm.toFixed(1),
        bedDepthMm: settings.bedDepthMm.toFixed(1),
        maxPrintHeightMm: settings.maxPrintHeightMm.toFixed(1),
    };

    return line.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
        return tokenValues[token] ?? match;
    });
}

function mmPerSecToFeedrate(mmPerSec: number): number {
    return mmPerSec * 60.0;
}
