/**
 * verify.ts — Verify the flower scatter v5 graph module.
 *
 * Loads ground mesh geometry from ground.glb, loads texture data,
 * sets them on the graph runtime, evaluates, and checks:
 * 1. Instance counts are reasonable (grass + flowers)
 * 2. All instances have valid world matrices
 * 3. Scene bounding box is reasonable
 * 4. Reactivity: changing seed/density affects output
 * 5. Object names map to valid asset files
 * 6. Comparison against ground truth (position-level matching on sample)
 *
 * Usage:
 *   npx tsx --tsconfig plugins/procedural-generation/porting/scripts/tsconfig.json examples/flower-scatter-v5/verify.ts
 */
import { DummyRenderManager } from '../../plugins/procedural-generation/src/utils/node-polyfill';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRuntime } from '../../plugins/procedural-generation/src/graph/runtime';
import sharp from 'sharp';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
const TOL = 0.02; // position tolerance for scatter matching
async function main() {
    console.log('=== Flower Scatter V5 Verification ===\n');
    // Import graph module
    const { graphModule, groupInputNode } = await import('./graph');
    // Load ground.glb
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
    // Load textures
    const densityMap = await loadPngTexture(path.join(assetsDir, 'texture_flowers-density_map.png'));
    const bluebellMask = await loadPngTexture(path.join(assetsDir, 'texture_bluebell-mask.png'));
    console.log(`  Density map: ${densityMap ? `${densityMap.width}x${densityMap.height}` : 'not loaded'}`);
    console.log(`  Bluebell mask: ${bluebellMask ? `${bluebellMask.width}x${bluebellMask.height}` : 'not loaded'}`);
    // Create runtime and set initial data
    const entry = graphModule.graphs[0];
    const runtime = createRuntime(entry.graph);
    runtime.set(groupInputNode, 'groundGeometry', groundGeometry);
    runtime.set(groupInputNode, 'textures', { densityMap, bluebellMask });
    // Evaluate with default parameters
    console.log('\n--- Default parameters ---');
    runtime.evaluate();
    const output = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    console.log(`Total instances: ${output.length}`);
    let pass = true;
    // Group by category
    const counts = new Map();
    for (const inst of output) {
        counts.set(inst.object_name, (counts.get(inst.object_name) ?? 0) + 1);
    }
    let grassCount = 0;
    let flowerCount = 0;
    console.log('\nInstance counts by asset:');
    for (const [name, count] of [...counts.entries()].sort()) {
        const isGrass = name.includes('grass') || name.includes('leaf_grass');
        const isFlower = name.includes('bluebell') || name.includes('dandelion');
        if (isGrass)
            grassCount += count;
        if (isFlower)
            flowerCount += count;
        console.log(`  ${name}: ${count}`);
    }
    console.log(`  TOTAL grass: ${grassCount}`);
    console.log(`  TOTAL flowers: ${flowerCount}`);
    // Check that we have instances
    if (output.length === 0) {
        console.log('FAIL: No instances generated');
        pass = false;
    }
    if (grassCount === 0) {
        console.log('FAIL: No grass instances');
        pass = false;
    }
    if (flowerCount === 0) {
        console.log('FAIL: No flower instances');
        pass = false;
    }
    // Check world matrices are valid
    let invalidMatrices = 0;
    for (const inst of output) {
        const m = inst.world_matrix;
        if (m.length !== 16) {
            invalidMatrices++;
            continue;
        }
        const hasNaN = m.some((v) => isNaN(v) || !isFinite(v));
        if (hasNaN)
            invalidMatrices++;
    }
    if (invalidMatrices > 0) {
        console.log(`FAIL: ${invalidMatrices} instances have invalid world matrices`);
        pass = false;
    }
    else {
        console.log('OK: All world matrices valid');
    }
    // Check object names are valid assets
    const validAssets = new Set(graphModule.assets);
    let unknownAssets = 0;
    for (const name of counts.keys()) {
        if (!validAssets.has(name)) {
            console.log(`WARN: Unknown asset name: ${name}`);
            unknownAssets++;
        }
    }
    if (unknownAssets > 0) {
        console.log(`WARN: ${unknownAssets} unknown asset names (will be invisible in viewer)`);
    }
    else {
        console.log('OK: All asset names are valid');
    }
    // Bounding box
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
        console.log(`\nScene bbox (Blender Z-up positions):`);
        console.log(`  min: [${min.map(v => v.toFixed(3)).join(', ')}]`);
        console.log(`  max: [${max.map(v => v.toFixed(3)).join(', ')}]`);
        const extentX = max[0] - min[0];
        const extentY = max[1] - min[1];
        console.log(`  Extent: X=${extentX.toFixed(2)}, Y=${extentY.toFixed(2)}`);
        if (extentX < 1 || extentY < 1) {
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
    // Change density
    runtime.set(groupInputNode, 'seed', 0); // reset
    runtime.set(groupInputNode, 'grassDensity', 1);
    runtime.evaluate();
    const output3 = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
    const grassCount3 = output3.filter(i => i.object_name.includes('grass')).length;
    if (grassCount3 === grassCount) {
        console.log('  FAIL: Grass count unchanged when density changed');
        pass = false;
    }
    else {
        console.log(`  OK: Density change -> grass (${grassCount} -> ${grassCount3})`);
    }
    // Compare with ground truth if available
    const gtPath = path.resolve(__dirname, '../../tmp/flower_scattering_ground_truth.json');
    if (fs.existsSync(gtPath)) {
        console.log('\n--- Ground truth comparison ---');
        const gtData = JSON.parse(fs.readFileSync(gtPath, 'utf8'));
        const gtInstances = gtData.instances;
        console.log(`Ground truth: ${gtInstances.length} instances (sample from ${gtData.total_instances} total)`);
        // Reset to default params for comparison
        runtime.set(groupInputNode, 'grassDensity', 3.0);
        runtime.set(groupInputNode, 'seed', 0);
        runtime.evaluate();
        const compareOutput = runtime.get(entry.outputs[0].node, entry.outputs[0].output);
        console.log(`Generated: ${compareOutput.length} instances`);
        // Ground truth has 117,343 total, 500 in sample
        // The 500 sample instances are all medium grass (GEO-leaf.grass.*)
        // Our Separate Children=false means each scatter point produces 4 instances
        // So we should check if our medium grass instances match the GT positions
        // Filter GT by object name pattern → these are all medium grass
        const gtMediumGrass = gtInstances.filter(i => i.object_name.startsWith('GEO-leaf.grass.'));
        // Filter our generated medium grass instances
        const genMediumGrass = compareOutput.filter(i => i.object_name.includes('leaf_grass_'));
        console.log(`\nGT medium grass (sample): ${gtMediumGrass.length}`);
        console.log(`Gen medium grass: ${genMediumGrass.length}`);
        // Position-level matching: check how many GT positions we match
        // GT positions are in Blender Z-up, our positions are also in Blender Z-up
        let posMatches = 0;
        let fullMatches = 0;
        const gtUsed = new Set();
        for (const gt of gtMediumGrass) {
            const gtPos = [gt.world_matrix[12], gt.world_matrix[13], gt.world_matrix[14]];
            let matched = false;
            for (let j = 0; j < genMediumGrass.length; j++) {
                if (gtUsed.has(j))
                    continue;
                const genPos = [genMediumGrass[j].world_matrix[12],
                    genMediumGrass[j].world_matrix[13],
                    genMediumGrass[j].world_matrix[14]];
                const dist = Math.sqrt((gtPos[0] - genPos[0]) ** 2 +
                    (gtPos[1] - genPos[1]) ** 2 +
                    (gtPos[2] - genPos[2]) ** 2);
                if (dist < TOL) {
                    posMatches++;
                    gtUsed.add(j);
                    // Check full matrix
                    let fullOk = true;
                    for (let k = 0; k < 16; k++) {
                        if (Math.abs(gt.world_matrix[k] - genMediumGrass[j].world_matrix[k]) > TOL) {
                            fullOk = false;
                            break;
                        }
                    }
                    if (fullOk)
                        fullMatches++;
                    matched = true;
                    break;
                }
            }
        }
        console.log(`Position matches: ${posMatches}/${gtMediumGrass.length}`);
        console.log(`Full matrix matches: ${fullMatches}/${gtMediumGrass.length}`);
        // Show first few unmatched GT instances for debugging
        if (posMatches < gtMediumGrass.length) {
            console.log('\nFirst 5 unmatched GT instances (position):');
            let shown = 0;
            for (const gt of gtMediumGrass) {
                const gtPos = [gt.world_matrix[12], gt.world_matrix[13], gt.world_matrix[14]];
                let found = false;
                for (let j = 0; j < genMediumGrass.length; j++) {
                    const genPos = [genMediumGrass[j].world_matrix[12],
                        genMediumGrass[j].world_matrix[13],
                        genMediumGrass[j].world_matrix[14]];
                    const dist = Math.sqrt((gtPos[0] - genPos[0]) ** 2 +
                        (gtPos[1] - genPos[1]) ** 2 +
                        (gtPos[2] - genPos[2]) ** 2);
                    if (dist < TOL) {
                        found = true;
                        break;
                    }
                }
                if (!found && shown < 5) {
                    console.log(`  GT: pos=(${gtPos[0].toFixed(3)}, ${gtPos[1].toFixed(3)}, ${gtPos[2].toFixed(3)}) name=${gt.object_name}`);
                    shown++;
                }
            }
        }
        // Show first few mismatched matrices for debugging
        if (fullMatches < posMatches) {
            console.log('\nFirst 3 rotation mismatches:');
            let shown = 0;
            const gtUsed2 = new Set();
            for (const gt of gtMediumGrass) {
                if (shown >= 3)
                    break;
                for (let j = 0; j < genMediumGrass.length; j++) {
                    if (gtUsed2.has(j))
                        continue;
                    const dist = Math.sqrt((gt.world_matrix[12] - genMediumGrass[j].world_matrix[12]) ** 2 +
                        (gt.world_matrix[13] - genMediumGrass[j].world_matrix[13]) ** 2 +
                        (gt.world_matrix[14] - genMediumGrass[j].world_matrix[14]) ** 2);
                    if (dist < TOL) {
                        gtUsed2.add(j);
                        let fullOk = true;
                        for (let k = 0; k < 16; k++) {
                            if (Math.abs(gt.world_matrix[k] - genMediumGrass[j].world_matrix[k]) > TOL) {
                                fullOk = false;
                                break;
                            }
                        }
                        if (!fullOk) {
                            console.log(`  GT rot: [${gt.world_matrix.slice(0, 3).map(v => v.toFixed(3)).join(',')}]`);
                            console.log(`  Gen rot: [${genMediumGrass[j].world_matrix.slice(0, 3).map(v => v.toFixed(3)).join(',')}]`);
                            console.log(`  GT scale-diag: [${gt.world_matrix[0].toFixed(3)},${gt.world_matrix[5].toFixed(3)},${gt.world_matrix[10].toFixed(3)}]`);
                            console.log(`  Gen scale-diag: [${genMediumGrass[j].world_matrix[0].toFixed(3)},${genMediumGrass[j].world_matrix[5].toFixed(3)},${genMediumGrass[j].world_matrix[10].toFixed(3)}]`);
                            console.log();
                            shown++;
                        }
                        break;
                    }
                }
            }
        }
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
