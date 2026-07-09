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

- [x] `CameraController` — orbit/pan/dolly input + camera math + sessionStorage persistence
  (renderer.ts:555-825), ~40% of the file, fully self-contained.
- [x] `ThemeClearColor` — theme media-query sync + CSS color parsing (renderer.ts:980-1065).
- [x] Shared `ShaderCompiler`/`GlProgram` module — `createShader`/`createProgram`/cached
  uniform locations are duplicated between renderer and slicer, and the slicer's copy lacks
  the renderer's error excerpts.
- [x] Engine-uniform registry (see §3), deleting the 27 `*Location` fields and the ~100-line
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

- [x] **Engine-uniform registry.** Each built-in (`uTime`, `uMinY`, `uScale`, …) is repeated
  in ~5 places: private field, `getUniformLocation`, per-frame `gl.uniformXf`, hand-written
  declarations in both `renderer.frag.glsl` and `scene-field-sample.frag.glsl`, name-based
  binding in the slicer. A `{name, glslType, bind}` table generating both the GLSL
  declarations and the TS binding loop, shared by renderer and slicer.
- [x] **Scene-relative compile error lines** (marker-comment mapping instead of `#line`) —
  errors now report "In scene.glsl at line N" alongside the composed-source excerpt.
- [x] **Cross-validate the uniform contract** — a uniform declared in `scene.ts` but unused
  in GLSL is silently dropped (`getUniformLocation` returns null); warn instead.
- [ ] **Only `float` scene uniforms supported**; `params` never reach GLSL. Typed specs →
  `vec2/vec3/int` via the same generation mechanism. *Deliberately deferred until a scene
  actually needs one (AGENTS.md: no just-in-case code).*
- [x] **Multi-field scenes use `fields[0]`** for the modifier view — now a documented
  choice (all fields are still sampled for postprocess; the debug view shows the first).
- [x] Template substitution is first-occurrence `String.replace` with no missing-token check.
- [x] Module-global singleton state in shader-pipeline
  (`globalThis.__implicitShaderPipelineState`) removed — sessionStorage already persists the
  active scene across reloads and HMR. (The no-scenes throw remains: it is a real error.)

## 4. Correctness findings

1. - [x] **GL shader leak on failed compile** — `createProgram` creates the vertex shader,
   then the fragment; if fragment compilation throws, the vertex shader is never deleted
   (renderer.ts:865-866, slicer.ts:2567). Leaks on every failed live-edit hot-reload.
2. - [x] **`WAIT_FAILED` treated as success** — `waitForPendingBatch` returns normally on
   `WAIT_FAILED` (slicer.ts:1444), then reads possibly-garbage pixels.
3. - [x] **Interval leak on unmount during bootstrap** — `onMount`'s `disposed` flag is
   checked once early; three `setInterval`s are registered after later awaits
   (App.svelte:1629-1698).
4. - [x] **No teardown in the engine layer** — renderer window/media-query listeners,
   `Preview`'s resize listener (preview.ts:61), controller's `renderLifecycleCleanup`
   (assigned studio-controller.ts:226, never invoked). Bites during Vite HMR.
5. - [x] **App.svelte ↔ controller state mirroring** — `viewMode`, raymarch/viewport/
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

- [x] **`ui/` vs `studio/` split doesn't match roles.** `Preview` is an engine class but
  lives in `ui/`; `file-export.ts` does DOM downloads + Moonraker HTTP but lives in `studio/`
  and is imported by App.svelte directly, bypassing the controller. Cleaner: engines in
  `core/`, controller + pure helpers in `studio/`, Svelte-facing stores/backends in `ui/`.
- [x] **Two backward type-edges into the controller**: `studio/benchmark-summary.ts:2`
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
- [~] **studio-controller.ts extraction seams** (946 lines, switchboard feel): render-loop/
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
- [x] ~55 lines of `DocumentEditorPanel` markup repeated in App.svelte (1740-1774 / 1821-1854)

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

**2026-07-09 — engine-uniform registry, renderer split, App.svelte first pass.**
`core/shaders/engine-uniforms.ts` now generates every engine uniform declaration into the three
fragment templates via `__ENGINE_UNIFORMS_GLSL__`; `core/gl/uniforms.ts` (`UniformBinder`)
replaced the renderer's 25 location fields and the sampler's local uniform helpers — adding an
engine uniform is one table entry plus a bind call. Template placeholder substitution now
errors on missing tokens. Renderer split into `core/renderer/camera-controller.ts` (all
viewport interaction + persistence, detachable) and `theme-clear-color.ts`; renderer.ts is
482 lines (from 1,151). A dispose chain (Renderer/Preview/StudioController, called from App
onDestroy) fixes the engine-layer listener leaks. App.svelte (1,882 → 1,731): mid-init
interval leak fixed with disposed re-checks, the two DocumentEditorPanel placements share one
reactive prop bag, and `src/app/` gained `printer-connection.ts`, `runtime-session.ts`, and
`slice-eta.ts`. Verified per pass: `npm run check` + `npm run build` clean, browser smoke
(slice, scene switch, camera orbit through the extracted controller, zero console errors).
Still open in App.svelte: repository-sync/document-CRUD/layout-resize extractions, runes
migration, and the App↔controller state mirroring (§4.5).

**2026-07-09 (second pass) — authoring feedback + layout-resize extraction.** Compile errors
now map back to the author's file: the pipeline wraps the scene chunk in
`__SCENE_GLSL_BEGIN__/__SCENE_GLSL_END__` marker comments and `core/gl/program.ts` reports
"In scene.glsl at line N" (verified live: a deliberate bad call at scene line 10 reported
line 10, where the raw GL error said composed line 1202). Declared-but-unused manifest
uniforms now warn in the shader status instead of silently doing nothing
(`getSceneUniformContractWarnings`). `src/app/layout-resize.ts` extracts all inspector/editor
resize handling from App.svelte (now 1,592 lines). Non-float scene uniforms are deferred until
a scene needs one. The repository-sync/document-CRUD extraction is intentionally left for the
Phase-2 unified document repository redesign — extracting it as a callback bag would relocate
the coupling without reducing it. Remaining top items: App ↔ controller state mirroring +
runes migration, Phase-2 document repository, `fields[0]`-only modifier view.

**2026-07-09 (third pass) — single source of truth for studio state.** `StudioController`
now publishes a Svelte store of its snapshot after every mutation (all override mutators
funnel through `resolveConfiguration`, which is the publish chokepoint; the renderer param
setters and `setViewMode` publish too). App.svelte's nine mirrored locals (`sceneId`,
`viewMode`, `config`, raymarch/viewport/animation params, presets) are now one reactive
derivation of `$studioState`; `refreshConfig()` and every manual write-back are gone.
Synchronous post-mutation reads (runtime snapshot capture/restore, init-time printer
defaults) use the store value, which updates synchronously, instead of the async-derived
locals. Verified in the browser: uniform override commits and round-trips, per-scene
overrides survive scene switches, session restore after reload brings back both the override
and the view mode, slicing works, zero console errors. §4.5 closed. App.svelte is 1,566
lines. The remaining Svelte-idiom item is the runes migration itself, which this store
structure now makes mechanical ($derived over the store instead of `$:`).

**2026-07-09 (fourth pass) — remaining structural items.** Layering: controller DTO
contracts move to `studio/types.ts` (kills the benchmark-summary cycle and every ui→controller
type edge); shader-status formatters become private to `ui/status-model.ts`; `Preview` moves
to `core/preview.ts`; `file-export` splits into pure `studio/filename.ts` and DOM/Moonraker
`ui/file-export.ts`; the unused `StudioController.generateVaseGcode` (which did DOM downloads
from the controller) is deleted. The shader-pipeline `globalThis` singleton is gone
(sessionStorage covers HMR); the `fields[0]` modifier view is a documented choice. Phase 2:
`ui/documents/` provides a generic working/persisted `DocumentSet` store with dirty tracking;
scene bundles and postprocess scripts are two instances, and App's per-kind merge/sort/equality
bookkeeping is deleted. Finally App.svelte is migrated to Svelte 5 runes — `$props`/`$state`
everywhere, every former `$:` split into explicit `$derived` or `$effect` — with zero
svelte-check errors or warnings. Verified in the browser after the migration: boot, uniform
override commit, editor dirty/revert badges, per-scene override survival across scene
switches, slicing, download button state, session restore after reload; no console output.
App.svelte is 1,548 lines. Non-float scene uniforms remain deliberately deferred; the
runtime-snapshot persist effect now genuinely tracks its dependencies (it re-persists on
state changes rather than only on unload — intended).
