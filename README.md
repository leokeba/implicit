# Implicit

Implicit is a browser-based tool for realtime raymarch rendering and vase-mode G-code slicing of implicit surfaces.

## Features

- Realtime WebGL raymarch rendering.
- GPU-assisted vase slicing pipeline.
- Shared implicit scene definition used by both renderer and slicer.
- Modular shader composition (scene, raymarch utilities, environment, materials).

## Scene Authoring

A scene is a folder under `src/scenes/<id>/` with two files:

- `scene.glsl` — the implicit surface: `mapScene(vec3 p)` plus optional field functions. Uniform declarations are injected automatically from the manifest.
- `scene.ts` — the orchestration manifest (optional): uniforms, parameters, slicer configuration, computed defaults, and the postprocess pipeline.

```ts
import { defineScene, usePostprocess } from 'implicit/scene';

export default defineScene({
    title: 'Lamp Shade',
    uniforms: {
        uTwistTurns: { default: 1.7, min: 0.8, max: 3.2, step: 0.05 },
    },
    params: {
        heightMm: { default: 100, min: 40, max: 240, step: 5, section: 'Size' },
        radiusMm: { default: 50, min: 15, max: 110, step: 1, section: 'Size' },
    },
    slicer: { printer: 'bambu-p1s', filament: 'pla-generic', layerHeight: 0.2 },
    preprocess({ params }) {
        const modelScale = params.heightMm / 4;
        return { slicer: { modelScale, minY: -2, maxY: 2, maxRadius: params.radiusMm / modelScale } };
    },
    postprocess: [usePostprocess('sine-wave', { amplitudeMm: 0.4 })],
});
```

Everything print-relevant lives in these files; inspector tweaks are session-only overrides, are badged in the UI, and are recorded in the exported G-code header (`IMPLICIT_BLOCK_START`) together with content hashes of the scene sources.

Generic postprocess scripts live in `src/postprocess-scripts/` and export `controls` plus `transform(context)`. Scene manifests reference them by id (`usePostprocess('sine-wave', {...})`) or by scene-local path (`usePostprocess('./flare')`).

## Project Structure

```
implicit
├── src
│   ├── main.ts                  # Bootstrap
│   ├── App.svelte               # UI shell and state wiring
│   ├── studio-controller.ts     # Facade: configuration ladder, overrides, slicing, export
│   ├── scene-runtime/           # defineScene/usePostprocess API + manifest types ('implicit/scene')
│   ├── scenes/<id>/             # Scene folders: scene.glsl + scene.ts (+ helpers)
│   ├── postprocess-scripts/     # Generic toolpath scripts (controls + transform)
│   ├── core
│   │   ├── renderer.ts          # Realtime raymarch viewport
│   │   ├── slicer.ts            # GPU-assisted vase slicing and G-code emission
│   │   ├── shader-pipeline.ts   # Scene registry, manifest evaluation, shader composition
│   │   ├── scene-manifest.ts    # In-browser evaluation of scene.ts modules
│   │   ├── script-host.ts       # Shared TS transpile/eval for user scripts
│   │   ├── postprocess-registry.ts # Script registry + pipeline resolution
│   │   └── toolpath-postprocess.ts # Pipeline executor + transform context
│   ├── shaders/                 # Shader templates and GLSL libs
│   ├── printers/models/         # Printer presets (JSON)
│   ├── filaments/profiles/      # Filament presets (JSON)
│   ├── ui/, components/         # Svelte UI: inspector schema, panels, document sync
│   └── studio/                  # Export, benchmark, overlay helpers
├── index.html
├── package.json
├── tsconfig.json                # includes the 'implicit/scene' path alias
└── vite.config.ts               # dev-server file API for src/scenes and src/postprocess-scripts
```

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   cd implicit
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Run dev server:
   ```
   npm run dev
   ```

4. Open the app in a browser at http://localhost:3000.

## VS Code Preview Action

If you want to open the app directly inside VS Code (Simple Browser tab), use the workspace task:

1. Open Command Palette.
2. Run `Tasks: Run Task`.
3. Choose `Preview: Start + Open in VS Code Tab`.

You can also run `Preview: Open in VS Code Tab` if the dev server is already running.

## Usage

- Use the controls panel to tune raymarch and viewport parameters.
- Choose a printer model in the slicer section to apply plate dimensions, max print height, print/travel speed defaults, and start/end G-code defaults.
- Choose a filament profile in the slicer section to apply material temperatures, flow, fan, and speed defaults.
- Set brim width and brim gap in the slicer section to control brim size and spacing from the model (`0` width disables brim).
- Generate vase-mode G-code from the slicer section.
- Scene edits in `src/scenes/<id>/` (in the app editor or any external editor) hot-reload both rendering and slicing while the dev server runs.

## Printer Models

Printer models are loaded from JSON files in `src/printers/models/`.
Each file should define one model with this structure:

```json
{
   "id": "generic-220",
   "name": "Generic Cartesian 220x220",
   "plateWidthMm": 220,
   "plateDepthMm": 220,
   "maxHeightMm": 250,
   "defaultPrintSpeedMmPerSec": 40,
   "defaultTravelSpeedMmPerSec": 120,
   "startGcode": ["G90", "M82"],
   "endGcode": ["M104 S0", "M84"]
}
```

The `startGcode` and `endGcode` entries can be either arrays of lines or a multiline string.
The G-code templates support placeholders like `{nozzleTempC}`, `{bedTempC}`, and `{fanPwm}`.

## Filament Profiles

Filament profiles are loaded from JSON files in `src/filaments/profiles/`.
Each file should define one profile with this structure:

```json
{
   "id": "pla-generic",
   "name": "Generic PLA",
   "filamentDiameter": 1.75,
   "nozzleTempC": 215,
   "bedTempC": 55,
   "fanPercent": 100,
   "flowRate": 1.0,
   "printSpeedMmPerSec": 35,
   "travelSpeedMmPerSec": 120
}
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.