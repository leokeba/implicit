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

## Usage

- Use the controls panel to tune raymarch and viewport parameters.
- Generate vase-mode G-code from the slicer section.
- Scene edits in src/shaders/scenes/defaultScene.glsl affect both rendering and slicing.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.