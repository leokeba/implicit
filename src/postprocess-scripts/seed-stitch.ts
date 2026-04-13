// Seed Stitch Knit
// @control {"key":"amplitudeMm","label":"Amplitude (mm)","min":0.0,"max":1.2,"step":0.01,"default":0.28,"section":"Seed Pattern","description":"Maximum displacement for seed bumps."}
// @control {"key":"wavesPerLayer","label":"Waves per layer","min":0.25,"max":20.0,"step":0.25,"default":7.0,"section":"Seed Pattern","description":"Base sinusoidal frequency along each layer."}
// @control {"key":"chunksPerLayer","label":"Chunks per layer","min":2.0,"max":120.0,"step":1.0,"default":28.0,"section":"Seed Pattern","description":"Alternation block count around each layer."}

const TAU = Math.PI * 2.0;
const PI = Math.PI;
const EPSILON = 1e-6;

export function transform(context: any) {
    const amplitudeMm = Number(context.params?.amplitudeMm ?? 0.28);
    const wavesPerLayer = Math.max(0.0, Number(context.params?.wavesPerLayer ?? 7.0));
    const chunksPerLayer = Math.max(2.0, Number(context.params?.chunksPerLayer ?? 28.0));
    const layerCount = Math.max(1, Number(context.totals?.layerCount ?? 1));

    if (!Number.isFinite(amplitudeMm) || amplitudeMm === 0 || wavesPerLayer === 0 || !Array.isArray(context.points)) {
        return {
            points: context.points,
            notes: ['Seed stitch bypassed (zero amplitude or invalid inputs)'],
        };
    }

    const normals = buildContourNormals(context.points, context.layers);

    const nextPoints = context.points.map((point: any, index: number) => {
        const layerProgress = clamp01(Number(point.metrics?.layerPathProgress ?? point.metrics?.layerFilamentProgress ?? 0.0));
        const shapeProgress = clamp01(Number(point.metrics?.shapeLayerProgress ?? layerProgress));
        const phase = shapeProgress * wavesPerLayer * layerCount * TAU;
        const chunkParity = Math.cos(shapeProgress * chunksPerLayer * layerCount * PI);
        const offsetMm = Math.cos(phase) * amplitudeMm * chunkParity;
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
        const layerPointCount = end - start + 1;

        let centerX = 0.0;
        let centerZ = 0.0;
        for (let i = start; i <= end; i++) {
            centerX += Number(points[i]?.x ?? 0.0);
            centerZ += Number(points[i]?.z ?? 0.0);
        }
        centerX /= layerPointCount;
        centerZ /= layerPointCount;

        for (let i = start; i <= end; i++) {
            const localIndex = i - start;
            let tangentX = 0.0;
            let tangentZ = 0.0;
            let tangentLen = 0.0;

            // Some seam-adjacent points can be nearly coincident. Expand wrapped sampling radius until stable.
            for (let sampleRadius = 1; sampleRadius < layerPointCount; sampleRadius++) {
                const prev = points[start + wrapLocalIndex(localIndex - sampleRadius, layerPointCount)] ?? points[i];
                const next = points[start + wrapLocalIndex(localIndex + sampleRadius, layerPointCount)] ?? points[i];
                tangentX = Number(next?.x ?? 0.0) - Number(prev?.x ?? 0.0);
                tangentZ = Number(next?.z ?? 0.0) - Number(prev?.z ?? 0.0);
                tangentLen = Math.hypot(tangentX, tangentZ);
                if (tangentLen > EPSILON) {
                    break;
                }
            }

            if (tangentLen <= EPSILON) {
                const radialX = Number(points[i]?.x ?? 0.0) - centerX;
                const radialZ = Number(points[i]?.z ?? 0.0) - centerZ;
                const radialLen = Math.hypot(radialX, radialZ);
                normals[i] = radialLen > EPSILON
                    ? { x: radialX / radialLen, z: radialZ / radialLen }
                    : { x: 1.0, z: 0.0 };
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

        // Circularly smooth normals per layer to remove seam-local spikes.
        if (layerPointCount >= 3) {
            const smoothedNormals = new Array<{ x: number; z: number }>(layerPointCount);
            for (let localIndex = 0; localIndex < layerPointCount; localIndex++) {
                const prev = normals[start + wrapLocalIndex(localIndex - 1, layerPointCount)] ?? { x: 1.0, z: 0.0 };
                const curr = normals[start + localIndex] ?? { x: 1.0, z: 0.0 };
                const next = normals[start + wrapLocalIndex(localIndex + 1, layerPointCount)] ?? { x: 1.0, z: 0.0 };
                const blendedX = prev.x + (2.0 * curr.x) + next.x;
                const blendedZ = prev.z + (2.0 * curr.z) + next.z;
                const blendedLen = Math.hypot(blendedX, blendedZ);
                smoothedNormals[localIndex] = blendedLen > EPSILON
                    ? { x: blendedX / blendedLen, z: blendedZ / blendedLen }
                    : curr;
            }

            for (let localIndex = 0; localIndex < layerPointCount; localIndex++) {
                normals[start + localIndex] = smoothedNormals[localIndex];
            }
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

function wrapLocalIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }

    return ((index % length) + length) % length;
}
