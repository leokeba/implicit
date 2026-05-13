// Basket Weave Knit
// @control {"key":"normalAmplitudeMm","label":"Normal amplitude (mm)","min":0.0,"max":2.6,"step":0.01,"default":0.34,"section":"Basket Weave","description":"Outward displacement strength in active normal blocks."}
// @control {"key":"tangentAmplitudeMm","label":"Tangent amplitude (mm)","min":0.0,"max":2.6,"step":0.01,"default":0.24,"section":"Basket Weave","description":"Along-path displacement strength in active tangent blocks."}
// @control {"key":"blockLayers","label":"Block layers","min":1.0,"max":24.0,"step":1.0,"default":3.0,"section":"Basket Weave","description":"How many layers before swapping weave direction."}
// @control {"key":"blocksPerLayer","label":"Blocks per layer","min":2.0,"max":64.0,"step":1.0,"default":10.0,"section":"Basket Weave","description":"How many horizontal weave blocks around the perimeter."}
// @control {"key":"sceneFieldInfluence","label":"Scene field influence","min":0.0,"max":1.0,"step":0.05,"default":1.0,"section":"Basket Weave","description":"Blend between uniform weave amplitude and the active scene field sample named noise."}
// @control {"key":"sceneFieldDepth","label":"Scene field depth","min":0.0,"max":2.0,"step":0.05,"default":1.0,"section":"Basket Weave","description":"How strongly the noise field expands/compresses weave amplitude around baseline."}

const TAU = Math.PI * 2.0;
const PI = Math.PI;
const EPSILON = 1e-6;

export function transform(context: any) {
    const normalAmplitudeMm = Number(context.params?.normalAmplitudeMm ?? 0.34);
    const tangentAmplitudeMm = Number(context.params?.tangentAmplitudeMm ?? 0.24);
    const blockLayers = Math.max(1.0, Math.floor(Number(context.params?.blockLayers ?? 3.0)));
    const blocksPerLayer = Math.max(2.0, Number(context.params?.blocksPerLayer ?? 10.0));
    const sceneFieldInfluence = clamp01(Number(context.params?.sceneFieldInfluence ?? 1.0));
    const sceneFieldDepth = Math.max(0.0, Number(context.params?.sceneFieldDepth ?? 1.0));
    const layerCount = Math.max(1, Number(context.totals?.layerCount ?? 1));

    if ((normalAmplitudeMm === 0 && tangentAmplitudeMm === 0) || !Array.isArray(context.points)) {
        return {
            points: context.points,
            notes: ['Basket weave bypassed (zero amplitude or invalid inputs)'],
        };
    }

    const frames = buildContourFrames(context.points, context.layers);
    let sceneFieldCount = 0;
    let sceneFieldMin = Number.POSITIVE_INFINITY;
    let sceneFieldMax = Number.NEGATIVE_INFINITY;

    const nextPoints = context.points.map((point: any, index: number) => {
        const progress = clamp01(Number(point.metrics?.layerFilamentProgress ?? 0.0));
        const shapeProgress = clamp01(Number(point.metrics?.shapeLayerProgress ?? progress));
        const verticalBlockPhase = shapeProgress * (layerCount / blockLayers) * PI;
        const angularBlockPhase = progress * blocksPerLayer * PI;
        const weaveSelector = 0.5 + (0.5 * Math.sin(verticalBlockPhase + angularBlockPhase));

        const frame = frames[index] ?? { nx: 1.0, nz: 0.0, tx: 0.0, tz: 1.0 };
        const blockPhase = shapeProgress * blocksPerLayer * layerCount * TAU;
        const pulse = Math.sin(blockPhase);

        const sceneNoise = clamp01(readScalarSceneField(point.sceneFields?.noise, 1.0));
        if (typeof point.sceneFields?.noise === 'number' && Number.isFinite(point.sceneFields.noise)) {
            sceneFieldCount += 1;
            sceneFieldMin = Math.min(sceneFieldMin, sceneNoise);
            sceneFieldMax = Math.max(sceneFieldMax, sceneNoise);
        }

        const centeredNoise = (sceneNoise * 2.0) - 1.0;
        const noisyScale = Math.max(0.0, 1.0 + (centeredNoise * sceneFieldDepth));
        const amplitudeScale = lerp(1.0, noisyScale, sceneFieldInfluence);

        const normalWeight = lerp(0.25, 1.0, weaveSelector);
        const tangentWeight = lerp(1.0, 0.25, weaveSelector);
        const normalOffset = pulse * normalAmplitudeMm * normalWeight * amplitudeScale;
        const tangentOffset = pulse * tangentAmplitudeMm * tangentWeight * amplitudeScale;

        return {
            ...point,
            x: point.x + (frame.nx * normalOffset) + (frame.tx * tangentOffset),
            z: point.z + (frame.nz * normalOffset) + (frame.tz * tangentOffset),
        };
    });

    return {
        points: nextPoints,
        notes: [
            `Applied basket weave: normalAmp=${normalAmplitudeMm.toFixed(2)}mm tangentAmp=${tangentAmplitudeMm.toFixed(2)}mm fieldMix=${sceneFieldInfluence.toFixed(2)} fieldDepth=${sceneFieldDepth.toFixed(2)}`,
            sceneFieldCount > 0
                ? `Scene field noise samples: count=${sceneFieldCount} range=${sceneFieldMin.toFixed(3)}..${sceneFieldMax.toFixed(3)}`
                : 'Scene field noise samples missing on points (using fallback=1.0).',
        ],
    };
}

function readScalarSceneField(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

function lerp(a: number, b: number, t: number): number {
    return a + ((b - a) * clamp01(t));
}
