# Slicer Review

Findings from a read-through of `src/core/slicer.ts` and `src/core/slicer/` on 2026-10-07. Three were fixed as they were found: the surface march now stops at the slice window, stops when the front walks out under a flat underside, and trims the folds a stepped front makes at concave parts of the surface (`trimFrontFolds`). What follows is what is still open, in the order it matters for a print, plus the things that are not bugs but are worth remembering.

## Open

### 1. Naive polygon offset for brim and bottom fill

`src/core/slicer/gcode.ts`, `buildBrimLoop` and `buildBottomFillLoopSet`.

Each edge is offset and the joins are mitered. There is no removal of self-intersections. Inward offsets on any concave first layer produce loops that cross themselves, and the stop test (sign flip or sub-bead area) is on the whole loop, so the crossed region is printed as doubled extrusion. Brim loops cross at concave corners the same way; the miter limit only clips the spike.

Only matters when `bottomLayers` is set or the first layer is non-convex, but both are common. A proper fix is a real offset (winding-number clip of the raw offset polygon, or a small polygon-clipping routine). Vase outlines are simple enough that the raw offset plus "keep the loop with the largest area of the right sign" would cover most of it.

### 2. End-of-print lift is a no-op

`src/core/slicer/gcode.ts`, the `G0 F6000 Z...` after the final retract moves Z to the last point's own height. The Bambu preset's end G-code lifts, the generic one does not, so a generic export leaves the nozzle sitting in the rim while it cools. Lift by a few millimetres, clamped to `maxPrintHeightMm`.

### 3. Surface mode with `bottomLayers` of 2 or more

`src/core/slicer/toolpath.ts` prints the first `flatLayerCount` contours through the flat-layer branch, which in surface mode means marched contours with per-point heights. The emitter then lays 2D fill rings for them at whatever Z is modal. The config allows the combination and it does something odd. Either reject it in `resolveVaseSettings` or clamp `bottomLayers` to 1 when `slicerMode` is `surface`.

## Remember

These are not bugs. They are places where the design makes an assumption that is easy to forget.

- **Deposit height differs between modes.** Planar samples the field half a layer below the nozzle Z (`getSliceSampleY`), which puts the bead centre on the surface. Surface mode puts the nozzle Z on the surface point itself, so the bead top is on the surface. On a wall that is a half-layer vertical shift, which on a 10 degree slope is about half a millimetre horizontally. Each convention suits its own case; a sphere sliced both ways will not line up exactly.
- **Index correspondence is an assumption.** The helix blend and `surfaceStepFlowRatio` both pair point k of one revolution with point k of the next. `alignContourLayers` only rotates. On a front that shrinks non-uniformly the pairs drift tangentially, so the measured step gains a sideways component and the flow ratio reads high. It is capped at 1, so the failure direction is slight over-extrusion, never a gap.
- **Overhang warnings are about descent, not facing.** `overhangWarnDegrees` flags a step that points below horizontal. A sloped underside (the sphere's lower half) is not flagged and should not be: the step still rises and the sideways clamp keeps each bead half on the one before. Only a flat underside stops the march, via the same `flatTopNormal` / `flatTopFraction` pair as a flat top.
- **Fold trimming is a tolerance test.** `trimFrontFolds` treats two nearby segments of the front as crossing when they come within a tenth of a segment in 3D, and drops the loop between them. A sharp concave corner of the front draws its segments close but not that close, so it survives; the Noise Fold scene trims on about a quarter of its revolutions and the sphere and noise shade on none. The trimmed gap is wider than one step, which the warning says.
- **Minimum layer time ignores brim and bottom fill.** Those moves exist only in the emitter and the preview splice, so `applyMinimumLayerTime` never sees them.
- **The cylindrical ray test counts a shared vertex twice** (`u > 1` is strict in `rayIntersectContourOuter`), so the bridging warning can trip on a vertex hit. Harmless.
- **16-bit field encoding.** The slice grid packs distances over the batch bounds' diagonal, so the resolution is about 0.005 mm at `modelScale` 50 and 0.02 mm at 200. Well under the grid pitch, but it is where precision would go first on a very large model. The point sampler used by the march encodes over a window that tracks the step size and is sub-micron.

## Verified sound

For the record, so the next review does not redo it: marching squares is correct in all sixteen cases with exact integer edge keys; the ellipse-radial pitch in `surfacePitchFor` is exactly the touching distance of two congruent bead sections; the tetrahedral gradient's `1/(4h)` scale is right; the tight-batch retry covers a flange the 24-level pre-pass missed; move merging bounds deviation against every dropped point and refuses to cross speed, flow, dwell or travel boundaries.
