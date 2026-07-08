# UI/UX Review — Implicit

*Reviewed 2026-07-08, live in Chrome (desktop 1440px, tablet 1100px, phone 390px; dark and light mode; keyboard and scripted interaction) plus code inspection.*

Overall: the fundamentals are unusually solid for a hand-rolled tool — real landmarks and live regions, a proper light/dark theme, a unified status model, per-field override resets, camera persistence. The problems are mostly about **state coherence**, **leftover developer-facing copy**, and **input ergonomics**.

---

## Critical — verified live

### 1. Typing "f" in the code editor resets the camera
> **Update 2026-07-08: fixed.** The window keydown handler now ignores the shortcut when the event target is an input, textarea, select, or contenteditable (CodeMirror), and when a modifier is held. Verified live: typing "f" in the editor preserves the camera; pressing F elsewhere still resets.
The reset shortcut is a bare `window` keydown listener with no focus guard (`src/core/renderer.ts:595-600`). Verified: with focus inside CodeMirror, dispatching an "f" keystroke snapped the stored camera from `yaw: 1.95` back to the default `0.45`. Every `float`, `if`, or `for` typed while a camera angle is set up whacks the viewport.

**Fix:** ignore the shortcut when `event.target` is an input/textarea or inside `.cm-editor`, or only handle the key when the viewport has focus.

### 2. Stale G-code survives a scene switch
> **Update 2026-07-08:** root cause found and fixed during the slicer work — `$: currentSliceSignature = buildSliceSignature()` had no visible reactive dependencies, so the signature never invalidated. Dependencies are now passed as arguments. The Download button and Update-from-cache detection now reset correctly on scene switch. The illegible toolpath-mode indicator (#3) remains open.
After generating G-code for the Default Scene and switching to Screw Thread Cylinder, the header **Download** button stays active and the Output tab still reads "Generated defaultscene-bambu-p1s-….gcode … Use Download to save locally." A user who tweaks a scene, switches, and hits Download gets the *previous scene's* toolpath — dangerous for a tool that feeds physical printers.

**Fix:** invalidate (or clearly mark stale) the generated artifact whenever scene, machine, material, or any print parameter changes.

### 3. Viewport silently stays in toolpath mode with an unreadable label
> **Update 2026-07-08: fixed.** The overlay is now cleared on scene switch (`changeScene` clears the preview points). A "Hide/Show Toolpath" toggle appears in the viewport toolbar whenever a toolpath exists (wired to the previously orphaned `workspace.toggleOverlay()`), and the "Toolpath in scene" label is rendered as light green text on a dark pill — legible in both themes. Verified live: toggle works, scene switch clears the overlay to fully transparent.
After Generate, the viewport switches to the green toolpath render — and it keeps showing the *old scene's* toolpath after a scene switch. The only indicator is canvas-drawn text in the bottom-left, dark green on dark navy (had to enhance a screenshot to read it: "Toolpath in scene"). Meanwhile the VIEW dropdown still says "Shaded" — the single source of truth for view mode is wrong, and the actual mode indicator is illegible.

**Fix:** make toolpath preview a real state of the VIEW control (or an obvious toggle chip in the viewport toolbar); render the mode label in UI-contrast colors.

### 4. Print-tab inputs load in an invalid state with float garbage
> **Update 2026-07-08: fixed.** `formatNumberFieldValue` (in `src/ui/inspector/commit.ts`) rounds the *displayed* value to the field's step precision (fallback: 6 significant digits when no step); committed values are untouched. Verified live on both the default and screw-thread scenes: 0 invalid inputs, clean values (e.g. auto-fit Min Y shows `-0.13` instead of `-0.12857142857142856`).
Four number inputs on the Print tab are `:invalid` on load — values like `-0.12857142857142856` against `step="0.01"`, and min/max attributes like `1.2000000476837158`. Float32→float64 noise is written raw into `value`/`min`/`max`. Consequences: 17-digit values when the user clicks a field, odd spinner snapping, form invalid before the user touches anything.

**Fix:** round to the field's step precision when populating inputs — the schema in `src/ui/inspector/tabs.ts` already knows each field's `step`.

---

## Major UX

### 5. Development changelog copy has leaked into the UI
> **Update 2026-07-08: fixed.** Inspector subtitle now reads "Scene, render, and print settings for the active surface."; the four changelog-style section captions in `tabs.ts` (Scene Controls, Adhesion And Merge, Machine, Material) were rewritten to describe the feature.
The Inspector subtitle: "Task-oriented tabs replace the old stacked form so the viewport can stay dominant" (`src/components/InspectorPanel.svelte:23`). Section blurbs follow the same pattern: "Brim and simplification controls stay together in the print workflow," "Scene choice and surface visualization stay close to the viewport workflow." These justify the redesign to a reviewer; they tell a user nothing. Delete or rewrite to describe the feature.

### 6. Shader status pill is developer-speak and reflows the header
> **Update 2026-07-08: partially fixed.** The pill now uses the scene's display label ("Shader: Loaded Screw Thread Cylinder" instead of "LOADED SCENE: SCREWTHREADCYLINDER"). The pill already had `max-width` + ellipsis, so with the shorter copy it no longer wraps the header at 1440px. A fixed-width/icon treatment remains an option if longer scene names still feel noisy.
After a scene switch it reads `SHADER: LOADED SCENE: SCREWTHREADCYLINDER` — an uppercased internal id. The pill grows with content; at 1440px it pushed MATERIAL onto a second row and shifted the whole header. Status text should be short, human ("Ready", "Compiled Screw Thread Cylinder"), and stable in width (`src/components/TopBar.svelte:79`).

### 7. No sliders anywhere
> **Update 2026-07-08: fixed.** Every numeric field with finite min/max now renders a slider next to the number input (`.field-row-slider` three-column layout). Sliders commit on `input` for live feedback while dragging; the number input keeps commit-on-change for precision. Verified live: dragging Layer height updates the value, summary chips, and resolved config in real time.
Every numeric parameter in a live-preview shader playground is a `type=number` spinner (zero `type=range` in the codebase). The core loop — nudge a value, watch the surface — currently requires click → type → commit-on-change per attempt. Draggable sliders (or Blender-style scrub-on-drag on labels) would transform the tool. **Highest-leverage improvement on this list.**

### 8. Duplicated controls with no clear hierarchy
- Scene and View settable in top bar *and* inspector Scene tab
- Generate in viewport toolbar *and* Output tab
- Download in header *and* Output tab
- "Hide Editor" twice (editor panel header + viewport toolbar)
- WORKSPACE and COMMANDS footer panels showed the identical "Generated …gcode" message side by side

Duplication doubles the surface where state can disagree (see #2). Pick one home per action; make the footer panels report different things or merge them.

### 9. `window.prompt()` for naming scenes and files
`src/App.svelte:1121, 1149, 1205`. Native prompts can't be styled, can't validate inline (slug rules, collisions), and look broken next to an otherwise polished dark UI. Use a small inline form in the editor header.

### 10. No build-volume sanity check
> **Update 2026-07-08: fixed.** The Print tab summary now has a "Part" chip showing the estimated printed envelope (slice window x scale, plus brim). When the footprint exceeds the machine bed it switches to an amber warn style and reads "~354 x 45 mm - exceeds bed". Verified live with Screw Thread Cylinder on the Bambu P1S.
Screw Thread Cylinder ships with Outer diameter 350mm while the selected machine is a Bambu P1S (256mm bed). No warning at parameter-entry or Generate time. The app knows machine dimensions — show a "part exceeds build volume" badge near the summary chips.

### 11. Compact layouts lose the tune-while-watching loop
Below the 1180px breakpoint (`styles.css:1081`) everything stacks in one column with a tall viewport on top, so adjusting any parameter scrolls the model off-screen. Consider keeping the inspector beside the viewport down to ~900px, or a bottom-sheet pattern. On a phone (390px) the top bar alone consumes two-thirds of the first screen.

### 12. The 3D camera is mouse-only
Handlers are `mousedown/mousemove/wheel` (`src/core/renderer.ts:523-593`) — no pointer/touch events, so on tablets and phones (and this is publicly deployed on GitHub Pages) you cannot orbit at all. Switching to Pointer Events covers mouse + touch + pen in one code path.

---

## Polish and accessibility

13. **Tabs aren't tabs.** Inspector tab bar uses `aria-pressed` buttons instead of `role="tablist"/"tab"/"tabpanel"` with arrow-key nav (`src/components/InspectorPanel.svelte:32`). Related: buttons like "Hide Editor" both change label *and* carry `aria-pressed` — announced as "Hide Editor, pressed," which is contradictory. Use static label + `aria-pressed`, or changing label with no pressed state.
14. **Five form fields lack `id`/`name`** (Chrome flags on load) — breaks autofill heuristics and label association (top-bar selects). *Fixed 2026-07-08: ids/names added to the four top-bar selects and the editor file select; Chrome reports zero form-field issues.*
15. **`↺` override-reset button has `title` but no `aria-label`** (`src/components/inspector/InspectorSchemaTab.svelte:45-52`) — invisible to screen readers; `title` doesn't show on touch. *Fixed 2026-07-08: per-field `aria-label` added.*
16. **Editor resize handle has no keyboard handler** while the inspector one supports Arrow/Home (`src/App.svelte:1357-1374`). Neither uses `role="separator"` + `aria-valuenow`.
17. **No `prefers-reduced-motion` support**, and the raymarch loop renders continuously when idle — a11y and battery. Pause the render loop when nothing changes.
18. **Select widths truncate their own options**: "Planar contour (s…", "Screw Thread Cy…" at default inspector width.
19. **Cmd+S only saves when focus is inside CodeMirror** (`src/components/DocumentEditorPanel.svelte:127-144`); with a dirty file and focus elsewhere it opens the browser save-page dialog. Handle at window level when any document is dirty.
20. **Locale mismatch in numerals**: number inputs render "0,2" (browser locale) while summary chips show "0.20 mm" — same value, two formats on one screen.
21. **In fullscreen preview, "Hide Editor"/"Hide Inspector" remain** and toggle state you can't see. Hide them while expanded. *Fixed 2026-07-08: the two panel toggles are hidden in fullscreen; Generate, Exit Preview, Reset View, and the toolpath toggle remain.*
22. **"SCENE EDITOR" and "FOLDER SYNC" chips are styled like buttons** but are static text — they read as dead controls. Distinguish badges from buttons.

---

## What's working well

Keep as-is: semantic structure (header/main/aside/footer, one h1, labeled regions); `role="status"` live regions for shader state and diagnostics; fully-ARIA'd progress bar with phase + ETA; genuine light-mode support including a light CodeMirror theme (verified); visible focus styles; text contrast (everything measured ≥ 6.3:1); per-field override `↺` with bulk reset; folder-sync reconnect flow.

## Suggested priority

1. Items **1, 2, 4** — small, well-localized correctness fixes (f-key guard, stale-gcode invalidation, float rounding).
2. Item **3** — view-mode coherence (medium).
3. Items **5, 6** — copy pass (an hour of editing).
4. Item **7** — sliders/scrubbing (biggest UX payoff).
5. Items **8–12**, then the polish list.
