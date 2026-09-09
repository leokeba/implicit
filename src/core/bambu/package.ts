/**
 * Builds a Bambu `.gcode.3mf` around already-emitted vase G-code.
 *
 * Bambu Connect and the printer both refuse bare `.gcode`: they expect a
 * sliced *plate* — the G-code wrapped in an OPC package alongside its md5
 * sidecar and the manifests describing the plate. This module assembles that
 * package; nothing here re-slices or rewrites the toolpath.
 *
 * The part list is dictated by Bambu Connect's importer, which reads
 * `Metadata/slice_info.config`, `Metadata/model_settings.config` and
 * `Metadata/project_settings.config` and *silently gives up* if any one of
 * them is missing. It then locates the plate G-code through the plate's
 * `gcode_file` key and unconditionally reads `thumbnail_file`, so both keys
 * must be present even when the referenced image is not.
 */

import type { VaseSlicerSettings } from '../slicer';
import { filamentMassGrams, measureGcode, type GcodePrintStats } from './gcode-stats';
import { md5Hex } from './md5';
import { renderPlateThumbnail } from './thumbnail';
import { buildZipArchive, type ZipEntry } from './zip';

/** Bambu addresses plates by index; a vase export is always a single plate. */
const PLATE_INDEX = 1;
const GCODE_PART = `Metadata/plate_${PLATE_INDEX}.gcode`;
const THUMBNAIL_PART = `Metadata/plate_${PLATE_INDEX}.png`;
/** Bambu Studio's own bed label for the P-series textured plate. */
const DEFAULT_BED_TYPE = 'Textured PEI Plate';

export interface BambuFilamentDescriptor {
    /** Bambu material name, e.g. `PLA`. Shown on the printer. */
    type: string;
    /** Bambu filament code, e.g. `GFL99` for generic PLA. */
    trayInfoIndex: string;
    densityGramsPerCm3: number;
    colorHex: string;
}

export interface BambuPackageInput {
    /** The complete G-code for the plate, exactly as it will be executed. */
    gcode: string;
    /** Display name for the plate; also the archive's object name. */
    name: string;
    settings: VaseSlicerSettings;
    /** Bambu's internal printer code, e.g. `C12` for the P1S. */
    bambuPrinterModelId: string;
    /** Bambu's printer display name, e.g. `Bambu Lab P1S`. */
    bambuPrinterModelName: string;
    /**
     * Slicer preset name, e.g. `Bambu Lab P1S 0.4 nozzle`. Connect matches
     * `Bambu Lab (.*) 0.` against it to decide which printers can run the
     * plate, so the "<model> <nozzle> nozzle" shape is load-bearing.
     */
    bambuPrinterPresetName: string;
    filament: BambuFilamentDescriptor;
}

export interface BambuPackage {
    bytes: Uint8Array;
    stats: GcodePrintStats;
    filamentGrams: number;
}

export async function buildBambuGcodePackage(input: BambuPackageInput): Promise<BambuPackage> {
    const encoder = new TextEncoder();
    const stats = measureGcode(input.gcode);
    const filamentGrams = filamentMassGrams(
        stats.filamentLengthMm,
        input.settings.filamentDiameter,
        input.filament.densityGramsPerCm3,
    );

    const gcodeBytes = encoder.encode(input.gcode);

    const entries: ZipEntry[] = [
        { path: '[Content_Types].xml', data: encoder.encode(buildContentTypes()) },
        { path: '_rels/.rels', data: encoder.encode(buildRootRelationships()) },
        { path: '3D/3dmodel.model', data: encoder.encode(buildModelPart(input)) },
        { path: GCODE_PART, data: gcodeBytes, compress: true },
        { path: `${GCODE_PART}.md5`, data: encoder.encode(md5Hex(gcodeBytes)) },
        { path: THUMBNAIL_PART, data: await renderPlateThumbnail(input.gcode) },
        {
            path: 'Metadata/slice_info.config',
            data: encoder.encode(buildSliceInfo(input, stats, filamentGrams)),
        },
        { path: 'Metadata/model_settings.config', data: encoder.encode(buildModelSettings(input)) },
        {
            path: 'Metadata/project_settings.config',
            data: encoder.encode(buildProjectSettings(input)),
        },
        {
            path: 'Metadata/_rels/model_settings.config.rels',
            data: encoder.encode(buildModelSettingsRelationships()),
        },
    ];

    return { bytes: await buildZipArchive(entries), stats, filamentGrams };
}

function buildContentTypes(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`;
}

function buildRootRelationships(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/${THUMBNAIL_PART}" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
 <Relationship Target="/${THUMBNAIL_PART}" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>
</Relationships>`;
}

function buildModelSettingsRelationships(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/${GCODE_PART}" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/>
</Relationships>`;
}

/**
 * A stand-in solid sized to the sliced model's bounding box. The plate G-code
 * is what actually prints; this part exists because a 3MF package must carry
 * a model, and a correctly sized box keeps any viewer's framing sensible.
 */
function buildModelPart(input: BambuPackageInput): string {
    const { settings } = input;
    const radiusMm = Math.max(1, settings.maxRadius * settings.modelScale);
    const heightMm = Math.max(1, (settings.maxY - settings.minY) * settings.modelScale);
    const vertices = [
        [-radiusMm, -radiusMm, 0],
        [radiusMm, -radiusMm, 0],
        [radiusMm, radiusMm, 0],
        [-radiusMm, radiusMm, 0],
        [-radiusMm, -radiusMm, heightMm],
        [radiusMm, -radiusMm, heightMm],
        [radiusMm, radiusMm, heightMm],
        [-radiusMm, radiusMm, heightMm],
    ];
    const triangles = [
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ];

    const vertexXml = vertices
        .map(([x, y, z]) => `    <vertex x="${formatNumber(x)}" y="${formatNumber(y)}" z="${formatNumber(z)}"/>`)
        .join('\n');
    const triangleXml = triangles
        .map(([v1, v2, v3]) => `    <triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`)
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Title">${escapeXml(input.name)}</metadata>
 <metadata name="Application">Implicit</metadata>
 <resources>
  <object id="1" type="model" name="${escapeXml(input.name)}">
   <mesh>
    <vertices>
${vertexXml}
    </vertices>
    <triangles>
${triangleXml}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 ${formatNumber(input.settings.centerX)} ${formatNumber(input.settings.centerZ)} 0"/>
 </build>
</model>`;
}

/**
 * The plate manifest. `prediction` (seconds) and `weight` (grams) are what the
 * printer's job list and Bambu Connect display before the print starts.
 * `nozzle_diameters` is read unguarded (`.split(',')`), so it must be present.
 */
function buildSliceInfo(
    input: BambuPackageInput,
    stats: GcodePrintStats,
    filamentGrams: number,
): string {
    const { settings, filament } = input;
    const usedMetres = stats.filamentLengthMm / 1000;

    return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="01.10.00.00"/>
  </header>
  <plate>
    <metadata key="index" value="${PLATE_INDEX}"/>
    <metadata key="printer_model_id" value="${escapeXml(input.bambuPrinterModelId)}"/>
    <metadata key="nozzle_diameters" value="${formatNumber(settings.nozzleDiameter)}"/>
    <metadata key="timelapse_type" value="0"/>
    <metadata key="prediction" value="${Math.round(stats.durationSeconds)}"/>
    <metadata key="weight" value="${filamentGrams.toFixed(2)}"/>
    <metadata key="outside" value="false"/>
    <metadata key="support_used" value="false"/>
    <metadata key="label_object_enabled" value="false"/>
    <object identify_id="1" name="${escapeXml(input.name)}" skipped="false"/>
    <filament id="1" tray_info_idx="${escapeXml(filament.trayInfoIndex)}" type="${escapeXml(filament.type)}" color="${escapeXml(filament.colorHex)}" used_m="${usedMetres.toFixed(2)}" used_g="${filamentGrams.toFixed(2)}" nozzle_diameter="${formatNumber(settings.nozzleDiameter)}" volume_type="Standard" used_for_object="true" used_for_support="false"/>
    <nozzle id="0" extruder_id="1" nozzle_diameter="${formatNumber(settings.nozzleDiameter)}" volume_type="Standard"/>
  </plate>
</config>`;
}

/**
 * Maps the plate to its G-code. Connect walks these plates first and looks up
 * the archive entry named by `gcode_file`, then reads `thumbnail_file`
 * unguarded — omitting it throws before the plate is ever shown.
 */
function buildModelSettings(input: BambuPackageInput): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="${escapeXml(input.name)}"/>
    <metadata key="extruder" value="1"/>
  </object>
  <plate>
    <metadata key="plater_id" value="${PLATE_INDEX}"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="gcode_file" value="${GCODE_PART}"/>
    <metadata key="thumbnail_file" value="${THUMBNAIL_PART}"/>
    <model_instance>
      <metadata key="object_id" value="1"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
  <assemble>
  </assemble>
</config>`;
}

/**
 * Bambu Studio writes its entire print profile here. Connect only reads
 * `filament_ids`, `curr_bed_type` and `print_compatible_printers` — the first
 * and last unguarded — so this carries the identifying subset rather than a
 * fabricated copy of a profile that never produced this G-code.
 */
function buildProjectSettings(input: BambuPackageInput): string {
    const { settings, filament } = input;
    const nozzle = formatNumber(settings.nozzleDiameter);

    return JSON.stringify({
        name: 'project_settings',
        from: 'project',
        version: '01.10.00.00',
        print_compatible_printers: [input.bambuPrinterPresetName],
        printer_model: input.bambuPrinterModelName,
        printer_settings_id: input.bambuPrinterPresetName,
        print_settings_id: `${settings.layerHeight.toFixed(2)}mm Implicit vase`,
        curr_bed_type: DEFAULT_BED_TYPE,
        nozzle_diameter: [nozzle],
        filament_ids: [filament.trayInfoIndex],
        filament_type: [filament.type],
        filament_colour: [filament.colorHex],
        filament_settings_id: [settings.filamentProfileName],
        filament_diameter: [formatNumber(settings.filamentDiameter)],
        filament_density: [formatNumber(filament.densityGramsPerCm3)],
        filament_map: ['1'],
        nozzle_temperature: [String(Math.round(settings.nozzleTempC))],
        hot_plate_temp: [String(Math.round(settings.bedTempC))],
        layer_height: formatNumber(settings.layerHeight),
        first_layer_height: formatNumber(settings.layerHeight),
        line_width: formatNumber(settings.lineWidth),
        spiral_mode: '1',
    }, null, 2);
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    return Number.parseFloat(value.toFixed(4)).toString();
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
