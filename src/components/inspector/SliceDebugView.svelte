<script lang="ts">
    import { afterUpdate, onMount } from 'svelte';

    import type { SliceDebugSnapshot } from '../../core/slicer';

    export let snapshot: SliceDebugSnapshot;

    let canvasEl: HTMLCanvasElement | null = null;

    function drawSnapshot(): void {
        const canvas = canvasEl;
        if (!canvas || !snapshot) {
            return;
        }

        const fieldRows = snapshot.field.length;
        const fieldCols = snapshot.field[0]?.length ?? 0;
        const width = Math.max(1, fieldCols);
        const height = Math.max(1, fieldRows);

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const minD = Math.min(snapshot.minDistance, -1e-6);
        const maxD = Math.max(snapshot.maxDistance, 1e-6);
        const imageData = ctx.createImageData(width, height);

        for (let row = 0; row < height; row++) {
            const srcRow = snapshot.field[height - 1 - row] ?? [];
            for (let col = 0; col < width; col++) {
                const value = srcRow[col] ?? maxD;
                const normalized = value < 0
                    ? 0.5 * (1.0 - clamp01(value / minD))
                    : 0.5 + 0.5 * clamp01(value / maxD);
                const g = Math.round(normalized * 255);
                const idx = ((row * width) + col) * 4;
                imageData.data[idx] = g;
                imageData.data[idx + 1] = g;
                imageData.data[idx + 2] = g;
                imageData.data[idx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);

        const toPixelX = (x: number): number => {
            const t = (x - snapshot.bounds.minX) / Math.max(1e-6, snapshot.bounds.maxX - snapshot.bounds.minX);
            return t * (width - 1);
        };

        const toPixelY = (z: number): number => {
            const t = (z - snapshot.bounds.minZ) / Math.max(1e-6, snapshot.bounds.maxZ - snapshot.bounds.minZ);
            return (1 - t) * (height - 1);
        };

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.strokeStyle = 'rgba(214, 40, 40, 0.35)';
        ctx.lineWidth = 1;
        for (const segment of snapshot.segments) {
            ctx.beginPath();
            ctx.moveTo(toPixelX(segment.ax), toPixelY(segment.az));
            ctx.lineTo(toPixelX(segment.bx), toPixelY(segment.bz));
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(27, 153, 139, 0.95)';
        ctx.lineWidth = 1.5;
        for (const contour of snapshot.closedContours) {
            if (contour.length < 2) {
                continue;
            }

            ctx.beginPath();
            ctx.moveTo(toPixelX(contour[0].x), toPixelY(contour[0].z));
            for (let index = 1; index < contour.length; index++) {
                const point = contour[index];
                ctx.lineTo(toPixelX(point.x), toPixelY(point.z));
            }
            ctx.closePath();
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(245, 130, 48, 0.95)';
        ctx.lineWidth = 1.3;
        for (const polyline of snapshot.openPolylines) {
            if (polyline.length < 2) {
                continue;
            }

            ctx.beginPath();
            ctx.moveTo(toPixelX(polyline[0].x), toPixelY(polyline[0].z));
            for (let index = 1; index < polyline.length; index++) {
                const point = polyline[index];
                ctx.lineTo(toPixelX(point.x), toPixelY(point.z));
            }
            ctx.stroke();
        }
    }

    function clamp01(value: number): number {
        return Math.min(1, Math.max(0, value));
    }

    onMount(drawSnapshot);
    afterUpdate(drawSnapshot);
</script>

<section class="slice-debug" aria-label="Slice debug visualization">
    <div class="slice-debug-meta">
        <strong>Slice Debug</strong>
        <span>Layer {snapshot.layerIndex}/{snapshot.layerCount}</span>
        <span>Z {snapshot.sliceHeightMm.toFixed(2)} mm</span>
        <span>{snapshot.contourCount} contour(s){snapshot.detail ? ` (${snapshot.detail})` : ''}</span>
    </div>

    <div class="slice-debug-grid">
        <canvas bind:this={canvasEl} class="slice-debug-canvas" aria-label="Failed slice field and contour overlay"></canvas>
    </div>

    <div class="slice-debug-legend">
        <span><i class="swatch swatch-segment"></i>Segments</span>
        <span><i class="swatch swatch-closed"></i>Closed contours</span>
        <span><i class="swatch swatch-open"></i>Open polylines</span>
    </div>

    <div class="slice-debug-notes">
        <span>Field: {snapshot.gridSize} x {snapshot.gridSize}</span>
        <span>Distance range: [{snapshot.minDistance.toFixed(4)}, {snapshot.maxDistance.toFixed(4)}]</span>
        <span>Open paths: {snapshot.openPolylines.length}</span>
    </div>
</section>

<style>
    .slice-debug {
        margin-top: 0.9rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 0.75rem;
        background: rgba(8, 12, 10, 0.65);
    }

    .slice-debug-meta,
    .slice-debug-legend,
    .slice-debug-notes {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        font-size: 0.78rem;
        color: rgba(236, 243, 238, 0.9);
    }

    .slice-debug-meta {
        margin-bottom: 0.5rem;
    }

    .slice-debug-grid {
        border-radius: 8px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.32);
        border: 1px solid rgba(255, 255, 255, 0.09);
    }

    .slice-debug-canvas {
        display: block;
        width: 100%;
        height: auto;
        image-rendering: pixelated;
        aspect-ratio: 1 / 1;
    }

    .slice-debug-legend {
        margin-top: 0.55rem;
    }

    .slice-debug-notes {
        margin-top: 0.35rem;
        color: rgba(219, 230, 223, 0.8);
    }

    .swatch {
        display: inline-block;
        width: 0.9rem;
        height: 0.28rem;
        border-radius: 0.2rem;
        margin-right: 0.35rem;
        vertical-align: middle;
    }

    .swatch-segment {
        background: rgba(214, 40, 40, 0.9);
    }

    .swatch-closed {
        background: rgba(27, 153, 139, 0.95);
    }

    .swatch-open {
        background: rgba(245, 130, 48, 0.95);
    }
</style>
