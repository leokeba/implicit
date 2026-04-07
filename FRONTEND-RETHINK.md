# Frontend Rethink

## Current Problems

The current UI reads like a small demo page instead of a production tool.

- The page shell in [index.html](index.html) uses a marketing-style header and a centered content column, which makes the viewport feel secondary instead of primary.
- The layout in [styles.css](styles.css) caps the experience inside a narrow canvas with generous decorative padding, gradients, and card chrome that consume space without improving workflow.
- The inspector in [src/ui/controls.ts](src/ui/controls.ts) is a single long form with every control rendered in one pass. It is hard to scan, hard to extend, and does not match how slicers or CAD tools organize tasks.
- The preview in [src/ui/preview.ts](src/ui/preview.ts) is already the strongest part of the app, but the surrounding shell does not give it enough room or enough status context.
- Rendering controls, viewport tuning, animation knobs, machine setup, material setup, slicing setup, and export actions are mixed together without a workflow model.

This creates two separate failures:

1. Visually, the app feels like a landing page with a demo panel.
2. Functionally, the control model does not map to how users think about modeling, slicing, and exporting.

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
| Nav |                                                             | Inspector    |
| rail|                         Main viewport                        | tabs         |
|     |                                                             |              |
|     |                                                             | active tab   |
|     |                                                             | content      |
+-----+-------------------------------------------------------------+--------------+
| Bottom strip: messages | benchmark results | export stats | camera hints        |
+----------------------------------------------------------------------------------+
```

### Layout Rules

- The viewport should occupy roughly 70 to 80 percent of desktop width by default.
- The app should use the full browser height with minimal outer margins.
- The inspector should be a docked panel on the right, around 360 to 420 px wide.
- The bottom strip should be collapsible. Use it for slicer/export status, benchmark output, and shader compiler messages.
- A narrow left rail should hold mode switches and utility actions, not dense parameter controls.
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

## Frontend Refactor Recommendation

The main implementation problem is structural, not only visual.

Right now, [src/ui/controls.ts](src/ui/controls.ts) builds the entire inspector procedurally in one method. That makes tabbing, conditional sections, persistence, and per-tab rendering harder than they need to be.

### Recommended Refactor

Split the current UI into four concerns:

1. App shell
   Handles top bar, left rail, viewport region, right inspector, and bottom status strip.
2. Inspector state
   Tracks active tab, collapsed groups, temporary field state, and persisted UI preferences.
3. Control schema
   Define each tab and field group as data, not as one long imperative block.
4. Status model
   Centralize shader status, export status, and benchmark results so they can be rendered in dedicated regions.

### Suggested Modules

- `src/ui/app-shell.ts`
- `src/ui/inspector.ts`
- `src/ui/control-schema.ts`
- `src/ui/status-bar.ts`
- `src/ui/viewport-toolbar.ts`

The existing [src/ui/preview.ts](src/ui/preview.ts) can remain mostly intact, but it should render inside a new viewport workspace shell.

## Framework Recommendation

For this app, the recommended medium-term stack is:

1. keep Vite as the build tool
2. keep the renderer, shader pipeline, preview canvas, and slicer in plain TypeScript modules
3. use Svelte for the application shell and inspector UI when the UI rewrite moves beyond the first pass

### Why Svelte Over Solid Here

- Svelte is a better fit for a practical migration from the current imperative DOM UI.
- The app's bottlenecks are layout, composition, and workflow clarity, not fine-grained reactive performance.
- Svelte will make it easier to build docked panels, tabs, collapsible groups, and persistent UI state without changing the rendering core.
- Solid is still a valid option if learning Solid is a project goal, but it is the riskier choice for a tool UI rewrite where the main goal is shipping.

### Immediate Implementation Strategy

Do not block the redesign on a framework migration.

The right near-term move is:

1. implement the new shell and tabbed inspector in the current codebase now
2. stabilize the information architecture and workspace behavior
3. migrate the shell and inspector to Svelte later if the UI keeps growing

That keeps momentum high while still pointing the codebase toward a better long-term frontend structure.

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
- Add a compact top command bar instead of a large title block.
- Add a scene info block in the viewport with current scene name and view mode.
- Add a dedicated overlay toggle between rendered surface and generated toolpath.
- Add preset reset actions inside each tab instead of one global mental model.

## Phased Implementation Plan

### Phase 1

- Replace the page-centered shell with a full-screen workspace layout.
- Move shader status to a top bar or bottom strip.
- Give the viewport dominant space.

### Phase 2

- Replace stacked cards with right-docked tabbed inspector.
- Re-group current controls into Scene, Camera, Render, Print, Machine, Material, and Output.

### Phase 3

- Extract control definitions into a schema-driven structure.
- Add persistent UI state for tabs, collapses, and layout preferences.

### Phase 4

- Add viewport toolbar, overlay toggles, status log, and resizable dock.
- Tighten typography, spacing, and panel contrast to finish the workstation feel.

## Recommendation

Do not iterate on the current card stack. Replace the shell and inspector model outright.

The fastest path to a better result is:

1. make the app full-height and viewport-dominant
2. replace stacked sections with task tabs
3. move status into dedicated chrome
4. refactor controls into smaller UI modules before adding more features

That will solve both of the current problems: the UI will look more like a real tool, and the frontend code will become maintainable enough to keep evolving.