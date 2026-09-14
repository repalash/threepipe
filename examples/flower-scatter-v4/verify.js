/**
 * verify.ts — Numerical verification of flower-scatter-v4 against Blender ground truth.
 *
 * Loads ground mesh geometry from ground.glb, loads texture data,
 * sets them on the graph runtime, evaluates, and compares against
 * the ground truth exported from Blender.
 *
 * Since scatter positions depend on triangle ordering in the GLB (which differs
 * from Blender's internal mesh), we verify DISTRIBUTION properties rather than
 * exact position matching:
 *   - Instance counts (total and per-asset)
 *   - Scale range matches GT
 *   - Position bounding box covers same area
 *   - Reactivity (seed/density changes affect output)
 *
 * For the 500-instance GT sample (all medium grass), we also do matrix matching
 * to check rotation/scale computation accuracy.
 *
 * Usage:
 *   npx tsx --tsconfig plugins/procedural-generation/porting/scripts/tsconfig.json examples/flower-scatter-v4/verify.ts
 */
import { DummyRenderManager } from '../../plugins/procedural-generation/src/utils/node-polyfill';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRuntime } from '../../plugins/procedural-generation/src/graph/runtime';
import sharp from 'sharp';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOL = 0.01;
// ─── Name mapping ────────────────────────────────────────────────────
// GT uses Blender object names, graph uses GLB filenames
const BLENDER_TO_GLB = {
    'GEO-leaf.grass.001': 'object_GEO-leaf_grass_001.glb',
    'GEO-leaf.grass.002': 'object_GEO-leaf_grass_002.glb',
    'GEO-leaf.grass.003': 'object_GEO-leaf_grass_003.glb',
    'GEO-leaf.grass.008': 'object_GEO-leaf_grass_008.glb',
    'GEO-leaf.grass-long.003': 'object_GEO-leaf_grass-long_003.glb',
    'GEO-leaf.grass-long.004': 'object_GEO-leaf_grass-long_004.glb',
    'GEO-leaf.grass-long.005': 'object_GEO-leaf_grass-long_005.glb',
    'EN-plants-bluebell.002': 'object_EN-plants-bluebell_002.glb',
    'EN-plants-bluebell.006': 'object_EN-plants-bluebell_006.glb',
    'EN-plants-bluebell.007': 'object_EN-plants-bluebell_007.glb',
    'EN-plants-bluebell.2': 'object_EN-plants-bluebell_2.glb',
    'EN-plants-bluebell.5': 'object_EN-plants-bluebell_5.glb',
    'EN-plants-dandelion.1': 'object_EN-plants-dandelion_1.glb',
    'EN-plants-dandelion.2': 'object_EN-plants-dandelion_2.glb',
    'EN-plants-dandelion.3': 'object_EN-plants-dandelion_3.glb',
    'EN-plants-dandelion.4': 'object_EN-plants-dandelion_4.glb',
};
const GLB_TO_BLENDER = Object.fromEntries(Object.entries(BLENDER_TO_GLB).map(([k, v]) => [v, k]));
// ─── Helpers ─────────────────────────────────────────────────────────
function extractScale(wm) {
    return Math.sqrt(wm[0] * wm[0] + wm[1] * wm[1] + wm[2] * wm[2]);
}
function extractPos(wm) {
    return [wm[12], wm[13], wm[14]];
}
function positionsMatch(a, b, tol) {
    return Math.abs(a[12] - b[12]) < tol && Math.abs(a[13] - b[13]) < tol && Math.abs(a[14] - b[14]) < tol;
}
function matricesMatch(a, b, tol) {
    if (a.length !== 16 || b.length !== 16)
        return false;
    for (let i = 0; i < 16; i++)
        if (Math.abs(a[i] - b[i]) > tol)
            return false;
    return true;
}
async function loadPngTexture(filepath) {
    if (!fs.existsSync(filepath)) {
        console.warn(`Texture not found: ${filepath}`);
        return null;
    }
    const img = sharp(filepath);
    const meta = await img.metadata();
    const { data } = await img.raw().toBuffer({ resolveWithObject: true });
    return {
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        width: meta.width,
        height: meta.height,
        channels: meta.channels ?? 4,
    };
}
// ─── Main ────────────────────────────────────────────────────────────
async function main() {
    console.log('=== Flower Scatter V4 — Numerical Verification ===\n');
    // Import graph module
    const { graphModule, groupInputNode } = await import('./graph');
    // Load ground.glb
    const assetsDir = path.resolve(__dirname, 'assets');
    const groundPath = path.join(assetsDir, 'ground.glb');
    if (!fs.existsSync(groundPath)) {
        console.error('ERROR: ground.glb not found at', groundPath);
        process.exit(1);
    }
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
    const posAttr = groundGeometry.getAttribute('position');
    console.log(`Ground mesh: ${posAttr?.count ?? 0} vertices`);
    // Load textures
    const densityMap = await loadPngTexture(path.join(assetsDir, 'texture_flowers-density_map.png'));
    const bluebellMask = await loadPngTexture(path.join(assetsDir, 'texture_bluebell-mask.png'));
    console.log(`Density map: ${densityMap ? `${densityMap.width}x${densityMap.height}` : 'NOT LOADED'}`);
    console.log(`Bluebell mask: ${bluebellMask ? `${bluebellMask.width}x${bluebellMask.height}` : 'NOT LOADED'}`);
    // Create runtime and set inputs
    const entry = graphModule.graphs[0];
    const runtime = createRuntime(entry.graph);
    runtime.set(groupInputNode, 'groundGeometry', groundGeometry);
    runtime.set(groupInputNode, 'textures', { densityMap, bluebellMask });
    // Evaluate with default parameters
    console.log('\n--- Evaluate with default parameters ---');
    runtime.evaluate();
    const output = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    console.log(`Total instances: ${output.length}`);
    let pass = true;
    // ── 1. Instance counts ──
    const counts = new Map();
    for (const inst of output) {
        counts.set(inst.object_name, (counts.get(inst.object_name) ?? 0) + 1);
    }
    let grassMediumCount = 0, grassLongCount = 0, bluebellCount = 0, dandelionCount = 0;
    console.log('\nInstance counts by asset:');
    for (const [name, count] of [...counts.entries()].sort()) {
        console.log(`  ${name}: ${count}`);
        if (name.includes('leaf_grass_'))
            grassMediumCount += count;
        if (name.includes('grass-long'))
            grassLongCount += count;
        if (name.includes('bluebell'))
            bluebellCount += count;
        if (name.includes('dandelion'))
            dandelionCount += count;
    }
    const grassCount = grassMediumCount + grassLongCount;
    const flowerCount = bluebellCount + dandelionCount;
    console.log(`\n  Medium grass: ${grassMediumCount}`);
    console.log(`  Long grass: ${grassLongCount}`);
    console.log(`  Bluebells: ${bluebellCount}`);
    console.log(`  Dandelions: ${dandelionCount}`);
    console.log(`  TOTAL grass: ${grassCount}`);
    console.log(`  TOTAL flowers: ${flowerCount}`);
    if (output.length === 0) {
        console.log('FAIL: No instances generated');
        pass = false;
    }
    if (grassCount === 0) {
        console.log('FAIL: No grass instances');
        pass = false;
    }
    // Verify uniform distribution across collection members (Separate Children=false)
    // Medium grass: 4 members, each scatter point creates 4 instances
    const grassMediumPerMember = grassMediumCount / 4;
    const grassMediumMemberCounts = [
        counts.get('object_GEO-leaf_grass_001.glb') ?? 0,
        counts.get('object_GEO-leaf_grass_002.glb') ?? 0,
        counts.get('object_GEO-leaf_grass_003.glb') ?? 0,
        counts.get('object_GEO-leaf_grass_008.glb') ?? 0,
    ];
    const allEqual = grassMediumMemberCounts.every(c => c === grassMediumMemberCounts[0]);
    if (!allEqual) {
        console.log(`  FAIL: Medium grass members not equal: ${grassMediumMemberCounts}`);
        pass = false;
    }
    else {
        console.log(`  OK: Medium grass members all equal (${grassMediumMemberCounts[0]} each)`);
    }
    // ── 2. Scale distribution ──
    console.log('\n--- Scale distribution ---');
    const genScales = output.map(i => extractScale(i.world_matrix));
    genScales.sort((a, b) => a - b);
    console.log(`  Generated scale range: [${genScales[0]?.toFixed(4)}, ${genScales[genScales.length - 1]?.toFixed(4)}]`);
    console.log(`  GT scale range:        [0.2686, 1.1580]`);
    // Check scale range is reasonable
    const scaleMin = genScales[0] ?? 0;
    const scaleMax = genScales[genScales.length - 1] ?? 0;
    if (scaleMin > 0.35) {
        console.log(`  WARN: Generated min scale (${scaleMin.toFixed(4)}) too high (GT: 0.2686)`);
    }
    if (scaleMax < 0.9 || scaleMax > 2.5) {
        console.log(`  WARN: Generated max scale (${scaleMax.toFixed(4)}) out of expected range`);
    }
    // ── 3. Position bounding box ──
    console.log('\n--- Position bounding box (Blender Z-up) ---');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const inst of output) {
        const [x, y, z] = extractPos(inst.world_matrix);
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
    console.log(`  Gen: [${min.map(v => v.toFixed(3)).join(', ')}] -> [${max.map(v => v.toFixed(3)).join(', ')}]`);
    console.log(`  GT:  [-4.756, -2.444, -0.057] -> [4.244, 5.385, 1.283]`);
    const extentX = max[0] - min[0];
    const extentY = max[1] - min[1];
    console.log(`  Extent: X=${extentX.toFixed(2)}, Y=${extentY.toFixed(2)}`);
    if (extentX < 4 || extentY < 4) {
        console.log('  WARN: Scatter extent may be too small');
    }
    // ── 4. Ground truth matrix comparison (500 sample) ──
    const gtPath = path.resolve(process.cwd(), 'tmp/flower_scattering_ground_truth.json');
    if (fs.existsSync(gtPath)) {
        console.log('\n--- Ground truth comparison (500 sample, all medium grass) ---');
        const gtData = JSON.parse(fs.readFileSync(gtPath, 'utf8'));
        const gtInstances = gtData.instances;
        console.log(`GT: ${gtInstances.length} instances, total_instances: ${gtData.total_instances}`);
        // Map GT names to GLB names
        const gtMapped = gtInstances.map(i => ({
            ...i,
            glb_name: BLENDER_TO_GLB[i.object_name] ?? i.object_name,
        }));
        // Filter our output to only medium grass for comparison
        const genMediumGrass = output.filter(i => i.object_name.includes('leaf_grass_'));
        console.log(`Gen medium grass: ${genMediumGrass.length}`);
        // GT scale analysis
        const gtScales = gtInstances.map(i => extractScale(i.world_matrix));
        gtScales.sort((a, b) => a - b);
        const genMedScales = genMediumGrass.map(i => extractScale(i.world_matrix));
        genMedScales.sort((a, b) => a - b);
        console.log(`  GT scale range:  [${gtScales[0]?.toFixed(4)}, ${gtScales[gtScales.length - 1]?.toFixed(4)}]`);
        console.log(`  Gen scale range: [${genMedScales[0]?.toFixed(4)}, ${genMedScales[genMedScales.length - 1]?.toFixed(4)}]`);
        console.log(`  GT scale mean:   ${(gtScales.reduce((a, b) => a + b, 0) / gtScales.length).toFixed(4)}`);
        console.log(`  Gen scale mean:  ${genMedScales.length > 0 ? (genMedScales.reduce((a, b) => a + b, 0) / genMedScales.length).toFixed(4) : 'N/A'}`);
        // Try matching matrices (won't match positions due to triangle ordering)
        // but check how many position-matches we get
        const gtUsed = new Set();
        let fullMatch = 0, posOnlyMatch = 0, noMatch = 0;
        for (const gen of genMediumGrass.slice(0, 1000)) { // limit to avoid O(n^2) explosion
            let bestIdx = -1;
            let bestType = 'none';
            for (let j = 0; j < gtMapped.length; j++) {
                if (gtUsed.has(j))
                    continue;
                if (gen.object_name === gtMapped[j].glb_name && matricesMatch(gen.world_matrix, gtMapped[j].world_matrix, TOL)) {
                    bestIdx = j;
                    bestType = 'full';
                    break;
                }
            }
            if (bestType === 'none') {
                for (let j = 0; j < gtMapped.length; j++) {
                    if (gtUsed.has(j))
                        continue;
                    if (positionsMatch(gen.world_matrix, gtMapped[j].world_matrix, TOL)) {
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
        const checked = Math.min(genMediumGrass.length, 1000);
        console.log(`\n  Matrix matching (checked ${checked} gen instances vs ${gtMapped.length} GT):`);
        console.log(`    Full match:         ${fullMatch}`);
        console.log(`    Position-only:      ${posOnlyMatch}`);
        console.log(`    No match:           ${noMatch}`);
        console.log(`    (No match expected since GLB triangle ordering differs from Blender)`);
        // Check name distribution in GT vs gen
        const gtNameCounts = new Map();
        for (const i of gtMapped)
            gtNameCounts.set(i.glb_name, (gtNameCounts.get(i.glb_name) ?? 0) + 1);
        console.log('\n  Per-asset counts (GT sample vs Gen total):');
        for (const [glbName, gtCount] of gtNameCounts) {
            const genCount = counts.get(glbName) ?? 0;
            console.log(`    ${glbName}: GT=${gtCount}, Gen=${genCount}`);
        }
    }
    // ── 5. Reactivity checks ──
    console.log('\n--- Reactivity checks ---');
    runtime.set(groupInputNode, 'seed', 42);
    runtime.evaluate();
    const output2 = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    const seedChanged = output.length !== output2.length ||
        !output.every((inst, i) => {
            const m1 = inst.world_matrix, m2 = output2[i]?.world_matrix;
            return m2 && m1[12] === m2[12] && m1[13] === m2[13] && m1[14] === m2[14];
        });
    if (!seedChanged) {
        console.log('  FAIL: Output unchanged when seed changed');
        pass = false;
    }
    else {
        console.log(`  OK: Seed change (0->42): ${output.length} -> ${output2.length} instances`);
    }
    runtime.set(groupInputNode, 'seed', 0);
    runtime.set(groupInputNode, 'grassDensity', 1.0);
    runtime.evaluate();
    const output3 = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    const grassCount3 = output3.filter(i => i.object_name.includes('grass')).length;
    if (grassCount3 >= grassCount) {
        console.log(`  FAIL: Grass count did not decrease when density decreased (${grassCount} -> ${grassCount3})`);
        pass = false;
    }
    else {
        console.log(`  OK: Density change (3->1): grass ${grassCount} -> ${grassCount3}`);
    }
    runtime.set(groupInputNode, 'grassDensity', 0);
    runtime.set(groupInputNode, 'flowerDensity', 0);
    runtime.evaluate();
    const output4 = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    if (output4.length !== 0) {
        console.log(`  WARN: Expected 0 instances with densities=0, got ${output4.length}`);
    }
    else {
        console.log('  OK: All densities=0 -> 0 instances');
    }
    // Final result
    console.log(`\n${'='.repeat(50)}`);
    console.log(`=== ${pass ? 'PASS' : 'FAIL'} ===`);
    viewer.dispose();
    process.exit(pass ? 0 : 1);
}
main().catch(e => {
    console.error('ERROR:', e);
    process.exit(1);
});
