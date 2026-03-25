import type { VaseSlicerSettings } from './slicer';

export interface FilamentProfile {
    id: string;
    name: string;
    filamentDiameter: number;
    nozzleTempC: number;
    bedTempC: number;
    fanPercent: number;
    flowRate: number;
    printSpeedMmPerSec: number;
    travelSpeedMmPerSec: number;
}

interface FilamentProfileFile {
    id?: unknown;
    name?: unknown;
    filamentDiameter?: unknown;
    nozzleTempC?: unknown;
    bedTempC?: unknown;
    fanPercent?: unknown;
    flowRate?: unknown;
    printSpeedMmPerSec?: unknown;
    travelSpeedMmPerSec?: unknown;
}

const filamentProfileRawModules = import.meta.glob('../filaments/profiles/*.json', {
    eager: true,
    as: 'raw',
}) as Record<string, string>;

export function loadFilamentProfiles(): FilamentProfile[] {
    const profiles: FilamentProfile[] = [];

    for (const [path, raw] of Object.entries(filamentProfileRawModules)) {
        const parsed = safeParseFilamentProfile(path, raw);
        if (!parsed) {
            continue;
        }
        profiles.push(parsed);
    }

    profiles.sort((a, b) => a.name.localeCompare(b.name));
    return profiles;
}

export function applyFilamentProfile(
    settings: VaseSlicerSettings,
    profile: FilamentProfile
): VaseSlicerSettings {
    return {
        ...settings,
        filamentProfileId: profile.id,
        filamentProfileName: profile.name,
        filamentDiameter: profile.filamentDiameter,
        nozzleTempC: profile.nozzleTempC,
        bedTempC: profile.bedTempC,
        fanPercent: profile.fanPercent,
        flowRate: profile.flowRate,
        printSpeedMmPerSec: profile.printSpeedMmPerSec,
        travelSpeedMmPerSec: profile.travelSpeedMmPerSec,
    };
}

function safeParseFilamentProfile(path: string, raw: string): FilamentProfile | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch (error) {
        console.warn(`Skipping invalid filament profile JSON: ${path}`, error);
        return null;
    }

    if (!value || typeof value !== 'object') {
        console.warn(`Skipping malformed filament profile object: ${path}`);
        return null;
    }

    const profile = value as FilamentProfileFile;

    const id = typeof profile.id === 'string' ? profile.id.trim() : '';
    const name = typeof profile.name === 'string' ? profile.name.trim() : '';
    const filamentDiameter = toFiniteNumber(profile.filamentDiameter);
    const nozzleTempC = toFiniteNumber(profile.nozzleTempC);
    const bedTempC = toFiniteNumber(profile.bedTempC);
    const fanPercent = toFiniteNumber(profile.fanPercent);
    const flowRate = toFiniteNumber(profile.flowRate);
    const printSpeedMmPerSec = toFiniteNumber(profile.printSpeedMmPerSec);
    const travelSpeedMmPerSec = toFiniteNumber(profile.travelSpeedMmPerSec);

    if (!id || !name || filamentDiameter <= 0 || nozzleTempC <= 0 || flowRate <= 0) {
        console.warn(`Skipping incomplete filament profile: ${path}`);
        return null;
    }

    return {
        id,
        name,
        filamentDiameter,
        nozzleTempC,
        bedTempC,
        fanPercent,
        flowRate,
        printSpeedMmPerSec,
        travelSpeedMmPerSec,
    };
}

function toFiniteNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
