# Frontend Rethink

## Status Update

The first major rewrite is now in place.

- The app shell is full-height and viewport-dominant.
- The UI now runs on Svelte while the renderer, preview, shader pipeline, and slicer remain plain TypeScript modules.
- The inspector is split into focused Svelte components under `src/components/` and `src/components/inspector/`.
- The duplicated left-side tab rail has been removed. The inspector now owns the only tab model.
- Shared inspector tab, section, summary, and field definitions now live in `src/ui/inspector-schema.ts`.

That means this document should now be read as a record of direction plus the next frontier, not as a proposal for the first rewrite.

## Current Problems

The app is no longer a marketing-style demo shell, but it still has several structural gaps before it feels like a polished production tool.

- The top-level state in `src/App.svelte` is still too broad. The shell is componentized, but state and action wiring are still centralized in one large container.
- The inspector fields are grouped better, but the interaction model is still mostly raw forms rather than a tool workflow with presets, summaries, and contextual actions.
- The right dock is static width. It should behave more like a real workstation panel.
- The viewport still behaves mostly like a passive canvas region. It needs richer in-viewport tooling and overlay controls.
- Benchmark, export, shader, and scene feedback are visible, but they are not yet modeled as a coherent command or status system.

This creates two separate failures:

1. The UI now looks like a tool, but it does not yet behave like a tightly integrated one.
2. The code is more maintainable, but the next layer of frontend architecture has not been extracted yet.

## Product Direction

The app should feel like a lightweight desktop tool for implicit modeling and vase slicing.

The right reference is not a marketing page. It is closer to a simplified mix of:

- a slicer application
- a DCC or CAD viewport workspace
- a shader tool with a docked inspector

The core principle should be:

**viewport first, inspector second, status always visible, decorative UI minimized**

## Proposed Layout

Use a full-height application shell instead of a centered page.

```text
+----------------------------------------------------------------------------------+
| Top bar: project name | scene preset | view mode | quick actions | shader state |
+-----+-------------------------------------------------------------+--------------+
|                                                             | Inspector        |
|                         Main viewport                        | tabs             |
|                                                             |                  |
|                                                             | active tab       |
|                                                             | content          |
+-------------------------------------------------------------+------------------+
| Bottom strip: messages | benchmark results | export stats | camera hints        |
+----------------------------------------------------------------------------------+
```

### Layout Rules

- The viewport should occupy roughly 70 to 80 percent of desktop width by default.
- The app should use the full browser height with minimal outer margins.
- The inspector should be a docked panel on the right, around 360 to 420 px wide.
- The bottom strip should be collapsible. Use it for slicer/export status, benchmark output, and shader compiler messages.
- Do not duplicate tab navigation outside the inspector. The active task model should live in one place.
- On smaller screens, the right inspector should become an overlay drawer rather than pushing the viewport down.

## Information Architecture

The current section model should be replaced with task-oriented tabs.

### Recommended Tabs

1. Scene
   Scene preset, scene-specific parameters, view mode, object framing, scene defaults.
2. Camera
   Orbit speed, pan speed, dolly speed, focal length, fit/reset actions.
3. Render
   Max steps, hit epsilon, step scale, normal epsilon, refine steps, animation throttling.
4. Print
   Core slicing geometry: min or max Y, scale, layer height, line width, points per layer, slice bounds, slice resolution.
5. Machine
   Printer model, bed size, center offsets, travel speed, max height, start and end G-code.
6. Material
   Filament profile, nozzle temp, bed temp, fan, flow, print speed.
7. Output
   Generate G-code, benchmark, output summary, last export metadata, toolpath overlay toggle.

This does three things:

- It reduces cognitive load by grouping settings by user intent.
- It makes the panel feel like a professional inspector instead of a form dump.
- It creates a stable framework for adding scene-specific controls later.

## UI Behavior

### Viewport

- Keep the viewport nearly fullscreen on desktop.
- Add a compact viewport toolbar in the top-left corner of the canvas for fit, reset, overlay toggle, and shading mode.
- Keep the toolpath overlay available as a first-class visualization mode, not just an aftereffect of export.
- Add an optional camera HUD in the bottom-left of the viewport with camera distance, focal length, and active scene.

### Inspector

- Tabs should be horizontal at the top of the inspector.
- Within a tab, use grouped subsections with compact headers rather than independent card blocks.
- Long groups should use collapsible fieldsets.
- Numeric inputs should support scrubby drag or step buttons later, but simple typed inputs are fine for phase one.
- Preset selectors should stay pinned near the top of their relevant tab.

### Status and Output

- Move shader compilation state out of the hero header and into a real status area.
- Show benchmark summaries in the bottom strip where they can wrap without destroying the inspector layout.
- Show export results as structured metadata: filename, size, point count, layer count, timing.
- Keep transient success messages low-noise. Use a log-like panel for verbose output.

## Visual Direction

The visual language should shift from soft promotional cards to neutral workstation chrome.

### Recommended Style

- Use a restrained graphite or stone UI shell with one accent color for active controls and overlays.
- Remove the large radial background gradients from the app shell.
- Reduce border radii. The current rounded cards make the UI feel consumer and soft.
- Use stronger hierarchy through spacing, panel contrast, and typography rather than decorative surfaces.
- Keep IBM Plex Sans if desired, but pair it with IBM Plex Mono for status, dimensions, and benchmark output.
- Prefer compact controls and denser spacing similar to slicers, without becoming cramped.

### What To Avoid

- Hero sections
- marketing copy above the tool
- oversized page margins
- every section styled as an isolated card
- decorative gradients competing with the canvas

## Frontend Architecture Recommendation

The first structural rewrite is done. The next implementation problem is state architecture rather than raw layout.

Right now, `src/App.svelte` coordinates the whole shell and dispatches state to inspector tab components through props. That is acceptable for the first Svelte pass, but it will get brittle once scene-specific controls, overlay toggles, dock resizing, and richer status systems are added.

### Current Structure

- App shell layout lives in `src/components/TopBar.svelte`, `src/components/ViewportPanel.svelte`, `src/components/InspectorPanel.svelte`, and `src/components/StatusStrip.svelte`.
- Inspector tabs live in `src/components/inspector/`.
- Shared inspector schema metadata lives in `src/ui/inspector-schema.ts`.
- Rendering, preview, and slicing remain outside Svelte in plain TypeScript modules.

### Next Refactor

Split the current frontend into four explicit concerns:

1. App shell
   Handles layout, docking, responsive behavior, and viewport chrome.
2. Workspace state
   Tracks active tab, inspector open state, persisted UI preferences, active scene, view mode, and current tool status.
3. Inspector schema
   Defines tabs, sections, fields, presets, summaries, and scene-conditional controls as data.
4. Command and status model
   Centralizes shader status, export status, benchmark results, validation, and toast/log output.

### Suggested Modules

- `src/ui/workspace-store.ts`
- `src/ui/inspector-schema.ts`
- `src/ui/status-model.ts`
- `src/ui/commands.ts`
- `src/components/viewport/` for toolbar and HUD pieces

The existing preview and renderer modules should remain imperative islands. The goal is not to pull WebGL into Svelte. The goal is to give Svelte a cleaner, smaller state contract.

## Current Stack Recommendation

The current stack is the right one:

1. keep Vite as the build tool
2. keep the renderer, shader pipeline, preview canvas, and slicer in plain TypeScript modules
3. use Svelte for the application shell, inspector, status chrome, and interaction workflows

### Why Svelte Over Solid Here

- Svelte is a better fit for a practical migration from the current imperative DOM UI.
- The app's bottlenecks are layout, composition, and workflow clarity, not fine-grained reactive performance.
- Svelte will make it easier to build docked panels, tabs, collapsible groups, and persistent UI state without changing the rendering core.
- Solid is still a valid option if learning Solid is a project goal, but it is the riskier choice for a tool UI rewrite where the main goal is shipping.

### Immediate Strategy From Here

Do not do another broad visual rewrite yet.

The next wins should be interaction and architecture wins:

1. reduce prop drilling with a small workspace store
2. add dock resizing and persistent layout preferences
3. improve viewport-local tooling and overlays
4. evolve the inspector from field groups into a richer workflow surface

## Practical Control Grouping From Current Code

The existing controls already suggest a cleaner grouping.

### Scene tab

- scene select
- view mode select

### Camera tab

- orbit sensitivity
- pan sensitivity
- wheel zoom sensitivity
- dolly sensitivity
- fit view action

### Render tab

- max steps
- hit epsilon
- max distance
- focal length
- step scale
- min step
- normal epsilon
- refine steps
- target FPS
- frame periodicity

### Print tab

- slicer mode
- min Y and max Y
- model scale
- layer height
- nozzle diameter
- line width
- first layer line width
- points per layer
- max radius
- radial steps
- brim width and gap
- merge controls

### Machine tab

- printer model
- bed width and depth
- max print height
- center X and Z
- travel speed
- start G-code
- end G-code

### Material tab

- filament profile
- filament diameter
- nozzle temp
- bed temp
- fan
- flow rate
- print speed
- first layer speed

### Output tab

- generate button
- benchmark controls
- structured result summary

## Interaction Upgrades Worth Adding

These would make the app feel materially closer to a slicer or CAD tool.

- Persist active tab and inspector width in local storage.
- Add keyboard shortcuts for fit view, toggle inspector, and toggle overlay.
- Add resizable right dock with a drag handle.
- Add a compact command/search surface for scene switching, export, benchmark, and view actions.
- Add a scene info block in the viewport with current scene name and view mode.
- Add a dedicated overlay toggle between rendered surface and generated toolpath.
- Add preset reset actions inside each tab instead of one global mental model.
- Add tab summaries so users can see current printer, material, and render quality at a glance without opening every tab.
- Add field validation and affordances for invalid slicing ranges instead of silently accepting bad combinations.
- Add scene-aware controls so a scene can declare optional UI beyond the generic field set.

## What Comes Next

The next phase should be less about repainting and more about tightening the tool.

### 1. Workspace Store

Move shell and inspector UI state out of `src/App.svelte` into a dedicated store.

This store should own:

- active inspector tab
- inspector collapsed state
- inspector width
- active scene label and view label
- benchmark and export activity state
- shader status and diagnostic text
- persisted UI preferences

That will remove a large amount of prop wiring and make future dock and command interactions easier.

### 2. Resizable Right Dock

The inspector should feel like a workstation dock, not a fixed sidebar.

Add:

- a drag handle between viewport and inspector
- min and max width constraints
- local storage persistence
- double-click reset to default width

### 3. Viewport-Local Tools

Important actions should live closer to the canvas.

Add:

- overlay toggle
- camera HUD
- current scene badge
- current preset summary badge
- fit or frame selected action

The canvas should become the center of the workflow, not just the place where pixels happen.

### 4. Inspector Summaries Instead Of Only Inputs

Each tab should start with a compact summary row before the detailed fields.

Examples:

- Scene: active scene, shading mode
- Render: max steps, quality profile
- Print: layer height, line width, points per layer
- Machine: active printer, bed size
- Material: active filament, temperature tuple
- Output: last export, last benchmark

This is one of the key differences between a tool UI and a simple form UI.

### 5. Scene-Declared UI Extensions

Long term, scene presets should be able to declare extra UI metadata rather than relying only on the generic inspector fields.

That likely means extending the shader pipeline metadata layer so a scene can advertise:

- scene-specific parameter fields
- display ranges and labels
- parameter groups
- optional advanced sections

This is the bridge from "generic slicer shell" to "implicit modeling workstation".

## Phased Implementation Plan

### Phase 1: Completed

- Replace the page-centered shell with a full-screen workspace layout.
- Move shader status to a top bar or bottom strip.
- Give the viewport dominant space.

### Phase 2: Completed

- Replace stacked cards with right-docked tabbed inspector.
- Re-group current controls into Scene, Camera, Render, Print, Machine, Material, and Output.

### Phase 3: Completed In First Pass

- Move the shell and inspector to Svelte.
- Split the inspector into focused components.
- Remove duplicated navigation models.

### Phase 4: Next

- Introduce a dedicated workspace store.
- Add resizable inspector dock.
- Persist dock width and shell preferences.
- Move status and command behavior into a cleaner frontend state model.

### Phase 5: After That

- Extract control definitions into a schema-driven structure.
- Add scene-declared control metadata and richer tab summaries.
- Add validation, presets, and workflow affordances.

### Phase 6: Finish Pass

- Add viewport toolbar, overlay toggles, status log, and resizable dock.
- Tighten typography, spacing, and panel contrast to finish the workstation feel.

## Recommendation

Do not iterate on the current card stack. Replace the shell and inspector model outright.

The fastest path to a better result from the current state is:

1. move shell state into a dedicated workspace store
2. add dock resizing and viewport-local actions
3. evolve the inspector from grouped inputs into task summaries plus controls
4. add scene-aware metadata so the tool can grow without turning App state into a knot

That will solve the next two problems: the app will feel more like a real desktop tool during use, and the frontend will stay maintainable as scene-specific UI and deeper workflows arrive.