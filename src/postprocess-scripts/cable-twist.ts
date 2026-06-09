// Cable Twist Knit

const TAU = Math.PI * 2.0;
const EPSILON = 1e-6;

export const controls = {
    amplitudeMm: { default: 0.45, min: 0.0, max: 1.6, step: 0.01, label: 'Amplitude (mm)', section: 'Cable Pattern', description: 'Maximum outward displacement for cable ridges.' },
    cableCount: { default: 6.0, min: 1.0, max: 24.0, step: 1.0, label: 'Cable count', section: 'Cable Pattern', description: 'How many cable ribs repeat around each layer.' },
    twistTurnsOverHeight: { default: 2.4, min: 0.0, max: 12.0, step: 0.05, label: 'Twist turns over height', section: 'Cable Pattern', description: 'How many full phase rotations occur from bottom to top.' },
};

export function transform(context: any) {
    const amplitudeMm = Number(context.params?.amplitudeMm ?? 0.45);
    const cableCount = Math.max(1.0, Number(context.params?.cableCount ?? 6.0));
    const twistTurnsOverHeight = Number(context.params?.twistTurnsOverHeight ?? 2.4);
    const layerCount = Math.max(1, Number(context.totals?.layerCount ?? 1));

    if (!Number.isFinite(amplitudeMm) || amplitudeMm === 0 || !Array.isArray(context.points)) {
        return {
            points: context.points,
            notes: ['Cable twist bypassed (zero amplitude or invalid inputs)'],
        };
    }

    const normals = buildContourNormals(context.points, context.layers);
    const estimatedHeightMm = Math.max(EPSILON, Number(context.totals?.estimatedHeightMm ?? 0.0));

    const nextPoints = context.points.map((point: any, index: number) => {
        const layerProgress = Number(point.metrics?.layerFilamentProgress ?? 0.0);
        const shapeProgress = Number(point.metrics?.shapeLayerProgress ?? layerProgress);
        const heightProgress = clamp01(Number(point.y ?? 0.0) / estimatedHeightMm);
        const phase = (shapeProgress * cableCount * layerCount * TAU) + (heightProgress * twistTurnsOverHeight * TAU);
        const offsetMm = Math.sin(phase) * amplitudeMm;
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
            `Applied cable twist: amp=${amplitudeMm.toFixed(2)}mm cables=${cableCount.toFixed(0)} twist=${twistTurnsOverHeight.toFixed(2)} turns`,
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
