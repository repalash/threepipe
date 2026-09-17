/**
 * Shared topology assertions for the generator tests.
 *
 * These check the things a generator gets wrong silently. A revolve with one ribbon wound the wrong
 * way still validates, still has the right element counts and still renders - just inside out along a
 * strip - so counts alone prove nothing. Each helper returns a list of human-readable problems, the
 * same shape `BMesh.validate()` uses, so a failure names the element rather than just saying `false`.
 */

import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {radialLoops} from '../bmesh/structure'
import {Vec3} from '../math'

/**
 * Every pair of faces sharing an edge must traverse it in opposite directions.
 *
 * This is the definition of a consistently wound surface, and it is exactly what Blender's
 * `use_normal_from_adjacent` exists to maintain across repeated extrusions.
 */
export function windingProblems(bm: BMesh): string[] {
    const problems: string[] = []
    for (const e of bm.edges) {
        const loops = [...radialLoops(e)]
        if (loops.length !== 2) continue
        if (loops[0].v === loops[1].v) {
            problems.push(
                `edge ${e.id} is traversed the same way by faces ${loops[0].f.id} and ${loops[1].f.id}`)
        }
    }
    return problems
}

/** Newell's area vector for a face, the same accumulation `averageFaceNormal` uses. */
export function faceNormal(f: BMFace): Vec3 {
    let nx = 0, ny = 0, nz = 0
    const verts = f.verts()
    for (let i = 0; i < verts.length; i++) {
        const a = verts[i]
        const b = verts[(i + 1) % verts.length]
        nx += (a.y - b.y) * (a.z + b.z)
        ny += (a.z - b.z) * (a.x + b.x)
        nz += (a.x - b.x) * (a.y + b.y)
    }
    return [nx / 2, ny / 2, nz / 2]
}

export function faceArea(f: BMFace): number {
    const [x, y, z] = faceNormal(f)
    return Math.sqrt(x * x + y * y + z * z)
}

export function faceCenter(f: BMFace): Vec3 {
    let x = 0, y = 0, z = 0
    const verts = f.verts()
    for (const v of verts) {
        x += v.x
        y += v.y
        z += v.z
    }
    return [x / verts.length, y / verts.length, z / verts.length]
}

/** Faces with a repeated corner, or with no area worth speaking of. */
export function degenerateFaceProblems(bm: BMesh, minArea = 1e-9): string[] {
    const problems: string[] = []
    for (const f of bm.faces) {
        const verts = f.verts()
        if (new Set(verts).size !== verts.length) {
            problems.push(`face ${f.id} uses a vertex more than once`)
            continue
        }
        const area = faceArea(f)
        if (!(area > minArea)) problems.push(`face ${f.id} has area ${area}`)
    }
    return problems
}

/** How many distinct positions the mesh has, for spotting a seam that was never welded. */
export function distinctPositionCount(bm: BMesh, eps = 1e-6): number {
    const keys = new Set<string>()
    for (const v of bm.verts) {
        keys.add(`${Math.round(v.x / eps)},${Math.round(v.y / eps)},${Math.round(v.z / eps)}`)
    }
    return keys.size
}

/** V - E + F. 2 for a closed surface, 0 for a torus, 1 for a disk. */
export function eulerCharacteristic(bm: BMesh): number {
    return bm.totvert - bm.totedge + bm.totface
}

/** Edges with exactly one face - the open border of the surface. */
export function boundaryEdgeCount(bm: BMesh): number {
    let n = 0
    for (const e of bm.edges) if ([...radialLoops(e)].length === 1) n++
    return n
}

/** Edges with no face at all. */
export function wireEdgeCount(bm: BMesh): number {
    let n = 0
    for (const e of bm.edges) if (e.l === null) n++
    return n
}

/** Distance from a point to the line through `center` along the unit `axis`. */
export function radiusFromAxis(p: {x: number, y: number, z: number}, center: Vec3, axis: Vec3): number {
    const dx = p.x - center[0]
    const dy = p.y - center[1]
    const dz = p.z - center[2]
    const along = dx * axis[0] + dy * axis[1] + dz * axis[2]
    const rx = dx - axis[0] * along
    const ry = dy - axis[1] * along
    const rz = dz - axis[2] * along
    return Math.sqrt(rx * rx + ry * ry + rz * rz)
}

/** Signed distance along the axis, the "axial" coordinate of a 2D lathe profile. */
export function heightAlongAxis(p: {x: number, y: number, z: number}, center: Vec3, axis: Vec3): number {
    return (p.x - center[0]) * axis[0] + (p.y - center[1]) * axis[1] + (p.z - center[2]) * axis[2]
}

/**
 * Six times the volume the surface encloses, by the divergence theorem, with each face fanned into
 * triangles from its first corner.
 *
 * Positive means the whole closed surface is wound outwards. It is the orientation check that still
 * works for a torus, where the inner half of the tube legitimately faces the axis and a radial test
 * says nothing. Meaningless for an open surface.
 */
export function signedVolume6(bm: BMesh): number {
    let total = 0
    for (const f of bm.faces) {
        const verts = f.verts()
        const a = verts[0]
        for (let i = 1; i + 1 < verts.length; i++) {
            const b = verts[i]
            const c = verts[i + 1]
            total += a.x * (b.y * c.z - b.z * c.y)
                - a.y * (b.x * c.z - b.z * c.x)
                + a.z * (b.x * c.y - b.y * c.x)
        }
    }
    return total
}

/**
 * Faces of a revolved surface whose normal points towards the axis rather than away from it.
 * Caps are skipped, because their normal is parallel to the axis and has no radial component.
 */
export function inwardFacingProblems(bm: BMesh, center: Vec3, axis: Vec3, skip: Set<BMFace> = new Set()): string[] {
    const problems: string[] = []
    for (const f of bm.faces) {
        if (skip.has(f)) continue
        const c = faceCenter(f)
        const along = (c[0] - center[0]) * axis[0] + (c[1] - center[1]) * axis[1] + (c[2] - center[2]) * axis[2]
        const radial: Vec3 = [
            c[0] - center[0] - axis[0] * along,
            c[1] - center[1] - axis[1] * along,
            c[2] - center[2] - axis[2] * along,
        ]
        const n = faceNormal(f)
        const dot = n[0] * radial[0] + n[1] * radial[1] + n[2] * radial[2]
        if (dot <= 0) problems.push(`face ${f.id} faces the axis (radial dot normal ${dot})`)
    }
    return problems
}

/** Build a wire polyline in `bm` and return its vertices and edges, in order. */
export function wirePolyline(bm: BMesh, points: Vec3[], closed = false) {
    const verts: BMVert[] = points.map(p => bm.vertCreate(p[0], p[1], p[2]))
    const edges = []
    for (let i = 0; i + 1 < verts.length; i++) edges.push(bm.edgeCreate(verts[i], verts[i + 1]))
    if (closed) edges.push(bm.edgeCreate(verts[verts.length - 1], verts[0]))
    return {verts, edges}
}

/** True when the two index lists describe the same face: the same cycle, in the same direction. */
export function sameFaceCycle(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    if (a.length !== b.length) return false
    const n = a.length
    for (let r = 0; r < n; r++) {
        let ok = true
        for (let i = 0; i < n; i++) {
            if (a[(i + r) % n] !== b[i]) {
                ok = false
                break
            }
        }
        if (ok) return true
    }
    return false
}
