import type { VaseSliceBenchmarkRun } from '../core/slicer';
import type { SlicerBenchmarkSummary } from '../studio-controller';

export function summarizeBenchmarkRuns(runs: VaseSliceBenchmarkRun[], warmupRuns: number, measuredRuns: number): SlicerBenchmarkSummary {
    if (runs.length === 0) {
        throw new Error('Benchmark completed without any runs.');
    }

    const measured = runs.filter((run) => !run.isWarmup);
    if (measured.length === 0) {
        throw new Error('Benchmark completed without any measured runs.');
    }

    let totalMs = 0;
    let totalContourSamplingMs = 0;
    let totalToolpathBuildMs = 0;
    let totalGcodeBuildMs = 0;
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = 0;

    for (const run of measured) {
        totalMs += run.timings.totalMs;
        totalContourSamplingMs += run.timings.contourSamplingMs;
        totalToolpathBuildMs += run.timings.toolpathBuildMs;
        totalGcodeBuildMs += run.timings.gcodeBuildMs;
        minMs = Math.min(minMs, run.timings.totalMs);
        maxMs = Math.max(maxMs, run.timings.totalMs);
    }

    const lastRun = runs[runs.length - 1];
    const sortedTotals = measured
        .map((run) => run.timings.totalMs)
        .sort((a, b) => a - b);
    const middleIndex = Math.floor(sortedTotals.length / 2);
    const medianMs = sortedTotals.length % 2 === 0
        ? (sortedTotals[middleIndex - 1] + sortedTotals[middleIndex]) * 0.5
        : sortedTotals[middleIndex];

    return {
        totalRuns: runs.length,
        measuredRuns,
        warmupRuns,
        averageMs: totalMs / measured.length,
        medianMs,
        minMs,
        maxMs,
        spreadMs: maxMs - minMs,
        averageContourSamplingMs: totalContourSamplingMs / measured.length,
        averageToolpathBuildMs: totalToolpathBuildMs / measured.length,
        averageGcodeBuildMs: totalGcodeBuildMs / measured.length,
        points: lastRun.pointCount,
        layers: lastRun.layerCount,
        bytes: lastRun.gcodeBytes,
    };
}
