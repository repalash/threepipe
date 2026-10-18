import {beforeAll, describe, expect, it} from 'vitest'
import Module from 'manifold-3d'
import {MeshData} from '../MeshData'
import {AttrDomain, AttrName} from '../constants'
import {primitiveCube, primitiveCone} from '../generate/primitives'
import {ManifoldApi, meshBooleanManifold} from './manifoldBoolean'

let api: ManifoldApi
beforeAll(async() => {
    const wasm = await Module()
    wasm.setup()
    api = wasm as unknown as ManifoldApi
})

const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const scale = (s: number) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]
const volume = (m: MeshData) => {
    // divergence theorem over a fan triangulation of each face
    let v = 0
    const P = m.positions
    for (let f = 0; f < m.facesNum; f++) {
        const s = m.faceOffsets[f], e = m.faceOffsets[f + 1]
        const a = m.cornerVerts[s]
        for (let c = s + 1; c + 1 < e; c++) {
            const b = m.cornerVerts[c], d = m.cornerVerts[c + 1]
            v += P[3 * a] * (P[3 * b + 1] * P[3 * d + 2] - P[3 * b + 2] * P[3 * d + 1])
                - P[3 * a + 1] * (P[3 * b] * P[3 * d + 2] - P[3 * b + 2] * P[3 * d])
                + P[3 * a + 2] * (P[3 * b] * P[3 * d + 1] - P[3 * b + 1] * P[3 * d])
        }
    }
    return v / 6
}

describe('meshBooleanManifold (mesh_boolean_manifold.cc)', () => {
    it('difference of two cubes: an L-shaped solid, faces merged back to quads and n-gons, manifold', () => {
        const a = primitiveCube({size: 2}), b = primitiveCube({size: 2})
        const r = meshBooleanManifold(api, [a, b], 'DIFFERENCE', [undefined as never, translate(1, 1, 1)])
        expect(r.error).toBe('NONE')
        const m = r.mesh!
        expect(volume(m)).toBeCloseTo(8 - 1, 5)
        expect(m.validate()).toEqual([])
        // an L-block cut from a cube: 9 faces (3 untouched quads, 3 L-hexagons, 3 cut quads)
        expect(m.facesNum).toBe(9)
        const sizes = Array.from({length: m.facesNum}, (_, f) => m.faceOffsets[f + 1] - m.faceOffsets[f]).sort()
        expect(sizes).toEqual([4, 4, 4, 4, 4, 4, 6, 6, 6])
    })

    it('union and intersection volumes; intersecting edges separate the inputs', () => {
        const a = primitiveCube({size: 2}), b = primitiveCube({size: 2})
        const t = [undefined as never, translate(1, 0, 0)]
        const u = meshBooleanManifold(api, [a, b], 'UNION', t)
        const i = meshBooleanManifold(api, [a, b], 'INTERSECT', t)
        expect(volume(u.mesh!)).toBeCloseTo(12, 5)
        expect(volume(i.mesh!)).toBeCloseTo(4, 5)
        // coplanar sides: the seams between the parts of A and of B on the shared faces
        expect(u.intersectingEdges.length).toBeGreaterThan(0)
        const mat = (m: MeshData) => m.attributes.get(AttrName.materialIndex)
        expect(mat(u.mesh!)).toBeUndefined()
    })

    it('a cylinder through a cube: face attributes follow their source faces, point attributes their source points', () => {
        const a = primitiveCube({size: 2})
        a.materials = ['body']
        const cyl = primitiveCone({segments: 16, radiusBottom: 0.4, radiusTop: 0.4, depth: 4})
        cyl.materials = ['bore'] // realize_instances joins the slots: body 0, bore 1
        const w = a.attributes.ensure('w', AttrDomain.Point, 'float').data as Float32Array
        w.fill(0.5)
        const r = meshBooleanManifold(api, [a, cyl], 'DIFFERENCE')
        expect(r.error).toBe('NONE')
        const m = r.mesh!
        expect(volume(m)).toBeLessThan(8)
        expect(m.validate()).toEqual([])
        const om = Array.from(m.attributes.get(AttrName.materialIndex)!.data)
        expect(om.filter(x => x === 1).length).toBe(16) // the bore's 16 side faces come from the cylinder
        // original cube corners keep their value; new intersection points get the default
        const ow = m.attributes.get('w')!.data
        let kept = 0
        for (let v = 0; v < m.vertsNum; v++) if (ow[v] === 0.5) kept++
        expect(kept).toBe(8)
    })

    it('subtracting a plane trims (the TrimByPlane special case); a non-manifold operand is reported', () => {
        const a = primitiveCube({size: 2})
        const plane = MeshData.fromFaces({positions: [-3, -3, 0.5, 3, -3, 0.5, 3, 3, 0.5, -3, 3, 0.5], faces: [[0, 1, 2, 3]]})
        const r = meshBooleanManifold(api, [a, plane], 'DIFFERENCE')
        expect(r.error).toBe('NONE')
        expect(volume(r.mesh!)).toBeCloseTo(4 * 0.5, 5) // TrimByPlane keeps the half the quad's normal (+z) points into
        const open = MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [[0, 1, 2]]})
        const bad = meshBooleanManifold(api, [a, open, a], 'UNION', [undefined as never, undefined as never, scale(0.5)])
        expect(bad.error).toBe('NON_MANIFOLD')
        expect(bad.nonManifoldMeshIndices).toEqual([1])
    })
})
