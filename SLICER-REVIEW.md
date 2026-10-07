# Slicer Review

Findings from a read-through of `src/core/slicer.ts` and `src/core/slicer/` on 2026-10-07. Two were fixed in the same change (the surface march now stops at the slice window and when the front walks out under a flat underside). What follows is what is still open, in the order it matters for a print, plus the things that are not bugs but are worth remembering.

## Open

### 1. The surface march has no self-intersection handling

`src/core/slicer/surface-march.ts`, `marchSurfaceContours` / `stepContour`.

Each revolution is the previous one pushed uphill, smoothed once, projected back. Nothing checks whether neighbouring points crossed. Wherever the uphill directions converge - every concave region of the surface: a fillet into a shoulder, a noise crater - the front forms a swallowtail, a small loop that Taubin smoothing and resampling carry along rather than remove. The inside-out test watches the loop's total signed area, so it only catches a global flip.

On the sphere and the lamp shade this never arises. On noise-displaced surfaces, expect local tangles that print as tiny back-and-forth stitches.

- Cheap mitigation: before `prepareContour` resamples, drop points whose spacing to a neighbour collapsed below a fraction of `targetSegment`. Converging points bunch up before they cross.
- Real fix: a segment-crossing pass per step, splitting out and discarding the small loop. The front is nearly planar locally, so a 2D test on the XZ projection over a neighbourhood of a few dozen points is enough.

### 2. Naive polygon offset for brim and bottom fill

`src/core/slicer/gcode.ts`, `buildBrimLoop` and `buildBottomFillLoopSet`.

Each edge is offset and the joins are mitered. There is no removal of self-intersections. Inward offsets on any concave first layer produce loops that cross themselves, and the stop test (sign flip or sub-bead area) is on the whole loop, so the crossed region is printed as doubled extrusion. Brim loops cross at concave corners the same way; the miter limit only clips the spike.

Only matters when `bottomLayers` is set or the first layer is non-convex, but both are common. A proper fix is a real offset (winding-number clip of the raw offset polygon, or a small polygon-clipping routine). Vase outlines are simple enough that the raw offset plus "keep the loop with the largest area of the right sign" would cover most of it.

### 3. End-of-print lift is a no-op

`src/core/slicer/gcode.ts`, the `G0 F6000 Z...` after the final retract moves Z to the last point's own height. The Bambu preset's end G-code lifts, the generic one does not, so a generic export leaves the nozzle sitting in the rim while it cools. Lift by a few millimetres, clamped to `maxPrintHeightMm`.

### 4. Surface mode with `bottomLayers` of 2 or more

`src/core/slicer/toolpath.ts` prints the first `flatLayerCount` contours through the flat-layer branch, which in surface mode means marched contours with per-point heights. The emitter then lays 2D fill rings for them at whatever Z is modal. The config allows the combination and it does something odd. Either reject it in `resolveVaseSettings` or clamp `bottomLayers` to 1 when `slicerMode` is `surface`.

## Remember

These are not bugs. They are places where the design makes an assumption that is easy to forget.

- **Deposit height differs between modes.** Planar samples the field half a layer below the nozzle Z (`getSliceSampleY`), which puts the bead centre on the surface. Surface mode puts the nozzle Z on the surface point itself, so the bead top is on the surface. On a wall that is a half-layer vertical shift, which on a 10 degree slope is about half a millimetre horizontally. Each convention suits its own case; a sphere sliced both ways will not line up exactly.
- **Index correspondence is an assumption.** The helix blend and `surfaceStepFlowRatio` both pair point k of one revolution with point k of the next. `alignContourLayers` only rotates. On a front that shrinks non-uniformly the pairs drift tangentially, so the measured step gains a sideways component and the flow ratio reads high. It is capped at 1, so the failure direction is slight over-extrusion, never a gap.
- **Overhang warnings are about descent, not facing.** `overhangWarnDegrees` flags a step that points below horizontal. A sloped underside (the sphere's lower half) is not flagged and should not be: the step still rises and the sideways clamp keeps each bead half on the one before. Only a flat underside stops the march, via the same `flatTopNormal` / `flatTopFraction` pair as a flat top.
- **Minimum layer time ignores brim and bottom fill.** Those moves exist only in the emitter and the preview splice, so `applyMinimumLayerTime` never sees them.
- **The cylindrical ray test counts a shared vertex twice** (`u > 1` is strict in `rayIntersectContourOuter`), so the bridging warning can trip on a vertex hit. Harmless.
- **16-bit field encoding.** The slice grid packs distances over the batch bounds' diagonal, so the resolution is about 0.005 mm at `modelScale` 50 and 0.02 mm at 200. Well under the grid pitch, but it is where precision would go first on a very large model. The point sampler used by the march encodes over a window that tracks the step size and is sub-micron.

## Verified sound

For the record, so the next review does not redo it: marching squares is correct in all sixteen cases with exact integer edge keys; the ellipse-radial pitch in `surfacePitchFor` is exactly the touching distance of two congruent bead sections; the tetrahedral gradient's `1/(4h)` scale is right; the tight-batch retry covers a flange the 24-level pre-pass missed; move merging bounds deviation against every dropped point and refuses to cross speed, flow, dwell or travel boundaries.
