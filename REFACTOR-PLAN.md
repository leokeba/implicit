# Refactor Plan

## Objective

Refactor the application so that file size and architectural boundaries line up with runtime ownership.

The goal is not cosmetic modularization. The goal is to make the next wave of work cheaper by:

- shrinking `src/App.svelte` into a composition shell
- separating application services from UI wiring
- removing duplicated document repository logic
- making shader and slicer pipelines explicit rather than singleton-heavy
- isolating computational phases so they can be tested and eventually moved off the main thread

## Current Hotspots

The main structural pressure points are:

- `src/App.svelte`
- `src/studio-controller.ts`
- `src/ui/inspector-schema.ts`
- `src/core/shader-pipeline.ts`
- `src/core/slicer.ts`
- duplicated repository logic in `src/ui/scene-documents.ts` and `src/ui/postprocess-documents.ts`

`src/core/renderer.ts` is large, but it is more cohesive than the files above and should not be the first split.

## Refactor Principles

1. Preserve behavior before improving internals.
2. Extract seams that already exist in the code instead of inventing a new architecture all at once.
3. Keep public APIs stable where practical until the end of a phase.
4. Validate every phase with the narrowest available checks.
5. Avoid parallel architectural rewrites in the same phase.

## Non-Goals

This plan does not include:

- rewriting the renderer in a different framework
- replacing WebGL with another rendering stack
- redesigning the Svelte component hierarchy from scratch
- changing the slicing algorithm itself unless required by modularization

## Validation Baseline

Use these checks throughout the plan:

- `npm run check`
- `npm run build`
- manual smoke pass in dev server for: scene switch, shader edit, postprocess edit, export, benchmark, toolpath overlay, dock resize

Because the repo does not currently expose focused automated tests for these flows, each phase should add at least one new low-cost validation target where feasible, such as parser unit coverage or store-level assertions.

## Target Architecture

### UI Shell

`src/App.svelte` should become a thin composition layer that wires together:

- workspace layout state
- editor workspace state
- inspector bindings
- command actions
- lifecycle bootstrapping

### Studio Layer

The current `StudioController` should be reduced into a small facade over focused services:

- scene service
- render lifecycle service
- export and benchmark service
- session state adapter

### Document Layer

Scene documents and postprocess scripts should share a generic repository abstraction with two storage adapters:

- browser storage adapter
- filesystem API adapter

### Shader Layer

Shader source composition should be decomposed into:

- scene registry
- scene parsing
- source composition
- hot-reload integration

### Slicer Layer

The slicer should become an explicit pipeline:

- settings normalization
- GPU sampling
- contour extraction and selection
- contour alignment and printable contour shaping
- toolpath construction
- toolpath optimization and postprocess application
- G-code writing and printer-flavor metadata

## Phase Plan

## Phase 0: Safety Rails And Baseline

### Scope

- record current hotspot files and module responsibilities
- add a manual smoke checklist to this file or a follow-up QA note
- identify any logic that depends on module-level singleton state

### Deliverables

- this plan document
- a repeatable validation checklist for the refactor

### Acceptance Criteria

- there is a clear list of user-visible flows to verify after each phase
- refactor work can proceed incrementally without guessing validation steps

### Validation

- `npm run check`
- `npm run build`

## Phase 1: Shrink App Shell Ownership

### Goal

Move workflow state and imperative actions out of `src/App.svelte` without changing the visible UI.

### Scope

Extract these concerns from `src/App.svelte`:

- editor document state and active document selection
- scene editor workflow
- postprocess editor workflow
- export and benchmark command handlers
- resize and dock behavior helpers
- repository bootstrapping and polling lifecycle

### Target Modules

- `src/app/workspace-session.ts`
- `src/app/editor-session.ts`
- `src/app/export-actions.ts`
- `src/app/repository-sync.ts`
- `src/app/layout-resize.ts`
- `src/app/scene-template.ts`

Names can vary, but the ownership split should stay the same.

### Notes

Do not move the existing Svelte stores yet. Use small helper modules first so the shell gets thinner before store boundaries are changed.

### Acceptance Criteria

- `src/App.svelte` no longer directly owns most mutation logic
- bootstrapping code is thinner and easier to scan
- editor save and revert flows still behave the same
- repository polling logic is not embedded in the component

### Validation

- `npm run check`
- `npm run build`
- manual smoke: save scene, save postprocess script, create scene, create postprocess script, export, benchmark

## Phase 2: Unify Document Repository Architecture

### Goal

Remove duplication between scene and postprocess document storage.

### Scope

Extract shared repository behavior from:

- `src/ui/scene-documents.ts`
- `src/ui/postprocess-documents.ts`

Keep domain-specific normalization thin.

### Target Modules

- `src/ui/documents/types.ts`
- `src/ui/documents/browser-storage.ts`
- `src/ui/documents/filesystem-storage.ts`
- `src/ui/documents/repository.ts`
- `src/ui/scene-documents.ts` as a thin scene-specific wrapper
- `src/ui/postprocess-documents.ts` as a thin postprocess-specific wrapper

### Shared Behaviors To Extract

- load browser overrides and customs
- persist browser overrides and customs
- load filesystem collections
- save a single document to filesystem
- dirty detection
- clone and sort helpers

### Acceptance Criteria

- scene and postprocess repositories reuse one common repository abstraction
- browser and filesystem behavior remains unchanged
- app-level code does not need to know repository internals

### Validation

- `npm run check`
- `npm run build`
- manual smoke: browser mode load, filesystem mode load, save to both modes, dirty detection, polling refresh

## Phase 3: Modularize Inspector Schema

### Goal

Split the inspector DSL into composable modules so schema, read behavior, and commit behavior stop living in one file.

### Scope

Break up `src/ui/inspector-schema.ts` into:

- shared inspector types
- static tab definitions per domain
- dynamic section builders for scene and postprocess controls
- field readers
- field commit dispatcher
- option readers and disabled-state helpers

### Target Modules

- `src/ui/inspector/types.ts`
- `src/ui/inspector/tabs/scene.ts`
- `src/ui/inspector/tabs/camera.ts`
- `src/ui/inspector/tabs/render.ts`
- `src/ui/inspector/tabs/print.ts`
- `src/ui/inspector/tabs/machine.ts`
- `src/ui/inspector/tabs/material.ts`
- `src/ui/inspector/tabs/postprocess.ts`
- `src/ui/inspector/tabs/output.ts`
- `src/ui/inspector/dynamic-sections.ts`
- `src/ui/inspector/readers.ts`
- `src/ui/inspector/commit.ts`
- `src/ui/inspector/index.ts`

### Acceptance Criteria

- no single inspector file owns schema, reads, and writes together
- adding a new tab or field type is localized
- scene and postprocess dynamic control generation remains supported

### Validation

- `npm run check`
- `npm run build`
- manual smoke: every inspector tab renders, edits apply, actions trigger, scene and postprocess dynamic controls still appear

## Phase 4: Split StudioController Into Focused Services

### Goal

Reduce `src/studio-controller.ts` to a thin orchestration facade or replace it with small service objects.

### Scope

Extract these responsibilities:

- scene switching and scene document sync
- renderer pause and resume lifecycle
- export and benchmark operations
- toolpath overlay projection
- scene default application and scene-control sync
- download helper and benchmark summarization

### Target Modules

- `src/studio/session.ts`
- `src/studio/scene-service.ts`
- `src/studio/render-loop.ts`
- `src/studio/export-service.ts`
- `src/studio/toolpath-overlay.ts`
- `src/studio/benchmark-summary.ts`

### Acceptance Criteria

- scene logic is not mixed with render lifecycle logic
- export and benchmark logic can be reasoned about without scanning render-loop code
- controller surface becomes small enough to read top-to-bottom quickly

### Validation

- `npm run check`
- `npm run build`
- manual smoke: scene change, shader error recovery, export pause and resume, benchmark overlay update

## Phase 5: Decompose Shader Pipeline Runtime

### Goal

Make shader state explicit and localize parsing concerns.

### Scope

Split `src/core/shader-pipeline.ts` into registry, parser, composition, and HMR runtime concerns.

### Target Modules

- `src/core/shaders/types.ts`
- `src/core/shaders/scene-registry.ts`
- `src/core/shaders/scene-parser.ts`
- `src/core/shaders/source-composer.ts`
- `src/core/shaders/runtime-state.ts`
- `src/core/shaders/hot-reload.ts`
- `src/core/shader-pipeline.ts` as a compatibility facade during migration

### Design Rule

Avoid broad module-level mutable state except in one clearly named runtime-state module.

### Acceptance Criteria

- scene registry operations do not also own parsing and HMR bookkeeping
- parser logic for defaults and controls is isolated and testable
- renderer-facing source composition stays unchanged in behavior

### Validation

- `npm run check`
- `npm run build`
- manual smoke: scene enumeration, scene edits, scene defaults, control parsing, HMR update

## Phase 6: Split Slicer Into Pipeline Modules

### Goal

Turn `src/core/slicer.ts` from a monolith into explicit pipeline stages with a stable facade.

### Scope

Keep the public `Slicer` class initially, but move internals behind focused modules.

### Target Modules

- `src/core/slicer/types.ts`
- `src/core/slicer/settings.ts`
- `src/core/slicer/gpu-sampler.ts`
- `src/core/slicer/contour-extraction.ts`
- `src/core/slicer/contour-selection.ts`
- `src/core/slicer/contour-alignment.ts`
- `src/core/slicer/toolpath-builder.ts`
- `src/core/slicer/toolpath-optimizer.ts`
- `src/core/slicer/postprocess-stage.ts`
- `src/core/slicer/gcode-writer.ts`
- `src/core/slicer/printer-flavors.ts`
- `src/core/slicer/geometry.ts`
- `src/core/slicer/progress.ts`
- `src/core/slicer.ts` as facade during migration

### Internal Split Guidance

- keep WebGL resource ownership inside the GPU sampler
- keep marching-squares and contour joining out of the `Slicer` class
- keep brim math and printer metadata out of the toolpath builder
- keep settings normalization independent from runtime execution

### Acceptance Criteria

- the slicer file stops containing all computational phases
- non-WebGL logic becomes testable in isolation
- the current progress reporting and debug snapshot behavior still work

### Validation

- `npm run check`
- `npm run build`
- manual smoke: generate G-code, benchmark G-code, planar mode, cylindrical mode, brim generation, printer-specific metadata, slice debug failure path

## Phase 7: Internal Renderer Cleanup

### Goal

Split renderer internals only after the rest of the ownership model is cleaner.

### Scope

Refactor `src/core/renderer.ts` internally without changing its public role.

### Target Modules

- `src/core/renderer/camera-state.ts`
- `src/core/renderer/interaction.ts`
- `src/core/renderer/program.ts`
- `src/core/renderer/uniform-cache.ts`
- `src/core/renderer/theme-sync.ts`
- `src/core/renderer/types.ts`

### Acceptance Criteria

- interaction code is separate from shader program setup
- uniform lookup and updates are no longer mixed into every renderer concern
- renderer remains behaviorally stable from the outside

### Validation

- `npm run check`
- `npm run build`
- manual smoke: orbit, pan, dolly, resize, shader reload, theme changes, overlay draw

## Phase 8: Hardening, Cleanup, And Documentation

### Goal

Remove migration shims and document the new architecture.

### Scope

- remove temporary compatibility wrappers that are no longer needed
- update README structure notes if they are stale
- add architecture notes for document repositories, studio services, shader runtime, and slicer pipeline
- add lightweight tests where newly isolated pure modules justify them

### Acceptance Criteria

- there are no misleading compatibility layers left behind
- repo documentation matches the actual structure
- the refactor leaves the codebase simpler, not just more numerous

### Validation

- `npm run check`
- `npm run build`
- final manual smoke pass across all key workflows

## Recommended Execution Order

Execute phases in this order:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8

This order matters.

- Phase 1 reduces App-level blast radius before deeper work.
- Phase 2 removes duplicated repository logic before editor workflows are moved further.
- Phase 3 makes the inspector easier to wire against slimmer services.
- Phase 4 splits the controller after the UI shell is thinner.
- Phase 5 and Phase 6 then isolate the two main runtime pipelines.
- Phase 7 is intentionally late because renderer churn is not the current bottleneck.

## Work Rules During Execution

When executing this plan:

1. Do not combine more than one major ownership rewrite in a single PR.
2. Keep temporary facades during migration, then remove them in Phase 8.
3. Prefer moving code without semantic edits first, then tighten APIs in a follow-up pass inside the same phase.
4. Add focused validation around newly isolated pure logic whenever a module becomes testable.
5. Stop a phase once the ownership goal is met. Do not opportunistically redesign adjacent systems.

## Definition Of Done

The refactor is complete when:

- `src/App.svelte` is primarily composition and wiring
- no single file owns both schema and command dispatch for the inspector
- document storage behavior is shared through one repository abstraction
- studio runtime concerns are separated into focused services
- shader runtime state is explicit and no longer hidden across broad singleton modules
- slicer phases are represented as explicit modules behind a stable facade
- the repo still passes `npm run check` and `npm run build`
- the main interactive flows behave the same or better than before