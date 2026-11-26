import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {edgeIsManifold, radialLength, radialLoops} from '../bmesh/structure'
import {bmToMesh} from '../bmesh/convert'
import {ElemFlag} from '../constants'
import {selectAll} from '../bmesh/marking'
import {Vec3} from '../math'
import {spin} from './spin'
import {
    boundaryEdgeCount,
    degenerateFaceProblems,
    distinctPositionCount,
    eulerCharacteristic,
    faceArea,
    radiusFromAxis,
    windingProblems,
    wireEdgeCount,
    wirePolyline,
} from './topology.testutil'

const Z: Vec3 = [0, 0, 1]
const ORIGIN: Vec3 = [0, 0, 0]

/** A straight wire profile parallel to the Z axis at radius `r`, `n` points tall. */
function column(bm: BMesh, r: number, n: number, closed = false) {
    const points: Vec3[] = []
    for (let i = 0; i < n; i++) points.push([r, 0, i])
    return wirePolyline(bm, points, closed)
}

/**
 * A quad in the plane that contains the axis, so that sweeping it makes a solid of revolution.
 *
 * Deliberately *not* a chord: a face whose edge is a chord of a circle about the axis sweeps into a
 * self-overlapping quad whenever the step is narrower than the chord's own angular span, which is
 * real geometry rather than a bug and would make the degeneracy checks meaningless here.
 */
function quadFace(bm: BMesh) {
    const v = [
        bm.vertCreate(1, 0, -0.5),
        bm.vertCreate(2, 0, -0.5),
        bm.vertCreate(2, 0, 0.5),
        bm.vertCreate(1, 0, 0.5),
    ]
    return {verts: v, face: bm.faceCreate(v)}
}

/**
 * {@link windingProblems}, but tolerating the one face a spin is documented to leave alone.
 *
 * `bmo_spin_exec` extrudes with `skip_input_flip=true` (`bmo_dupe.cc:638`), so when the seed region
 * survives its step - which it does whenever the seed is a whole island, because then `delorig` is
 * false - the seed keeps the winding the user gave it, while the side faces around it are wound for
 * the new solid. Every edge of the seed is therefore traversed the same way twice. That is Blender's
 * result, not a kernel bug, and this asserts it exactly: the seed may disagree with its neighbours,
 * and nothing else may.
 */
function seamProblemsExcept(bm: BMesh, seed: BMFace): string[] {
    const problems: string[] = []
    for (const e of bm.edges) {
        const loops = [...radialLoops(e)]
        if (loops.length !== 2 || loops[0].v !== loops[1].v) continue
        if (loops[0].f === seed || loops[1].f === seed) continue
        problems.push(
            `edge ${e.id} is traversed the same way by faces ${loops[0].f.id} and ${loops[1].f.id}`)
    }
    return problems
}

describe('spin - wire input', () => {
    it('sweeps a wire polyline into a quad ribbon with the counts the algorithm predicts', () => {
        // P points, S steps, no merge: S + 1 rings of P vertices, (P - 1) * S quads.
        for (const [p, s] of [[2, 4], [2, 9], [3, 5], [6, 12]] as const) {
            const bm = new BMesh()
            const {verts, edges} = column(bm, 2, p)
            spin(bm, {verts, edges}, {axis: Z, angle: Math.PI, steps: s})

            expect(bm.totvert).toBe(p * (s + 1))
            expect(bm.totface).toBe((p - 1) * s)
            expect(bm.totedge).toBe((p - 1) * (s + 1) + p * s)
            // An open sheet, so the Euler characteristic of a disk.
            expect(eulerCharacteristic(bm)).toBe(1)
            expect(bm.validate()).toEqual([])
            expect(windingProblems(bm)).toEqual([])
            expect(degenerateFaceProblems(bm)).toEqual([])
            for (const f of bm.faces) expect(f.len).toBe(4)
        }
    })

    it('closes the seam with useMerge, leaving no duplicate vertices', () => {
        for (const s of [3, 4, 8, 17]) {
            const bm = new BMesh()
            const {verts, edges} = column(bm, 2, 3)
            spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: s, useMerge: true})

            // The last ring is spliced onto the first, so S rings rather than S + 1.
            expect(bm.totvert).toBe(3 * s)
            expect(bm.totface).toBe(2 * s)
            expect(bm.totedge).toBe(2 * s + 3 * s)
            // An open tube, twice: characteristic 0.
            expect(eulerCharacteristic(bm)).toBe(0)
            // No seam left behind: every vertex is at its own position.
            expect(distinctPositionCount(bm)).toBe(bm.totvert)
            expect(bm.validate()).toEqual([])
            expect(windingProblems(bm)).toEqual([])
            expect(degenerateFaceProblems(bm)).toEqual([])
            // Only the two end rings are open.
            expect(boundaryEdgeCount(bm)).toBe(2 * s)
            for (const f of bm.faces) expect(f.len).toBe(4)
        }
    })

    it('leaves the seam duplicated when useMerge is off, which is why the lathe asks for it', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 2)
        spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: 8, useMerge: false})

        expect(bm.totvert).toBe(2 * 9)
        // The last ring lands on the first, so two vertices share each of those two positions.
        expect(distinctPositionCount(bm)).toBe(2 * 8)
        expect(bm.validate()).toEqual([])
    })

    it('ignores useMerge below three steps, as Blender does', () => {
        // `use_merge && (steps >= 3)`: merging a 2-step turn would weld the mesh onto itself.
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 2)
        spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: 2, useMerge: true})
        expect(bm.totvert).toBe(2 * 3)
        expect(bm.validate()).toEqual([])
    })

    it('puts every ring at its exact angle rather than an accumulated one', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 3, 2)
        const steps = 12
        const res = spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps, useMerge: true})

        // Group the surviving vertices by the profile point they descend from; insertion order in
        // `originOf` is input first, then one ring at a time.
        const ring: BMVert[] = []
        for (const [descendant, origin] of res.originOf) {
            if (origin === verts[0] && bm.verts.has(descendant)) ring.push(descendant)
        }
        expect(ring.length).toBe(steps)
        for (let i = 0; i < steps; i++) {
            const a = Math.PI * 2 * i / steps
            expect(ring[i].x).toBeCloseTo(3 * Math.cos(a), 12)
            expect(ring[i].y).toBeCloseTo(3 * Math.sin(a), 12)
            expect(ring[i].z).toBeCloseTo(0, 12)
            expect(radiusFromAxis(ring[i], ORIGIN, Z)).toBeCloseTo(3, 12)
        }
    })

    it('keeps the winding consistent across every step, not just the first', () => {
        // This is what `use_normal_from_adjacent` buys. Extruding the rim again without it winds the
        // second ribbon the same way round the shared edge as the first.
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 4)
        spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: 16, useMerge: true})

        expect(windingProblems(bm)).toEqual([])
        // All the interior edges really are shared, so the check above had something to check.
        let manifold = 0
        for (const e of bm.edges) if (edgeIsManifold(e)) manifold++
        expect(manifold).toBe(bm.totedge - boundaryEdgeCount(bm))
        expect(manifold).toBeGreaterThan(0)
    })

    it('reverses every face with useNormalFlip', () => {
        const build = (flip: boolean) => {
            const bm = new BMesh()
            const {verts, edges} = column(bm, 2, 2)
            spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: 6, useMerge: true, useNormalFlip: flip})
            return bm
        }
        const plain = build(false)
        const flipped = build(true)
        expect(plain.totface).toBe(flipped.totface)
        expect(windingProblems(flipped)).toEqual([])

        // Same faces, opposite orientation: the radial component of the normal changes sign.
        const radialDot = (bm: BMesh) => {
            const f = [...bm.faces][0]
            const verts = f.verts()
            let cx = 0, cy = 0
            for (const v of verts) {
                cx += v.x / verts.length
                cy += v.y / verts.length
            }
            let nx = 0, ny = 0
            for (let i = 0; i < verts.length; i++) {
                const a = verts[i]
                const b = verts[(i + 1) % verts.length]
                nx += (a.y - b.y) * (a.z + b.z)
                ny += (a.z - b.z) * (a.x + b.x)
            }
            return nx * cx + ny * cy
        }
        expect(Math.sign(radialDot(plain))).toBe(-Math.sign(radialDot(flipped)))
    })

    it('screws the sweep along the axis when dvec is given', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 2)
        const steps = 8
        const pitch = 4
        const res = spin(bm, {verts, edges}, {
            axis: Z, angle: Math.PI * 2, steps, dvec: [0, 0, pitch / steps],
        })

        // A helix does not close, so nothing is merged and the last ring is a full pitch higher.
        // `dvec` is scaled by the step number and applied on top of a fresh rotation each step, so
        // the offset is absolute rather than accumulated.
        expect(bm.totvert).toBe(2 * (steps + 1))
        expect(res.verts.map(v => v.z).sort((a, b) => a - b))
            .toEqual([pitch, pitch + 1].map(z => expect.closeTo(z, 9)))
        for (const v of res.verts) expect(radiusFromAxis(v, ORIGIN, Z)).toBeCloseTo(2, 9)
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
    })

    it('spins a loose vertex into a ring of wire edges', () => {
        // Blender's `isovert_map.out` pass: a vertex with no edge is duplicated and joined to its copy.
        const bm = new BMesh()
        const v = bm.vertCreate(2, 0, 0)
        spin(bm, {verts: [v]}, {axis: Z, angle: Math.PI * 2, steps: 8})

        expect(bm.totvert).toBe(9)
        expect(bm.totedge).toBe(8)
        expect(bm.totface).toBe(0)
        expect(wireEdgeCount(bm)).toBe(8)
        expect(bm.validate()).toEqual([])
    })
})

describe('spin - face input', () => {
    it('sweeps a face region into a closed torus-like tube', () => {
        const bm = new BMesh()
        const {face} = quadFace(bm)
        const steps = 10
        spin(bm, {faces: [face]}, {axis: Z, angle: Math.PI * 2, steps, useMerge: false})

        // Both caps survive, plus 4 side faces per step, over `steps + 1` rings of 4 vertices.
        //
        // The *first* cap is the seed face itself. `bmo_extrude_face_region_exec` only sets `delorig`
        // when some input face has a neighbour outside the region, which a lone face does not, so
        // step 0 keeps its input; from step 1 on the input cap does have a neighbour - the side faces
        // step 0 built - and is deleted. So exactly two caps, whatever `steps` is.
        expect(bm.totface).toBe(4 * steps + 2)
        expect(bm.totvert).toBe(4 * (steps + 1))
        expect(bm.totedge).toBe(4 * (steps + 1) + 4 * steps)
        // Capped at both ends: a closed surface.
        expect(eulerCharacteristic(bm)).toBe(2)
        expect(bm.validate()).toEqual([])
        expect(seamProblemsExcept(bm, face)).toEqual([])
        expect(degenerateFaceProblems(bm)).toEqual([])
        for (const f of bm.faces) expect(f.len).toBe(4)

        // And the seed really is the one face that disagrees, on all four of its edges - the direct
        // observable consequence of `skip_input_flip`. Drop that flag and this is 0, not 4.
        expect(windingProblems(bm).length).toBe(4)
    })

    it('leaves the mesh valid and wound consistently over a partial sweep', () => {
        const bm = new BMesh()
        const {face} = quadFace(bm)
        spin(bm, {faces: [face]}, {axis: Z, angle: Math.PI / 2, steps: 4})
        expect(bm.validate()).toEqual([])
        expect(seamProblemsExcept(bm, face)).toEqual([])
        expect(degenerateFaceProblems(bm)).toEqual([])
    })
})

describe('spin - duplicate mode', () => {
    it('makes independent islands instead of a connected sweep', () => {
        const bm = new BMesh()
        const {face} = quadFace(bm)
        const steps = 5
        const res = spin(bm, {faces: [face]}, {
            axis: Z, angle: Math.PI * 2, steps, useDuplicate: true,
        })

        // The original plus one copy per step, none of them joined to each other.
        expect(bm.totface).toBe(steps + 1)
        expect(bm.totvert).toBe(4 * (steps + 1))
        expect(bm.totedge).toBe(4 * (steps + 1))
        expect(degenerateFaceProblems(bm)).toEqual([])
        for (const e of bm.edges) expect(radialLength(e)).toBe(1)
        // Each copy is rotated by the total angle for its step, off the original.
        expect(res.faces.length).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('ignores useMerge in duplicate mode, as Blender does', () => {
        const bm = new BMesh()
        const {face} = quadFace(bm)
        spin(bm, {faces: [face]}, {axis: Z, angle: Math.PI * 2, steps: 6, useDuplicate: true, useMerge: true})
        // 6 copies plus the original; a merge would have welded the sixth onto it.
        expect(bm.totface).toBe(7)
        expect(bm.validate()).toEqual([])
    })
})

describe('spin - bookkeeping', () => {
    it('reports the last ring as geom_last, and everything it made as new*', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 3)
        const res = spin(bm, {verts, edges}, {axis: Z, angle: Math.PI, steps: 5})

        expect(res.verts.length).toBe(3)
        expect(res.edges.length).toBe(2)
        expect(res.newVerts.length).toBe(3 * 5)
        expect(res.newFaces.length).toBe(2 * 5)
        expect(res.newEdges.length).toBe(bm.totedge - 2)
        for (const v of res.newVerts) expect(bm.verts.has(v)).toBe(true)
        for (const e of res.newEdges) expect(bm.edges.has(e)).toBe(true)
        // Every produced vertex traces back to one of the three profile points.
        for (const v of res.newVerts) expect(verts).toContain(res.originOf.get(v))
    })

    it('returns the input unchanged for zero steps', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 3)
        const res = spin(bm, {verts, edges}, {axis: Z, steps: 0})
        expect(bm.totvert).toBe(3)
        expect(bm.totface).toBe(0)
        expect(res.verts).toEqual(verts)
        expect(res.newFaces).toEqual([])
    })

    it('leaves the selection alone, because the Blender operator works in flag layers', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 3)
        selectAll(bm)
        const before = bm.totvertsel
        spin(bm, {verts, edges}, {axis: Z, angle: Math.PI, steps: 4})
        for (const v of verts) expect(v.hflag & ElemFlag.Select).toBeTruthy()
        expect(bm.totvertsel).toBe(before)
    })

    it('round-trips through MeshData', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 3)
        spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: 9, useMerge: true})
        const mesh = bmToMesh(bm)
        expect(mesh.validate()).toEqual([])
        expect(mesh.vertsNum).toBe(bm.totvert)
        expect(mesh.facesNum).toBe(bm.totface)
    })

    it('makes no zero-area faces on a sweep whose profile touches the axis', () => {
        // Without a weld the ring at radius 0 collapses to a point and its quads have no area. The
        // spin operator itself does not weld - Blender's does not either - so the faces are expected
        // to be there, and this pins down that the lathe is what fixes it.
        const bm = new BMesh()
        const {verts, edges} = wirePolyline(bm, [[0, 0, 1], [2, 0, 0]])
        spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: 8, useMerge: true})
        const zeroArea = [...bm.faces].filter(f => faceArea(f) < 1e-9)
        expect(zeroArea.length).toBe(0)
        // The pole ring is still a ring of 8 coincident vertices.
        expect(bm.totvert).toBe(16)
        expect(distinctPositionCount(bm)).toBe(9)
        expect(bm.validate()).toEqual([])
    })
})

describe('spin - shared edges', () => {
    it('gives every interior edge exactly two faces', () => {
        const bm = new BMesh()
        const {verts, edges} = column(bm, 2, 5)
        spin(bm, {verts, edges}, {axis: Z, angle: Math.PI * 2, steps: 12, useMerge: true})
        for (const e of bm.edges) {
            const n = [...radialLoops(e)].length
            expect(n === 1 || n === 2).toBe(true)
        }
        expect(boundaryEdgeCount(bm)).toBe(2 * 12)
    })
})
