# Slicing Algorithm Review — Implicit

> **Status update (2026-07-08):** C1, C2, C3, C4, C8, E1/G1 (merged into a single
> `targetSegmentMm` parameter), E2, E3 (fast-scan variant), and G4 are implemented.
> Grid sizing is now driven by one knob — Target segment (mm) — which sets both the
> sampling pitch (segment/2) and the per-layer point count (max perimeter / segment).
> Bounds auto-fit runs as a coarse 64² GPU pre-pass. Non-fatal issues (skipped holes,
> sub-printable loops, small islands) surface as warnings in the UI and G-code header;
> disjoint islands ≥ 4 mm² still fail with a classified error. Measured on the screw
> scene: 9.7 s → 5.9 s at equivalent resolution (grid still capped at 2048), 1.9 s at
> 0.6 mm segments. Also fixed en route: a stale `currentSliceSignature` reactive in
> App.svelte (root cause of UI-review finding #2). Still open: C5, C6, C7, E4–E9,
> G3, G5, G6.

*Reviewed 2026-07-08. Full read of `src/core/slicer.ts` (2,924 lines), `src/shaders/slicer.frag.glsl`, `src/core/toolpath-postprocess.ts`, and the invocation path in `src/studio-controller.ts`, plus live benchmarks in Chrome using the built-in Benchmark tool.*

## Pipeline summary (as implemented)

GPU renders the scene SDF into a `gridSize × (gridSize × batch)` texture, one XZ slice per batch row-block, distance packed as 16-bit in the R/G bytes (`slicer.frag.glsl`) → synchronous `readPixels` → JS decode into `number[][]` fields → marching squares with edge-keyed segment joining → single-contour selection with significance thresholds → dense resample + Taubin smoothing → per-layer rotational alignment → continuous-helix interpolation with flat first layer and extrusion-ramped top cap → optional postprocess pipeline → greedy move merging → extrusion recompute → minimum-layer-time → G-code emission.

The overall design is sound: mid-layer-style sampling, ambiguity resolution via cell-center averaging in marching squares, exact edge-key segment joining (no float-tolerance matching), the debug snapshot on failure, and the cached base-toolpath so postprocess-only changes skip resampling (`studio-controller.ts:555-586`) are all good engineering.

## Measured performance (Screw Thread Cylinder, 90 layers)

| Configuration | Total | Sampling | Toolpath | G-code |
|---|---|---|---|---|
| Grid pitch 0.1 mm (grid capped at 2048) | 9,715 ms | 9,689 ms (99.7%) | 17 ms | 8 ms |
| Grid pitch 0.4 mm (~960 grid) | 1,718 ms | 1,700 ms | 12 ms | 6 ms |

Output was nearly identical across the two runs (19,787 vs 19,697 points, 860 KB vs 856 KB): **the default 0.1 mm pitch massively oversamples relative to what the fixed 640-point contour resample retains.** Everything downstream of sampling is effectively free.

Micro-measurement of the JS side at 2048²: field decode ≈ 25 ms/layer, a minimal full-grid cell scan ≈ 10 ms/layer (the real `extractCellSegments` path with per-cell calls and allocations is slower). Across 90 layers that alone is 3–5 s of CPU; the remainder is GPU render + synchronous `readPixels` stalls (~1.5 GB of pixel data moved for this part).

---

## Correctness

### C1. Systematic vertical sampling skew (0.5–1.5 layers)
`getSliceSampleY` (slicer.ts:1224) samples the SDF at `t = (i + 0.5) / layerCount` across `[minY, maxY]`, with `layerCount = floor(H/lh) + 1`. But the helix prints contour *j* around mid-height `lh·(j+0.5) + lh/2` (slicer.ts:883, after accounting for the one-layer blend smear). Because the sample pitch is `H/layerCount` (slightly less than `lh`), the offset between where geometry is sampled and where it's printed grows from ~half a layer at the bottom to ~1.5 layers at the top (e.g. H=45, lh=0.2: contour 225 sampled at 44.90 mm, printed at 45.0). On sloped geometry that is a systematic radial error — relevant for precision parts like the screw threads this app targets.

**Fix:** derive sample heights from print heights, not by dividing the SDF span evenly: `sampleY(j) = minY + (min(H, lh·(j+1)) − lh/2) / scale`, with `layerCount = ceil(H/lh)`.

### C2. Double pass at the rim when height is an exact multiple of layer height
The helix Y is clamped: `y = min(modelHeightMm, lh·(1+spiralT))` (slicer.ts:883). With `layerCount = floor(H/lh)+1`, the helix top `lh·layerCount` always exceeds H, so the tail of the last revolution flattens at H — for exact multiples (45 mm / 0.2 mm) it is an entire revolution at full extrusion. The top cap (slicer.ts:919-945) then traces *another* full revolution at the same Y, ramping extrusion down. Net: up to ~1.7× material over the final rim. **Fix:** end the helix at `H − ε` and let the cap be the only pass at H, or skip the cap when the flattened tail already covered the top contour.

### C3. Silent geometry dropping in contour selection
`selectPrimaryContour` (slicer.ts:2201) ignores secondary contours below `max(8% of primary area, feature-size²·2)` **and** below the perimeter threshold — silently. The `detail` string ("ignored N tiny loops") is discarded on the success path. Consequences:
- A real feature up to 8% of the slice area is simply not printed, with no warning.
- A thin fin (large perimeter, small area) fails the area test and is dropped.

**Fix:** surface ignored-contour counts/areas as a per-slice warning in the UI (the status model already supports diagnostics), and gate the drop on absolute printable size only, not on a percentage of the primary.

### C4. Hole vs. island is not distinguished
When two significant contours exist, the error is the same whether they are nested (a shelled model — inner boundary of an annulus) or disjoint (two islands). Nesting is cheap to test (point-in-polygon of one contour's vertex against the other). A nested hole could legitimately vase-print the outer wall with a warning; disjoint islands cannot. At minimum the error message should say which case occurred — the user's fix is different in each.

### C5. `sceneFields` are stripped after the first postprocess step
`normalizeReturnedPoint` (toolpath-postprocess.ts:297) rebuilds points without `sceneFields`, so in a multi-step pipeline, step 2 and later see `sceneFields === undefined` even though the fields were GPU-sampled before step 1 (slicer.ts:961-962). Any script combination where a later step reads fields breaks silently. **Fix:** carry `sceneFields` through (they're positionally stale after a step moves points, but that's equally true today for step 1's own mutations), or re-sample fields between steps.

### C6. Move-merge deviation bound is not what the setting promises
`simplifyLayerMoves` (slicer.ts:1272) checks each dropped point's deviation against the *local triple* (prev-kept, current, immediate-next), not against the final chord after subsequent merges. Greedy accumulation means the true deviation from the original path can exceed `moveMergeMaxDeviationMm` several-fold within a `keepStride` window (default 12). In practice the 1° turn limit keeps it tight on smooth contours, but on noise-modulated surfaces (this app's specialty) the bound is soft. **Fix:** track the accumulated chord — test all points dropped so far against the candidate chord (windowed Douglas-Peucker), or tighten the docs/label to "local deviation".

### C7. Cylindrical mode silently bridges reentrant geometry
`rayIntersectContourOuter` takes the *farthest* intersection (slicer.ts:1013), so non-star-convex profiles are silently convexified; the error only fires when a ray misses entirely. The thrown message ("requires a contour that is visible from the center axis at every angle") describes a condition the code doesn't actually enforce. It's labeled legacy — fine — but the message and behavior should agree, and a max-deviation check between the radial resample and the true contour would make the mode self-verifying.

### C8. Off-center models fail with a confusing error
`getSliceBounds` (slicer.ts:1214) is a fixed square at the origin (±maxRadius). A model offset in XZ gets clipped at the window edge → open polylines → "requires exactly one closed contour" — the error doesn't mention clipping. Auto-fitting bounds from a coarse SDF pre-pass (or at least detecting boundary-touching open polylines and saying "increase slice half-extent / recenter the model") would fix both generality and diagnosability. The debug snapshot helps, but only after the user opens it.

### Verified-correct things worth noting
- 16-bit distance encode/decode round-trip is exact (shader `encodeSignedDistance` ↔ `decodeSliceBatchFields`).
- Marching-squares saddle cases (5/10) resolved by cell-center average — standard and correct.
- Edge-keyed segment joining cannot produce the classic float-tolerance chain breaks.
- Relative-extrusion G-code with per-move rounded deltas: cumulative rounding error over 56k moves is < 0.3 mm of filament — negligible.
- `resampleClosedContour` handles the closing segment correctly (checked the cumulative-length indexing).

---

## Efficiency / speed

Ordered by expected payoff. The first three attack the measured 99.7%.

### E1. Stop oversampling the grid (measured 5.7× on a real part)
The pitch-driven grid (`sliceSpanMm / 0.1mm`, slicer.ts:566) is disconnected from what survives: every contour is resampled to `pointsPerLayer` (640) and Taubin-smoothed. For the screw part, segments are ~1.7 mm long while the grid resolves 0.19 mm. Derive the grid from the actual chord-error budget (a function of `pointsPerLayer`, perimeter, and line width — e.g. pitch ≈ lineWidth/4 with a floor) instead of a fixed mm constant, or at least lower the default and document the trade. This is a settings-level change worth 3–6× on large parts today.

### E2. Typed arrays for the field + integer edge keys
- `decodeSliceBatchFields` (slicer.ts:1640) builds `number[][]` via `push` — 4.2M pushes per 2048² layer (~25 ms measured, plus GC). Decode into one flat `Float32Array` per layer with direct indexing; pass `(field, gridSize)` to the extractor.
- `edgeKey` (slicer.ts:2079) allocates a string per segment endpoint and the joiner uses `Map<string, …>`. Encode edges as integers (`(axis << 30) | (row << 15) | col`) and use a `Map<number, …>` — removes all string churn from the hot path.
- `extractCellSegments` allocates arrays/objects per boundary cell via four closure helpers; inline the four edge interpolations and emit into preallocated arrays.

### E3. Contour tracing instead of full-grid segment extraction
Marching squares currently visits all `(gridSize−1)²` cells per layer (~4.2M at 2048, ≥10 ms/layer just to scan). Replace with: one cheap sign-scan pass over the flat field (branch-poor, typed-array reads, or even a GPU reduction that returns crossing rows) to find seed cells, then *trace* each contour cell-to-cell — O(perimeter) ≈ thousands of cells instead of millions. The seed scan still touches every cell but at ~1 ns/cell; the expensive per-cell work disappears. This also naturally yields contours already joined, removing the segment-soup + adjacency step.

### E4. Move slicing off the main thread
Both paths block the UI: the sync path (`benchmarkVaseGcode`) freezes the page for the full ~10 s × runs, and the async path only yields between batches, so each batch (GPU render + readPixels + decode + extraction of up to 16 layers) is one long task. A Web Worker with OffscreenCanvas isolates all of it; the progress-reporting architecture already fits a `postMessage` boundary cleanly.

### E5. WebGL2 readback improvements
- Render to `R16UI`/`R32F` (WebGL2 / `EXT_color_buffer_float`) — halves readback bytes and deletes the pack/unpack entirely.
- Use `readPixels` into a `PIXEL_PACK_BUFFER` with a fence sync (`getBufferSubData` after `clientWaitSync`) so the GPU never stalls the CPU; overlap batch N's readback with batch N−1's extraction.
- Minor: the slicer context requests `preserveDrawingBuffer: true` (slicer.ts:1727) — unnecessary for FBO rendering; drop it.

### E6. Exploit layer coherence
Adjacent slices differ by ~one layer height of slope. After layer j, layer j+1's contour lies within a predictable band. Options: sample only a dilated band around the previous contour (two-pass coarse→fine grid), or seed contour tracing (E3) directly from the previous layer's cells and fall back to a full scan only when tracing fails or topology changes. Cuts both GPU fill and CPU work by ~10× for typical parts.

### E7. G-code size: emit F and Z only on change
`buildGcode` writes `F` on every `G1` (slicer.ts:1540) even though speed is constant within a layer, and `Z` on every move even on the flat first layer/cap. Emitting them only when changed shaves ~15–20% off the file (2.5 MB → ~2 MB on the default scene) for free.

### E8. Postprocess context allocation
`buildToolpathPostprocessContext` rebuilds seven full-length arrays plus a metrics object (14 fields) per point *per step*. For 56k points × several steps this is tens of MB of garbage per Generate. Fine today; if pipelines grow, switch metrics to flat parallel arrays with a lazy per-point view.

### E9. Deduplicate the sync/async sampling paths
`sampleSliceContoursGpu` and `sampleSliceContoursGpuAsync` (slicer.ts:558-709) are ~85 duplicated lines differing only in progress reporting and yielding. One implementation with an optional `await maybeYield()` hook removes the risk of the two drifting (the error-handling paths have already started to diverge in formatting).

---

## Generality

### G1. Adaptive points per layer
`pointsPerLayer` is one global constant. 640 points on a 1,100 mm perimeter is 1.7 mm segments (visible faceting on curvature); on a 60 mm perimeter it's 0.1 mm segments (needless G-code bloat that move-merging then re-removes — the measured 65% merge reduction is mostly this). The helix interpolation needs *equal counts across layers*, so: compute the max perimeter across layers after contour extraction, choose `count = clamp(maxPerimeter / targetSegmentMm, min, max)` once per slice job, and resample all layers to it. One-line UX win: replace the "Points per layer" number with "Target segment length (mm)".

### G2. Vase-mode constraint diagnostics (see C3/C4/C8)
The single-contour requirement is inherent to spiral printing, but the three failure flavors (multiple islands, nested shell, window clipping) currently produce one undifferentiated error. Classifying them (disjoint vs nested vs boundary-touching) makes the constraint teachable instead of frustrating.

### G3. Solid bottom layers
First layer is a single perimeter + brim; large-diameter vases have no floor. The 2D offsetting machinery already exists (`buildBrimLoop`/`buildOffsetEdges2D`, slicer.ts:2723-2796) — offsetting *inward* with the same code generates concentric-fill bottom layers. This is the single most-requested capability gap for a practical vase slicer, and ~80% of the geometry code is already written.

### G4. Bounds auto-fit (see C8)
A coarse 64² pre-pass over a generous window, taking the bbox of negative samples plus a margin, removes both the off-center failure mode and wasted resolution: for parts that don't fill the ±maxRadius square, the effective pitch improves for free (the 2048 cap currently spends pixels on empty space).

### G5. Non-uniform layer heights
The architecture is closer to supporting adaptive layer height than it looks: sampling already takes arbitrary `sampleY` per layer, and the helix builder only assumes *ordered* layers. Slope-adaptive layer heights (thinner where the contour changes fast between layers — measurable from the alignment score already computed in `findBestContourShift`) would improve surface quality on domes/threads at equal print time. Requires C1's sample-height refactor first.

### G6. Retraction/end-of-print constants
End-of-print retraction is hard-coded (`G1 F1200 E-1.20000`, slicer.ts:1546), as are the prime pulses (0.8/0.6 mm). These belong in `VaseSlicerSettings` next to the other filament-dependent values — PETG vs TPU need different values.

---

## Suggested priority

1. **C1 + C2** (sampling alignment, rim double-pass) — small, self-contained, directly affect dimensional accuracy of every print.
2. **E1** (grid sizing) — measured 5.7× wall-clock on a real part; settings-level change.
3. **E2 + E3** (typed arrays, contour tracing) — removes most of the CPU seconds; mechanical refactor of well-isolated functions.
4. **C3 + C4 + C8 / G2** (constraint diagnostics) — turns the most common failure mode into actionable feedback.
5. **E4** (worker) — UX-level responsiveness; independent of the above.
6. **G1, G3** (adaptive segment length, bottom layers) — biggest capability wins.
7. Remainder (E5–E9, C5–C7, G4–G6) as opportunity arises.
