/**
 * Tests for distribute_points_on_faces.ts — Blender's DistributePointsOnFaces port.
 *
 * Verifies:
 * 1. RANDOM mode produces points on a PlaneGeometry
 * 2. Determinism: same seed → same result
 * 3. Different seed → different result
 * 4. Density 0 → empty result
 * 5. POISSON mode: all points at least minDistance apart
 * 6. Normal computation
 * 7. Point ID computation
 */

import {BufferAttribute, BufferGeometry, PlaneGeometry, Vector3} from 'three'
import {distributePointsOnFaces} from '../src/blender/distribute_points_on_faces'

// ─── Test harness ───────────────────────────────────────────────────

let passed = 0, failed = 0

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error(`  \x1b[31mFAIL\x1b[0m: ${msg}`)
        failed++
    } else {
        console.log(`  \x1b[32mPASS\x1b[0m: ${msg}`)
        passed++
    }
}

function section(name: string) {
    console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ─── Test 1: RANDOM mode basic ──────────────────────────────────────

section('Test 1: RANDOM mode basic — PlaneGeometry(10, 10, 10, 10)')

const plane = new PlaneGeometry(10, 10, 10, 10)

const result1 = distributePointsOnFaces(plane, {
    method: 'RANDOM',
    density: 100,
    seed: 42,
})

assert(result1.positions.length > 0, `RANDOM mode produced ${result1.positions.length} points (expected > 0)`)
assert(result1.normals.length === result1.positions.length, `normals count matches positions count`)
assert(result1.ids.length === result1.positions.length, `ids count matches positions count`)

// Verify all positions are within the plane bounds (roughly -5 to 5 on X and Y,
// PlaneGeometry is in the XY plane in three.js)
let allInBounds = true
for (const p of result1.positions) {
    if (Math.abs(p.x) > 5.1 || Math.abs(p.y) > 5.1 || Math.abs(p.z) > 0.01) {
        allInBounds = false
        break
    }
}
assert(allInBounds, `All points are within plane bounds`)

// ─── Test 2: Determinism — same seed ────────────────────────────────

section('Test 2: Determinism — same seed must produce identical results')

const result2 = distributePointsOnFaces(plane, {
    method: 'RANDOM',
    density: 100,
    seed: 42,
})

assert(result2.positions.length === result1.positions.length,
    `Same seed produces same count (${result1.positions.length} vs ${result2.positions.length})`)

let allMatch = true
for (let i = 0; i < result1.positions.length; i++) {
    if (!result1.positions[i].equals(result2.positions[i])) {
        allMatch = false
        break
    }
}
assert(allMatch, `All positions are identical for same seed`)

let idsMatch = true
for (let i = 0; i < result1.ids.length; i++) {
    if (result1.ids[i] !== result2.ids[i]) {
        idsMatch = false
        break
    }
}
assert(idsMatch, `All IDs are identical for same seed`)

// ─── Test 3: Different seed → different result ──────────────────────

section('Test 3: Different seed must produce different results')

const result3 = distributePointsOnFaces(plane, {
    method: 'RANDOM',
    density: 100,
    seed: 99,
})

// Count should likely differ, or positions should differ
let hasDifference = result3.positions.length !== result1.positions.length
if (!hasDifference && result3.positions.length > 0) {
    for (let i = 0; i < Math.min(result1.positions.length, result3.positions.length); i++) {
        if (!result1.positions[i].equals(result3.positions[i])) {
            hasDifference = true
            break
        }
    }
}
assert(hasDifference, `Different seed produces different result`)

// ─── Test 4: Density 0 → empty ─────────────────────────────────────

section('Test 4: Density 0 must produce empty result')

const result4 = distributePointsOnFaces(plane, {
    method: 'RANDOM',
    density: 0,
    seed: 42,
})

assert(result4.positions.length === 0, `Density 0 produces 0 points (got ${result4.positions.length})`)

// ─── Test 5: POISSON mode — minimum distance ───────────────────────

section('Test 5: POISSON mode — all points at least minDistance apart')

const minDist = 0.5
const result5 = distributePointsOnFaces(plane, {
    method: 'POISSON',
    density: 50,
    minDistance: minDist,
    seed: 42,
})

assert(result5.positions.length > 0, `POISSON mode produced ${result5.positions.length} points (expected > 0)`)

let minDistViolations = 0
for (let i = 0; i < result5.positions.length; i++) {
    for (let j = i + 1; j < result5.positions.length; j++) {
        const dist = result5.positions[i].distanceTo(result5.positions[j])
        if (dist < minDist * 0.99) { // small tolerance for floating point
            minDistViolations++
        }
    }
}
assert(minDistViolations === 0,
    `No minimum distance violations (found ${minDistViolations} pairs closer than ${minDist})`)

// ─── Test 6: POISSON determinism ────────────────────────────────────

section('Test 6: POISSON mode determinism')

const result6 = distributePointsOnFaces(plane, {
    method: 'POISSON',
    density: 50,
    minDistance: minDist,
    seed: 42,
})

assert(result6.positions.length === result5.positions.length,
    `POISSON same seed same count (${result5.positions.length} vs ${result6.positions.length})`)

let poissonPosMatch = true
for (let i = 0; i < result5.positions.length; i++) {
    if (!result5.positions[i].equals(result6.positions[i])) {
        poissonPosMatch = false
        break
    }
}
assert(poissonPosMatch, `POISSON same seed produces identical positions`)

// ─── Test 7: Normals are valid ──────────────────────────────────────

section('Test 7: All normals are normalized unit vectors')

let allNormalized = true
for (const n of result1.normals) {
    if (Math.abs(n.length() - 1.0) > 0.001) {
        allNormalized = false
        break
    }
}
assert(allNormalized, `All normals are unit length`)

// For a flat plane in three.js (XY plane), normals should be (0, 0, 1)
let allFaceUp = true
for (const n of result1.normals) {
    if (Math.abs(n.z) < 0.99) {
        allFaceUp = false
        break
    }
}
assert(allFaceUp, `Plane normals point in Z direction (PlaneGeometry is in XY plane)`)

// ─── Test 8: IDs are deterministic integers ─────────────────────────

section('Test 8: Point IDs are deterministic integers')

const allIntegers = result1.ids.every(id => Number.isInteger(id))
assert(allIntegers, `All IDs are integers`)

const uniqueIds = new Set(result1.ids)
// IDs should be mostly unique (hash collisions are theoretically possible but extremely rare)
assert(uniqueIds.size > result1.ids.length * 0.95,
    `IDs are mostly unique (${uniqueIds.size} unique out of ${result1.ids.length})`)

// ─── Test 9: densityFactor works ────────────────────────────────────

section('Test 9: densityFactor reduces point count')

const vertCount = plane.getAttribute('position').count
const halfDensity = new Float32Array(vertCount).fill(0.5)
const result9 = distributePointsOnFaces(plane, {
    method: 'RANDOM',
    density: 100,
    densityFactor: halfDensity,
    seed: 42,
})

// With densityFactor=0.5, we expect roughly half the points
const ratio = result9.positions.length / result1.positions.length
assert(ratio > 0.3 && ratio < 0.7,
    `densityFactor=0.5 produces ~half points (ratio=${ratio.toFixed(2)}, ` +
    `${result9.positions.length} vs ${result1.positions.length})`)

// ─── Test 10: Zero densityFactor → no points ───────────────────────

section('Test 10: densityFactor=0 produces no points')

const zeroDensity = new Float32Array(vertCount).fill(0)
const result10 = distributePointsOnFaces(plane, {
    method: 'RANDOM',
    density: 100,
    densityFactor: zeroDensity,
    seed: 42,
})

assert(result10.positions.length === 0,
    `densityFactor=0 produces 0 points (got ${result10.positions.length})`)

// ─── Summary ────────────────────────────────────────────────────────

console.log(`\n\x1b[1m───────────────────────────────────────\x1b[0m`)
console.log(`\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`)

if (failed > 0) {
    process.exit(1)
}
