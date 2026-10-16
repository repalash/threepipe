/**
 * `verifySpec(mesh, spec)` - check a mesh against written requirements, three-valued.
 *
 * Every requirement comes back `PASS`, `FAIL` or `UNVERIFIED`, tagged with the evidence it rests on:
 * `measured` (a number computed from the geometry: bounds, area, volume), `structural` (topology and
 * validity: counts, manifoldness, `BM_mesh_is_valid`), `derived` (inferred from measured facts by a
 * theorem: genus from the Euler characteristic) or `unverified` (the check could not run - say, `unchanged`
 * with no baseline). A spec `conforms` only when nothing failed, nothing went unverified and at least one
 * requirement was actually checked: an empty spec does not vacuously pass. The shape follows build123d-mcp's
 * `verify_spec`; the keys are ours.
 */

import {MeshData} from '../MeshData'
import {bmFromMesh} from '../bmesh/convert'
import {bmMeshIsValid} from '../bmesh/validate'
import {Mat4Like, measureMesh, MeshMeasure} from './measure'
import {diffMeshData, DiffSelection} from './diff'

export type Verdict = 'PASS' | 'FAIL' | 'UNVERIFIED'
export type Evidence = 'measured' | 'structural' | 'derived' | 'unverified'

/** A number, a `[min, max]` range, or `{min?, max?}`. */
export type NumberSpec = number | [number, number] | {min?: number, max?: number}

export interface MeshSpec {
    /** World-space size (or min / max corners) of the bounding box. Each entry a {@link NumberSpec} or null to skip. */
    bbox?: {size?: (NumberSpec | null)[], min?: (NumberSpec | null)[], max?: (NumberSpec | null)[]}
    /** Tolerance for exact numbers in `bbox`, `volume`, `area`. Default 1e-4. */
    tolerance?: number
    counts?: {verts?: NumberSpec, edges?: NumberSpec, faces?: NumberSpec, tris?: NumberSpec}
    volume?: NumberSpec
    area?: NumberSpec
    /** `closed`: no boundary, wire or non-manifold edges. `orientable`: consistent winding. */
    manifold?: {closed?: boolean, orientable?: boolean}
    /** Passes `BM_mesh_is_valid` (and the array-level checks it needs to run at all). */
    valid?: boolean
    genus?: NumberSpec
    boundaryLoops?: NumberSpec
    components?: NumberSpec
    /** User attribute layers that must exist. */
    attributeLayers?: string[]
    /** Material slots that must exist, by name, or a count. */
    materialSlots?: string[] | NumberSpec
    /** Named element groups, as indices into the baseline mesh. Used by `unchanged`. */
    groups?: Record<string, DiffSelection>
    /** Groups whose geometry must survive unchanged from the baseline. Needs `baseline`. */
    unchanged?: string[]
}

export interface RequirementResult {
    requirement: string
    verdict: Verdict
    evidence: Evidence
    expected?: unknown
    actual?: unknown
    note?: string
}

export interface SpecResult {
    conforms: boolean
    passed: number
    failed: number
    unverified: number
    results: RequirementResult[]
    measure: MeshMeasure
}

export interface VerifyOptions {
    /** Maps the mesh into the space `bbox`, `area` and `volume` are written in. */
    matrix?: Mat4Like | null
    /** The mesh as it was, for `unchanged`. */
    baseline?: MeshData | null
}

function numberCheck(actual: number, spec: NumberSpec, tol: number): boolean {
    if (typeof spec === 'number') return Math.abs(actual - spec) <= tol
    if (Array.isArray(spec)) return actual >= spec[0] - tol && actual <= spec[1] + tol
    return (spec.min === undefined || actual >= spec.min - tol) && (spec.max === undefined || actual <= spec.max + tol)
}

export function verifySpec(mesh: MeshData, spec: MeshSpec, options: VerifyOptions = {}): SpecResult {
    const tol = spec.tolerance ?? 1e-4
    const m = measureMesh(mesh, {matrix: options.matrix})
    const results: RequirementResult[] = []
    const push = (r: RequirementResult) => results.push(r)
    const num = (requirement: string, evidence: Evidence, actual: number | null, expected: NumberSpec, t = 0) => {
        if (actual === null) {
            push({requirement, verdict: 'UNVERIFIED', evidence: 'unverified', expected, note: 'not defined for this mesh'})
            return
        }
        push({requirement, verdict: numberCheck(actual, expected, t) ? 'PASS' : 'FAIL', evidence, expected, actual})
    }

    if (spec.bbox) {
        for (const key of ['size', 'min', 'max'] as const) {
            const want = spec.bbox[key]
            if (!want) continue
            want.forEach((w, axis) => {
                if (w === null || w === undefined) return
                num(`bbox.${key}.${'xyz'[axis]}`, 'measured', m.bounds ? m.bounds[key][axis] : null, w, tol)
            })
        }
    }
    if (spec.counts) {
        for (const key of ['verts', 'edges', 'faces', 'tris'] as const) {
            if (spec.counts[key] !== undefined) num(`counts.${key}`, 'structural', m[key], spec.counts[key]!)
        }
    }
    if (spec.volume !== undefined) {
        if (!m.closed || !m.consistentWinding) {
            push({requirement: 'volume', verdict: 'UNVERIFIED', evidence: 'unverified', expected: spec.volume, actual: m.volume,
                note: 'the mesh is not closed and consistently wound, so it encloses no well-defined volume'})
        } else num('volume', 'measured', Math.abs(m.volume), spec.volume, tol)
    }
    if (spec.area !== undefined) num('area', 'measured', m.area, spec.area, tol)
    if (spec.manifold) {
        if (spec.manifold.closed !== undefined) {
            push({requirement: 'manifold.closed', verdict: m.closed === spec.manifold.closed ? 'PASS' : 'FAIL',
                evidence: 'structural', expected: spec.manifold.closed, actual: {closed: m.closed, ...m.edgeUse}})
        }
        if (spec.manifold.orientable !== undefined) {
            push({requirement: 'manifold.orientable', verdict: m.consistentWinding === spec.manifold.orientable ? 'PASS' : 'FAIL',
                evidence: 'structural', expected: spec.manifold.orientable, actual: {inconsistentEdges: m.inconsistentEdges}})
        }
    }
    if (spec.valid !== undefined) {
        const structural = mesh.validate()
        let errors = structural
        if (!structural.length) errors = bmMeshIsValid(bmFromMesh(mesh))
        push({requirement: 'valid', verdict: (errors.length === 0) === spec.valid ? 'PASS' : 'FAIL', evidence: 'structural',
            expected: spec.valid, actual: errors.slice(0, 20)})
    }
    if (spec.genus !== undefined) num('genus', 'derived', m.genus, spec.genus)
    if (spec.boundaryLoops !== undefined) num('boundaryLoops', 'structural', m.boundaryLoops, spec.boundaryLoops)
    if (spec.components !== undefined) num('components', 'structural', m.components, spec.components)
    if (spec.attributeLayers) {
        const have = new Set(m.attributeLayers.map(l => l.name))
        for (const name of spec.attributeLayers) {
            push({requirement: `attributeLayers.${name}`, verdict: have.has(name) ? 'PASS' : 'FAIL', evidence: 'structural',
                expected: true, actual: have.has(name)})
        }
    }
    if (spec.materialSlots !== undefined) {
        if (Array.isArray(spec.materialSlots) && typeof spec.materialSlots[0] !== 'number') {
            for (const name of spec.materialSlots as string[]) {
                const ok = m.materialSlots.includes(name)
                push({requirement: `materialSlots.${name}`, verdict: ok ? 'PASS' : 'FAIL', evidence: 'structural', expected: true, actual: ok})
            }
        } else num('materialSlots', 'structural', m.materialSlots.length, spec.materialSlots as NumberSpec)
    }
    for (const group of spec.unchanged ?? []) {
        const selection = spec.groups?.[group]
        if (!selection) {
            push({requirement: `unchanged.${group}`, verdict: 'UNVERIFIED', evidence: 'unverified',
                note: `no group "${group}" in spec.groups`})
            continue
        }
        if (!options.baseline) {
            push({requirement: `unchanged.${group}`, verdict: 'UNVERIFIED', evidence: 'unverified',
                note: 'no baseline mesh to compare against'})
            continue
        }
        // Everything outside the group is claimed, so whatever is collateral lies inside the group.
        const outside = complement(options.baseline, selection)
        const d = diffMeshData(options.baseline, mesh, {claim: outside, ring: 0})
        const groupFaces = new Set(Array.from(selection.faces ?? []))
        const groupVerts = new Set(Array.from(selection.verts ?? []))
        const changedFaces = d.collateral.faces.filter(f => groupFaces.has(f))
        const changedVerts = d.collateral.verts.filter(v => groupVerts.has(v))
        const ok = d.collateral.faceCount === 0 && d.collateral.vertCount === 0
        push({requirement: `unchanged.${group}`, verdict: ok ? 'PASS' : 'FAIL', evidence: 'measured',
            expected: 'unchanged', actual: {changedFaces, changedVerts, faceCount: d.collateral.faceCount, vertCount: d.collateral.vertCount}})
    }

    const passed = results.filter(r => r.verdict === 'PASS').length
    const failed = results.filter(r => r.verdict === 'FAIL').length
    const unverified = results.filter(r => r.verdict === 'UNVERIFIED').length
    return {conforms: failed === 0 && unverified === 0 && passed > 0, passed, failed, unverified, results, measure: m}
}

/**
 * The selection of everything *not* in `group`, so a diff claiming it (with no ring growth) reports
 * exactly the group's changes as collateral. A face shared-vertex away from the group stays outside;
 * a group face whose boundary vertex moved no longer matches, so it is still caught.
 */
function complement(mesh: MeshData, group: DiffSelection): DiffSelection {
    const inFaces = new Set(Array.from(group.faces ?? []))
    const inVerts = new Set(Array.from(group.verts ?? []))
    for (const f of inFaces) for (const v of mesh.faceVerts(f)) inVerts.add(v)
    const faces: number[] = []
    for (let f = 0; f < mesh.facesNum; f++) if (!inFaces.has(f)) faces.push(f)
    const verts: number[] = []
    for (let v = 0; v < mesh.vertsNum; v++) if (!inVerts.has(v)) verts.push(v)
    return {faces, verts}
}
