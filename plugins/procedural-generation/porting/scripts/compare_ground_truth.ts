/**
 * compare_ground_truth.ts — Standard comparison script for verifying
 * procedural generator output against Blender ground truth.
 *
 * Compares ALL 16 values of the world matrix per instance, not just position.
 * Reports position-only matches vs full matrix matches to catch rotation/scale bugs.
 *
 * Usage:
 *   npx tsx compare_ground_truth.ts <generated.json> <ground_truth.json>
 *
 * Input format (both files):
 *   { "instances": [ { "world_matrix": [16 floats, column-major], "object_name": "..." }, ... ] }
 *
 * The generated.json should use the same format as ground_truth.json.
 * If object_name is available and source_resolved is true, it's also compared.
 *
 * Exit code: 0 if 100% matrix match, 1 otherwise.
 */

import * as fs from 'fs'
import * as path from 'path'

const TOL = 0.01  // tolerance for float comparison

interface Instance {
    world_matrix: number[]
    object_name?: string
    source_resolved?: boolean
}

function loadInstances(filepath: string): Instance[] {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'))
    // Support both flat format and nested configs format
    if (data.instances) return data.instances
    if (data.configs) return data.configs[0].instances
    throw new Error(`Cannot find instances in ${filepath}`)
}

function matrixPosition(m: number[]): [number, number, number] {
    return [m[12], m[13], m[14]]
}

function matrixRotation(m: number[]): number[] {
    // First 3 columns of the 4x4 matrix (rotation + scale)
    return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
}

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

function rotationsMatch(a: number[], b: number[], tol: number): boolean {
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
        if (Math.abs(a[i] - b[i]) > tol) return false
    }
    return true
}

function formatPos(m: number[]): string {
    return `(${m[12].toFixed(2)}, ${m[13].toFixed(2)}, ${m[14].toFixed(2)})`
}

function formatRot(m: number[]): string {
    return `[${m[0].toFixed(2)},${m[1].toFixed(2)},${m[2].toFixed(2)} | ${m[4].toFixed(2)},${m[5].toFixed(2)},${m[6].toFixed(2)} | ${m[8].toFixed(2)},${m[9].toFixed(2)},${m[10].toFixed(2)}]`
}

// ─── Main ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.length < 2) {
    console.error('Usage: npx tsx compare_ground_truth.ts <generated.json> <ground_truth.json>')
    process.exit(1)
}

const genInstances = loadInstances(args[0])
const gtInstances = loadInstances(args[1])

console.log(`Generated: ${genInstances.length} instances`)
console.log(`Ground truth: ${gtInstances.length} instances`)

if (genInstances.length !== gtInstances.length) {
    console.error(`\n✗ FAIL: Instance count mismatch (gen=${genInstances.length}, gt=${gtInstances.length})`)
}

// Match each generated instance to the closest ground truth instance by full matrix
const gtUsed = new Set<number>()
let fullMatch = 0
let posOnlyMatch = 0
let posMatch = 0
let noMatch = 0

const rotMismatches: {gen: Instance, gt: Instance, idx: number}[] = []
const posMismatches: Instance[] = []

for (const gen of genInstances) {
    let bestGtIdx = -1
    let bestType: 'full' | 'pos_only' | 'none' = 'none'

    // First try full matrix match
    for (let i = 0; i < gtInstances.length; i++) {
        if (gtUsed.has(i)) continue
        if (matricesMatch(gen.world_matrix, gtInstances[i].world_matrix, TOL)) {
            bestGtIdx = i
            bestType = 'full'
            break
        }
    }

    // If no full match, try position-only match (to identify rotation mismatches)
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

// Also check object_name where both are resolved
let nameMatch = 0
let nameChecked = 0
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

// Report
console.log(`\n=== Results ===`)
console.log(`Full matrix match:    ${fullMatch}/${genInstances.length}`)
console.log(`Position-only match:  ${posOnlyMatch}/${genInstances.length} (rotation/scale wrong)`)
console.log(`No position match:    ${noMatch}/${genInstances.length}`)
console.log(`Total position match: ${posMatch}/${genInstances.length}`)
if (nameChecked > 0) {
    console.log(`Object name match:    ${nameMatch}/${nameChecked} (where resolvable)`)
}

if (rotMismatches.length > 0) {
    console.log(`\n=== Rotation mismatches (first ${rotMismatches.length}) ===`)
    for (const rm of rotMismatches) {
        const name = rm.gen.object_name ?? '?'
        console.log(`  ${name} at ${formatPos(rm.gen.world_matrix)}`)
        console.log(`    gen rot: ${formatRot(rm.gen.world_matrix)}`)
        console.log(`    gt  rot: ${formatRot(rm.gt.world_matrix)}`)
    }
}

if (posMismatches.length > 0) {
    console.log(`\n=== Position mismatches (first ${posMismatches.length}) ===`)
    for (const pm of posMismatches) {
        console.log(`  ${pm.object_name ?? '?'} at ${formatPos(pm.world_matrix)}`)
    }
}

// Final verdict
const pass = fullMatch === genInstances.length && genInstances.length === gtInstances.length
console.log(`\n${pass ? '✓ PASS' : '✗ FAIL'}: ${fullMatch}/${gtInstances.length} full matrix matches`)

if (!pass) process.exit(1)
