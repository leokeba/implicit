# UI/UX Review — Implicit

*Reviewed 2026-10-08 in headless Chrome at 1440×900, 1180×800, 1024×768, 820×1180 and 390×844, dark and light. Supersedes the 2026-07-08 review, whose correctness and accessibility items were all resolved.*

## Findings

1. **The viewport lost the space budget.** At 1440 it got about a third of the screen; at 1024×768 it was 638×149 and the inspector's first field sat below its own visible area. Causes: the editor docked to the side only at ≥1440px and otherwise docked under *both* viewport and inspector; a non-collapsible 106–124px footer of four cards (one of them static help text); a top bar that wrapped to three rows below ~1300px; and a padded, bordered frame around the canvas.
2. **Below 980px the app became a scrolling page** (≈2000px tall on a phone), and the phone layout overflowed horizontally (413px layout in a 390px screen).
3. **No type system.** Twelve font sizes on one screen; toolbar and editor buttons at the browser-default 16px regular next to 12.8px semibold tabs.
4. **The declared font never loaded.** IBM Plex was named in CSS but never loaded or installed, so macOS rendered Avenir Next.
5. **Everything was a bordered box** (top-bar fields, chips, inspector groups inside the inspector, footer cards, the viewport frame), with uppercase tracked labels at equal weight everywhere and no visually primary action.
6. **Explanatory copy ate vertical space**, and one note (planar vs. cylindrical) lived in the wrong tab.
7. **The editor header took 230px** before the first line of code: six text buttons, two badges, a helper paragraph and a status line.
8. **Eight inspector tabs could not fit one row**, and summary chips repeated values shown right next to them.
9. **Portrait viewports cropped the model sideways**: the focal length framed the viewport height only.

## Changes made

- **Layout modes** (`src/app/layout-mode.ts`): *wide* ≥1280 (editor | viewport | inspector); *medium* (viewport | one side panel switching Parameters/Code); *narrow* (≤760 or portrait: viewport above that panel). The bottom-docked editor and its height state are gone, and the editor panel renders from one prop set.
- **Shell**: 44px single-row top bar (scene, then machine/material, then Generate/Download/Print); edge-to-edge viewport; 26px status bar with shader dot (click for diagnostics, auto-opens on compile error), command/progress line, workspace status and a `?` controls popover.
- **Viewport toolbar**: view-mode select moved here; icon buttons with static labels and `aria-pressed` (reset, toolpath, fullscreen, editor, side panel).
- **Editor header**: one row (wraps in narrow panels) with Scene/Scripts switch, file picker, unsaved dot, icon tools and Save; status moved to a 24px footer.
- **Inspector**: header removed; underline tabs merged to Scene · View · Slice · Printer · Postprocess · Output; groups are flat sections; summary chips are an inline mono stat line; duplicate summaries removed; slicer-mode note moved to Slice.
- **Visual system** (`styles.css`, rewritten): IBM Plex Sans/Mono self-hosted via `@fontsource`; 11/12/13/15px scale; 28px controls (34px on coarse pointers); one filled primary action; quiet selects on chrome; custom slider track and thumb.
- **Renderer**: focal length frames the shorter side in both the raymarch shader and the toolpath overlay, so portrait viewports keep the full model width.
- **Toolpath legend** starts collapsed in the narrow layout.

## Still open

- **Scrubbable number fields** (drag the label to change the value) in place of the slider + input pair.
- **Narrow split ratio** is fixed at 52% for the panel; a drag handle would help on phones.
- **Machine/material in the top bar** could become one "P1S · ABS" popover, freeing more room at medium widths.
- **Shaded view** looked flat under SwiftShader; confirm the lighting on a real GPU.
- **Light-mode `SliceDebugView`** still uses hard-coded dark colours.
