# AGENTS.md

Context and working agreements for anyone (human or agent) making changes to this repository.

## What This Project Is

Implicit is a browser-based studio for designing implicit surfaces (SDF-style GLSL scenes), previewing them with realtime raymarching, and slicing them directly into vase-mode G-code. The whole pipeline runs in the browser: WebGL for rendering and GPU-assisted slicing, TypeScript for toolpath construction, postprocessing, and G-code emission.

The product vision is **code-first, reproducible fabrication**: scene source files and their configuration should be a complete, committable record of how a printable artifact was produced. The UI is an exploration and verification surface, not the source of truth.

## Working Agreements

1. **This is a personal project with exactly one user.** There are no external consumers, no API stability promises, and no migration burden to carry.
2. **Backwards compatibility is a non-goal.** When a design improves the project, break the old format and delete the legacy path in the same change. Do not add compatibility shims, dual-format parsers, deprecation cycles, or "v1/v2" branches. Stale scenes or scripts get migrated by hand (there are about a dozen of them).
3. **Reproducibility beats convenience.** Anything that affects the final G-code should be expressible in committed source files. Session-only UI state is fine for exploration, but never as the only home for print-relevant configuration.
4. **Prefer deleting code over keeping it "just in case".** Dead branches, unused fallbacks, and parsing for retired formats should be removed when found.
5. **Keep heavy compute out of the UI layer.** Rendering, slicing, and shader composition live in plain TypeScript modules under `src/core/`; Svelte components only wire state and actions.

## Commands

```
npm run dev      # Vite dev server on port 3000 (required for filesystem document sync)
npm run check    # svelte-check + TypeScript — primary static validation
npm run build    # production build — second validation gate
```

There is no test framework. Validation is `npm run check`, `npm run build`, plus a manual smoke pass in the dev server: switch scenes, edit shader source, edit a postprocess script, slice/export, check the toolpath overlay.

## Architecture Map

- `src/scenes/<id>/` — **a scene is a folder**: `scene.glsl` (the implicit surface, `mapScene(vec3 p)`) plus an optional `scene.ts` orchestration manifest (`defineScene({...})` from `implicit/scene`) declaring uniforms, params, fields, slicer config, a pure `preprocess()` for computed defaults, and the postprocess pipeline. Uniform declarations are injected into the GLSL from the manifest.
- `src/scene-runtime/` — the `implicit/scene` module (tsconfig path alias): `defineScene`, `usePostprocess`, manifest normalization, and all authoring types. Scene manifests are type-checked by `npm run check` and evaluated at runtime via the script host.
- `src/core/script-host.ts` — shared in-browser TS compile/eval (`ts.transpileModule` + `new Function` with a `require` shim) for manifests and postprocess scripts.
- `src/core/scene-manifest.ts` — evaluates a scene folder's TS modules into a normalized manifest (supports scene-local `./module` imports).
- `src/core/shader-pipeline.ts` — module-level scene registry (folders + manifests) and shader composition by substituting `__SCENE_GLSL__`-style placeholders in templates from `src/shaders/`.
- `src/core/postprocess-registry.ts` — generic script registry plus pipeline resolution (manifest steps -> resolved transforms with effective params).
- `src/core/toolpath-postprocess.ts` — pipeline executor: builds the `transform(context)` context, runs steps in order, validates returned points.
- `src/studio-controller.ts` — facade between UI and core. Owns the **configuration ladder** (slicer defaults -> printer/filament presets -> manifest slicer block -> `preprocess()` -> sparse session overrides) and the per-scene override maps; emits the reproducibility header (`IMPLICIT_BLOCK_*`) into exported G-code.
- `src/core/renderer.ts` — realtime raymarch viewport (WebGL). `src/core/slicer.ts` — GPU contour sampling, toolpath build, move merging, G-code emission; largest and most performance-sensitive file.
- `src/postprocess-scripts/*.ts` — generic toolpath scripts exporting `controls` + `transform(context)`, referenced from manifests via `usePostprocess(id, params)`.
- `src/printers/models/*.json`, `src/filaments/profiles/*.json` — printer and filament presets, referenced by id from manifests.
- `src/ui/`, `src/components/` — Svelte 5 UI: inspector schema (override badges + reset), document sync, workspace store, panels.
- `vite.config.ts` — also hosts the dev-server file API (`/__implicit_api/scenes/<id>/<file>`, `/__implicit_api/postprocess-scripts`) that lets the in-app editors read/write real files. Without the dev server the app is read-only on bundled sources (no browser-draft storage; files are the only source of truth).

## Conventions

- TypeScript everywhere, explicit interfaces for cross-module contracts, 4-space indentation (`vite.config.ts` is the 2-space exception).
- Defensive parsing at boundaries: user-authored content (GLSL metadata, scripts, stored JSON) is parsed with `unknown`-typed payloads and normalization helpers that return `null` on bad input rather than throwing.
- User script failures must surface as readable status messages in the UI, never as silent fallbacks.
- Untracked scratch output goes to `.tmp/`.

## Planning Documents

Design history and direction live in markdown at the repo root. Read before large structural changes:

- `REFACTOR-PLAN.md` — modularization plan (App.svelte shrink, service extraction, document layer dedup).
- `FRONTEND-RETHINK.md` — UI direction: viewport-first workstation layout.
- `SCENE-ORCHESTRATION-PLAN.md` — current phase: scene = GLSL + TS orchestration module pair.
