// @ts-nocheck

export function summarizeBenchmarkRuns(runs) {
    const summary = {
        totalRuns: runs.length,
        successfulRuns: 0,
        failedRuns: 0,
        profileUsage: {},
        transportUsage: {},
        scenarioUsage: {},
        responseModeRecommendations: {},
    };
    for (const run of runs) {
        if (run.success === true) {
            summary.successfulRuns += 1;
        }
        else {
            summary.failedRuns += 1;
        }
        summary.profileUsage[run.profile] = (summary.profileUsage[run.profile] || 0) + 1;
        summary.transportUsage[run.transport] = (summary.transportUsage[run.transport] || 0) + 1;
        summary.scenarioUsage[run.scenario] = (summary.scenarioUsage[run.scenario] || 0) + 1;
        for (const [toolName, recommendation] of Object.entries(run.responseModeResults || {})) {
            if (!summary.responseModeRecommendations[toolName]) {
                summary.responseModeRecommendations[toolName] = {
                    compact: 0,
                    full: 0,
                };
            }
            const mode = recommendation?.recommendedMode === 'compact' ? 'compact' : 'full';
            summary.responseModeRecommendations[toolName][mode] += 1;
        }
    }
    return summary;
}
