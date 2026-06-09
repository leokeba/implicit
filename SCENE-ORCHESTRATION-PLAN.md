# Scene Orchestration Plan

## Status (2026-06-10)

**Implemented.** All phases landed in one push: scene folders under `src/scenes/<id>/`, the `implicit/scene` runtime (`defineScene`/`usePostprocess`), manifest-driven uniforms/params/fields with injected GLSL declarations, the configuration ladder with sparse session overrides (badged + resettable in the inspector), the multi-step postprocess pipeline, the reproducibility header (`IMPLICIT_BLOCK_*` with file hashes and an explicit override list), and the folder-based dev-server file API. All bundled scenes and postprocess scripts were migrated; the legacy `SCENE_DEFAULT_*`/`@control`/`@field` parsing, the single-script postprocess config, and the flat `src/shaders/scenes/` layout were deleted.

Deviations from the plan as written:

- Browser-draft storage was removed entirely (the plan's fallback position): filesystem via the dev server is the only write path; static builds are read-only on bundled sources.
- Bare-number uniform/param specs mean "fixed value, no slider" rather than deriving a range.
- The G-code header uses an Orca-style config block (`implicit_* = ...` lines) instead of free-form comments; git commit capture is still open (file content hashes are recorded).

The rest of this document is the original design rationale.

## Objective

Make every scene a self-contained, committable description of a printable artifact. A scene becomes a **pair of files**:

- `scene.glsl` — the implicit surface: `mapScene(vec3 p)`, modifier field functions, nothing else.
- `scene.ts` — the orchestration module: uniforms, parameters, slicer configuration, preprocessing (computed defaults), and the postprocess pipeline.

Checking out a commit and pressing "slice" must produce the same G-code, with no print-relevant configuration living only in browser storage or UI state.

This replaces the current metadata-in-GLSL approach (`#define SCENE_DEFAULT_*`, `// @control {...}`, `// @field {...}`) and the single globally-selected postprocess script. Per AGENTS.md, the legacy formats are deleted, not kept alongside.

## What Is Clunky Today

- Scene metadata is smuggled through GLSL comments and `#define`s, parsed by regex in `src/core/shaders/scene-parser.ts`. It is stringly-typed, untyped for the author, and can only express constants — no computed defaults.
- Slicer defaults from `SCENE_DEFAULT_*` flow through name-aliasing tables (`SCENE_DEFAULT_PARAM_ALIASES` in `src/studio-controller.ts`) into `VaseSlicerSettings`. Adding one default touches three files.
- Postprocessing is one script, selected globally in the UI, with its parameter values persisted per-browser. The scene has no say in which postprocess belongs to it; a committed scene does not reproduce its surface texture.
- Filename templating (`gcodeSuffix`, `partIndex`, `partCount`) is wedged into the same `#define` mechanism (`src/studio/file-export.ts:buildSceneSuffixSlug`).
- Printer/filament presets are chosen in the UI only; a scene cannot declare "this prints on the MK4S with PETG".

## Target Design

### Design principles

- **Svelte is the spiritual reference.** One artifact, a few focused languages, near-zero boilerplate between them. We are not building custom tooling or an LSP, so a scene splits into two plain files that standard tooling already understands — but every API choice should be measured against "would this feel at home in a .svelte file?". Shorthands over ceremony, convention over configuration, no registration steps.
- **Sizing-first authoring.** The flagship preprocess use case: define the final printed object first (height and radius in millimeters) and derive scene scale and bounds from it, instead of hand-tuning `modelScale`/`minY`/`maxY`/`maxRadius` until the print comes out the right size.
- **The UI stays the exploration surface.** Manifests own defaults and computed values; the inspector remains the fast feedback loop for trying values before committing them back into the file. File edits and UI exploration must coexist without stepping on each other (see "Configuration dataflow").

### Scene folders

Each scene is a folder under a new top-level `src/scenes/` directory:

```
src/scenes/
  lamp_shade/
    scene.glsl        # implicit surface + field functions
    scene.ts          # orchestration module (optional; defaults apply if absent)
    flare.ts          # optional scene-local postprocess/helper modules
  threaded_coupler/
    scene.glsl
    scene.ts
```

The folder name is the scene id. `src/shaders/scenes/` goes away after migration. Generic, reusable postprocess scripts stay in `src/postprocess-scripts/` and become addressable by id from any manifest.

A folder per scene (rather than sibling files in one flat directory) gives each artifact a clean archival unit and a home for scene-local scripts and future assets.

### The orchestration module

`scene.ts` default-exports a manifest built with `defineScene`. Sketch of the full surface:

```ts
import { defineScene, usePostprocess } from 'implicit/scene';

export default defineScene({
    title: 'Lamp Shade',

    // GLSL uniforms + their UI controls. Replaces `// @control` and the
    // `uniform float ...;` declarations in the GLSL (declarations are
    // auto-injected by the shader pipeline from this block).
    uniforms: {
        uSceneTwistTurns: {
            type: 'float', default: 1.7, min: 0.8, max: 3.2, step: 0.05,
            label: 'Twist turns', section: 'Profile',
            description: 'How tightly the shade spirals around the axis.',
        },
        uSceneOrbitRadius: { type: 'float', default: 0.46, min: 0.2, max: 0.7, step: 0.01, section: 'Profile' },
    },

    // Modifier fields sampled on the GPU and attached to toolpath points.
    // Replaces `// @field`.
    fields: {
        noise: { fn: 'noiseField', type: 'float', min: -1, max: 1 },
    },

    // Custom scalar parameters that are NOT uniforms: inputs to preprocess /
    // postprocess / filename templating. Rendered in the inspector like controls.
    params: {
        heightMm: { default: 180, min: 60, max: 280, step: 5, section: 'Size' },
        radiusMm: { default: 55, min: 20, max: 110, step: 1, section: 'Size' },
        partIndex: { default: 0, min: 0, max: 7, step: 1 },
    },

    // Static slicer configuration. Replaces SCENE_DEFAULT_*. Keys are real
    // VaseSlicerSettings keys — no alias table. Presets are referenced by id
    // and applied before the overrides in this block.
    slicer: {
        printer: 'prusa-mk4s',
        filament: 'petg-generic',
        layerHeight: 0.2,
    },

    // Computed configuration. Runs after presets + static slicer block,
    // before UI overrides. Pure function: same inputs => same outputs.
    // The flagship case: the surface is authored in normalized scene units
    // (here y in [-2, 2], radius <= 2) and scale and bounds flow from the
    // desired printed size.
    preprocess({ params, slicer, uniforms }) {
        const modelScale = params.heightMm / 4;
        return {
            slicer: {
                modelScale,
                minY: -2,
                maxY: 2,
                maxRadius: params.radiusMm / modelScale,
            },
        };
    },

    // Ordered postprocess pipeline. Replaces the single global script.
    // Generic scripts are referenced by id with pinned parameter values;
    // inline steps are plain transform functions.
    postprocess: [
        usePostprocess('sine-wave', { amplitudeMm: 0.32, wavesPerLayer: 5 }),
        {
            name: 'seam drift',
            transform(ctx) {
                // same ToolpathPostprocessContext contract as generic scripts
            },
        },
    ],

    // Export configuration. Replaces gcodeSuffix/partIndex/partCount defines.
    export: {
        filenameSuffix: 'part-{part1}-of-{count}',
    },
});
```

Everything is optional. A missing `scene.ts` (or any omitted block) means "no uniforms, no params, base slicer defaults, empty pipeline" — a bare `scene.glsl` keeps working for quick sketches.

Specs stay terse: `label` derives from the key, `section` has a default, `step` derives from the range, and `[default, min, max, step?]` tuples are accepted anywhere a full spec object is.

### Typing and module resolution

`scene.ts` files are real in-repo TypeScript, so they get type-checked by `npm run check` and autocompleted in the editor:

- A new `src/scene-runtime/` module exports `defineScene`, `usePostprocess`, and all manifest/context types (reusing `VaseSlicerSettings`, `ToolpathPostprocessContext`, etc.).
- A tsconfig path alias maps `implicit/scene` to `src/scene-runtime/index.ts` so manifests use a stable, file-location-independent import.

At runtime, manifests are compiled the same way postprocess scripts already are (`ts.transpileModule` to CommonJS, evaluated via `new Function`), because the in-app editor must be able to hot-reload them without a Vite rebuild. The evaluator gets a `require` shim that resolves:

- `implicit/scene` → the scene-runtime API object,
- relative paths (`./flare`) → other compiled modules from the same scene folder.

The compile/eval/cache machinery is extracted from `src/core/toolpath-postprocess.ts` into a shared `src/core/script-host.ts` used by both manifests and postprocess scripts.

### Configuration dataflow

Resolution order for the effective slice configuration, lowest to highest precedence:

1. Built-in slicer defaults (`Slicer.getDefaultVaseSettings`).
2. Printer + filament presets named in `manifest.slicer.printer` / `.filament` (UI dropdowns can still switch them for exploration).
3. Static `manifest.slicer` overrides.
4. `manifest.preprocess()` output (computed from params/uniforms/resolved settings; must be pure).
5. Session-only UI overrides (inspector sliders).

Same ladder for uniform values: manifest defaults → preprocess output → UI sliders.

UI overrides are stored as **sparse per-key override maps** (one each for slicer settings, uniforms, params, and postprocess step parameters), kept per scene in the session snapshot. The file-derived base (steps 1–4) is recomputed from scratch on every manifest or GLSL edit and the override map is reapplied on top. Consequences, by design:

- Editing a default or a preprocess formula immediately moves every control the user has **not** touched.
- Explicitly overridden controls keep their values across unrelated edits.
- Touching a control writes exactly one key into the override map; per-control and global "reset to scene" delete keys.
- The inspector visibly badges overridden controls, and overrides never persist into exports silently: the G-code header records them (see Phase 6).

`preprocess` re-runs whenever params, uniforms, or presets change — it is cheap, synchronous, and must not touch the DOM, network, or random state. Errors surface in the status strip like shader compile errors do.

### Postprocess pipeline

- The pipeline is an ordered list of steps; each step gets the same `ToolpathPostprocessContext` and the chained points from the previous step.
- `usePostprocess(id, params)` references a script from `src/postprocess-scripts/` (or a scene-local module) with parameter values pinned in the manifest. Pinned values replace the per-browser `postprocessControlValueState` persistence as the source of truth; the inspector can still tweak them per-session as overrides.
- Inline steps are transform functions defined right in the manifest (or imported from scene-local files).
- Per-step summaries (notes, duration, point counts) replace the single `ToolpathPostprocessSummary`; the existing per-script validation in `toolpath-postprocess.ts` runs after each step.
- The global "postprocess script" picker, enable toggle, and per-browser parameter persistence in `App.svelte` are removed. The inspector instead renders the active scene's pipeline: step list with enable/disable checkboxes (session-only) and parameter sliders.

### Reproducible export

The exported G-code becomes traceable to its sources:

- Header block (alongside the existing Orca metadata) recording: scene id, content hashes of `scene.glsl` and `scene.ts` (and scene-local modules), git describe/commit if the dev server can provide it, resolved settings JSON, pipeline step list with parameter values, and an explicit `OVERRIDES:` list for any session UI deviations (empty list = file-pure artifact).
- Filename built from manifest `export.filenameSuffix` templating plus the existing scene/printer/nozzle slugs.

## What Gets Deleted

In keeping with the no-backwards-compatibility rule, the end state removes:

- `parseSceneDefaultParams`, `readSceneNumberParam`, `parseSceneControlDefinitions`, `parseSceneFieldDefinitions` in `src/core/shaders/scene-parser.ts` (the whole file, most likely).
- `getSceneDefaultParams` / `getSceneSlicerDefaults` in `src/core/shader-pipeline.ts` and `SCENE_DEFAULT_PARAM_ALIASES` + `applySceneDefaultParams` in `src/studio-controller.ts`.
- `// @control` parsing for postprocess scripts in `toolpath-postprocess.ts` — generic scripts export a typed `controls` object instead of comment JSON.
- `buildSceneSuffixSlug` define-based templating in `src/studio/file-export.ts`.
- `uniform float uScene...;` declarations inside scene GLSL (auto-injected from the manifest).
- The single-script `ToolpathPostprocessConfig` plumbing (`postprocessEnabled`, `activePostprocessScriptId`, `postprocessControlValueState`) in `App.svelte` and `StudioController`.
- `src/shaders/scenes/` and the old flat-scene assumptions in the vite middleware and document repositories.

## Phases

Each phase lands independently, validated by `npm run check`, `npm run build`, and the manual smoke pass (scene switch, GLSL edit, manifest edit, slice, export, overlay). Breakage of stored browser drafts or old scene files mid-migration is acceptable; bundled scenes are migrated in the final phase, with `lamp_shade` converted early as the pilot.

### Phase 1 — Scene runtime and script host

1. Create `src/scene-runtime/`: manifest types (`SceneManifest`, `UniformSpec`, `ParamSpec`, `FieldSpec`, `SlicerOverrides`, `PostprocessStep`), `defineScene` (identity + normalization/validation), `usePostprocess`.
2. Extract the transpile/eval/cache machinery from `toolpath-postprocess.ts` into `src/core/script-host.ts`; add the `require` shim with the `implicit/scene` resolution and a hook for sibling-module resolution.
3. Add the `implicit/scene` tsconfig path alias; verify `npm run check` type-checks a sample manifest.
4. Build the manifest evaluator: source → normalized `SceneManifest` with readable errors (compile failure, no default export, invalid spec shapes).

Exit: a manifest can be compiled and inspected from a unit-style harness (a temporary dev page or console call), no UI integration yet.

### Phase 2 — Scene folders and document plumbing

1. Introduce `src/scenes/<id>/` with `import.meta.glob` bundling for both `scene.glsl` and `*.ts` per folder.
2. Rework the vite middleware: list scene folders, GET/PUT `scene.glsl`, `scene.ts`, and scene-local modules under `/__implicit_api/scenes/<id>/<file>`.
3. Rework `src/ui/scene-documents.ts` + `src/ui/documents/repository.ts`: a scene entry now carries multiple documents (glsl + ts + extras). Keep browser-draft fallback with the same multi-file shape (one storage payload per scene).
4. Update the editor panel: per-scene file tabs (GLSL / manifest / extras) instead of the scene-vs-postprocess document mode toggle.
5. Move `lamp_shade` into the new layout as the pilot (manifest still unused by the pipeline at this point; old GLSL metadata kept only on the unmigrated scenes).

Exit: scenes load from folders, both files editable and saving to disk in dev mode.

### Phase 3 — Manifest-driven uniforms, params, fields

1. Shader pipeline: build the scene entry from `scene.glsl` + evaluated manifest; inject a generated uniform declaration block via a new `__SCENE_UNIFORMS_GLSL__` placeholder in renderer/slicer/field-sampler templates.
2. Controls: inspector scene tab renders from `manifest.uniforms` + `manifest.params` (sections, labels, options as today — reuse `SceneControlDefinition` shape internally).
3. Fields: slicer field sampling reads `manifest.fields` instead of `// @field`.
4. Manifest edits hot-reload like GLSL edits: re-evaluate, re-inject uniforms, recompile shaders, surface errors in the status strip.
5. Delete `@control`/`@field` parsing for scenes.

Exit: `lamp_shade` renders and slices fully manifest-driven; its GLSL contains only surface code.

### Phase 4 — Slicer config and preprocess

1. Implement the resolution ladder (defaults → presets-by-id → static `slicer` block → `preprocess()` → UI overrides) in `StudioController`, replacing `applySceneDefaultParams`.
2. Wire `preprocess` re-execution on param/uniform/preset changes; pipe errors to the status strip.
3. Inspector: override badges + reset-to-scene actions; printer/filament dropdowns show when they deviate from the manifest's choice.
4. Delete `SCENE_DEFAULT_*` parsing and the alias table.

Exit: a scene's committed files fully determine its slice settings; UI changes are visibly exploratory.

### Phase 5 — Postprocess pipeline

1. Generic scripts: replace `// @control` comments with an exported `controls` object (typed via `implicit/scene`); register bundled scripts by id.
2. Pipeline executor: run manifest steps in order through the existing context-build + validation machinery; collect per-step summaries.
3. Manifest support for inline transforms and scene-local module steps.
4. Inspector: render the active pipeline (step list, session enable toggles, parameter overrides); remove the global script picker, enable flag, and per-browser parameter persistence.
5. Update `StudioController` caching so the base-toolpath cache keys on pipeline identity.

Exit: surface texture is part of the scene definition; two scenes can ship different pipelines and switch cleanly.

### Phase 6 — Reproducible export and migration

1. G-code header: scene id, file content hashes, resolved settings, pipeline with parameters, override list; commit hash when available from the dev server.
2. Filename templating from `manifest.export`, deleting the define-based suffix logic.
3. Migrate all remaining bundled scenes to folders + manifests; delete `src/shaders/scenes/`, `scene-parser.ts`, and every legacy code path listed in "What Gets Deleted".
4. Update README and AGENTS.md to describe the scene-folder format.

Exit: repo contains only the new format; an exported G-code file names the exact sources that produced it.

## Out of Scope (Future Work)

- **Headless slicing CLI** (`implicit slice <scene> -o out.gcode`): the slicer depends on WebGL contour sampling, so a headless path needs either a GL shim or scripted Chromium. The manifest design deliberately keeps everything needed for this in files, but the runner itself is a separate effort.
- **Saved print jobs / variants**: multiple named parameter sets per scene (e.g. one per `partIndex`). The `params` + `export.filenameSuffix` design anticipates this; a `variants` block can be added later without rework.
- Multi-material, non-vase slicing modes, or changes to the slicing algorithm itself.

## Open Decisions (defaults chosen, revisit if they chafe)

- **Manifest evaluation context**: manifests run with the same blunt `new Function` evaluation as postprocess scripts — no sandboxing. Fine for a single-user tool running its own code.
- **Browser-draft mode**: kept, but as a strictly secondary path; if multi-file drafts make it awkward, drafts degrade to "GLSL only" and manifest editing becomes dev-server-only.
- **`uniforms` vs `params` split**: kept as two blocks because they have different plumbing (GPU vs script-side). If the distinction grows annoying in practice, a unified `inputs` block with a `uniform: true` flag is the fallback design.
- **Two files, not one**: a single-file format with an embedded GLSL block (svelte-style `<glsl>` section) is the aspiration, but it would need custom editor tooling/LSP support to not feel worse than two files. Two files is the deliberate compromise; revisit if file-switching friction grows.
