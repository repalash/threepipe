/**
 * Buildify Demo 3 — Procedural Buildings (Grid-based)
 *
 * Uses the generic GraphViewer with the building graph definition.
 * The graph file (graph.ts) can also be verified against ground truth:
 *
 *   npx tsx plugins/procedural-generation/porting/scripts/compare_graph.ts \
 *     examples/buildify-demo-3/graph.ts /tmp/buildings_gt/all_ground_truth.json
 */
import { _testFinish, _testStart } from 'threepipe';
import { launchGraphViewer } from '@threepipe/plugin-procedural-generation';
import { graphModule } from './graph';
_testStart();
launchGraphViewer(graphModule, {
    cameraPos: [0, 40, 100],
    cameraTarget: [-5, 10, 0],
    groundSize: 200,
}).finally(_testFinish);
