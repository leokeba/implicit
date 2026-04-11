export function transform(context: any) {
    const amplitudeMm = 2.4;
    const phaseTurns = 7.0;
    const centerX = Number(context.settings?.centerX ?? 0);
    const centerZ = Number(context.settings?.centerZ ?? 0);
    const nextPoints = context.points.map((point: any) => {
        const angle = point.metrics.spiralPathProgress * phaseTurns * Math.PI * 2.0;
        const localX = point.x - centerX;
        const localZ = point.z - centerZ;
        const radius = Math.max(1e-6, Math.hypot(localX, localZ));
        const waveOffsetMm = Math.sin(angle) * amplitudeMm;
        const normalX = localX / radius;
        const normalZ = localZ / radius;
        const layerExtrusionBias = 0.85 + (0.3 * point.metrics.layerFilamentProgress);

        return {
            ...point,
            x: point.x + (normalX * waveOffsetMm),
            z: point.z + (normalZ * waveOffsetMm),
            extrusionScale: layerExtrusionBias,
        };
    });

    return {
        points: nextPoints,
        notes: ['Applied center-relative spiral radial wave with layer-relative extrusion bias'],
    };
}