# Code Quality Review

Full-project review focused on maintainability, simplicity, coherency, correctness, and
separation of concerns. Line numbers reference the tree at the time of review (2026-07-08,
commit e922b41 + working changes); they will drift as the fixes land.

**Status legend:** unmarked = open, `[x]` = fixed, `[~]` = partially addressed.

## Verdict

The architecture concept is strong: clean `core/` layering (nothing in core imports upward),
a well-designed configuration ladder in `studio-controller.ts`, a genuinely DRY scene-uniform
contract, and unusually good docs. The debt is concentrated in three places:

- `src/core/slicer.ts` (4,100 lines) — sampling and slicing entangled.
- `src/App.svelte` (1,882 lines) — god component mirroring controller state.
- `src/core/renderer.ts` (1,151 lines) — four unrelated concerns in one class.

REFACTOR-PLAN.md already diagnoses most of this; Phases 1, 2, 4, 5, 6 are essentially
unstarted. `npm run check` is clean.

## 1. Sampling ↔ slicing boundary

The seam already exists in the data: what crosses from sampling to slicing is a plain
per-layer `Float32Array` field plus bounds — no GL types. Everything downstream
(`extractContoursFromField`, marching squares, `selectPrimaryContour`, resample/smooth/align)
is pure module-level functions. Swapping the contour algorithm is already easy.

But the seam is not expressed as an interface, and it sits in the wrong place:

- [x] The crossing type is named after the implementation (`SliceGpuBatchResult`,
  `SliceGpuPendingBatch`, slicer.ts:321-343). A CPU sampler would have to impersonate the
  whole GPU batch protocol (issue → fence-wait → PBO read) and the texture-limit-driven
  batching in `prepareSliceJob`. There is no `FieldSampler` interface.
- [x] `finalizeSliceLayers` (slicer.ts:1270) sits on the sampling side but does slicing work:
  derives `pointsPerLayer`, resamples, Taubin-smooths, aligns layers, adaptive-decimates.
  "Sampling" today returns finished printable contours, not raw field-extracted loops. The
  worker inherits this: `sampling.worker.ts` returns fully finalized geometry.
- [~] Hidden channels cross the boundary: `settings.pointsPerLayer` is both a clamped input
  and a derived output (mutated at slicer.ts:1288 and again at :612); `lastSliceDebugSnapshot`
  is written from deep inside `extractSliceLayer` as a side channel.
- [x] The field's coordinate convention (row 0 = minZ, GL bottom-up readback) lives only
  implicitly between the frag shader and `extractContoursFromField` — undocumented at the seam.

**Fix:** define a `FieldSampler` interface (Y-levels + bounds in, `{sampleY, field}[]` out,
"Gpu" out of the name), move `finalizeSliceLayers`' post-processing into the orchestrator,
return derived values explicitly instead of mutating settings/fields, document the field
layout at the seam.

Also: only the async path uses the worker; `benchmarkVaseGcode` uses the sync, non-pipelined
path — benchmark timings do not measure the production path.

## 2. File splits

### slicer.ts → core/slicer/ package

| Module | Content | ~Lines |
|---|---|---|
| `config.ts` | `VaseSlicerSettings`, defaults, merge/clamp | 160 |
| `field-sampler-gpu.ts` | GL resources, batch issue/wait/read, job planning, scene-field sampling | 750 |
| `contours.ts` | marching squares, segment joining, `selectPrimaryContour`, significance | 700 |
| `contour-postprocess.ts` | resample, Taubin smoothing, alignment, adaptive decimation | 250 |
| `toolpath.ts` | spiral builders, move merging, extrusion, min-layer-time | 470 |
| `gcode.ts` | `buildGcode`, brim, bottom fill, 2D offset (merge with existing satellites) | 490 |
| `slicer.ts` (facade) | orchestration + worker plumbing | ~575 |

The worker already reuses the same class with zero duplicated logic; the facade stays the
dual-host entry point.

### renderer.ts → four units

- [ ] `CameraController` — orbit/pan/dolly input + camera math + sessionStorage persistence
  (renderer.ts:555-825), ~40% of the file, fully self-contained.
- [ ] `ThemeClearColor` — theme media-query sync + CSS color parsing (renderer.ts:980-1065).
- [x] Shared `ShaderCompiler`/`GlProgram` module — `createShader`/`createProgram`/cached
  uniform locations are duplicated between renderer and slicer, and the slicer's copy lacks
  the renderer's error excerpts.
- [ ] Engine-uniform registry (see §3), deleting the 27 `*Location` fields and the ~100-line
  binding block.

Leaves a ~300-line renderer.

### App.svelte

~1,710 lines of script vs ~170 of markup; the clearest AGENTS.md §5 violation. Contains
Moonraker networking, localStorage/sessionStorage persistence, an ETA-learning estimator,
document CRUD with id-collision suffixing, and folder-sync pollers. REFACTOR-PLAN Phase 1's
module list (`repository-sync`, `export-actions`, `layout-resize`, …) maps 1:1 onto these
blocks. The app is also still entirely Svelte 4 idiom (26 `$:` statements mixing derived
values with side effects, `export let`, zero runes) despite Svelte 5.55 — migrate extracted
modules to runes as they come out; two reactive statements mutate their own inputs
(App.svelte:407-409, :430-432).

## 3. GLSL ↔ TS interaction

Good: scene uniforms are single-sourced — `defineScene` specs generate the GLSL
`uniform float` block (`buildSceneUniformBlock`, shader-pipeline.ts:266).

Improvements, in value order:

- [ ] **Engine-uniform registry.** Each built-in (`uTime`, `uMinY`, `uScale`, …) is repeated
  in ~5 places: private field, `getUniformLocation`, per-frame `gl.uniformXf`, hand-written
  declarations in both `renderer.frag.glsl` and `scene-field-sample.frag.glsl`, name-based
  binding in the slicer. A `{name, glslType, bind}` table generating both the GLSL
  declarations and the TS binding loop, shared by renderer and slicer.
- [ ] **`#line` directives before `__SCENE_GLSL__`** — compile errors currently report
  positions in the composed source; scene authors get offset line numbers.
- [ ] **Cross-validate the uniform contract** — a uniform declared in `scene.ts` but unused
  in GLSL is silently dropped (`getUniformLocation` returns null); warn instead.
- [ ] **Only `float` scene uniforms supported**; `params` never reach GLSL. Typed specs →
  `vec2/vec3/int` via the same generation mechanism.
- [ ] **Multi-field scenes silently use only `fields[0]`** for the modifier view
  (shader-pipeline.ts:222) — support the rest or reject such manifests.
- [ ] Template substitution is first-occurrence `String.replace` with no missing-token check.
- [ ] Module-global singleton state in shader-pipeline
  (`globalThis.__implicitShaderPipelineState`) makes init order brittle;
  `composeRendererFragmentSource` can throw during `Renderer.init`.

## 4. Correctness findings

1. - [x] **GL shader leak on failed compile** — `createProgram` creates the vertex shader,
   then the fragment; if fragment compilation throws, the vertex shader is never deleted
   (renderer.ts:865-866, slicer.ts:2567). Leaks on every failed live-edit hot-reload.
2. - [x] **`WAIT_FAILED` treated as success** — `waitForPendingBatch` returns normally on
   `WAIT_FAILED` (slicer.ts:1444), then reads possibly-garbage pixels.
3. - [ ] **Interval leak on unmount during bootstrap** — `onMount`'s `disposed` flag is
   checked once early; three `setInterval`s are registered after later awaits
   (App.svelte:1629-1698).
4. - [ ] **No teardown in the engine layer** — renderer window/media-query listeners,
   `Preview`'s resize listener (preview.ts:61), controller's `renderLifecycleCleanup`
   (assigned studio-controller.ts:226, never invoked). Bites during Vite HMR.
5. - [ ] **App.svelte ↔ controller state mirroring** — `viewMode`, raymarch/viewport/
   animation params, and overrides exist as local `let`s and inside the controller, synced by
   hand. Any missed `refreshConfig()` desyncs UI from engine — the most likely source of
   "UI shows X but print does Y" bugs.
6. - [x] **Wrong error label** — "Planar contour slicer produced too few valid slices" is
   emitted in cylindrical mode too (slicer.ts:1277).
7. - [ ] **Two coexisting extrusion models** — the spiral builder accumulates `e` per
   segment, then `recomputeExtrusion` overwrites it in the main path (slicer.ts:1671); only
   the top-cap `extrusionScale` survives.
8. - [ ] **Stringly-typed control flow** — `'Renderer not initialized'` used as a magic
   sentinel string in three places in the controller.
9. - [ ] **Cmd+S handled twice** (window in App.svelte, document in DocumentEditorPanel),
   correct only because of DOM bubble ordering.

## 5. Coherency / separation of concerns

- [ ] **`ui/` vs `studio/` split doesn't match roles.** `Preview` is an engine class but
  lives in `ui/`; `file-export.ts` does DOM downloads + Moonraker HTTP but lives in `studio/`
  and is imported by App.svelte directly, bypassing the controller. Cleaner: engines in
  `core/`, controller + pure helpers in `studio/`, Svelte-facing stores/backends in `ui/`.
- [ ] **Two backward type-edges into the controller**: `studio/benchmark-summary.ts:2`
  imports a type from its own consumer (compile-time-only cycle); `ui/status-model.ts`
  imports functions and types from the controller — the shader-message formatters
  (studio-controller.ts:138-159) are presentation code in the wrong layer. Move DTO
  interfaces to a types module and the formatters to `ui/`.
- [x] **Duplicated sync/async pipeline bodies** — `executeVaseSlice`/`executeVaseSliceAsync`
  and `sampleSliceContoursGpu`/`…Async` are four near-identical bodies. The sync path exists
  only for benchmarking (and measures the wrong path anyway) — candidate for deletion per
  AGENTS.md working agreement 4.
- [ ] **`buildGcode` embeds geometry** — bottom-fill infill (slicer.ts:2304-2368) and
  brim/2D-offset are path planning living in the G-code emission layer.
- [ ] **`gcode-metadata.ts`** — ~200 lines of hardcoded OrcaSlicer/Bambu config mostly
  disconnected from actual settings; `shouldEmitOrcaMetadata` always returns true.
- [ ] **studio-controller.ts extraction seams** (946 lines, switchboard feel): render-loop/
  preview lifecycle (837-897); reproducibility header building (768-835, belongs next to
  file-export); the resolution ladder (620-719) as a pure testable function; DTO interfaces
  (40-135) to a types file.

## 6. Quick wins (mechanical)

Duplicated verbatim:

- [x] `buildSceneControlValueMap` — renderer.ts:1069 / slicer.ts:4082
- [x] `mmPerSecToFeedrate` — slicer.ts:3745 / gcode-template.ts:56
- [x] `clamp` — slicer.ts:4071 / gcode-metadata.ts:337
- [x] `distance3` — slicer.ts:3757 / toolpath-postprocess.ts:361
- [ ] `toScriptLabel` — postprocess-registry.ts:234 / postprocess-documents.ts:173
- [ ] `toFiniteNumber` + `extractModuleData` — printer-models.ts / filament-profiles.ts
- [ ] Shoelace area and closed-path dedupe implemented twice with different point shapes
  (`{x,z}` vs `{x,y}`)
- [ ] ~55 lines of `DocumentEditorPanel` markup repeated in App.svelte (1740-1774 / 1821-1854)

Dead code:

- [x] `distance2` (slicer.ts:3753), `setUniform1i` (slicer.ts:2656),
  `sampleYToPrintHeightMm` (slicer.ts:1962 — logic inlined twice elsewhere instead),
  marching-squares cases 0/15 (slicer.ts:2860, unreachable), unreachable `default` in
  `getSliceProgressPhaseLabel`.
- [ ] Epsilons scattered (`1e-4` … `1e-12`) with no shared tolerance constants.

## Suggested order of work

1. Slicer split with an explicit `FieldSampler` interface (§1 + §2) — serves the
   swappable-methods goal directly and untangles the worker story.
2. Shared GL module (compiler + engine-uniform registry) — fixes renderer/slicer duplication,
   the shader leak, and the engine-uniform DRY problem in one move.
3. App.svelte Phase 1 extractions, converting to runes as modules come out.

The §6 quick wins are a low-risk warm-up for any of these.

## Progress log

**2026-07-08 — slicer split + FieldSampler boundary + shared GL module (items 1 and 2 of the
suggested order).** `core/slicer.ts` went from 4,100 lines to a 673-line orchestrator/facade
(public API unchanged for importers) over new modules: `slicer/types.ts`, `slicer/config.ts`,
`slicer/math.ts`, `slicer/contours.ts`, `slicer/contour-postprocess.ts`, `slicer/toolpath.ts`,
`slicer/gcode.ts`, `slicer/field-sampler.ts` (the sampling↔slicing interface, with the field
layout contract documented), `slicer/field-sampler-gpu.ts`, and `slicer/job-planner.ts`
(sampler-agnostic, takes any `FieldSampler`). `finalizeContourLayers` now returns the derived
`pointsPerLayer` instead of mutating settings inside the sampler path (the orchestrator applies
it explicitly). The unused sync slice path (`generateVaseGcode`, `generateVaseGcodeWithProgress`,
`executeVaseSlice`, `sampleSliceContoursGpu`) was deleted; `benchmarkVaseGcode` is now async and
measures the production worker+pipelined path. `core/gl/program.ts` is the shared shader
compiler (renderer + sampler) with source-excerpt errors and no leak on failed compiles;
`buildSceneControlValueMap` lives once in `core/control-options.ts`. Also removed:
`shouldEmitOrcaMetadata` (always-true gate), dead `distance2`/`setUniform1i`/`sampleYToPrintHeightMm`
duplication, unreachable marching-squares cases. Verified: `npm run check` and `npm run build`
clean, plus a browser smoke pass (default scene slice 55k points, Lamp Shade slice with
postprocess pipeline 95k points, async benchmark, scene switching; Threaded Coupler's
layer-1 "no closed outline" failure reproduces identically on pre-refactor HEAD — pre-existing,
not a regression).
