/**
 * Ramp domain measurement, shared between the initial build (whole toolpath)
 * and the renderer (whatever layer range is currently drawn).
 *
 * Rescaling to the visible range is what makes the layer scrubber useful for
 * more than hiding geometry. A vase-mode path ends with a top cap whose
 * extrusion is deliberately ramped to zero, so a whole-path flow domain spans
 * 0 to 2 and every wall segment collapses into one indistinguishable shade.
 * Scrub the cap out of view and the ramp reopens over the wall's real spread.
 */

import type { ToolpathRampKind } from './types';

export interface ChannelDomain {
    min: number;
    max: number;
}

export interface DomainRequest {
    kind: ToolpathRampKind;
    /** Ramp midpoint for diverging channels. */
    neutral?: number;
    /** Categorical channels have a fixed domain of one unit per category. */
    categoryCount?: number;
}

/**
 * Measures over `values[first .. first + count)`, skipping segments flagged in
 * `excluded` - travels and zero-length moves, whose values are either from a
 * different regime entirely or undefined.
 */
export function measureChannelDomain(
    request: DomainRequest,
    values: Float32Array,
    excluded: Uint8Array,
    first: number,
    count: number,
): ChannelDomain {
    if (request.kind === 'categorical') {
        // Values are plain category indices. Offsetting the domain by half a
        // category puts index i at the centre of its block in the ramp
        // texture; on a 0..N domain, i/N lands on the block's leading edge
        // and rounds down into the previous category's colour.
        const count = Math.max(1, request.categoryCount ?? 1);
        return { min: -0.5, max: count - 0.5 };
    }

    let min = Infinity;
    let max = -Infinity;
    const end = Math.min(values.length, first + count);
    for (let i = Math.max(0, first); i < end; i++) {
        if (excluded[i] === 1) continue;
        const value = values[i];
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return request.kind === 'diverging'
            ? { min: (request.neutral ?? 0) - 1, max: (request.neutral ?? 0) + 1 }
            : { min: 0, max: 1 };
    }

    if (request.kind === 'diverging') {
        const neutral = request.neutral ?? 0;
        // A diverging ramp is only readable when its neutral sits at the
        // middle, so the domain widens to whichever side deviates further.
        const radius = Math.max(Math.abs(min - neutral), Math.abs(max - neutral), 0.02);
        return { min: neutral - radius, max: neutral + radius };
    }

    if (max - min < 1e-9) {
        const pad = Math.max(1e-6, Math.abs(max) * 0.05);
        return { min: min - pad, max: max + pad };
    }

    return { min, max };
}
