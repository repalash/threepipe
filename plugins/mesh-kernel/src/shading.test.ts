import {describe, expect, it} from 'vitest'
import {MeshData} from './MeshData'
import {AttrDomain, AttrName} from './constants'
import {meshFaceNormals, meshSharpEdgesSetFromAngle, meshSmoothSet, shadeFlat, shadeSmooth, shadeSmoothByAngle} from './shading'
import {primitiveCone, primitiveCube} from './generate/primitives'
import {bakeGeometry} from './bake'

const D = Math.PI / 180
const sharpEdgeCount = (m: MeshData) => {
    const l = m.attributes.get(AttrName.sharpEdge)
    return l ? (l.data as Uint8Array).reduce((a, b) => a + b, 0) : 0
}
const edgeKey = (m: MeshData, e: number) => {
    const a = m.edgeVerts[2 * e], b = m.edgeVerts[2 * e + 1]
    return a < b ? `${a}-${b}` : `${b}-${a}`
}

describe('shading (Shade Flat / Smooth / Smooth by Angle)', () => {
    it('face normals follow face_normal_calc: quads by diagonals, tris, n-gons by Newell, degenerate = +Z', () => {
        const m = MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 0, 1, 0, 0, 5, 1, 0, 5, 2, 0, 5, 2, 1, 5, 1, 2, 5, 0, 1, 5],
            faces: [[0, 1, 2, 3], [4, 5, 6], [7, 8, 9, 10, 11, 12], [0, 1, 4]],
        })
        const n = Array.from(meshFaceNormals(m)).map(v => v + 0)
        expect(Array.from(n.slice(0, 3))).toEqual([0, 0, 1])
        expect(Array.from(n.slice(3, 6))).toEqual([0, -1, 0])
        expect(Array.from(n.slice(6, 9))).toEqual([0, 0, 1])
        expect(Array.from(n.slice(9, 12))).toEqual([0, 0, 1]) // collinear triangle
    })

    it('smooth by angle on a cube: every edge at 30 deg, none past 90 deg, flat/smooth at the ends of the range', () => {
        const m = primitiveCube()
        // primitives come out flat, as Blender's do; by-angle on its own leaves sharp_face alone
        expect(m.attributes.get(AttrName.sharpFace)).toBeDefined()
        shadeSmoothByAngle(m, 30 * D, false)
        expect(m.attributes.get(AttrName.sharpFace)).toBeUndefined()
        expect(sharpEdgeCount(m)).toBe(12)
        shadeSmoothByAngle(m, 91 * D, false)
        expect(sharpEdgeCount(m)).toBe(0)
        meshSharpEdgesSetFromAngle(m, 0)
        expect(Array.from(m.attributes.get(AttrName.sharpFace)!.data)).toEqual([1, 1, 1, 1, 1, 1])
        meshSharpEdgesSetFromAngle(m, Math.PI)
        expect(m.attributes.get(AttrName.sharpFace)).toBeUndefined()
        expect(m.attributes.get(AttrName.sharpEdge)).toBeUndefined()
    })

    it('a 32-sided cylinder: sides smooth (11.25 deg), cap rims sharp; the bake splits only at the rims', () => {
        const m = primitiveCone({segments: 32, radiusBottom: 1, radiusTop: 1, depth: 2})
        shadeSmoothByAngle(m)
        expect(sharpEdgeCount(m)).toBe(64)
        const g = bakeGeometry(m).data
        // distinct normals per position: a side vertex has its smooth normal plus one from the cap
        const normals = new Map<string, Set<string>>()
        for (let i = 0; i < g.position.length / 3; i++) {
            const k = [0, 1, 2].map(c => g.position[3 * i + c].toFixed(4)).join()
            const n = [0, 1, 2].map(c => g.normal![3 * i + c].toFixed(3)).join()
            if (!normals.has(k)) normals.set(k, new Set())
            normals.get(k)!.add(n)
        }
        for (const s of normals.values()) expect(s.size).toBe(2)
    })

    it('keepSharpEdges keeps earlier tags; without it the layer starts empty', () => {
        const m = primitiveCone({segments: 32, depth: 2})
        shadeSmooth(m)
        const sharp = m.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data as Uint8Array
        // tag one side edge (between two side quads) by hand
        let side = -1
        for (let e = 0; e < m.edgesNum; e++) {
            const a = m.edgeVerts[2 * e] * 3, b = m.edgeVerts[2 * e + 1] * 3
            if (Math.abs(m.positions[a + 2] - m.positions[b + 2]) > 1) { side = e; break }
        }
        sharp[side] = 1
        shadeSmoothByAngle(m, 30 * D, true)
        expect(sharpEdgeCount(m)).toBe(65)
        shadeSmoothByAngle(m, 30 * D, false)
        expect(sharpEdgeCount(m)).toBe(64)
    })

    it('flat faces are sharp by topology, so their edges are not tagged by angle', () => {
        const m = primitiveCube()
        shadeSmooth(m, false)
        const sf = m.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool').data as Uint8Array
        sf[0] = 1
        meshSharpEdgesSetFromAngle(m, 100 * D, true)
        expect(sharpEdgeCount(m)).toBe(0)
    })

    it('a face flipped against its neighbour is tagged by its opposed normal; a non-manifold edge is reset', () => {
        // two coplanar quads sharing an edge, the second wound backwards: the normals oppose, so the angle test
        // fires (the flip test would make the edge sharp in the fan anyway)
        const flipped = MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0], faces: [[0, 1, 2, 3], [1, 2, 5, 4]]})
        meshSharpEdgesSetFromAngle(flipped, 30 * D)
        expect(sharpEdgeCount(flipped)).toBe(1)
        // three fins on one edge: the first two faces decide (here 120 deg apart, so tagged by angle); the third
        // finds the edge already sharp and leaves it
        const fins = (third: number[]) => MeshData.fromFaces({
            positions: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, -0.5, 0.866, 0, -0.5, 0.866, 1, -1, 0, 0, -1, 0, 1, ...third],
            faces: [[0, 2, 3, 1], [1, 5, 4, 0], [0, 8, 9, 1]],
        })
        const shared = (m: MeshData) => { for (let e = 0; e < m.edgesNum; e++) if (edgeKey(m, e) === '0-1') return e; return -1 }
        const a = fins([-0.5, -0.866, 0, -0.5, -0.866, 1])
        meshSharpEdgesSetFromAngle(a, 30 * D)
        expect((a.attributes.get(AttrName.sharpEdge)!.data as Uint8Array)[shared(a)]).toBe(1)
        // first two coplanar (a straight continuation, smooth), the third makes it non-manifold: reset to not-tagged
        const b2 = MeshData.fromFaces({
            positions: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, -1, 0, 0, -1, 0, 1, 0, 1, 0, 0, 1, 1],
            faces: [[0, 2, 3, 1], [1, 5, 4, 0], [0, 6, 7, 1]],
        })
        const sb = b2.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data as Uint8Array
        meshSharpEdgesSetFromAngle(b2, 30 * D, true)
        expect(sb[shared(b2)]).toBe(0)
    })

    it('meshSmoothSet: flat writes sharp_face everywhere, smooth removes it, sharp edges kept on request', () => {
        const m = primitiveCube()
        shadeSmoothByAngle(m, 30 * D)
        shadeFlat(m)
        expect(Array.from(m.attributes.get(AttrName.sharpFace)!.data)).toEqual([1, 1, 1, 1, 1, 1])
        expect(sharpEdgeCount(m)).toBe(12)
        meshSmoothSet(m, true)
        expect(m.attributes.get(AttrName.sharpFace)).toBeUndefined()
        expect(m.attributes.get(AttrName.sharpEdge)).toBeUndefined()
    })
})
