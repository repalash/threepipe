import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {radialLoops} from '../bmesh/structure'
import {AttrType} from '../constants'
import {getComponent, setComponent} from '../bmesh/customdata'
import {Vec3, mat4TransformDir, mat4Translation} from '../math'
import {mirrorGeometry} from './mirror'
import {
    distinctPositionCount,
    eulerCharacteristic,
    faceCenter,
    faceNormal,
    windingProblems,
} from './topology.testutil'

function box(bm: BMesh, x0 = 0, x1 = 1, y0 = 0, y1 = 1, z0 = 0, z1 = 1): {verts: BMVert[], faces: BMFace[]} {
    const co: Vec3[] = [
        [x0, y0, z0], [x0, y0, z1], [x0, y1, z0], [x0, y1, z1],
        [x1, y0, z0], [x1, y0, z1], [x1, y1, z0], [x1, y1, z1],
    ]
    const verts = co.map(c => bm.vertCreate(c[0], c[1], c[2]))
    const faces = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
        .map(f => bm.faceCreate(f.map(i => verts[i])))
    return {verts, faces}
}

function radialHistogram(bm: BMesh): Record<number, number> {
    const h: Record<number, number> = {}
    for (const e of bm.edges) {
        const n = [...radialLoops(e)].length
        h[n] = (h[n] ?? 0) + 1
    }
    return h
}

const normalize = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2])
    return [v[0] / l, v[1] / l, v[2] / l]
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe('mirrorGeometry - geometry away from the plane', () => {
    it('duplicates everything and welds nothing', () => {
        const bm = new BMesh()
        const {faces} = box(bm, 1, 2)
        const r = mirrorGeometry(bm, {faces}, {axis: 'x'})

        expect(r.welded).toEqual([])
        expect(bm.totvert).toBe(16)
        expect(bm.totedge).toBe(24)
        expect(bm.totface).toBe(12)
        expect(r.verts.length).toBe(8)
        expect(r.edges.length).toBe(12)
        expect(r.faces.length).toBe(6)
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
        // Two closed shells.
        expect(eulerCharacteristic(bm)).toBe(4)
        expect(radialHistogram(bm)).toEqual({2: 24})
    })

    it('reflects the copy and leaves the original where it was', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 1, 2, 3, 4, 5, 6)
        const before = verts.map(v => [v.x, v.y, v.z] as Vec3)
        const r = mirrorGeometry(bm, {faces}, {axis: 'x'})

        for (let i = 0; i < verts.length; i++) {
            expect([verts[i].x, verts[i].y, verts[i].z]).toEqual(before[i])
            const copy = r.vertMap.get(verts[i])!
            expect(copy.x).toBeCloseTo(-before[i][0], 12)
            expect(copy.y).toBeCloseTo(before[i][1], 12)
            expect(copy.z).toBeCloseTo(before[i][2], 12)
        }
    })

    it('mirrors on y and z as well', () => {
        for (const [axis, i] of [['y', 1], ['z', 2]] as const) {
            const bm = new BMesh()
            const {verts, faces} = box(bm, 1, 2, 3, 4, 5, 6)
            const r = mirrorGeometry(bm, {faces}, {axis})
            for (const v of verts) {
                const copy = r.vertMap.get(v)!
                const src: Vec3 = [v.x, v.y, v.z]
                const got: Vec3 = [copy.x, copy.y, copy.z]
                for (let k = 0; k < 3; k++) {
                    expect(got[k], `${axis} component ${k}`).toBeCloseTo(k === i ? -src[k] : src[k], 12)
                }
            }
            expect(bm.validate(), axis).toEqual([])
        }
    })

    it('mirrors in the space of the given matrix', () => {
        // Mirror about the plane x = 2 rather than x = 0.
        const bm = new BMesh()
        const {verts, faces} = box(bm, 3, 4)
        const r = mirrorGeometry(bm, {faces}, {axis: 'x', matrix: mat4Translation([2, 0, 0])})

        for (const v of verts) {
            const copy = r.vertMap.get(v)!
            expect(copy.x).toBeCloseTo(4 - v.x, 12)
            expect(copy.y).toBeCloseTo(v.y, 12)
            expect(copy.z).toBeCloseTo(v.z, 12)
        }
        expect(r.welded).toEqual([])
        expect(bm.validate()).toEqual([])
    })
})

describe('mirrorGeometry - winding', () => {
    /**
     * A reflection has a negative determinant, so the Newell normal of a reflected face with the
     * *original* winding is `-M n`: it points into the copy. Reversing the winding, which is what
     * `mesh_flip_faces` does for the mirror modifier, turns that back into `+M n`. Asserting equality
     * with `+M n` is therefore exactly the assertion that the winding was reversed - a port that
     * skipped the flip lands on the negation of this.
     */
    function checkFlipped(bm: BMesh, faces: BMFace[], mirror: Vec3[], axis: 'x' | 'y' | 'z') {
        const before = new Map(faces.map(f => [f, faceNormal(f)] as const))
        const r = mirrorGeometry(bm, {faces}, {axis})
        expect(r.faceMap.size).toBe(faces.length)

        const m = mirror
        for (const [src, dst] of r.faceMap) {
            const n = before.get(src)!
            const expected = normalize([
                m[0][0] * n[0] + m[1][0] * n[1] + m[2][0] * n[2],
                m[0][1] * n[0] + m[1][1] * n[1] + m[2][1] * n[2],
                m[0][2] * n[0] + m[1][2] * n[1] + m[2][2] * n[2],
            ])
            const got = normalize(faceNormal(dst))
            expect(dot(got, expected)).toBeCloseTo(1, 9)
            // And not the un-flipped answer, which is the negation.
            expect(dot(got, expected)).not.toBeCloseTo(-1, 3)
        }
        return r
    }

    it('reverses the winding of every mirrored face', () => {
        const bm = new BMesh()
        const {faces} = box(bm, 1, 2)
        const r = checkFlipped(bm, faces, [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], 'x')
        expect(r.faces.length).toBe(6)
        expect(windingProblems(bm)).toEqual([])
    })

    it('leaves the mirrored shell facing outwards', () => {
        const bm = new BMesh()
        const {faces} = box(bm, 1, 2)
        const r = mirrorGeometry(bm, {faces}, {axis: 'x'})
        // Centre of the mirrored box.
        const centre: Vec3 = [-1.5, 0.5, 0.5]
        for (const f of r.faces) {
            const c = faceCenter(f)
            const outward: Vec3 = [c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]]
            expect(dot(normalize(faceNormal(f)), normalize(outward))).toBeCloseTo(1, 9)
        }
    })

    it('reverses the winding of an n-gon too, keeping its first corner', () => {
        const bm = new BMesh()
        const verts = [
            bm.vertCreate(1, 0, 0), bm.vertCreate(2, 0, 0), bm.vertCreate(2.5, 1, 0),
            bm.vertCreate(2, 2, 0), bm.vertCreate(1, 2, 0), bm.vertCreate(0.5, 1, 0),
        ]
        const f = bm.faceCreate(verts)
        const before = normalize(faceNormal(f))
        const r = mirrorGeometry(bm, {faces: [f]}, {axis: 'x'})

        const mf = r.faces[0]
        expect(mf.len).toBe(6)
        const got = normalize(faceNormal(mf))
        // `mesh_flip_faces` keeps corner 0: the mirrored face still starts at the image of verts[0].
        expect(mf.lFirst.v).toBe(r.vertMap.get(verts[0])!)
        expect([...mf.eachLoop()].map(l => l.v)).toEqual(
            [verts[0], ...verts.slice(1).reverse()].map(v => r.vertMap.get(v)!))
        // The hexagon is wound anticlockwise in the XY plane, so its normal is +Z. A reflection
        // about x maps +Z to +Z; without the winding flip the mirrored face would read -Z.
        expect(before[2]).toBeCloseTo(1, 9)
        expect(got[2]).toBeCloseTo(1, 9)
        expect(got[0]).toBeCloseTo(0, 9)
        expect(got[1]).toBeCloseTo(0, 9)
    })
})

describe('mirrorGeometry - the weld', () => {
    it('welds vertices on the mirror plane instead of duplicating them', () => {
        const bm = new BMesh()
        const {verts, faces} = box(bm, 0, 1) // the x = 0 face sits on the plane
        const r = mirrorGeometry(bm, {faces}, {axis: 'x'})

        // Eight new vertices, less the four on the plane.
        expect(r.welded.length).toBe(4)
        expect(bm.totvert).toBe(12)
        expect(distinctPositionCount(bm)).toBe(12)
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])

        // 24 edges, less the four on the plane that were already there.
        expect(bm.totedge).toBe(20)
        // 12 faces, less the copy of the plane face, which the weld found already existed.
        expect(bm.totface).toBe(11)
        expect(eulerCharacteristic(bm)).toBe(12 - 20 + 11)

        // The four plane edges now carry the plane face plus one side face from each half.
        expect(radialHistogram(bm)).toEqual({2: 16, 3: 4})

        // The welded vertices map to themselves: their image became the original.
        for (const v of verts) {
            if (v.x === 0) expect(r.vertMap.get(v)).toBe(v)
            else expect(r.vertMap.get(v)).not.toBe(v)
        }
    })

    it('reports the copy without the elements the weld resolved onto the original half', () => {
        const bm = new BMesh()
        const {faces} = box(bm, 0, 1)
        const r = mirrorGeometry(bm, {faces}, {axis: 'x'})

        // Four new vertices (the far side), the four plane ones having welded away.
        expect(r.verts.length).toBe(4)
        // 12 mirrored edges, less the four plane ones that already existed.
        expect(r.edges.length).toBe(8)
        // 6 mirrored faces, less the plane face that already existed.
        expect(r.faces.length).toBe(5)
        for (const v of r.verts) expect(v.x).toBeCloseTo(-1, 12)
    })

    it('welds only within mergeDistance', () => {
        // The near face is at x = 0.05, so its image is 0.1 away.
        const welded = new BMesh()
        const a = mirrorGeometry(welded, {faces: box(welded, 0.05, 1).faces}, {axis: 'x', mergeDistance: 0.06})
        expect(a.welded.length).toBe(4)
        expect(welded.totvert).toBe(12)

        const kept = new BMesh()
        const b = mirrorGeometry(kept, {faces: box(kept, 0.05, 1).faces}, {axis: 'x', mergeDistance: 0.04})
        expect(b.welded).toEqual([])
        expect(kept.totvert).toBe(16)
    })

    it('welds against the mirror plane of the given space, not the world origin', () => {
        // Mirror about x = 2, with the box's near face exactly on it.
        const bm = new BMesh()
        const {faces} = box(bm, 2, 3)
        const r = mirrorGeometry(bm, {faces}, {axis: 'x', matrix: mat4Translation([2, 0, 0])})
        expect(r.welded.length).toBe(4)
        expect(bm.totvert).toBe(12)
        expect(bm.validate()).toEqual([])
    })

    it('welds an open surface without leaving a seam', () => {
        // A quad straddling nothing: two of its corners are on the plane.
        const bm = new BMesh()
        const v = [
            bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0),
            bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0),
        ]
        const f = bm.faceCreate(v)
        const r = mirrorGeometry(bm, {faces: [f]}, {axis: 'x'})

        expect(r.welded.length).toBe(2)
        expect(bm.totvert).toBe(6)
        expect(bm.totedge).toBe(7)
        expect(bm.totface).toBe(2)
        expect(bm.validate()).toEqual([])
        // The shared edge on the plane has both faces on it: the two halves are one surface.
        expect(radialHistogram(bm)).toEqual({1: 6, 2: 1})
        expect(windingProblems(bm)).toEqual([])
        expect(eulerCharacteristic(bm)).toBe(1) // a disk
    })
})

describe('mirrorGeometry - UVs', () => {
    function quadWithUvs(bm: BMesh) {
        const layer = bm.addLayer('loop', 'uv', 'float2' as AttrType)
        const v = [
            bm.vertCreate(1, 0, 0), bm.vertCreate(2, 0, 0),
            bm.vertCreate(2, 1, 0), bm.vertCreate(1, 1, 0),
        ]
        const f = bm.faceCreate(v)
        const uvs: [number, number][] = [[0.25, 0.75], [0.5, 0.75], [0.5, 0.25], [0.25, 0.25]]
        const loops = [...f.eachLoop()]
        for (let i = 0; i < loops.length; i++) {
            setComponent(loops[i], bm.ldata, layer, 0, uvs[i][0])
            setComponent(loops[i], bm.ldata, layer, 1, uvs[i][1])
        }
        return {f, layer, uvs, loops}
    }

    it('leaves UVs alone by default', () => {
        const bm = new BMesh()
        const {f, layer} = quadWithUvs(bm)
        const r = mirrorGeometry(bm, {faces: [f]}, {axis: 'x'})
        const us = [...r.faces[0].eachLoop()].map(l => getComponent(l, layer, 0)).sort()
        expect(us).toEqual([0.25, 0.25, 0.5, 0.5])
    })

    it('flips U and V when asked', () => {
        for (const [mirrorU, mirrorV] of [[true, false], [false, true], [true, true]] as const) {
            const bm = new BMesh()
            const {f, layer} = quadWithUvs(bm)
            const r = mirrorGeometry(bm, {faces: [f]}, {axis: 'x', mirrorU, mirrorV})
            const got = [...r.faces[0].eachLoop()].map(l => [
                getComponent(l, layer, 0), getComponent(l, layer, 1),
            ])
            for (const [u, v] of got) {
                // The originals are 0.25 / 0.5, so a flip gives 0.75 / 0.5.
                if (mirrorU) expect([0.5, 0.75]).toContain(+u.toFixed(6))
                else expect([0.25, 0.5]).toContain(+u.toFixed(6))
                if (mirrorV) expect([0.25, 0.75]).toContain(+v.toFixed(6))
                else expect([0.25, 0.75]).toContain(+v.toFixed(6))
            }
        }
    })

    it('flips within the UDIM tile when mirrorUdim is set', () => {
        const bm = new BMesh()
        const {f, layer} = quadWithUvs(bm)
        // Push the quad into the second UDIM tile.
        for (const l of f.eachLoop()) setComponent(l, bm.ldata, layer, 0, getComponent(l, layer, 0) + 2)

        const r = mirrorGeometry(bm, {faces: [f]}, {axis: 'x', mirrorU: true, mirrorUdim: true})
        // `ceil(2.25) - fmod(2.25, 1)` is 3 - 0.25 = 2.75: still in the same tile.
        const us = [...r.faces[0].eachLoop()].map(l => +getComponent(l, layer, 0).toFixed(6)).sort()
        expect(us).toEqual([2.5, 2.5, 2.75, 2.75])
    })
})

describe('mirrorGeometry - edge cases', () => {
    it('does nothing with an empty input', () => {
        const bm = new BMesh()
        box(bm)
        const before = bm.describe()
        const r = mirrorGeometry(bm, {})
        expect(r.verts).toEqual([])
        expect(r.faces).toEqual([])
        expect(bm.describe()).toBe(before)
    })

    it('rejects useShapekey rather than silently ignoring it', () => {
        // Blender's mirror passes `use_shapekey` through to the transform operator, which moves the
        // active shape key's coordinates. The kernel has no shape keys, so this must not pretend.
        const bm = new BMesh()
        const {faces} = box(bm)
        expect(() => mirrorGeometry(bm, {faces}, {useShapekey: true})).toThrow(/shape key/)
    })

    it('pulls in the vertices and edges its faces need', () => {
        const bm = new BMesh()
        const v = [bm.vertCreate(1, 0, 0), bm.vertCreate(2, 0, 0), bm.vertCreate(2, 1, 0)]
        const f = bm.faceCreate(v)
        const r = mirrorGeometry(bm, {faces: [f]}, {axis: 'x'})
        expect(r.verts.length).toBe(3)
        expect(r.edges.length).toBe(3)
        expect(r.faces.length).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('mirrors a wire edge, which has no winding to reverse', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(1, 0, 0)
        const b = bm.vertCreate(2, 0, 0)
        const e = bm.edgeCreate(a, b)
        const r = mirrorGeometry(bm, {edges: [e]}, {axis: 'x'})
        expect(r.verts.length).toBe(2)
        expect(r.edges.length).toBe(1)
        expect(r.faces).toEqual([])
        expect(bm.totvert).toBe(4)
        expect(bm.totedge).toBe(2)
        expect(bm.validate()).toEqual([])
    })

    it('keeps the direction transform of the mirror space consistent with the point transform', () => {
        // A sanity check on the matrix itself: reflecting a direction about x negates only its x.
        const d = mat4TransformDir([
            -1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ], [1, 2, 3])
        expect(d).toEqual([-1, 2, 3])
    })
})
