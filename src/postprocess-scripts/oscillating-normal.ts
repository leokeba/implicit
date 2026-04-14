// Oscillating Normal Pattern
// @control {"key":"amplitudeMm","label":"Amplitude (mm)","min":0.0,"max":2.0,"step":0.01,"default":0.35,"section":"Oscillation","description":"Maximum normal-direction displacement."}
// @control {"key":"sourceMode","label":"Source mode","default":0.0,"options":["Filament distance","Layer normalized"],"section":"Oscillation","description":"Choose modulation source domain."}
// @control {"key":"waveMode","label":"Wave mode","default":0.0,"options":["Sine","Square","Triangle","Ramp up","Ramp down","Cosine","Pulse"],"section":"Oscillation","description":"Waveform shape used for modulation."}
// @control {"key":"frequency","label":"Frequency","min":0.01,"max":200.0,"step":0.01,"default":6.0,"section":"Oscillation","description":"Filament source: cycles/100mm. Layer-normalized source: cycles/layer."}
// @control {"key":"phaseTurns","label":"Phase offset (turns)","min":-4.0,"max":4.0,"step":0.01,"default":0.0,"section":"Oscillation","description":"Global phase offset in turns."}
// @control {"key":"pulseDutyCycle","label":"Pulse duty cycle","min":0.01,"max":0.99,"step":0.01,"default":0.5,"section":"Oscillation","description":"Only used by pulse mode: fraction of each cycle at +1 state."}
// @control {"key":"sceneFieldInfluence","label":"Scene field influence","min":0.0,"max":1.0,"step":0.05,"default":1.0,"section":"Oscillation","description":"Blend between uniform amplitude and the active scene field sample named noise."}
// @control {"key":"sceneFieldDepth","label":"Scene field depth","min":0.0,"max":2.0,"step":0.05,"default":1.0,"section":"Oscillation","description":"How strongly the noise field expands/compresses amplitude around the baseline."}

const TAU = Math.PI * 2.0;
const EPSILON = 1e-6;

export function transform(context: any) {
    const amplitudeMm = Number(context.params?.amplitudeMm ?? 0.35);
    const sourceMode = clamp(Number(context.params?.sourceMode ?? 0.0), 0.0, 1.0);
    const waveMode = Math.round(clamp(Number(context.params?.waveMode ?? 0.0), 0.0, 6.0));
    const frequency = Math.max(0.0, Number(context.params?.frequency ?? context.params?.frequencyCyclesPer100Mm ?? 6.0));
    const phaseTurns = Number(context.params?.phaseTurns ?? 0.0);
    const pulseDutyCycle = clamp(Number(context.params?.pulseDutyCycle ?? 0.5), 0.01, 0.99);
    const sceneFieldInfluence = clamp(Number(context.params?.sceneFieldInfluence ?? 1.0), 0.0, 1.0);
    const sceneFieldDepth = Math.max(0.0, Number(context.params?.sceneFieldDepth ?? 1.0));

    if (!Number.isFinite(amplitudeMm) || amplitudeMm === 0 || !Number.isFinite(phaseTurns) || !Array.isArray(context.points)) {
        return {
            points: context.points,
            notes: ['Oscillating normal bypassed (zero amplitude or invalid inputs)'],
        };
    }

    const layerCount = Math.max(1, Number(context.totals?.layerCount ?? 1));
    const frequencyCyclesPerMm = frequency / 100.0;
    const normals = buildContourNormals(context.points, context.layers);
    let sceneFieldCount = 0;
    let sceneFieldMin = Number.POSITIVE_INFINITY;
    let sceneFieldMax = Number.NEGATIVE_INFINITY;

    const nextPoints = context.points.map((point: any, index: number) => {
        const spiralFilamentMm = Math.max(0.0, Number(point.metrics?.spiralFilamentMm ?? 0.0));
        const shapeProgress = clamp(Number(point.metrics?.shapeLayerProgress ?? point.metrics?.spiralFilamentProgress ?? 0.0), 0.0, 1.0);
        const turns = sourceMode < 0.5
            ? (spiralFilamentMm * frequencyCyclesPerMm) + phaseTurns
            : (shapeProgress * layerCount * frequency) + phaseTurns;
        const signal = evaluateWave(turns, waveMode, pulseDutyCycle);
        const sceneNoise = clamp(readScalarSceneField(point.sceneFields?.noise, 1.0), 0.0, 1.0);
        if (typeof point.sceneFields?.noise === 'number' && Number.isFinite(point.sceneFields.noise)) {
            sceneFieldCount += 1;
            sceneFieldMin = Math.min(sceneFieldMin, sceneNoise);
            sceneFieldMax = Math.max(sceneFieldMax, sceneNoise);
        }

        const centeredNoise = (sceneNoise * 2.0) - 1.0;
        const noisyScale = Math.max(0.0, 1.0 + (centeredNoise * sceneFieldDepth));
        const amplitudeScale = lerp(1.0, noisyScale, sceneFieldInfluence);
        const offsetMm = signal * amplitudeMm * amplitudeScale;
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
            `Applied oscillating normal: amp=${amplitudeMm.toFixed(2)}mm source=${sourceModeLabel(sourceMode)} wave=${waveModeLabel(waveMode)} freq=${frequency.toFixed(2)} ${sourceMode < 0.5 ? 'cyc/100mm' : 'cyc/layer'} fieldMix=${sceneFieldInfluence.toFixed(2)} fieldDepth=${sceneFieldDepth.toFixed(2)}`,
            sceneFieldCount > 0
                ? `Scene field noise samples: count=${sceneFieldCount} range=${sceneFieldMin.toFixed(3)}..${sceneFieldMax.toFixed(3)}`
                : 'Scene field noise samples missing on points (using fallback=1.0).',
        ],
    };
}

function readScalarSceneField(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function lerp(a: number, b: number, t: number): number {
    return a + ((b - a) * t);
}

function evaluateWave(turns: number, waveMode: number, pulseDutyCycle: number): number {
    const phase = frac(turns);

    switch (waveMode) {
        case 1:
            return Math.sin(turns * TAU) >= 0 ? 1.0 : -1.0;
        case 2:
            return 1.0 - (4.0 * Math.abs(phase - 0.5));
        case 3:
            return (2.0 * phase) - 1.0;
        case 4:
            return 1.0 - (2.0 * phase);
        case 5:
            return Math.cos(turns * TAU);
        case 6:
            return phase < pulseDutyCycle ? 1.0 : -1.0;
        case 0:
        default:
            return Math.sin(turns * TAU);
    }
}

function sourceModeLabel(sourceMode: number): string {
    return sourceMode < 0.5 ? 'filament' : 'layer-normalized';
}

function waveModeLabel(waveMode: number): string {
    switch (waveMode) {
        case 1:
            return 'square';
        case 2:
            return 'triangle';
        case 3:
            return 'ramp-up';
        case 4:
            return 'ramp-down';
        case 5:
            return 'cosine';
        case 6:
            return 'pulse';
        case 0:
        default:
            return 'sine';
    }
}

function frac(value: number): number {
    return value - Math.floor(value);
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
            const prevIndex = i > start ? i - 1 : end;
            const nextIndex = i < end ? i + 1 : start;
            const prev = points[prevIndex] ?? points[i];
            const next = points[nextIndex] ?? points[i];
            const tangentX = Number(next?.x ?? 0.0) - Number(prev?.x ?? 0.0);
            const tangentZ = Number(next?.z ?? 0.0) - Number(prev?.z ?? 0.0);
            const tangentLen = Math.hypot(tangentX, tangentZ);

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

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
