import {describe, expect, it} from 'vitest'
import {MeshData} from './MeshData'
import {AttrDomain, AttrName, SelectMode} from './constants'
import {AttributeStorage} from './attributes'

/** Unit cube with quad faces, in the winding Blender's `create_cube` uses. */
function cube(): MeshData {
    const s = 0.5
    const positions = [
        -s, -s, -s, -s, -s, s, -s, s, -s, -s, s, s,
        s, -s, -s, s, -s, s, s, s, -s, s, s, s,
    ]
    const faces = [
        [0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4],
        [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5],
    ]
    return MeshData.fromFaces({positions, faces})
}

describe('MeshData.fromFaces', () => {
    it('builds a cube with the expected element counts', () => {
        const mesh = cube()
        expect(mesh.vertsNum).toBe(8)
        expect(mesh.facesNum).toBe(6)
        expect(mesh.cornersNum).toBe(24)
        // Euler: V - E + F = 2 for a closed genus-0 surface, so E must be 12.
        expect(mesh.edgesNum).toBe(12)
        expect(mesh.vertsNum - mesh.edgesNum + mesh.facesNum).toBe(2)
    })

    it('produces a valid mesh', () => {
        expect(cube().validate()).toEqual([])
    })

    it('gives every face four corners and a consistent offsets array', () => {
        const mesh = cube()
        expect(mesh.faceOffsets.length).toBe(7)
        expect(mesh.faceOffsets[0]).toBe(0)
        expect(mesh.faceOffsets[6]).toBe(24)
        for (let f = 0; f < mesh.facesNum; f++) expect(mesh.faceSize(f)).toBe(4)
    })

    it('shares each edge between exactly two faces', () => {
        const mesh = cube()
        const uses = new Int32Array(mesh.edgesNum)
        for (const e of mesh.cornerEdges) uses[e]++
        for (let e = 0; e < mesh.edgesNum; e++) expect(uses[e]).toBe(2)
    })

    it('supports n-gons and mixed face sizes', () => {
        const mesh = MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 0, 1, 0],
            faces: [[0, 1, 4, 5], [1, 2, 3, 4], [0, 1, 2, 3, 4, 5]],
        })
        expect(mesh.facesNum).toBe(3)
        expect(mesh.faceSize(0)).toBe(4)
        expect(mesh.faceSize(2)).toBe(6)
        expect(mesh.validate()).toEqual([])
    })

    it('stores material indices when given', () => {
        const mesh = MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
            faces: [[0, 1, 2], [0, 2, 3]],
            materialIndices: [0, 1],
        })
        const layer = mesh.attributes.require(AttrName.materialIndex, AttrDomain.Face, 'int32')
        expect([...layer.data]).toEqual([0, 1])
    })

    it('rejects a face with fewer than three vertices', () => {
        expect(() => MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0], faces: [[0, 1]]}))
            .toThrow(/at least 3/)
    })

    it('rejects an out-of-range vertex index', () => {
        expect(() => MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 1, 1, 0], faces: [[0, 1, 7]]}))
            .toThrow(/out of range/)
    })
})

describe('MeshData.calculateCornerEdges', () => {
    it('reproduces the same corner edges as calculateEdges', () => {
        const mesh = cube()
        const expected = [...mesh.cornerEdges]
        mesh.cornerEdges.fill(-1)
        mesh.calculateCornerEdges()
        expect([...mesh.cornerEdges]).toEqual(expected)
    })

    it('throws when a face uses an edge that does not exist', () => {
        const mesh = cube()
        // Break one edge so the pair it used to represent is no longer present.
        mesh.edgeVerts[0] = mesh.edgeVerts[1]
        expect(() => mesh.calculateCornerEdges()).toThrow(/does not exist/)
    })
})

describe('MeshData.validate', () => {
    it('reports an out-of-range corner vertex', () => {
        const mesh = cube()
        mesh.cornerVerts[3] = 99
        expect(mesh.validate().join('\n')).toMatch(/corner 3 references vertex 99/)
    })

    it('reports a corner edge that joins the wrong vertices', () => {
        const mesh = cube()
        mesh.cornerEdges[0] = (mesh.cornerEdges[0] + 5) % mesh.edgesNum
        expect(mesh.validate().join('\n')).toMatch(/but it joins/)
    })

    it('reports a degenerate edge', () => {
        const mesh = cube()
        mesh.edgeVerts[1] = mesh.edgeVerts[0]
        expect(mesh.validate().join('\n')).toMatch(/degenerate/)
    })

    it('reports a selection-history entry pointing past the end', () => {
        const mesh = cube()
        mesh.select.history.push({type: 'vert', index: 500})
        expect(mesh.validate().join('\n')).toMatch(/selection history references vert 500/)
    })

    it('assertValid throws with the problems listed', () => {
        const mesh = cube()
        mesh.cornerVerts[0] = -1
        expect(() => mesh.assertValid()).toThrow(/invalid MeshData/)
    })
})

describe('MeshData.clone', () => {
    it('copies attributes, offsets and selection state without aliasing', () => {
        const mesh = cube()
        mesh.select.mode = SelectMode.Edge
        mesh.select.history.push({type: 'face', index: 2})
        mesh.select.activeFace = 2
        mesh.materials = ['red']

        const copy = mesh.clone()
        expect(copy.validate()).toEqual([])
        expect(copy.describe()).toBe(mesh.describe())
        expect(copy.select.mode).toBe(SelectMode.Edge)
        expect(copy.select.activeFace).toBe(2)

        copy.positions[0] = 42
        copy.faceOffsets[1] = 99
        copy.select.history.push({type: 'vert', index: 0})
        copy.materials.push('blue')

        expect(mesh.positions[0]).not.toBe(42)
        expect(mesh.faceOffsets[1]).toBe(4)
        expect(mesh.select.history.length).toBe(1)
        expect(mesh.materials).toEqual(['red'])
    })
})

describe('MeshData.describe', () => {
    it('summarises counts and hides internal attributes', () => {
        const mesh = cube()
        mesh.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2'})
        const text = mesh.describe()
        expect(text).toContain('verts 8')
        expect(text).toContain('faces 6')
        expect(text).toContain('uv')
        // `.corner_vert` and friends are topology, not user data.
        expect(text).not.toContain('.corner_vert')
    })
})

describe('AttributeStorage', () => {
    it('resizes a domain, preserving existing values and defaulting new ones', () => {
        const store = new AttributeStorage({[AttrDomain.Point]: 2})
        const layer = store.add({name: 'weight', domain: AttrDomain.Point, type: 'float', data: [1, 2]})
        store.resizeDomain(AttrDomain.Point, 4)
        expect([...layer.data]).toEqual([1, 2, 0, 0])
        store.resizeDomain(AttrDomain.Point, 1)
        expect([...layer.data]).toEqual([1])
    })

    it('defaults byteColor to opaque white rather than transparent black', () => {
        const store = new AttributeStorage({[AttrDomain.Point]: 1})
        const layer = store.add({name: 'color', domain: AttrDomain.Point, type: 'byteColor'})
        expect([...layer.data]).toEqual([255, 255, 255, 255])
    })

    it('refuses to redefine a built-in attribute with the wrong shape', () => {
        const store = new AttributeStorage({[AttrDomain.Face]: 1, [AttrDomain.Point]: 1})
        expect(() => store.add({name: AttrName.materialIndex, domain: AttrDomain.Point, type: 'float'}))
            .toThrow(/must be face\/int32/)
    })

    it('refuses duplicate names', () => {
        const store = new AttributeStorage({[AttrDomain.Point]: 1})
        store.add({name: 'uv', domain: AttrDomain.Point, type: 'float2'})
        expect(() => store.add({name: 'uv', domain: AttrDomain.Point, type: 'float2'})).toThrow(/already exists/)
    })

    it('require reports the actual domain and type on mismatch', () => {
        const store = new AttributeStorage({[AttrDomain.Corner]: 1})
        store.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2'})
        expect(() => store.require('uv', AttrDomain.Point, 'float2')).toThrow(/is on domain corner, expected point/)
        expect(() => store.require('uv', AttrDomain.Corner, 'float3')).toThrow(/has type 'float2', expected 'float3'/)
        expect(() => store.require('nope', AttrDomain.Corner, 'float2')).toThrow(/missing attribute/)
    })

    it('ensure is idempotent', () => {
        const store = new AttributeStorage({[AttrDomain.Point]: 3})
        const a = store.ensure('w', AttrDomain.Point, 'float')
        const b = store.ensure('w', AttrDomain.Point, 'float')
        expect(a).toBe(b)
        expect(store.size).toBe(1)
    })

    it('validate catches a layer whose length no longer matches its domain', () => {
        const store = new AttributeStorage({[AttrDomain.Point]: 2})
        const layer = store.add({name: 'w', domain: AttrDomain.Point, type: 'float'})
        layer.data = new Float32Array(5)
        expect(store.validate().join('\n')).toMatch(/has 5 values, expected 2/)
    })

    it('clone does not alias layer data', () => {
        const store = new AttributeStorage({[AttrDomain.Point]: 2})
        store.add({name: 'w', domain: AttrDomain.Point, type: 'float', data: [1, 2]})
        const copy = store.clone()
        copy.get('w')!.data[0] = 9
        expect(store.get('w')!.data[0]).toBe(1)
    })
})

describe('kernel node-safety', () => {
    it('imports and runs without any DOM global', () => {
        // If this file needed `document`, `window` or `ImageData`, the import above would already have
        // thrown under vitest's node environment. Assert explicitly so the intent is documented.
        expect(typeof globalThis.document).toBe('undefined')
        expect(cube().vertsNum).toBe(8)
    })
})
