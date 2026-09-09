/**
 * Turns a sliced plate into a Bambu `.gcode.3mf` and hands it to Bambu
 * Connect. Keeps App.svelte free of package assembly and path plumbing.
 */

import { buildBambuGcodePackage, type BambuFilamentDescriptor } from '../core/bambu/package';
import type { FilamentProfile } from '../core/filament-profiles';
import type { PrinterModel } from '../core/printer-models';
import type { VaseSlicerSettings } from '../core/slicer';
import {
    buildBambuConnectImportUrl,
    describeHandoffPathProblem,
    joinHandoffPath,
    openBambuConnect,
    toBambuPackageFilename,
    writeHandoffPackage,
    type BambuHandoffFolder,
} from '../ui/bambu-handoff';

/** Bambu's slice_info colour field; the AMS overrides it with the real spool. */
const DEFAULT_FILAMENT_COLOR = '#FFFFFFFF';

export interface BambuSendRequest {
    filename: string;
    gcode: string;
    settings: VaseSlicerSettings;
    printerModel: PrinterModel | undefined;
    filamentProfile: FilamentProfile | undefined;
    folder: BambuHandoffFolder;
    handoffFolderPath: string;
}

export interface BambuSendResult {
    packageFilename: string;
    absolutePath: string;
    /** Human-readable summary of what the plate will consume. */
    summary: string;
}

/**
 * Writes the package, then opens Bambu Connect on it. The write is awaited to
 * completion first so Connect never reads a half-written plate.
 */
export async function sendPlateToBambuConnect(request: BambuSendRequest): Promise<BambuSendResult> {
    const pathProblem = describeHandoffPathProblem(request.handoffFolderPath, request.folder.name);
    if (pathProblem) {
        throw new Error(pathProblem);
    }

    const bambuPrinterModelId = request.printerModel?.bambuModelId?.trim() ?? '';
    if (!bambuPrinterModelId) {
        throw new Error(
            `Printer preset "${request.settings.printerModelName}" has no bambuModelId; Bambu Connect needs one (the P1S is C12).`,
        );
    }

    const filament = describeFilament(request.filamentProfile, request.settings.filamentProfileName);
    const packageFilename = toBambuPackageFilename(request.filename);
    const displayName = packageFilename.replace(/\.gcode\.3mf$/i, '');

    const bambuPackage = await buildBambuGcodePackage({
        gcode: request.gcode,
        name: displayName,
        settings: request.settings,
        bambuPrinterModelId,
        bambuPrinterModelName: request.printerModel?.name ?? request.settings.printerModelName,
        bambuPrinterPresetName: buildPrinterPresetName(
            request.printerModel?.name ?? request.settings.printerModelName,
            request.settings.nozzleDiameter,
        ),
        filament,
    });

    await writeHandoffPackage(request.folder, packageFilename, bambuPackage.bytes);

    const absolutePath = joinHandoffPath(request.handoffFolderPath, packageFilename);
    openBambuConnect(buildBambuConnectImportUrl(absolutePath, displayName));

    return {
        packageFilename,
        absolutePath,
        summary: `${formatDuration(bambuPackage.stats.durationSeconds)}, ${bambuPackage.filamentGrams.toFixed(1)} g, ${bambuPackage.stats.layerCount} layers`,
    };
}

/**
 * `Bambu Lab P1S 0.4 nozzle`. Connect matches `Bambu Lab (.*) 0.` against this
 * to work out which printers can run the plate, so the shape matters more than
 * the exact preset existing in Bambu Studio.
 */
function buildPrinterPresetName(modelName: string, nozzleDiameter: number): string {
    const nozzle = Number.parseFloat(nozzleDiameter.toFixed(2));
    return `${modelName} ${nozzle} nozzle`;
}

function describeFilament(
    profile: FilamentProfile | undefined,
    profileName: string,
): BambuFilamentDescriptor {
    const type = profile?.bambuType?.trim() ?? '';
    const trayInfoIndex = profile?.bambuTrayInfoIndex?.trim() ?? '';

    if (!profile || !type || !trayInfoIndex) {
        throw new Error(
            `Filament profile "${profileName}" is missing bambuType/bambuTrayInfoIndex; Bambu Connect needs both (generic PLA is PLA / GFL99).`,
        );
    }

    return {
        type,
        trayInfoIndex,
        densityGramsPerCm3: profile.densityGramsPerCm3,
        colorHex: DEFAULT_FILAMENT_COLOR,
    };
}

function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
