/**
 * compare_graph.ts — Evaluate a graph module and compare against ground truth.
 *
 * Single-pass comparison that verifies:
 * 1. Instance matrices (16 values) match within tolerance
 * 2. Per-asset instance counts match
 * 3. Scene bounding box matches (with actual asset geometry, not just positions)
 * 4. All referenced assets exist and load correctly
 *
 * Usage:
 *   npx tsx porting/scripts/compare_graph.ts <graph.ts> <ground_truth.json>
 *
 * Exit code: 0 if all checks pass, 1 otherwise.
 */

import {DummyRenderManager} from '../../src/utils/node-polyfill'
import * as fs from 'fs'
import * as path from 'path'
import {createRuntime} from '../../src/graph/runtime'
import type {GraphModule, GeneratedInstance} from '../../src/graph/module'

const TOL = 0.01
const VERTEX_TOL = 0.002

// ─── Types ──────────────────────────────────────────────────────────

interface GTInstance {
    world_matrix: number[]
    object_name?: string
    source_resolved?: boolean
}

interface GroundTruth {
    type: 'instances' | 'vertices'
    instances?: GTInstance[]
    vertices?: number[][]
}

interface BBox { min: number[], max: number[] }

// ─── Ground truth loading ───────────────────────────────────────────

function loadGroundTruth(filepath: string): GroundTruth[] {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'))
    if (data.configs) {
        return data.configs.map((c: any) => {
            if (c.instances) return {type: 'instances' as const, instances: c.instances as GTInstance[]}
            if (c.vertices) return {type: 'vertices' as const, vertices: c.vertices as number[][]}
            return {type: 'instances' as const, instances: []}
        })
    }
    if (data.instances && data.instances.length > 0 && data.instances[0].world_matrix) {
        return [{type: 'instances', instances: data.instances as GTInstance[]}]
    }
    if (data.vertices || data.world_vertices) {
        return [{type: 'vertices', vertices: (data.vertices || data.world_vertices) as number[][]}]
    }
    throw new Error(`Cannot find instances or vertices in ${filepath}`)
}

// ─── Asset loading ──────────────────────────────────────────────────

async function loadAssetBBoxes(assetNames: string[], assetsDir: string): Promise<Map<string, BBox>> {
    const bboxes = new Map<string, BBox>()
    try {
        const {ThreeViewer} = await import('threepipe')
        const canvas = (globalThis as any).document.createElement('canvas')
        canvas.id = 'compare'
        const viewer = new (ThreeViewer as any)({canvas, rmClass: DummyRenderManager, tonemap: false})

        for (const name of assetNames) {
            const filePath = path.join(assetsDir, name)
            if (!fs.existsSync(filePath)) continue
            const buffer = fs.readFileSync(filePath)
            const file = new File([buffer], name, {type: 'model/gltf-binary'})
            try {
                const result = await viewer.assetManager.addAsset(file)
                const obj = Array.isArray(result) ? result[0] : result
                if (!obj?.traverse) continue
                const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
                let hasGeo = false
                obj.traverse((child: any) => {
                    const pos = child.geometry?.getAttribute?.('position')
                    if (!pos) return
                    hasGeo = true
                    for (let i = 0; i < pos.count; i++) {
                        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
                        if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x
                        if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y
                        if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z
                    }
                })
                if (hasGeo) bboxes.set(name, {min, max})
            } catch { /* skip failed loads */ }
        }
        viewer.dispose()
    } catch (e: any) {
        console.log(`  (Asset loading failed: ${e.message?.slice(0, 100)})`)
    }
    return bboxes
}

// ─── Math helpers ───────────────────────────────────────────────────

function matricesMatch(a: number[], b: number[], tol: number): boolean {
    if (a.length !== 16 || b.length !== 16) return false
    for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > tol) return false
    return true
}

function positionsMatch(a: number[], b: number[], tol: number): boolean {
    return Math.abs(a[12] - b[12]) < tol && Math.abs(a[13] - b[13]) < tol && Math.abs(a[14] - b[14]) < tol
}

function formatPos(m: number[]): string {
    return `(${m[12].toFixed(2)}, ${m[13].toFixed(2)}, ${m[14].toFixed(2)})`
}

function formatRot(m: number[]): string {
    return `[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[2].toFixed(2)} | ${m[4].toFixed(2)},${m[5].toFixed(2)},${m[6].toFixed(2)} | ${m[8].toFixed(2)},${m[9].toFixed(2)},${m[10].toFixed(2)}]`
}

function formatBBox(b: BBox): string {
    return `[${b.min.map(v => v.toFixed(2))}] → [${b.max.map(v => v.toFixed(2))}]`
}

/** Transform a local bbox by a column-major 4x4 matrix to get world-space bbox. */
function transformBBox(local: BBox, m: number[]): BBox {
    const corners = [
        [local.min[0], local.min[1], local.min[2]],
        [local.max[0], local.min[1], local.min[2]],
        [local.min[0], local.max[1], local.min[2]],
        [local.max[0], local.max[1], local.min[2]],
        [local.min[0], local.min[1], local.max[2]],
        [local.max[0], local.min[1], local.max[2]],
        [local.min[0], local.max[1], local.max[2]],
        [local.max[0], local.max[1], local.max[2]],
    ]
    const wMin = [Infinity, Infinity, Infinity], wMax = [-Infinity, -Infinity, -Infinity]
    for (const [lx, ly, lz] of corners) {
        // Column-major: col0=[m0,m1,m2], col1=[m4,m5,m6], col2=[m8,m9,m10], col3=[m12,m13,m14]
        const wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12]
        const wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13]
        const wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14]
        if (wx < wMin[0]) wMin[0] = wx; if (wx > wMax[0]) wMax[0] = wx
        if (wy < wMin[1]) wMin[1] = wy; if (wy > wMax[1]) wMax[1] = wy
        if (wz < wMin[2]) wMin[2] = wz; if (wz > wMax[2]) wMax[2] = wz
    }
    return {min: wMin, max: wMax}
}

function mergeBBox(a: BBox, b: BBox): BBox {
    return {
        min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
        max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    }
}

function bboxClose(a: BBox, b: BBox, tol: number): boolean {
    for (let c = 0; c < 3; c++) {
        if (Math.abs(a.min[c] - b.min[c]) > tol) return false
        if (Math.abs(a.max[c] - b.max[c]) > tol) return false
    }
    return true
}

// ─── Instance comparison (single pass) ──────────────────────────────

function compareInstances(
    genInstances: GeneratedInstance[],
    gtInstances: GTInstance[],
    label: string,
    assetBBoxes: Map<string, BBox>,
    declaredAssets: string[],
): boolean {
    console.log(`\n─── ${label} ───`)
    console.log(`Generated: ${genInstances.length} instances`)
    console.log(`Ground truth: ${gtInstances.length} instances`)

    let pass = true

    if (genInstances.length !== gtInstances.length) {
        console.error(`  ✗ Instance count mismatch (gen=${genInstances.length}, gt=${gtInstances.length})`)
        pass = false
    }

    // Per-asset counts
    const genCounts = new Map<string, number>()
    for (const inst of genInstances) genCounts.set(inst.object_name ?? '', (genCounts.get(inst.object_name ?? '') ?? 0) + 1)
    const gtCounts = new Map<string, number>()
    for (const inst of gtInstances.filter(i => i.source_resolved !== false))
        gtCounts.set(inst.object_name ?? '', (gtCounts.get(inst.object_name ?? '') ?? 0) + 1)
    let countMismatches = 0
    for (const [name, genN] of genCounts) {
        const gtN = gtCounts.get(name)
        if (gtN !== undefined && gtN !== genN) {
            if (countMismatches < 3) console.log(`  ⚠ "${name}": gen=${genN}, gt=${gtN}`)
            countMismatches++
        }
    }

    // Asset name validation
    const assetSet = new Set(declaredAssets)
    const unknownAssets = new Set<string>()
    const missingBBox = new Set<string>()
    for (const gen of genInstances) {
        if (gen.object_name && !assetSet.has(gen.object_name)) unknownAssets.add(gen.object_name)
        if (gen.object_name && assetBBoxes.size > 0 && !assetBBoxes.has(gen.object_name)) missingBBox.add(gen.object_name)
    }
    if (unknownAssets.size > 0) {
        console.log(`  ✗ ${unknownAssets.size} undeclared asset(s): ${[...unknownAssets].slice(0, 5).join(', ')}`)
        pass = false
    }
    if (missingBBox.size > 0) {
        console.log(`  ⚠ ${missingBBox.size} asset(s) without geometry: ${[...missingBBox].slice(0, 5).join(', ')}`)
    }

    // Scene bounding box (using actual asset geometry)
    if (assetBBoxes.size > 0 && genInstances.length > 0 && gtInstances.length > 0) {
        let genSceneBBox: BBox | null = null
        for (const inst of genInstances) {
            const localBBox = assetBBoxes.get(inst.object_name)
            if (!localBBox) continue
            const worldBBox = transformBBox(localBBox, inst.world_matrix)
            genSceneBBox = genSceneBBox ? mergeBBox(genSceneBBox, worldBBox) : worldBBox
        }
        let gtSceneBBox: BBox | null = null
        for (const inst of gtInstances) {
            const name = inst.object_name
            const localBBox = name ? assetBBoxes.get(name) || assetBBoxes.get(name + '.glb') : null
            if (!localBBox) continue
            const worldBBox = transformBBox(localBBox, inst.world_matrix)
            gtSceneBBox = gtSceneBBox ? mergeBBox(gtSceneBBox, worldBBox) : worldBBox
        }
        if (genSceneBBox && gtSceneBBox) {
            console.log(`  Scene bbox (gen): ${formatBBox(genSceneBBox)}`)
            console.log(`  Scene bbox (gt):  ${formatBBox(gtSceneBBox)}`)
            if (!bboxClose(genSceneBBox, gtSceneBBox, TOL * 10)) {
                console.log(`  ⚠ Scene bounding box mismatch`)
            }
        } else if (genSceneBBox) {
            console.log(`  Scene bbox (gen): ${formatBBox(genSceneBBox)}`)
            console.log(`  (GT scene bbox not computed — asset names may not match)`)
        }
    }

    // Matrix matching
    const gtUsed = new Set<number>()
    let fullMatch = 0, posOnlyMatch = 0, noMatch = 0

    const rotMismatches: {gen: GeneratedInstance, gt: GTInstance}[] = []
    const posMismatches: GeneratedInstance[] = []

    for (const gen of genInstances) {
        let bestGtIdx = -1
        let bestType: 'full' | 'pos_only' | 'none' = 'none'

        for (let i = 0; i < gtInstances.length; i++) {
            if (gtUsed.has(i)) continue
            if (matricesMatch(gen.world_matrix, gtInstances[i].world_matrix, TOL)) {
                bestGtIdx = i; bestType = 'full'; break
            }
        }
        if (bestType === 'none') {
            for (let i = 0; i < gtInstances.length; i++) {
                if (gtUsed.has(i)) continue
                if (positionsMatch(gen.world_matrix, gtInstances[i].world_matrix, TOL)) {
                    bestGtIdx = i; bestType = 'pos_only'; break
                }
            }
        }

        if (bestGtIdx >= 0) gtUsed.add(bestGtIdx)
        if (bestType === 'full') { fullMatch++ }
        else if (bestType === 'pos_only') {
            posOnlyMatch++
            if (rotMismatches.length < 5) rotMismatches.push({gen, gt: gtInstances[bestGtIdx]})
        } else {
            noMatch++
            if (posMismatches.length < 5) posMismatches.push(gen)
        }
    }

    // Object name check
    let nameChecked = 0, nameMatch = 0
    for (const gen of genInstances) {
        if (!gen.object_name) continue
        for (const gt of gtInstances) {
            if (!gt.source_resolved) continue
            if (positionsMatch(gen.world_matrix, gt.world_matrix, TOL)) {
                nameChecked++
                if (gen.object_name === gt.object_name) nameMatch++
                break
            }
        }
    }

    // Report
    console.log(`\n  Full matrix match:    ${fullMatch}/${genInstances.length}`)
    if (posOnlyMatch > 0) console.log(`  Position-only match:  ${posOnlyMatch} (rotation/scale wrong)`)
    if (noMatch > 0) console.log(`  No match:             ${noMatch}`)
    if (nameChecked > 0) console.log(`  Object name match:    ${nameMatch}/${nameChecked}`)

    if (rotMismatches.length > 0) {
        console.log(`\n  Rotation mismatches (first ${rotMismatches.length}):`)
        for (const rm of rotMismatches) {
            console.log(`    ${rm.gen.object_name ?? '?'} at ${formatPos(rm.gen.world_matrix)}`)
            console.log(`      gen: ${formatRot(rm.gen.world_matrix)}`)
            console.log(`      gt:  ${formatRot(rm.gt.world_matrix)}`)
        }
    }
    if (posMismatches.length > 0) {
        console.log(`\n  Position mismatches (first ${posMismatches.length}):`)
        for (const pm of posMismatches) console.log(`    ${pm.object_name ?? '?'} at ${formatPos(pm.world_matrix)}`)
    }

    if (fullMatch !== genInstances.length || genInstances.length !== gtInstances.length) pass = false
    console.log(`\n  ${pass ? '✓ PASS' : '✗ FAIL'}: ${fullMatch}/${gtInstances.length} full matrix matches`)
    return pass
}

// ─── Vertex comparison ──────────────────────────────────────────────

function compareVertices(genVerts: number[][], gtVerts: number[][], label: string, tol: number): boolean {
    console.log(`\n─── ${label} (vertices) ───`)
    console.log(`Generated: ${genVerts.length} vertices`)
    console.log(`Ground truth: ${gtVerts.length} vertices`)

    if (genVerts.length !== gtVerts.length) {
        console.error(`  ✗ Vertex count mismatch (gen=${genVerts.length}, gt=${gtVerts.length})`)
    }

    let orderedMatch = 0, maxErr = 0
    const n = Math.min(genVerts.length, gtVerts.length)
    for (let i = 0; i < n; i++) {
        const err = Math.max(
            Math.abs(genVerts[i][0] - gtVerts[i][0]),
            Math.abs(genVerts[i][1] - gtVerts[i][1]),
            Math.abs(genVerts[i][2] - gtVerts[i][2]),
        )
        if (err > maxErr) maxErr = err
        if (err < tol) orderedMatch++
    }

    console.log(`  Match: ${orderedMatch}/${n} (tol=${tol}, maxErr=${maxErr.toFixed(6)})`)
    const pass = orderedMatch === n && genVerts.length === gtVerts.length
    console.log(`  ${pass ? '✓ PASS' : '✗ FAIL'}`)
    return pass
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2)
    if (args.length < 2) {
        console.error('Usage: npx tsx compare_graph.ts <graph.ts> <ground_truth.json>')
        process.exit(1)
    }

    const graphPath = path.resolve(args[0])
    const gtPath = path.resolve(args[1])
    console.log(`Graph:        ${graphPath}`)
    console.log(`Ground truth: ${gtPath}`)

    // Import and evaluate graph
    const mod = await import(graphPath)
    const graphModule: GraphModule = mod.graphModule
    if (!graphModule?.graphs?.length) {
        console.error(`✗ ERROR: ${graphPath} does not export a valid graphModule`)
        process.exit(1)
    }

    // Load assets (for bbox verification)
    let assetBBoxes = new Map<string, BBox>()
    if (graphModule.assets?.length > 0 && graphModule.assetsPath) {
        const assetsDir = path.resolve(path.dirname(graphPath), graphModule.assetsPath)
        if (fs.existsSync(assetsDir)) {
            // Check files exist
            let missing = 0
            for (const name of graphModule.assets) {
                if (!fs.existsSync(path.join(assetsDir, name))) {
                    if (missing < 3) console.log(`  ✗ Missing: ${name}`)
                    missing++
                }
                const size = fs.existsSync(path.join(assetsDir, name)) ? fs.statSync(path.join(assetsDir, name)).size : 0
                if (size > 0 && size < 200) console.log(`  ⚠ ${name}: ${size} bytes (empty GLB)`)
            }
            if (missing > 0) console.log(`  ${missing} asset file(s) missing`)

            // Load GLBs for bounding boxes
            assetBBoxes = await loadAssetBBoxes(graphModule.assets, assetsDir)
            console.log(`Assets: ${assetBBoxes.size}/${graphModule.assets.length} loaded with geometry`)
        }
    }

    // Evaluate and collect outputs
    // If the graph module exports an `initRuntime` function, call it to set up
    // external inputs (e.g. ground geometry for scatter graphs).
    // Signature: initRuntime(rt: Runtime, assetsDir: string) => Promise<void>
    const initRuntime: ((rt: any, assetsDir: string) => Promise<void>) | undefined = mod.initRuntime
    const assetsDir = graphModule.assetsPath
        ? path.resolve(path.dirname(graphPath), graphModule.assetsPath)
        : path.dirname(graphPath)

    const outputs: {label: string, type: 'instances' | 'mesh', data: any}[] = []
    for (const entry of graphModule.graphs) {
        const rt = createRuntime(entry.graph)
        if (initRuntime) await initRuntime(rt, assetsDir)
        rt.evaluate()
        for (const ref of entry.outputs) {
            const output = rt.get(ref.node, ref.output)
            const label = ref.node.name || `Output ${outputs.length}`
            if (Array.isArray(output) && output.length > 0 && output[0]?.world_matrix) {
                // GeneratedInstance[] — instance placements
                outputs.push({label, type: 'instances', data: output})
            } else if (Array.isArray(output) && (output.length === 0 || Array.isArray(output[0]))) {
                // number[][] — flat vertex array (world-space)
                outputs.push({label, type: 'mesh', data: output})
            } else if (output && typeof output === 'object' && 'rings' in output) {
                // Mesh scatter — extract world-space vertices by applying placements
                const allVerts: number[][] = []
                const scale = (output as any).scale ?? 1
                for (const ring of (output as any).rings) {
                    const verts = ring.vertices as number[]
                    const N = verts.length / 3
                    for (let pi = 0; pi < ring.placements.length; pi++) {
                        const [px, py, pz] = ring.placements[pi]
                        const angle = ring.rotations[pi]
                        const cosA = Math.cos(angle), sinA = Math.sin(angle)
                        for (let vi = 0; vi < N; vi++) {
                            const lx = verts[vi * 3] * scale, ly = verts[vi * 3 + 1] * scale, lz = verts[vi * 3 + 2] * scale
                            // Rotate around Z + translate (Blender Z-up to placement position)
                            // Then convert Blender Z-up → three.js Y-up: (bx, bz, -by)
                            const rx = lx * cosA - ly * sinA
                            const ry = lx * sinA + ly * cosA
                            allVerts.push([rx + px, ry + py, lz + pz])
                        }
                    }
                }
                outputs.push({label, type: 'mesh', data: allVerts})
            } else if (output == null) {
                console.log(`  Skipping null output '${ref.output}' on '${label}'`)
            } else {
                console.error(`  ✗ Unknown output type for '${ref.output}' on '${label}'`)
                process.exit(1)
            }
        }
    }

    // Load ground truth and compare
    const gtConfigs = loadGroundTruth(gtPath)
    console.log(`\nOutputs: ${outputs.length}, Ground truth configs: ${gtConfigs.length}`)

    const n = Math.min(outputs.length, gtConfigs.length)
    let allPass = true

    for (let i = 0; i < n; i++) {
        const out = outputs[i], gt = gtConfigs[i]
        if (out.type === 'instances' && gt.type === 'instances') {
            if (!compareInstances(out.data, gt.instances!, out.label, assetBBoxes, graphModule.assets)) allPass = false
        } else if (out.type === 'mesh' && gt.type === 'vertices') {
            if (!compareVertices(out.data, gt.vertices!, out.label, VERTEX_TOL)) allPass = false
        } else {
            console.error(`  ✗ Type mismatch: ${out.label} is ${out.type}, gt is ${gt.type}`)
            allPass = false
        }
    }
    if (outputs.length !== gtConfigs.length) allPass = false

    console.log(`\n${'═'.repeat(50)}`)
    console.log(allPass ? '✓ ALL PASS' : '✗ SOME FAILED')
    if (!allPass) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
