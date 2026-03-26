# Implicit

Implicit is a browser-based tool for realtime raymarch rendering and vase-mode G-code slicing of implicit surfaces.

## Features

- Realtime WebGL raymarch rendering.
- GPU-assisted vase slicing pipeline.
- Shared implicit scene definition used by both renderer and slicer.
- Modular shader composition (scene, raymarch utilities, environment, materials).

## Project Structure

```
implicit
├── src
│   ├── main.ts                # Application orchestration entry point
│   ├── core
│   │   ├── renderer.ts        # Realtime viewport renderer and camera interaction
│   │   ├── slicer.ts          # Vase-mode slicing and G-code emission
│   │   └── shader-pipeline.ts # Central shader source composition and shared scene wiring
│   ├── shaders
│   │   ├── renderer.vert.glsl
│   │   ├── renderer.frag.glsl
│   │   ├── slicer.vert.glsl
│   │   ├── slicer.frag.glsl
│   │   ├── scenes/
│   │   │   └── defaultScene.glsl
│   │   └── lib/
│   │       ├── raymarch.glsl
│   │       ├── environment.glsl
│   │       └── materials.glsl
│   ├── ui
│   │   ├── controls.ts        # UI controls
│   │   └── preview.ts         # Canvas and toolpath overlay
│   └── types/
│       └── shaders.d.ts
├── index.html            # Main HTML file
├── package.json
├── tsconfig.json
└── vite.config.ts
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
- Scene edits in src/shaders/scenes/defaultScene.glsl affect both rendering and slicing.

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