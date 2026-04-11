// Seed Stitch Knit
// @control {"key":"amplitudeMm","label":"Amplitude (mm)","min":0.0,"max":1.2,"step":0.01,"default":0.28,"section":"Seed Pattern","description":"Maximum displacement for seed bumps."}
// @control {"key":"wavesPerLayer","label":"Waves per layer","min":0.25,"max":20.0,"step":0.25,"default":7.0,"section":"Seed Pattern","description":"Base sinusoidal frequency along each layer."}
// @control {"key":"chunksPerLayer","label":"Chunks per layer","min":2.0,"max":120.0,"step":1.0,"default":28.0,"section":"Seed Pattern","description":"Alternation block count around each layer."}

const TAU = Math.PI * 2.0;
const EPSILON = 1e-6;

export function transform(context: any) {
    const amplitudeMm = Number(context.params?.amplitudeMm ?? 0.28);
    const wavesPerLayer = Math.max(0.0, Number(context.params?.wavesPerLayer ?? 7.0));
    const chunksPerLayer = Math.max(2.0, Number(context.params?.chunksPerLayer ?? 28.0));

    if (!Number.isFinite(amplitudeMm) || amplitudeMm === 0 || wavesPerLayer === 0 || !Array.isArray(context.points)) {
        return {
            points: context.points,
            notes: ['Seed stitch bypassed (zero amplitude or invalid inputs)'],
        };
    }

    const normals = buildContourNormals(context.points, context.layers);

    const nextPoints = context.points.map((point: any, index: number) => {
        const progress = clamp01(Number(point.metrics?.layerFilamentProgress ?? 0.0));
        const layerParity = point.layer % 2 === 0 ? 1.0 : -1.0;
        const chunkParity = Math.floor(progress * chunksPerLayer) % 2 === 0 ? 1.0 : -1.0;
        const phase = progress * wavesPerLayer * TAU;
        const offsetMm = Math.sin(phase) * amplitudeMm * layerParity * chunkParity;
        const normal = normals[index] ?? { x: 1.0, z: 0.0 };

        return {
            ...point,
            x: point.x + (normal.x * offsetMm),
            z: point.z + (normal.z * offsetMm),
        };
    });

    return {
        points: nextPoints,
        notes: [
            `Applied seed stitch: amp=${amplitudeMm.toFixed(2)}mm waves/layer=${wavesPerLayer.toFixed(2)} chunks=${chunksPerLayer.toFixed(0)}`,
        ],
    };
}

function buildContourNormals(points: any[], layers: any[] | undefined): Array<{ x: number; z: number }> {
    const normals = new Array<{ x: number; z: number }>(points.length);
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
            const tangentX = Number(next?.x ?? 0.0) - Number(prev?.x ?? 0.0);
            const tangentZ = Number(next?.z ?? 0.0) - Number(prev?.z ?? 0.0);
            const tangentLen = Math.hypot(tangentX, tangentZ);

            if (tangentLen <= EPSILON) {
                normals[i] = { x: 1.0, z: 0.0 };
                continue;
            }

            let normalX = -tangentZ / tangentLen;
            let normalZ = tangentX / tangentLen;
            const outwardX = Number(points[i]?.x ?? 0.0) - centerX;
            const outwardZ = Number(points[i]?.z ?? 0.0) - centerZ;
            if ((normalX * outwardX) + (normalZ * outwardZ) < 0.0) {
                normalX *= -1.0;
                normalZ *= -1.0;
            }

            normals[i] = { x: normalX, z: normalZ };
        }
    }

    for (let i = 0; i < normals.length; i++) {
        if (!normals[i]) {
            normals[i] = { x: 1.0, z: 0.0 };
        }
    }

    return normals;
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
