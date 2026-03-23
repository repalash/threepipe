/**
 * compare_graph.ts — Evaluate a graph module and compare against ground truth.
 *
 * This is the single script for the porting workflow. The user writes a graph
 * .ts file that exports `graphModule`, then runs:
 *
 *   npx tsx porting/scripts/compare_graph.ts <graph.ts> <ground_truth.json>
 *
 * The script:
 *   1. Dynamically imports the graph module
 *   2. Creates a runtime and evaluates the graph
 *   3. Collects all GeneratedInstance[] from declared outputs
 *   4. Compares against ground truth (full 16-value world matrix)
 *
 * Exit code: 0 if 100% matrix match, 1 otherwise.
 */

import * as fs from 'fs'
import * as path from 'path'
import {createRuntime} from '../../src/graph/runtime'
import type {GraphModule, GeneratedInstance} from '../../src/graph/module'

const TOL = 0.01

// ─── Ground truth loading ────────────────────────────────────────────

interface GTInstance {
    world_matrix: number[]
    object_name?: string
    source_resolved?: boolean
}

function loadGroundTruth(filepath: string): GTInstance[][] {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'))
    // Multi-config: { configs: [{ instances: [...] }, ...] }
    if (data.configs) return data.configs.map((c: any) => c.instances as GTInstance[])
    // Flat: { instances: [...] }
    if (data.instances) return [data.instances as GTInstance[]]
    throw new Error(`Cannot find instances in ${filepath}`)
}

// ─── Comparison logic ────────────────────────────────────────────────

function matricesMatch(a: number[], b: number[], tol: number): boolean {
    if (a.length !== 16 || b.length !== 16) return false
    for (let i = 0; i < 16; i++) {
        if (Math.abs(a[i] - b[i]) > tol) return false
    }
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

function compareInstances(genInstances: GeneratedInstance[], gtInstances: GTInstance[], label: string): boolean {
    console.log(`\n─── ${label} ───`)
    console.log(`Generated: ${genInstances.length} instances`)
    console.log(`Ground truth: ${gtInstances.length} instances`)

    if (genInstances.length !== gtInstances.length) {
        console.error(`  ✗ Instance count mismatch (gen=${genInstances.length}, gt=${gtInstances.length})`)
    }

    const gtUsed = new Set<number>()
    let fullMatch = 0
    let posOnlyMatch = 0
    let posMatch = 0
    let noMatch = 0

    const rotMismatches: {gen: GeneratedInstance, gt: GTInstance, idx: number}[] = []
    const posMismatches: GeneratedInstance[] = []

    for (const gen of genInstances) {
        let bestGtIdx = -1
        let bestType: 'full' | 'pos_only' | 'none' = 'none'

        for (let i = 0; i < gtInstances.length; i++) {
            if (gtUsed.has(i)) continue
            if (matricesMatch(gen.world_matrix, gtInstances[i].world_matrix, TOL)) {
                bestGtIdx = i
                bestType = 'full'
                break
            }
        }

        if (bestType === 'none') {
            for (let i = 0; i < gtInstances.length; i++) {
                if (gtUsed.has(i)) continue
                if (positionsMatch(gen.world_matrix, gtInstances[i].world_matrix, TOL)) {
                    bestGtIdx = i
                    bestType = 'pos_only'
                    break
                }
            }
        }

        if (bestType === 'full') {
            fullMatch++
            posMatch++
            gtUsed.add(bestGtIdx)
        } else if (bestType === 'pos_only') {
            posOnlyMatch++
            posMatch++
            gtUsed.add(bestGtIdx)
            if (rotMismatches.length < 10) {
                rotMismatches.push({gen, gt: gtInstances[bestGtIdx], idx: bestGtIdx})
            }
        } else {
            noMatch++
            if (posMismatches.length < 5) posMismatches.push(gen)
        }
    }

    // Name match check
    let nameMatch = 0, nameChecked = 0
    for (const gen of genInstances) {
        if (!gen.object_name) continue
        for (let i = 0; i < gtInstances.length; i++) {
            const gt = gtInstances[i]
            if (!gt.source_resolved) continue
            if (positionsMatch(gen.world_matrix, gt.world_matrix, TOL)) {
                nameChecked++
                if (gen.object_name === gt.object_name) nameMatch++
                break
            }
        }
    }

    console.log(`\n  Full matrix match:    ${fullMatch}/${genInstances.length}`)
    console.log(`  Position-only match:  ${posOnlyMatch}/${genInstances.length} (rotation/scale wrong)`)
    console.log(`  No position match:    ${noMatch}/${genInstances.length}`)
    console.log(`  Total position match: ${posMatch}/${genInstances.length}`)
    if (nameChecked > 0) {
        console.log(`  Object name match:    ${nameMatch}/${nameChecked} (where resolvable)`)
    }

    if (rotMismatches.length > 0) {
        console.log(`\n  Rotation mismatches (first ${rotMismatches.length}):`)
        for (const rm of rotMismatches) {
            const name = rm.gen.object_name ?? '?'
            console.log(`    ${name} at ${formatPos(rm.gen.world_matrix)}`)
            console.log(`      gen rot: ${formatRot(rm.gen.world_matrix)}`)
            console.log(`      gt  rot: ${formatRot(rm.gt.world_matrix)}`)
        }
    }

    if (posMismatches.length > 0) {
        console.log(`\n  Position mismatches (first ${posMismatches.length}):`)
        for (const pm of posMismatches) {
            console.log(`    ${pm.object_name ?? '?'} at ${formatPos(pm.world_matrix)}`)
        }
    }

    const pass = fullMatch === genInstances.length && genInstances.length === gtInstances.length
    console.log(`\n  ${pass ? '✓ PASS' : '✗ FAIL'}: ${fullMatch}/${gtInstances.length} full matrix matches`)
    return pass
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2)
    if (args.length < 2) {
        console.error('Usage: npx tsx compare_graph.ts <graph.ts> <ground_truth.json>')
        console.error('')
        console.error('The graph .ts file must export: graphModule: GraphModule')
        console.error('See src/graph/module.ts for the interface definition.')
        process.exit(1)
    }

    const graphPath = path.resolve(args[0])
    const gtPath = path.resolve(args[1])

    // 1. Import graph module
    console.log(`Graph:        ${graphPath}`)
    console.log(`Ground truth: ${gtPath}`)

    const mod = await import(graphPath)
    const graphModule: GraphModule = mod.graphModule
    if (!graphModule) {
        console.error(`\n✗ ERROR: ${graphPath} does not export 'graphModule'`)
        console.error('Expected: export const graphModule: GraphModule = { graph, outputs, assets }')
        process.exit(1)
    }

    if (!graphModule.graphs || graphModule.graphs.length === 0) {
        console.error(`\n✗ ERROR: graphModule is missing required fields (graphs)`)
        process.exit(1)
    }

    // 2. Evaluate each graph and collect instances
    const allGenerated: GeneratedInstance[][] = []
    const labels: string[] = []

    for (const entry of graphModule.graphs) {
        const rt = createRuntime(entry.graph)
        rt.evaluate()

        for (const ref of entry.outputs) {
            const instances = rt.get(ref.node, ref.output) as GeneratedInstance[]
            if (!Array.isArray(instances)) {
                console.error(`\n✗ ERROR: Output '${ref.output}' on node '${ref.node.name}' is not an array`)
                process.exit(1)
            }
            if (instances.length > 0) {
                const first = instances[0]
                if (!first.world_matrix || first.world_matrix.length !== 16) {
                    console.error(`\n✗ ERROR: Instances must have world_matrix (16 floats). Got: ${JSON.stringify(first).slice(0, 100)}`)
                    console.error('See porting/scripts/output_format.md for the required format.')
                    process.exit(1)
                }
            }
            allGenerated.push(instances)
            labels.push(ref.node.name || `Output ${allGenerated.length - 1}`)
        }
    }

    // 3. Load ground truth
    const gtConfigs = loadGroundTruth(gtPath)

    console.log(`\nGraph outputs: ${allGenerated.length} config(s), Ground truth: ${gtConfigs.length} config(s)`)

    if (allGenerated.length !== gtConfigs.length) {
        console.warn(`⚠ Config count mismatch: graph has ${allGenerated.length}, ground truth has ${gtConfigs.length}`)
        console.warn(`  Will compare min(${allGenerated.length}, ${gtConfigs.length}) configs`)
    }

    // 4. Compare each config
    const n = Math.min(allGenerated.length, gtConfigs.length)
    let allPass = true
    for (let i = 0; i < n; i++) {
        const pass = compareInstances(allGenerated[i], gtConfigs[i], labels[i])
        if (!pass) allPass = false
    }

    // Check for unmatched configs
    if (allGenerated.length !== gtConfigs.length) allPass = false

    console.log(`\n${'═'.repeat(50)}`)
    console.log(allPass ? '✓ ALL PASS' : '✗ SOME FAILED')
    if (!allPass) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
