import type { ViewportParams } from './types';

const CAMERA_STATE_STORAGE_KEY = 'implicit.camera.orbit.v1';

export interface CameraVec3 {
    x: number;
    y: number;
    z: number;
}

export interface CameraBasis {
    forward: CameraVec3;
    right: CameraVec3;
    up: CameraVec3;
}

interface StoredCameraState {
    yaw: number;
    pitch: number;
    distance: number;
    targetX: number;
    targetY: number;
    targetZ: number;
}

/**
 * Orbit camera state plus all viewport interaction: pointer orbit/pan/dolly,
 * two-finger pinch, wheel zoom, double-click and F-key reset, and
 * sessionStorage persistence. The renderer only reads position/basis/target.
 */
export class CameraController {
    private orbitYaw: number;
    private orbitPitch: number;
    private orbitDistance: number;
    private targetX: number;
    private targetY: number;
    private targetZ: number;
    private isPointerDown = false;
    private pointerMode: 'orbit' | 'pan' | 'dolly' | null = null;
    private lastPointerX = 0;
    private lastPointerY = 0;
    private activePointers = new Map<number, { x: number; y: number }>();
    private pinchDistance: number | null = null;
    private detachHandlers: (() => void) | null = null;

    constructor(
        private readonly getViewportParams: () => ViewportParams,
        private readonly onChanged: () => void,
    ) {
        const savedState = this.readStoredCameraState();
        this.orbitYaw = savedState.yaw;
        this.orbitPitch = savedState.pitch;
        this.orbitDistance = savedState.distance;
        this.targetX = savedState.targetX;
        this.targetY = savedState.targetY;
        this.targetZ = savedState.targetZ;
    }

    public getTarget(): CameraVec3 {
        return { x: this.targetX, y: this.targetY, z: this.targetZ };
    }

    public getPosition(): CameraVec3 {
        const basis = this.getBasis();
        return {
            x: this.targetX + basis.forward.x * -this.orbitDistance,
            y: this.targetY + basis.forward.y * -this.orbitDistance,
            z: this.targetZ + basis.forward.z * -this.orbitDistance,
        };
    }

    public getBasis(): CameraBasis {
        const cp = Math.cos(this.orbitPitch);
        const forward = {
            x: cp * Math.sin(this.orbitYaw),
            y: Math.sin(this.orbitPitch),
            z: cp * Math.cos(this.orbitYaw),
        };

        const upWorld = { x: 0.0, y: 1.0, z: 0.0 };
        const right = normalize3(cross3(upWorld, forward));
        const up = normalize3(cross3(forward, right));

        return { forward, right, up };
    }

    public reset(): void {
        this.orbitYaw = 0.45;
        this.orbitPitch = 0.25;
        this.orbitDistance = 3.0;
        this.targetX = 0.0;
        this.targetY = 0.0;
        this.targetZ = 0.0;
        this.storeCameraState();
    }

    public detach(): void {
        this.detachHandlers?.();
        this.detachHandlers = null;
    }

    public attach(canvas: HTMLCanvasElement): void {
        this.detach();
        canvas.style.cursor = 'grab';
        // Pointer Events cover mouse, touch, and pen with one code path.
        // Two simultaneous touch pointers drive pinch-dolly plus pan.
        canvas.style.touchAction = 'none';

        const onContextMenu = (event: MouseEvent): void => {
            event.preventDefault();
        };

        const onDblClick = (): void => {
            this.reset();
        };

        const onPointerDown = (event: PointerEvent): void => {
            if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1 && event.button !== 2) {
                return;
            }

            try {
                canvas.setPointerCapture(event.pointerId);
            } catch {
                // The pointer may already be gone (e.g. touch lifted mid-gesture).
            }
            this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (this.activePointers.size === 2) {
                this.pinchDistance = this.currentPinchDistance();
                this.pointerMode = null;
                return;
            }

            this.isPointerDown = true;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
            if (event.pointerType === 'mouse' && event.button === 1) {
                this.pointerMode = 'dolly';
            } else {
                this.pointerMode = (event.pointerType === 'mouse' && event.button === 2) || event.shiftKey ? 'pan' : 'orbit';
            }
            canvas.style.cursor = 'grabbing';
        };

        const releasePointer = (event: PointerEvent): void => {
            this.activePointers.delete(event.pointerId);
            this.pinchDistance = null;

            if (this.activePointers.size === 1) {
                // Pinch ended with one finger still down: continue as orbit from there.
                const remaining = [...this.activePointers.values()][0];
                this.lastPointerX = remaining.x;
                this.lastPointerY = remaining.y;
                this.isPointerDown = true;
                this.pointerMode = 'orbit';
                return;
            }

            this.isPointerDown = false;
            this.pointerMode = null;
            canvas.style.cursor = 'grab';
        };

        const onPointerMove = (event: PointerEvent): void => {
            if (!this.activePointers.has(event.pointerId)) {
                return;
            }

            this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (this.activePointers.size === 2) {
                const distance = this.currentPinchDistance();
                if (this.pinchDistance !== null && distance > 0 && this.pinchDistance > 0) {
                    this.orbitDistance *= this.pinchDistance / distance;
                    this.orbitDistance = Math.max(1.0, Math.min(16.0, this.orbitDistance));
                    this.storeCameraState();
                }
                this.pinchDistance = distance;
                return;
            }

            if (!this.isPointerDown) {
                return;
            }

            const dx = event.clientX - this.lastPointerX;
            const dy = event.clientY - this.lastPointerY;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
            const viewportParams = this.getViewportParams();

            if (this.pointerMode === 'pan') {
                const basis = this.getBasis();
                const panScale = (this.orbitDistance / Math.max(canvas.clientHeight, 1)) * viewportParams.panSensitivity;
                this.targetX += (-basis.right.x * dx + basis.up.x * dy) * panScale;
                this.targetY += (-basis.right.y * dx + basis.up.y * dy) * panScale;
                this.targetZ += (-basis.right.z * dx + basis.up.z * dy) * panScale;
                this.storeCameraState();
                return;
            }

            if (this.pointerMode === 'dolly') {
                this.orbitDistance *= Math.exp(dy * viewportParams.dollySensitivity);
                this.orbitDistance = Math.max(1.0, Math.min(16.0, this.orbitDistance));
                this.storeCameraState();
                return;
            }

            this.orbitYaw += dx * viewportParams.orbitSensitivity;
            this.orbitPitch -= dy * viewportParams.orbitSensitivity;

            const pitchLimit = 1.35;
            this.orbitPitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.orbitPitch));
            this.storeCameraState();
        };

        const onWheel = (event: WheelEvent): void => {
            event.preventDefault();
            this.orbitDistance *= Math.exp(event.deltaY * this.getViewportParams().zoomSensitivity);
            this.orbitDistance = Math.max(1.0, Math.min(16.0, this.orbitDistance));
            this.storeCameraState();
        };

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }
            const target = event.target;
            if (target instanceof HTMLElement && (
                target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || target instanceof HTMLSelectElement
                || target.isContentEditable
            )) {
                return;
            }
            this.reset();
        };

        canvas.addEventListener('contextmenu', onContextMenu);
        canvas.addEventListener('dblclick', onDblClick);
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointerup', releasePointer);
        canvas.addEventListener('pointercancel', releasePointer);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('keydown', onKeyDown);

        this.detachHandlers = () => {
            canvas.removeEventListener('contextmenu', onContextMenu);
            canvas.removeEventListener('dblclick', onDblClick);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointerup', releasePointer);
            canvas.removeEventListener('pointercancel', releasePointer);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('keydown', onKeyDown);
        };
    }

    private currentPinchDistance(): number {
        const points = [...this.activePointers.values()];
        if (points.length < 2) {
            return 0;
        }
        return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    }

    private readStoredCameraState(): StoredCameraState {
        const fallback: StoredCameraState = {
            yaw: 0.45,
            pitch: 0.25,
            distance: 3.0,
            targetX: 0.0,
            targetY: 0.0,
            targetZ: 0.0,
        };

        try {
            const raw = sessionStorage.getItem(CAMERA_STATE_STORAGE_KEY);
            if (!raw) {
                return fallback;
            }

            const parsed = JSON.parse(raw) as Partial<StoredCameraState>;
            if (
                typeof parsed.yaw !== 'number' ||
                typeof parsed.pitch !== 'number' ||
                typeof parsed.distance !== 'number'
            ) {
                return fallback;
            }

            return {
                yaw: parsed.yaw,
                pitch: Math.max(-1.35, Math.min(1.35, parsed.pitch)),
                distance: Math.max(1.5, Math.min(8.0, parsed.distance)),
                targetX: typeof parsed.targetX === 'number' ? parsed.targetX : 0.0,
                targetY: typeof parsed.targetY === 'number' ? parsed.targetY : 0.0,
                targetZ: typeof parsed.targetZ === 'number' ? parsed.targetZ : 0.0,
            };
        } catch {
            return fallback;
        }
    }

    private storeCameraState(): void {
        this.onChanged();
        try {
            sessionStorage.setItem(
                CAMERA_STATE_STORAGE_KEY,
                JSON.stringify({
                    yaw: this.orbitYaw,
                    pitch: this.orbitPitch,
                    distance: this.orbitDistance,
                    targetX: this.targetX,
                    targetY: this.targetY,
                    targetZ: this.targetZ,
                })
            );
        } catch {
            // Ignore storage errors (private mode/storage restrictions).
        }
    }
}

function cross3(a: CameraVec3, b: CameraVec3): CameraVec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function normalize3(v: CameraVec3): CameraVec3 {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-8) {
        return { x: 1.0, y: 0.0, z: 0.0 };
    }

    return {
        x: v.x / len,
        y: v.y / len,
        z: v.z / len,
    };
}
