import type { SliceProgressUpdate } from '../core/slicer';

/**
 * Learns a slice's expected total duration from measured sampling throughput
 * (sampling spans the 2%–78% window of overall progress, hence the 0.76
 * factor) and smooths the displayed ETA so it counts down steadily instead
 * of jumping when a phase's throughput shifts. One instance per slice run.
 */
export class SliceEtaEstimator {
    private readonly startMs: number;
    private lastPhase = '';
    private samplingPhaseStartMs: number | null = null;
    private learnedTotalSliceSeconds: number | null = null;
    private displayedEtaSeconds: number | null = null;
    private lastEtaUpdateMs: number;

    constructor(nowMs: number = performance.now()) {
        this.startMs = nowMs;
        this.lastEtaUpdateMs = nowMs;
    }

    /** Feed one progress update; returns the smoothed ETA in seconds, or null while data is too thin. */
    public observe(update: SliceProgressUpdate, nowMs: number = performance.now()): number | null {
        const progress = Math.max(0, Math.min(1, update.overall));

        if (update.phase === 'sampling') {
            if (this.samplingPhaseStartMs === null) {
                this.samplingPhaseStartMs = nowMs;
            }

            const samplingElapsedSeconds = Math.max(0, (nowMs - this.samplingPhaseStartMs) / 1000);
            const phaseProgress = update.total > 0 ? Math.max(0, Math.min(1, update.completed / update.total)) : 0;

            // Learn expected total slice duration from measured sampling throughput once enough data exists.
            if (update.completed >= 4 && phaseProgress >= 0.05) {
                const estimatedSamplingTotalSeconds = samplingElapsedSeconds / phaseProgress;
                const estimatedSliceTotalSeconds = estimatedSamplingTotalSeconds / 0.76;
                this.learnedTotalSliceSeconds = this.learnedTotalSliceSeconds === null
                    ? estimatedSliceTotalSeconds
                    : (this.learnedTotalSliceSeconds * 0.6) + (estimatedSliceTotalSeconds * 0.4);
            }
        } else if (this.lastPhase === 'sampling' && this.samplingPhaseStartMs !== null && this.learnedTotalSliceSeconds === null) {
            const samplingElapsedSeconds = Math.max(0, (nowMs - this.samplingPhaseStartMs) / 1000);
            this.learnedTotalSliceSeconds = samplingElapsedSeconds / 0.76;
        }

        this.lastPhase = update.phase;

        const elapsedSeconds = Math.max(0, (nowMs - this.startMs) / 1000);
        const fallbackEtaSeconds = progress > 0.2
            ? Math.max(0, elapsedSeconds * ((1 / progress) - 1))
            : null;
        const rawEtaSeconds = this.learnedTotalSliceSeconds !== null
            ? Math.max(0, this.learnedTotalSliceSeconds - elapsedSeconds)
            : fallbackEtaSeconds;

        if (rawEtaSeconds === null) {
            return null;
        }

        if (this.displayedEtaSeconds === null) {
            this.displayedEtaSeconds = rawEtaSeconds;
        } else {
            // ETAs may fall freely but only rise slowly, so throughput noise
            // does not make the countdown jump backwards.
            const deltaSeconds = Math.max(1e-3, (nowMs - this.lastEtaUpdateMs) / 1000);
            const allowedRise = (deltaSeconds * 0.45) + 0.08;
            if (rawEtaSeconds > this.displayedEtaSeconds + allowedRise) {
                this.displayedEtaSeconds += allowedRise;
            } else {
                this.displayedEtaSeconds = rawEtaSeconds;
            }
        }

        if (update.phase === 'finalizing') {
            this.displayedEtaSeconds = Math.min(this.displayedEtaSeconds, 1);
        }

        this.lastEtaUpdateMs = nowMs;
        return this.displayedEtaSeconds;
    }
}
