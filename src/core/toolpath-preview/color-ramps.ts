/**
 * Colour ramps for the toolpath preview.
 *
 * One sampler serves both consumers: the renderer bakes it into a 256-texel
 * lookup texture, and the legend turns the same samples into a CSS gradient.
 * Keeping the definition here (rather than as GLSL) is what guarantees the
 * swatch under the viewport matches the pixels in it.
 */

import type { ToolpathCategory, ToolpathChannelSummary } from './types';

export const RAMP_TEXTURE_SIZE = 256;

type Stops = ReadonlyArray<readonly [number, number, number]>;

function hexStops(...hexes: string[]): Stops {
    return hexes.map((hex) => {
        const value = Number.parseInt(hex.slice(1), 16);
        return [
            ((value >> 16) & 0xff) / 255,
            ((value >> 8) & 0xff) / 255,
            (value & 0xff) / 255,
        ] as const;
    });
}

/**
 * Viridis: perceptually uniform and monotonic in lightness, so ordering
 * survives greyscale printing and every common form of colour blindness.
 */
const SEQUENTIAL_STOPS = hexStops(
    '#440154', '#482878', '#3e4a89', '#31688e', '#26828e',
    '#1f9e89', '#35b779', '#6dcd59', '#b4de2c', '#fde725',
);

/**
 * Moreland cool-warm. Diverging channels have a meaningful neutral (flow
 * ratio 1.0), so the ramp is symmetric about a light midpoint: too little
 * reads cool, too much reads warm, and "correct" recedes.
 */
const DIVERGING_STOPS = hexStops(
    '#3b4cc0', '#7396f5', '#aabedf', '#dddcdb', '#e8b7a5', '#e3705b', '#b40426',
);

/** Okabe-Ito, chosen for categorical separation under colour blindness. */
export const FEATURE_CATEGORIES: ToolpathCategory[] = [
    { label: 'Spiral wall', color: rgb('#0072b2') },
    { label: 'First layer', color: rgb('#e69f00') },
    { label: 'Solid bottom', color: rgb('#cc79a7') },
    { label: 'Brim', color: rgb('#009e73') },
    { label: 'Top cap', color: rgb('#f0e442') },
    { label: 'Dwell stop', color: rgb('#d55e00') },
    { label: 'Travel', color: rgb('#949ba6') },
];

export const FEATURE_WALL = 0;
export const FEATURE_FIRST_LAYER = 1;
export const FEATURE_SOLID_BOTTOM = 2;
export const FEATURE_BRIM = 3;
export const FEATURE_CAP = 4;
export const FEATURE_DWELL = 5;
export const FEATURE_TRAVEL = 6;

function rgb(hex: string): [number, number, number] {
    const [r, g, b] = hexStops(hex)[0];
    return [r, g, b];
}

function sampleStops(stops: Stops, t: number): [number, number, number] {
    const clamped = Math.min(1, Math.max(0, t));
    const scaled = clamped * (stops.length - 1);
    const low = Math.min(stops.length - 1, Math.floor(scaled));
    const high = Math.min(stops.length - 1, low + 1);
    const blend = scaled - low;
    const a = stops[low];
    const b = stops[high];
    return [
        a[0] + (b[0] - a[0]) * blend,
        a[1] + (b[1] - a[1]) * blend,
        a[2] + (b[2] - a[2]) * blend,
    ];
}

/** Colour for normalized position `t` in 0..1 along the channel's ramp. */
export function sampleChannelRamp(channel: ToolpathChannelSummary, t: number): [number, number, number] {
    if (channel.kind === 'categorical') {
        const categories = channel.categories ?? FEATURE_CATEGORIES;
        const index = Math.min(categories.length - 1, Math.max(0, Math.floor(t * categories.length)));
        return categories[index].color;
    }

    return sampleStops(channel.kind === 'diverging' ? DIVERGING_STOPS : SEQUENTIAL_STOPS, t);
}

/** 256 x 1 RGBA8 lookup table, sampled with NEAREST so category blocks stay flat. */
export function buildRampTexels(channel: ToolpathChannelSummary): Uint8Array {
    const texels = new Uint8Array(RAMP_TEXTURE_SIZE * 4);
    for (let i = 0; i < RAMP_TEXTURE_SIZE; i++) {
        const [r, g, b] = sampleChannelRamp(channel, (i + 0.5) / RAMP_TEXTURE_SIZE);
        texels[i * 4 + 0] = Math.round(r * 255);
        texels[i * 4 + 1] = Math.round(g * 255);
        texels[i * 4 + 2] = Math.round(b * 255);
        texels[i * 4 + 3] = 255;
    }
    return texels;
}

export function toCssColor(color: readonly [number, number, number]): string {
    const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
    return `rgb(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])})`;
}

/** CSS `linear-gradient` stops matching what the shader will sample. */
export function buildLegendGradient(channel: ToolpathChannelSummary, steps = 24): string {
    const parts: string[] = [];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        parts.push(`${toCssColor(sampleChannelRamp(channel, t))} ${(t * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${parts.join(', ')})`;
}
