/** Shared numeric helpers for the slicer modules. */

export interface Point3 {
    x: number;
    y: number;
    z: number;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, Math.round(value)));
}

export function lerp(a: number, b: number, t: number): number {
    return a + ((b - a) * t);
}

export function distance3(a: Point3, b: Point3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function turnAngleDegrees(a: Point3, b: Point3, c: Point3): number {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const vz = c.z - b.z;

    const lu = Math.hypot(ux, uy, uz);
    const lv = Math.hypot(vx, vy, vz);
    if (lu < 1e-9 || lv < 1e-9) {
        return 0;
    }

    const cosTheta = clamp(((ux * vx) + (uy * vy) + (uz * vz)) / (lu * lv), -1, 1);
    return (Math.acos(cosTheta) * 180) / Math.PI;
}

export function pointLineDistance3(p: Point3, a: Point3, b: Point3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const apz = p.z - a.z;

    const abLenSq = (abx * abx) + (aby * aby) + (abz * abz);
    if (abLenSq < 1e-12) {
        return Math.hypot(apx, apy, apz);
    }

    const t = clamp(((apx * abx) + (apy * aby) + (apz * abz)) / abLenSq, 0, 1);
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const qz = a.z + abz * t;
    return Math.hypot(p.x - qx, p.y - qy, p.z - qz);
}

/** Cooperative yield that works on the main thread and in workers. */
export async function yieldToMainThread(): Promise<void> {
    await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
            return;
        }

        setTimeout(() => resolve(), 0);
    });
}
