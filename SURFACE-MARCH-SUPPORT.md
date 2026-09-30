# Surface Marching: the Unsupported Base

*Written 2026-09-09, after a 50 mm sphere print whose first ~6 mm came off the
bed as loose wire instead of a wall.*

> **Status: the placement fix is implemented** - the sideways advance is now a
> clamp on the step rather than a test, and flow follows the shortened step.
> See "What was done". Everything under "Still open" is deferred.

## What the print shows

The bottom of the sphere printed as a bird's nest of unbonded loops; the shell
only became a shell once the wall got steep enough, and the wire base tore off
before the print finished. Nothing in the slice warned about it.

## What the march actually does down there

Replaying `marchSurfaceContours` analytically on `src/scenes/sphere` (R = 25 mm,
`layerHeight` 0.2, `lineWidth` 0.42 — the march is axisymmetric here, so one
meridian point describes a whole revolution):

| rev | z (mm) | radius (mm) | sideways / rev | rise / rev | overlap with the bead below | surface slope |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0.20 | 3.16 | 0.406 | 0.052 | 3 % | 7.3° |
| 1 | 0.25 | 3.56 | 0.402 | 0.058 | 4 % | 8.2° |
| 5 | 0.53 | 5.14 | 0.384 | 0.081 | 9 % | 11.9° |
| 12 | 1.22 | 7.72 | 0.347 | 0.113 | 17 % | 18.0° |
| 20 | 2.24 | 10.33 | 0.304 | 0.138 | 28 % | 24.4° |
| 30 | 3.73 | 13.14 | 0.256 | 0.158 | 39 % | 31.7° |
| 45 | 6.27 | 16.55 | 0.199 | 0.176 | 53 % | 41.5° |
| 90 | 14.75 | 22.80 | 0.088 | 0.196 | 79 % | 65.8° |

Revolution 0 is fine: it is the planar seed, laid on the bed. Revolution 1 is
0.41 mm further out and 0.05 mm higher — it hangs in the air a quarter of a
millimetre above the bed, held by a 3 % side kiss against its neighbour. That
continues for **42 revolutions and about 2.7 m of extrusion**, covering a
32 mm-wide, 5.7 mm-tall cap, before consecutive beads reach even half overlap.
That cap is the wire in the photograph.

## Why none of the existing guards fire

Three independent reasons, all in `src/core/slicer/surface-march.ts`:

1. **The overhang counter only looks for descent.** `surface-march.ts:315`
   counts a point as overhang when the step direction dips below the horizon
   (`uy < -sin 5°`). On the sphere's bottom cap every step still *climbs* — by
   0.05 mm, but it climbs — so `overhangPoints` stays at zero and the
   "marches onto a downward-facing surface" warning never appears. The cap is a
   downward-*facing* surface that the march walks *up*; the test conflates the
   two.

2. **The support test is disabled by default.** `maxBeadAdvance` defaults to
   1.0 (`config.ts:146`), which makes `maxHorizontalAdvance` a whole bead width
   (`surface-march.ts:278`). The sphere's worst step advances 0.406 mm against
   a limit of 0.42, so `unsupportedPoints` is also zero. The setting's own doc
   comment explains why it was left disabled — at 0.5 it leaves a 32 mm hole in
   the top of this same sphere — which is exactly right *as a stopping rule* and
   exactly wrong as a *reporting* rule.

3. **Even when it fires, it is only consulted on a closing front.**
   `surface-march.ts:207` requires `nextPerimeter <= perimeter`. The comment is
   deliberate and half-correct: an opening front does still have surface to
   follow, so the march should not *stop*. But the conclusion drawn was that
   nothing needs saying, and the base of a sphere is precisely the case where
   something needs saying.

## The conceptual error

`surfacePitchFor` answers a packing question: *how far apart can two bead
sections sit and still touch?* On a wall that is the same as the support
question, because the previous bead is underneath the new one and touching
means resting. On a downward-facing surface it is not: the same spacing puts
the new bead **beside** its neighbour at nearly the same height, over air.

The file's own summary — "the bead is always laid against the last one,
whatever the slope" — is true and insufficient. *Against* only becomes *on*
when the step direction has enough vertical component. Spacing is a geometric
property of the pair of beads; support is a property of what is underneath.
The march currently models only the first.

Usefully, the two are related by a single number. Requiring the sideways
advance to stay under a fraction *f* of a bead width is the same statement as a
maximum overhang angle, and the familiar values line up:

| f (`surfaceMaxBeadAdvance`) | equivalent slope limit | sphere trim height | trim radius |
|---:|---:|---:|---:|
| 0.90 | 13.7° | 0.71 mm | 5.9 mm |
| 0.75 | 22.9° | 1.96 mm | 9.7 mm |
| 0.60 | 33.1° | 4.05 mm | 13.7 mm |
| 0.50 | 39.6° | 5.74 mm | 15.9 mm |
| 0.35 | 52.4° | 9.75 mm | 19.8 mm |

f = 0.5 lands on ~40°, one rule of thumb restated as another.

## What was done

The advance limit became a **clamp on the step** instead of a test on it.
`stepContour` now takes two pitches: `natural`, the distance at which the bead
sections touch, and `pitch`, that distance shortened until its horizontal
component is within `maxBeadAdvance` of a bead width. The front still follows
the same surface and lands on it through the same Newton projection - it just
takes more, shorter steps across the shallow parts, and every bead keeps half
its width over the one below.

Three things had to move with it:

- **Flow follows the step.** A step at half its natural pitch fills half as
  wide a strip, and a full bead of material into it would pile up exactly where
  the wall is most fragile. `surfaceStepFlowRatio` in `toolpath.ts` measures the
  strip from the two contour points the move runs between - which is the true
  spacing after the clamp, the projection, the smoothing and the resample, none
  of which the march's intended pitch survives exactly - and scales extrusion by
  it. Quantized to a percent so runs of equal flow still merge.
- **The old stop rule went.** Reaching the advance limit can no longer end the
  march, because the clamp means it is never reached. That rule was inert at the
  shipped default of 1.0 anyway, and at 0.5 it would have cut the dome off 32 mm
  from its top - the regression `5c3497a` was written to undo.
- **The pole test follows the step down.** It stops the front when the opening
  is under one step, and the step is now shorter, so the threshold scales with
  `maxBeadAdvance` too. Without that the sphere stopped a revolution early and
  left a 0.23 mm pinhole at its apex. An inversion at an opening already that
  small is the same test arriving a revolution late, so it no longer warns.

Default `surfaceMaxBeadAdvance`: 1.0 -> 0.5.

### Measured, on the real march against an analytic sphere

| | advance 1.0 (before) | advance 0.5 (now) |
|---|---|---|
| revolutions | 292 | 336 |
| overlap at revolution 0 | 4 % | 50 % |
| overlap at revolution 30 (z 3.7 mm) | 39 % | 50 % |
| worst sideways over the body | 0.407 mm | 0.211 mm |
| closes at | r 0.19 mm | r 0.22 mm |
| filament | 3.11 g | 3.11 g |

More revolutions, the same material - which is the flow correction doing its
job. A flat-top cylinder moves 233 -> 234 revolutions with identical filament
and the same open top: a vertical wall never reaches the limit, so nothing that
was already steep changed.

## What this does not do

The base is now fused, not supported. Those first revolutions are still laid
over air - what changed is that each one is welded to its neighbour along half
a bead instead of kissing it along a sliver, so the shingled sheet hangs
together from the seed ring that *is* anchored to the bed. Expect it to sag;
expect it to hold. A sphere resting on its pole still has no printable base,
and no bead-spacing rule will invent one.

## Still open

Deferred from the original proposal, in value order:

- **Report it.** Nothing warns that a print has an unsupported region, because
  the overhang counter only looks for *descent* (`surface-march.ts:315`) and
  the sphere's cap climbs while facing down. A measurement of the real
  post-projection advance per revolution, surfaced as a height band, would have
  named this print's problem before it was printed.
- **Start the march where the wall can stand.** Use the leading revolutions as
  a probe, discard until the surface can support a bead, and raise `minY` to
  that height so the cut face lands on the bed and `bottomLayers` floors it.
  For the test sphere at 0.5 that is a 5.7 mm cut onto a 32 mm disc, and it is
  the difference between a base that sags and a base that is flat because it
  was meant to be. Report the trim - it silently changes the object.
- **Weld the lowest revolutions to the bed.** A revolution sitting within a
  bead height of the bed is printed hovering over it; clamp those to the first
  layer height and give them first-layer width and speed.
- **Planar solid base**, for keeping the cap rather than cutting it: stack
  ordinary solid layers to the trim height and march from there. Turns the
  shell into a shell with a plug (~2.4 cm3 on the test sphere), so it belongs
  behind an explicit setting.

## Validation

No test framework. `npm run check` and `npm run build` pass. The numbers above
come from running `marchSurfaceContours`, `finalizeMarchedContourLayers` and
`buildSpiralBaseToolpath` unmodified against an analytic sphere SDF standing in
for the GPU sampler, which reproduces the shipped 292-revolution result exactly.
Still to do in the dev server: slice `src/scenes/sphere` at `uSceneFlatten` 1.0
and 0.5 and read the first revolutions off the toolpath overlay; re-slice
`lamp_shade` and `knit_cylinder` and confirm nothing moved; then print it.
