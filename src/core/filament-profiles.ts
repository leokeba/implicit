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
    /** Solid density, used to report filament mass in exported packages. */
    densityGramsPerCm3: number;
    /** Bambu material name (e.g. `PLA`), shown on the printer's job screen. */
    bambuType: string;
    /** Bambu filament code (e.g. `GFL99` for generic PLA). */
    bambuTrayInfoIndex: string;
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
    densityGramsPerCm3?: unknown;
    bambuType?: unknown;
    bambuTrayInfoIndex?: unknown;
}

const filamentProfileModules = import.meta.glob('../filaments/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, unknown>;

/** Presets shipped with the app; always available, overlaid by workspace presets. */
export const bundledFilamentProfiles: FilamentProfile[] = sortFilamentProfiles(
    Object.entries(filamentProfileModules)
        .map(([path, moduleValue]) => safeParseFilamentProfile(path, moduleValue))
        .filter((profile): profile is FilamentProfile => profile !== null)
);

/** Parses one workspace preset file; null (with a console warning) on bad input. */
export function parseFilamentProfileJson(label: string, source: string): FilamentProfile | null {
    let value: unknown;
    try {
        value = JSON.parse(source);
    } catch {
        console.warn(`Skipping unparsable filament profile: ${label}`);
        return null;
    }
    return safeParseFilamentProfile(label, value);
}

/** Bundled presets overlaid by workspace presets; on the same id the workspace wins. */
export function mergeWithBundledFilamentProfiles(workspace: FilamentProfile[]): FilamentProfile[] {
    const byId = new Map(bundledFilamentProfiles.map((profile) => [profile.id, profile]));
    for (const profile of workspace) {
        byId.set(profile.id, profile);
    }
    return sortFilamentProfiles(Array.from(byId.values()));
}

function sortFilamentProfiles(profiles: FilamentProfile[]): FilamentProfile[] {
    return profiles.slice().sort((a, b) => a.name.localeCompare(b.name));
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

function safeParseFilamentProfile(path: string, moduleValue: unknown): FilamentProfile | null {
    const value = extractModuleData(moduleValue);

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
    const densityGramsPerCm3 = toFiniteNumber(profile.densityGramsPerCm3);
    const bambuType = toTrimmedString(profile.bambuType);
    const bambuTrayInfoIndex = toTrimmedString(profile.bambuTrayInfoIndex);

    if (!id || !name || filamentDiameter <= 0 || nozzleTempC <= 0 || flowRate <= 0 || densityGramsPerCm3 <= 0) {
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
        densityGramsPerCm3,
        bambuType,
        bambuTrayInfoIndex,
    };
}

function toTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function extractModuleData(moduleValue: unknown): unknown {
    if (!moduleValue || typeof moduleValue !== 'object') {
        return moduleValue;
    }

    const withDefault = moduleValue as { default?: unknown };
    return withDefault.default ?? moduleValue;
}
