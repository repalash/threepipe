import {describe, expect, it} from 'vitest'
import {meshDataFromTriangles, mergeCoplanarFaces} from './unbake'
import {bakeGeometry} from './bake'
import {MeshData} from './MeshData'
import {AttrDomain} from './constants'

/** A cube as a raw triangle soup with split corners, the way a glTF import arrives. */
function cubeTriangleSoup() {
    const s = 0.5
    const quads: [number[], number[], number[], number[]][] = [
        [[-s,-s,-s],[-s,-s,s],[-s,s,s],[-s,s,-s]],
        [[s,-s,-s],[s,s,-s],[s,s,s],[s,-s,s]],
        [[-s,-s,-s],[s,-s,-s],[s,-s,s],[-s,-s,s]],
        [[-s,s,-s],[-s,s,s],[s,s,s],[s,s,-s]],
        [[-s,-s,-s],[-s,s,-s],[s,s,-s],[s,-s,-s]],
        [[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]],
    ]
    const position: number[] = []
    const index: number[] = []
    for (const q of quads) {
        const base = position.length / 3
        for (const p of q) position.push(...p)
        index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    return {position, index}
}

describe('meshDataFromTriangles', () => {
    it('welds a split-corner cube back to 8 vertices and 12 triangles', () => {
        const {position, index} = cubeTriangleSoup()
        expect(position.length / 3).toBe(24) // every corner split, as exported
        const {mesh, weldedCount} = meshDataFromTriangles({position, index})
        expect(mesh.vertsNum).toBe(8)
        expect(mesh.facesNum).toBe(12)
        expect(mesh.edgesNum).toBe(18)
        expect(weldedCount).toBe(16)
        expect(mesh.validate()).toEqual([])
        // A closed triangulated cube: 8 - 18 + 12 = 2.
        expect(mesh.vertsNum - mesh.edgesNum + mesh.facesNum).toBe(2)
    })

    it('handles a non-indexed triangle list', () => {
        const {position, index} = cubeTriangleSoup()
        const flat: number[] = []
        for (const i of index) flat.push(position[i*3], position[i*3+1], position[i*3+2])
        const {mesh} = meshDataFromTriangles({position: flat})
        expect(mesh.vertsNum).toBe(8)
        expect(mesh.facesNum).toBe(12)
        expect(mesh.validate()).toEqual([])
    })

    it('drops triangles that collapse when welded, rather than emitting an invalid mesh', () => {
        // Two of these three corners are within tolerance of each other.
        const position = [0,0,0, 1e-9,0,0, 1,0,0, 0,1,0]
        const index = [0,1,2, 0,2,3]
        const {mesh} = meshDataFromTriangles({position, index})
        expect(mesh.facesNum).toBe(1) // the degenerate one is gone
        expect(mesh.validate()).toEqual([])
    })

    it('carries UVs to the corner domain, keeping a seam split', () => {
        const {position, index} = cubeTriangleSoup()
        const uv: number[] = []
        for (let i = 0; i < position.length / 3; i++) uv.push(i / 100, 1 - i / 100)
        const {mesh} = meshDataFromTriangles({position, index, uv})
        const layer = mesh.attributes.require('uv', AttrDomain.Corner, 'float2')
        expect(layer.data.length / 2).toBe(mesh.cornersNum)
        // Corners that welded to one vertex keep their own UVs, which is the point of the corner domain.
        const distinct = new Set<string>()
        for (let c = 0; c < mesh.cornersNum; c++) distinct.add(`${layer.data[c*2]},${layer.data[c*2+1]}`)
        expect(distinct.size).toBeGreaterThan(8)
        expect(mesh.validate()).toEqual([])
    })

    it('respects a larger tolerance by welding more aggressively', () => {
        const position = [0,0,0, 0.01,0,0, 1,0,0, 0,1,0]
        const index = [0,1,2, 0,2,3]
        const tight = meshDataFromTriangles({position, index}, {tolerance: 1e-4})
        const loose = meshDataFromTriangles({position, index}, {tolerance: 0.1})
        expect(tight.mesh.vertsNum).toBe(4)
        expect(loose.mesh.vertsNum).toBe(3)
    })

    it('assigns material indices from geometry groups', () => {
        const {position, index} = cubeTriangleSoup()
        const {mesh} = meshDataFromTriangles({
            position, index,
            groups: [{start: 0, count: 18, materialIndex: 0}, {start: 18, count: 18, materialIndex: 1}],
        })
        const mat = mesh.attributes.get('material_index')!
        expect([...mat.data].filter(m => m === 1).length).toBe(6)
    })
})

describe('bake and unbake round trip', () => {
    it('recovers the same topology a bake produced', () => {
        const s = 0.5
        const original = MeshData.fromFaces({
            positions: [-s,-s,-s, -s,-s,s, -s,s,-s, -s,s,s, s,-s,-s, s,-s,s, s,s,-s, s,s,s],
            faces: [[0,1,3,2],[2,3,7,6],[6,7,5,4],[4,5,1,0],[2,6,4,0],[7,3,1,5]],
        })
        const {data} = bakeGeometry(original)
        const {mesh} = meshDataFromTriangles({position: data.position, index: data.index})
        // Quads became triangle pairs on the way out; vertices and edges come back exactly.
        expect(mesh.vertsNum).toBe(original.vertsNum)
        expect(mesh.facesNum).toBe(12)
        expect(mesh.validate()).toEqual([])
    })
})

describe('mergeCoplanarFaces', () => {
    it('merges a triangulated flat quad back into one face', () => {
        const mesh = MeshData.fromFaces({
            positions: [0,0,0, 1,0,0, 1,1,0, 0,1,0],
            faces: [[0,1,2],[0,2,3]],
        })
        const merged = mergeCoplanarFaces(mesh)
        expect(merged).toBe(1)
        expect(mesh.facesNum).toBe(1)
        expect(mesh.faceSize(0)).toBe(4)
        expect(mesh.validate()).toEqual([])
    })

    it('leaves a folded pair alone', () => {
        const mesh = MeshData.fromFaces({
            positions: [0,0,0, 1,0,0, 1,1,0, 0,1,1],
            faces: [[0,1,2],[0,2,3]],
        })
        expect(mergeCoplanarFaces(mesh)).toBe(0)
        expect(mesh.facesNum).toBe(2)
        expect(mesh.validate()).toEqual([])
    })

    it('is off by default when unbaking, since it guesses at intent', () => {
        const {position, index} = cubeTriangleSoup()
        const plain = meshDataFromTriangles({position, index})
        expect(plain.mesh.facesNum).toBe(12)
        const merged = meshDataFromTriangles({position, index}, {mergeCoplanar: true})
        expect(merged.mesh.facesNum).toBe(6)
        expect(merged.mesh.validate()).toEqual([])
    })
})
