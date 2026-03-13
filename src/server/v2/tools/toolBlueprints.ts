// @ts-nocheck

import { buildBrowserToolBlueprints } from './browserBlueprints.js';
import { buildInspectToolBlueprints } from './inspectBlueprints.js';
import { buildDebugToolBlueprints } from './debugBlueprints.js';
import { buildAnalyzeToolBlueprints } from './analyzeBlueprints.js';
import { buildHookToolBlueprints } from './hookBlueprints.js';
import { buildFlowToolBlueprints } from './flowBlueprints.js';

export function buildToolBlueprints(shared) {
    return [
        ...buildBrowserToolBlueprints(shared),
        ...buildInspectToolBlueprints(shared),
        ...buildDebugToolBlueprints(shared),
        ...buildAnalyzeToolBlueprints(shared),
        ...buildHookToolBlueprints(shared),
        ...buildFlowToolBlueprints(shared),
    ];
}
