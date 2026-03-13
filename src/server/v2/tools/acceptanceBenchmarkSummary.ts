// @ts-nocheck

export function summarizeAcceptanceBenchmarkRuns(runs) {
    const summary = {
        totalRuns: runs.length,
        successfulRuns: 0,
        failedRuns: 0,
        surfaceUsage: {},
        scenarioUsage: {},
        scenarioSuccess: {},
    };
    for (const run of runs) {
        if (run.success === true) {
            summary.successfulRuns += 1;
        }
        else {
            summary.failedRuns += 1;
        }
        summary.surfaceUsage[run.surface] = (summary.surfaceUsage[run.surface] || 0) + 1;
        summary.scenarioUsage[run.scenario] = (summary.scenarioUsage[run.scenario] || 0) + 1;
        if (!summary.scenarioSuccess[run.scenario]) {
            summary.scenarioSuccess[run.scenario] = {
                passes: 0,
                failures: 0,
            };
        }
        if (run.success === true) {
            summary.scenarioSuccess[run.scenario].passes += 1;
        }
        else {
            summary.scenarioSuccess[run.scenario].failures += 1;
        }
    }
    return summary;
}
