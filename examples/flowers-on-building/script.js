/**
 * Flowers on Building — Composition demo.
 *
 * Mixed output graph: building (GeneratedInstance[]) + flowers (IObject3D).
 * Uses launchGraphViewer which now handles both output types.
 */
import { _testFinish, _testStart } from 'threepipe';
import { launchGraphViewer } from '@threepipe/plugin-procedural-generation';
import { graphModule } from './graph';
_testStart();
launchGraphViewer(graphModule, {
    cameraPos: [25, 20, 30],
    cameraTarget: [0, 9, 0],
    groundSize: 100,
}).finally(_testFinish);
