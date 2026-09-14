/**
 * Custom comparison for flower-scatter-v5.
 * Focuses on statistical properties since exact position matching is
 * not possible due to different triangle ordering in GLB vs Blender internal mesh.
 */
// Polyfill must be first import to set up globals before threepipe loads
import '../../plugins/procedural-generation/src/utils/node-polyfill';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRuntime } from '../../plugins/procedural-generation/src/graph/runtime';
import { graphModule, initRuntime } from './graph';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function main() {
    const gtPath = path.resolve('tmp/flower_scattering_ground_truth.json');
    const entry = graphModule.graphs[0];
    const rt = createRuntime(entry.graph);
    const assetsDir = path.resolve(__dirname, graphModule.assetsPath || './assets/');
    await initRuntime(rt, assetsDir);
    rt.evaluate();
    const output = rt.get(entry.outputs[0].node, entry.outputs[0].output);
    console.log(`Total generated instances: ${output.length}`);
    // Group by type
    const groups = {};
    for (const inst of output) {
        const cat = inst.object_name.includes('grass-long') ? 'grass-long'
            : inst.object_name.includes('grass_') ? 'grass-medium'
                : inst.object_name.includes('bluebell') ? 'bluebell'
                    : inst.object_name.includes('dandelion') ? 'dandelion'
                        : 'other';
        if (!groups[cat])
            groups[cat] = [];
        groups[cat].push(inst);
    }
    console.log('\n--- Instance counts by category ---');
    for (const [cat, insts] of Object.entries(groups)) {
        console.log(`  ${cat}: ${insts.length}`);
    }
    // GT data
    const gt = JSON.parse(fs.readFileSync(gtPath, 'utf8'));
    console.log(`\nGT total instances: ${gt.total_instances}`);
    console.log(`GT sample: ${gt.instances.length} (all medium grass)`);
    // Compare medium grass statistics
    const medGrass = groups['grass-medium'] || [];
    console.log(`\n--- Medium grass comparison ---`);
    console.log(`  Generated: ${medGrass.length}`);
    // GT has 500 sample instances / 4 members = 125 scatter points sampled
    // Total GT instances = 117343 - let's figure out how many are medium grass
    // With density*100 for medium, density*100/3 for long
    // Medium scatter points >> long scatter points (~3x more)
    // If total = 117343 and each medium point = 4 instances, each long = 3 instances
    // Let long_pts = L, medium_pts = M, then 3L + 4M = 117343
    // Also density ratio: medium density = 3 * long density with same ground
    // But medium minDist=0.01 vs long minDist=0.04, so medium has many more points
    // The GT sample is ALL medium grass, so medium is the dominant category
    // Scale analysis
    const scales = medGrass.map(inst => {
        const m = inst.world_matrix;
        return Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    });
    const gtScales = gt.instances.map((inst) => {
        const m = inst.world_matrix;
        return Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    });
    console.log(`\n--- Scale comparison ---`);
    console.log(`  Generated: min=${Math.min(...scales).toFixed(4)}, max=${Math.max(...scales).toFixed(4)}, mean=${(scales.reduce((a, b) => a + b, 0) / scales.length).toFixed(4)}`);
    console.log(`  GT:        min=${Math.min(...gtScales).toFixed(4)}, max=${Math.max(...gtScales).toFixed(4)}, mean=${(gtScales.reduce((a, b) => a + b, 0) / gtScales.length).toFixed(4)}`);
    // Position distribution (bounding box)
    const genBB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const inst of medGrass) {
        const m = inst.world_matrix;
        const x = m[12], y = m[13], z = m[14];
        if (x < genBB.min[0])
            genBB.min[0] = x;
        if (x > genBB.max[0])
            genBB.max[0] = x;
        if (y < genBB.min[1])
            genBB.min[1] = y;
        if (y > genBB.max[1])
            genBB.max[1] = y;
        if (z < genBB.min[2])
            genBB.min[2] = z;
        if (z > genBB.max[2])
            genBB.max[2] = z;
    }
    const gtBB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const inst of gt.instances) {
        const m = inst.world_matrix;
        const x = m[12], y = m[13], z = m[14];
        if (x < gtBB.min[0])
            gtBB.min[0] = x;
        if (x > gtBB.max[0])
            gtBB.max[0] = x;
        if (y < gtBB.min[1])
            gtBB.min[1] = y;
        if (y > gtBB.max[1])
            gtBB.max[1] = y;
        if (z < gtBB.min[2])
            gtBB.min[2] = z;
        if (z > gtBB.max[2])
            gtBB.max[2] = z;
    }
    console.log(`\n--- Spatial distribution ---`);
    console.log(`  Generated bbox: [${genBB.min.map(v => v.toFixed(2)).join(', ')}] → [${genBB.max.map(v => v.toFixed(2)).join(', ')}]`);
    console.log(`  GT bbox:        [${gtBB.min.map(v => v.toFixed(2)).join(', ')}] → [${gtBB.max.map(v => v.toFixed(2)).join(', ')}]`);
    // Check that positions are all at the same location within groups of 4
    // (Separate Children=false should give different positions per child)
    console.log(`\n--- Separate Children check ---`);
    // In our implementation, groups of 4 have same position (all children at scatter point)
    // In GT, groups of 4 have same rotation/scale but different positions (child offsets)
    let samePos = 0;
    for (let i = 0; i < Math.min(medGrass.length, 40); i += 4) {
        const m0 = medGrass[i].world_matrix;
        let allSame = true;
        for (let j = 1; j < 4 && i + j < medGrass.length; j++) {
            const mj = medGrass[i + j].world_matrix;
            if (Math.abs(m0[12] - mj[12]) > 0.001 || Math.abs(m0[13] - mj[13]) > 0.001 || Math.abs(m0[14] - mj[14]) > 0.001) {
                allSame = false;
                break;
            }
        }
        if (allSame)
            samePos++;
    }
    console.log(`  Groups of 4 with same position: ${samePos}/10 checked`);
    console.log(`  (GT has different positions per child due to child origin offsets)`);
    console.log(`  (Our GLBs have child offsets baked into mesh — visual result is the same)`);
    // Scale histogram comparison
    console.log(`\n--- Scale histogram ---`);
    const bins = 10;
    const allScales = [...scales, ...gtScales];
    const smin = Math.min(...allScales), smax = Math.max(...allScales);
    const binWidth = (smax - smin) / bins;
    const genHist = new Array(bins).fill(0);
    const gtHist = new Array(bins).fill(0);
    for (const s of scales) {
        const bin = Math.min(Math.floor((s - smin) / binWidth), bins - 1);
        genHist[bin]++;
    }
    for (const s of gtScales) {
        const bin = Math.min(Math.floor((s - smin) / binWidth), bins - 1);
        gtHist[bin]++;
    }
    console.log('  Range         | Gen% | GT%');
    for (let i = 0; i < bins; i++) {
        const lo = smin + i * binWidth;
        const hi = lo + binWidth;
        const genPct = (genHist[i] / scales.length * 100).toFixed(1);
        const gtPct = (gtHist[i] / gtScales.length * 100).toFixed(1);
        console.log(`  ${lo.toFixed(2)}-${hi.toFixed(2)} | ${genPct.padStart(5)}% | ${gtPct.padStart(5)}%`);
    }
    console.log('\n=== Done ===');
}
main().catch(e => { console.error(e); process.exit(1); });
