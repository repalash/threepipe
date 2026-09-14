/**
 * verify.ts — Verify the pebble scatter graph module against ground truth.
 *
 * Loads the ground mesh geometry from ground.glb, sets it on the graph runtime,
 * evaluates, and compares against Blender ground truth.
 *
 * Also checks reactivity (seed/factor changes affect output).
 *
 * Usage:
 *   npx tsx --tsconfig plugins/procedural-generation/porting/scripts/tsconfig.json examples/pebble-scatter/verify.ts
 */
import { DummyRenderManager } from '../../plugins/procedural-generation/src/utils/node-polyfill';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRuntime } from '../../plugins/procedural-generation/src/graph/runtime';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOL = 0.01;
// Blender reference counts (from depsgraph / ground_truth.json):
const BLENDER_COUNTS = {
    'GEO-pebble': 4865, // Large pebbles (Poisson)
    'GEO-pebble.004': 11501, // Medium pebbles (Random)
    'GEO-pebble.002': 24392, // Small pebbles (Random)
};
const BLENDER_TOTAL = 40758;
// Map our GLB names to Blender object names for ground truth matching
const GLB_TO_BLENDER = {
    'object_GEO-pebble.glb': 'GEO-pebble',
    'object_GEO-pebble_004.glb': 'GEO-pebble.004',
    'object_GEO-pebble_002.glb': 'GEO-pebble.002',
};
function matricesMatch(a, b, tol) {
    if (a.length !== 16 || b.length !== 16)
        return false;
    for (let i = 0; i < 16; i++)
        if (Math.abs(a[i] - b[i]) > tol)
            return false;
    return true;
}
function positionsMatch(a, b, tol) {
    return Math.abs(a[12] - b[12]) < tol && Math.abs(a[13] - b[13]) < tol && Math.abs(a[14] - b[14]) < tol;
}
async function main() {
    console.log('=== Pebble Scatter Verification ===\n');
    // Import graph module
    const { graphModule, groupInputNode } = await import('./graph');
    // Load ground.glb for the scatter surface
    const assetsDir = path.resolve(__dirname, 'assets');
    const groundPath = path.join(assetsDir, 'ground.glb');
    if (!fs.existsSync(groundPath)) {
        console.error('ERROR: ground.glb not found at', groundPath);
        process.exit(1);
    }
    // Load ground mesh geometry using ThreeViewer
    const { ThreeViewer } = await import('threepipe');
    const canvas = globalThis.document.createElement('canvas');
    canvas.id = 'verify';
    const viewer = new ThreeViewer({ canvas, rmClass: DummyRenderManager, tonemap: false });
    const buffer = fs.readFileSync(groundPath);
    const file = new File([buffer], 'ground.glb', { type: 'model/gltf-binary' });
    const result = await viewer.assetManager.addAsset(file);
    const obj = Array.isArray(result) ? result[0] : result;
    let groundGeometry = null;
    if (obj?.traverse) {
        obj.traverse((child) => {
            if (child.isMesh && child.geometry && !groundGeometry) {
                groundGeometry = child.geometry;
            }
        });
    }
    if (!groundGeometry) {
        console.error('ERROR: Could not extract geometry from ground.glb');
        process.exit(1);
    }
    console.log('Ground mesh loaded successfully');
    const posAttr = groundGeometry.getAttribute('position');
    console.log(`  Vertices: ${posAttr?.count ?? 0}`);
    // Create runtime and set ground geometry
    const entry = graphModule.graphs[0];
    const runtime = createRuntime(entry.graph);
    runtime.set(groupInputNode, 'groundGeometry', groundGeometry);
    // Evaluate with default parameters
    console.log('\n--- Default parameters ---');
    runtime.evaluate();
    const output = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    console.log(`Total instances: ${output.length} (Blender: ${BLENDER_TOTAL})`);
    // Group by asset name
    const counts = new Map();
    for (const inst of output) {
        counts.set(inst.object_name, (counts.get(inst.object_name) ?? 0) + 1);
    }
    let pass = true;
    // Check instance counts
    console.log('\nInstance counts by asset:');
    for (const [glbName, blenderName] of Object.entries(GLB_TO_BLENDER)) {
        const genCount = counts.get(glbName) ?? 0;
        const blenderCount = BLENDER_COUNTS[blenderName];
        const ratio = blenderCount > 0 ? genCount / blenderCount : 0;
        const ok = ratio > 0.5 && ratio < 2.0;
        console.log(`  ${glbName}: ${genCount} (Blender: ${blenderCount}, ratio: ${ratio.toFixed(2)}) ${ok ? 'OK' : 'FAIL'}`);
        if (!ok)
            pass = false;
    }
    // Load ground truth and compare matrices
    const gtPath = path.resolve(__dirname, 'ground_truth.json');
    if (fs.existsSync(gtPath)) {
        console.log('\n--- Ground truth comparison ---');
        const gtData = JSON.parse(fs.readFileSync(gtPath, 'utf8'));
        const gtInstances = gtData.instances;
        console.log(`Ground truth: ${gtInstances.length} instances`);
        // Group GT by object name
        const gtByName = new Map();
        for (const inst of gtInstances) {
            let list = gtByName.get(inst.object_name);
            if (!list) {
                list = [];
                gtByName.set(inst.object_name, list);
            }
            list.push(inst);
        }
        // Compare per-asset type
        for (const [glbName, blenderName] of Object.entries(GLB_TO_BLENDER)) {
            const genList = output.filter(i => i.object_name === glbName);
            const gtList = gtByName.get(blenderName) ?? [];
            if (genList.length === 0 || gtList.length === 0)
                continue;
            // Build index of GT positions for fast lookup
            const gtUsed = new Set();
            let fullMatch = 0, posOnlyMatch = 0, noMatch = 0;
            for (const gen of genList) {
                let bestIdx = -1;
                let bestType = 'none';
                for (let j = 0; j < gtList.length; j++) {
                    if (gtUsed.has(j))
                        continue;
                    if (matricesMatch(gen.world_matrix, gtList[j].world_matrix, TOL)) {
                        bestIdx = j;
                        bestType = 'full';
                        break;
                    }
                }
                if (bestType === 'none') {
                    for (let j = 0; j < gtList.length; j++) {
                        if (gtUsed.has(j))
                            continue;
                        if (positionsMatch(gen.world_matrix, gtList[j].world_matrix, TOL)) {
                            bestIdx = j;
                            bestType = 'pos';
                            break;
                        }
                    }
                }
                if (bestIdx >= 0)
                    gtUsed.add(bestIdx);
                if (bestType === 'full')
                    fullMatch++;
                else if (bestType === 'pos')
                    posOnlyMatch++;
                else
                    noMatch++;
            }
            const total = genList.length;
            console.log(`  ${blenderName}: ${fullMatch}/${total} full match, ${posOnlyMatch} pos-only, ${noMatch} no-match (GT: ${gtList.length})`);
        }
    }
    // Scene bounding box
    if (output.length > 0) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const inst of output) {
            const m = inst.world_matrix;
            const x = m[12], y = m[13], z = m[14];
            if (x < min[0])
                min[0] = x;
            if (x > max[0])
                max[0] = x;
            if (y < min[1])
                min[1] = y;
            if (y > max[1])
                max[1] = y;
            if (z < min[2])
                min[2] = z;
            if (z > max[2])
                max[2] = z;
        }
        console.log(`\nScene bbox (positions):`);
        console.log(`  min: [${min.map(v => v.toFixed(3)).join(', ')}]`);
        console.log(`  max: [${max.map(v => v.toFixed(3)).join(', ')}]`);
        const extentX = max[0] - min[0];
        const extentY = max[1] - min[1];
        console.log(`  Extent: X=${extentX.toFixed(2)}, Y=${extentY.toFixed(2)}`);
        if (extentX < 4 || extentY < 4) {
            console.log('  FAIL: Scatter extent too small');
            pass = false;
        }
        else {
            console.log('  OK: Scatter extent reasonable');
        }
    }
    // Reactivity check: change seed
    console.log('\n--- Reactivity check ---');
    runtime.set(groupInputNode, 'seed', 42);
    runtime.evaluate();
    const output2 = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    const seedChanged = output.length !== output2.length ||
        !output.every((inst, i) => {
            const m1 = inst.world_matrix, m2 = output2[i]?.world_matrix;
            return m2 && m1[12] === m2[12] && m1[13] === m2[13] && m1[14] === m2[14];
        });
    if (!seedChanged) {
        console.log('  FAIL: Output did not change when seed changed');
        pass = false;
    }
    else {
        console.log(`  OK: Seed change -> different output (${output.length} -> ${output2.length} instances)`);
    }
    // Change density factor
    runtime.set(groupInputNode, 'seed', 0); // reset
    runtime.set(groupInputNode, 'largeFactor', 2);
    runtime.evaluate();
    const output3 = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    const largeCount3 = output3.filter(i => i.object_name === 'object_GEO-pebble.glb').length;
    const origLargeCount = counts.get('object_GEO-pebble.glb') ?? 0;
    if (largeCount3 === origLargeCount) {
        console.log('  FAIL: Large pebble count unchanged when factor changed');
        pass = false;
    }
    else {
        console.log(`  OK: Factor change -> large pebbles (${origLargeCount} -> ${largeCount3})`);
    }
    // Zero density test
    runtime.set(groupInputNode, 'largeFactor', 0);
    runtime.set(groupInputNode, 'mediumFactor', 0);
    runtime.set(groupInputNode, 'smallFactor', 0);
    runtime.evaluate();
    const output4 = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    if (output4.length !== 0) {
        console.log(`  FAIL: Expected 0 instances with all factors=0, got ${output4.length}`);
        pass = false;
    }
    else {
        console.log('  OK: All factors=0 -> 0 instances');
    }
    // Final result
    console.log(`\n=== ${pass ? 'PASS' : 'FAIL'} ===`);
    viewer.dispose();
    process.exit(pass ? 0 : 1);
}
main().catch(e => {
    console.error('ERROR:', e);
    process.exit(1);
});
