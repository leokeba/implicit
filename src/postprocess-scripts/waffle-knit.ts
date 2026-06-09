// Waffle Knit

const TAU = Math.PI * 2.0;
const PI = Math.PI;
const QUARTER_TURN = Math.PI * 0.5;
const EPSILON = 1e-6;

export const controls = {
    normalAmplitudeMm: { default: 0.32, min: 0.0, max: 3.4, step: 0.01, label: 'Normal amplitude (mm)', section: 'Waffle Pattern', description: 'Outward/inward displacement magnitude.' },
    tangentAmplitudeMm: { default: 0.22, min: 0.0, max: 3.4, step: 0.01, label: 'Tangent amplitude (mm)', section: 'Waffle Pattern', description: 'Along-contour displacement magnitude.' },
    normalWavesPerLayer: { default: 6.0, min: 0.25, max: 24.0, step: 0.25, label: 'Normal waves per layer', section: 'Waffle Pattern', description: 'Frequency of normal-direction waves.' },
    tangentWavesPerLayer: { default: 9.0, min: 0.25, max: 24.0, step: 0.25, label: 'Tangent waves per layer', section: 'Waffle Pattern', description: 'Frequency of tangent-direction waves.' },
};

export function transform(context: any) {
    const normalAmplitudeMm = Number(context.params?.normalAmplitudeMm ?? 0.32);
    const tangentAmplitudeMm = Number(context.params?.tangentAmplitudeMm ?? 0.22);
    const normalWavesPerLayer = Math.max(0.0, Number(context.params?.normalWavesPerLayer ?? 6.0));
    const tangentWavesPerLayer = Math.max(0.0, Number(context.params?.tangentWavesPerLayer ?? 9.0));
    const layerCount = Math.max(1, Number(context.totals?.layerCount ?? 1));

    if ((normalAmplitudeMm === 0 && tangentAmplitudeMm === 0) || !Array.isArray(context.points)) {
        return {
            points: context.points,
            notes: ['Waffle knit bypassed (zero amplitude or invalid inputs)'],
        };
    }

    const frames = buildContourFrames(context.points, context.layers);

    const nextPoints = context.points.map((point: any, index: number) => {
        const progress = clamp01(Number(point.metrics?.layerFilamentProgress ?? 0.0));
        const shapeProgress = clamp01(Number(point.metrics?.shapeLayerProgress ?? progress));
        const weaveBlend = 0.5 + (0.5 * Math.sin(shapeProgress * layerCount * PI));
        const normalWeight = 0.45 + (0.55 * weaveBlend);
        const tangentWeight = 0.45 + (0.55 * (1.0 - weaveBlend));
        const normalPhase = shapeProgress * normalWavesPerLayer * layerCount * TAU;
        const tangentPhase = (shapeProgress * tangentWavesPerLayer * layerCount * TAU) + QUARTER_TURN + ((weaveBlend - 0.5) * QUARTER_TURN);
        const normalOffset = Math.sin(normalPhase) * normalAmplitudeMm * normalWeight;
        const tangentOffset = Math.sin(tangentPhase) * tangentAmplitudeMm * tangentWeight;
        const frame = frames[index] ?? { nx: 1.0, nz: 0.0, tx: 0.0, tz: 1.0 };

        return {
            ...point,
            x: point.x + (frame.nx * normalOffset) + (frame.tx * tangentOffset),
            z: point.z + (frame.nz * normalOffset) + (frame.tz * tangentOffset),
        };
    });

    return {
        points: nextPoints,
        notes: [
            `Applied waffle knit: normalAmp=${normalAmplitudeMm.toFixed(2)}mm tangentAmp=${tangentAmplitudeMm.toFixed(2)}mm`,
        ],
    };
}

function buildContourFrames(points: any[], layers: any[] | undefined): Array<{ nx: number; nz: number; tx: number; tz: number }> {
    const frames = new Array<{ nx: number; nz: number; tx: number; tz: number }>(points.length);
    const ranges = getLayerRanges(points, layers);

    for (const range of ranges) {
        const start = Math.max(0, range.startIndex);
        const end = Math.min(points.length - 1, range.endIndex);
        if (end < start) {
            continue;
        }

        let centerX = 0.0;
        let centerZ = 0.0;
        const count = end - start + 1;
        for (let i = start; i <= end; i++) {
            centerX += Number(points[i]?.x ?? 0.0);
            centerZ += Number(points[i]?.z ?? 0.0);
        }
        centerX /= count;
        centerZ /= count;

        for (let i = start; i <= end; i++) {
            const prevIndex = i > start ? i - 1 : i;
            const nextIndex = i < end ? i + 1 : i;
            const prev = points[prevIndex] ?? points[i];
            const next = points[nextIndex] ?? points[i];
            let tx = Number(next?.x ?? 0.0) - Number(prev?.x ?? 0.0);
            let tz = Number(next?.z ?? 0.0) - Number(prev?.z ?? 0.0);
            const tangentLen = Math.hypot(tx, tz);

            if (tangentLen <= EPSILON) {
                frames[i] = { nx: 1.0, nz: 0.0, tx: 0.0, tz: 1.0 };
                continue;
            }

            tx /= tangentLen;
            tz /= tangentLen;

            let nx = -tz;
            let nz = tx;
            const outwardX = Number(points[i]?.x ?? 0.0) - centerX;
            const outwardZ = Number(points[i]?.z ?? 0.0) - centerZ;
            if ((nx * outwardX) + (nz * outwardZ) < 0.0) {
                nx *= -1.0;
                nz *= -1.0;
            }

            frames[i] = { nx, nz, tx, tz };
        }
    }

    for (let i = 0; i < frames.length; i++) {
        if (!frames[i]) {
            frames[i] = { nx: 1.0, nz: 0.0, tx: 0.0, tz: 1.0 };
        }
    }

    return frames;
}

function getLayerRanges(points: any[], layers: any[] | undefined): Array<{ startIndex: number; endIndex: number }> {
    if (Array.isArray(layers) && layers.length > 0) {
        return layers
            .map((layer: any) => ({
                startIndex: Number(layer?.startIndex),
                endIndex: Number(layer?.endIndex),
            }))
            .filter((range) => Number.isInteger(range.startIndex) && Number.isInteger(range.endIndex));
    }

    if (points.length === 0) {
        return [];
    }

    const ranges: Array<{ startIndex: number; endIndex: number }> = [];
    let start = 0;
    let currentLayer = points[0]?.layer;

    for (let i = 1; i < points.length; i++) {
        if (points[i]?.layer !== currentLayer) {
            ranges.push({ startIndex: start, endIndex: i - 1 });
            start = i;
            currentLayer = points[i]?.layer;
        }
    }

    ranges.push({ startIndex: start, endIndex: points.length - 1 });
    return ranges;
}

function clamp01(value: number): number {
    return Math.min(1.0, Math.max(0.0, value));
}
