import {describe, expect, it} from 'vitest'
import {findDoublesByDistance, findDoublesByDistanceConnected, removeDoubles} from './removeDoubles'
import {joinMeshes} from './join'
import {primitiveCube, primitiveGrid} from '../generate/primitives'
import {bmFromMesh, bmToMesh} from '../bmesh/convert'
import {BMesh} from '../bmesh/BMesh'
import {mat4Translation} from '../math'
import {MeshData} from '../MeshData'

/** Loose vertices at given positions, which is enough for the finding half. */
function looseVerts(bm: BMesh, points: [number, number, number][]) {
    return points.map(p => bm.vertCreate(p[0], p[1], p[2]))
}

describe('findDoublesByDistance', () => {
    it('maps a pair onto the lower index, for stability', () => {
        const bm = new BMesh()
        const verts = looseVerts(bm, [[0, 0, 0], [0.00005, 0, 0]])
        const map = findDoublesByDistance(verts, 0.001)
        expect(map.size).toBe(1)
        expect(map.get(verts[1])).toBe(verts[0])
    })

    it('leaves vertices further apart than the distance alone', () => {
        const bm = new BMesh()
        const verts = looseVerts(bm, [[0, 0, 0], [0.5, 0, 0]])
        expect(findDoublesByDistance(verts, 0.001).size).toBe(0)
        expect(findDoublesByDistance(verts, 1).size).toBe(1)
    })

    it('keeps the most central member of a larger cluster', () => {
        const bm = new BMesh()
        // Three in a row: the middle one is closest to the centroid, so it is the survivor even
        // though it is not the lowest index. That is `deduplicate_target_calc_fn`.
        const verts = looseVerts(bm, [[-0.001, 0, 0], [0, 0, 0], [0.001, 0, 0]])
        const map = findDoublesByDistance(verts, 0.01)
        expect(map.size).toBe(2)
        expect(map.get(verts[0])).toBe(verts[1])
        expect(map.get(verts[2])).toBe(verts[1])
    })

    it('never maps a kept vertex away, and prefers it as the survivor', () => {
        const bm = new BMesh()
        const verts = looseVerts(bm, [[0, 0, 0], [0.0001, 0, 0], [0.0002, 0, 0]])
        const map = findDoublesByDistance(verts, 0.01, new Set([verts[2]]))
        expect(map.has(verts[2])).toBe(false)
        expect(map.get(verts[0])).toBe(verts[2])
        expect(map.get(verts[1])).toBe(verts[2])
    })
})

describe('findDoublesByDistanceConnected', () => {
    it('merges along an edge but not across empty space', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(0.0001, 0, 0)
        bm.edgeCreate(a, b)
        // A third vertex sitting on `a` but joined to nothing.
        const loose = bm.vertCreate(0, 0, 0)

        const verts = [a, b, loose]
        expect(findDoublesByDistanceConnected(verts, 0.01).size).toBe(1)
        // The plain search has no such scruples and takes all three.
        expect(findDoublesByDistance(verts, 0.01).size).toBe(2)
    })

    it('reaches the opposite corner of a quad, which no edge joins', () => {
        // A degenerate quad whose opposite corners are coincident: edge stepping alone never
        // compares them, which is why the face step exists.
        const mesh = MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0],
            faces: [[0, 1, 2, 3]],
        })
        const bm = bmFromMesh(mesh)
        const verts = [...bm.verts]
        const map = findDoublesByDistanceConnected(verts, 0.01)
        expect(map.size).toBe(1)
    })

    it('does not need the face step for a triangle', () => {
        const mesh = MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 0.5, 1, 0],
            faces: [[0, 1, 2]],
        })
        const bm = bmFromMesh(mesh)
        expect(findDoublesByDistanceConnected([...bm.verts], 0.01).size).toBe(0)
    })
})

describe('removeDoubles', () => {
    it('welds two cubes joined face to face into one manifold solid', () => {
        // Two unit cubes sharing a face, joined without welding - 16 vertices, 8 of them doubled.
        const joined = joinMeshes([
            {mesh: primitiveCube({size: 1})},
            {mesh: primitiveCube({size: 1}), matrix: mat4Translation([1, 0, 0])},
        ])
        expect(joined.vertsNum).toBe(16)

        const bm = bmFromMesh(joined)
        const result = removeDoubles(bm, [...bm.verts], {distance: 0.001})
        expect(result.merged).toBe(4)

        const merged = bmToMesh(bm)
        expect(merged.vertsNum).toBe(12)
        expect(merged.validate()).toEqual([])
        // Every position is now distinct, which is the whole point.
        const seen = new Set<string>()
        for (let v = 0; v < merged.vertsNum; v++) {
            seen.add([merged.positions[v * 3], merged.positions[v * 3 + 1], merged.positions[v * 3 + 2]].join())
        }
        expect(seen.size).toBe(merged.vertsNum)
    })

    it('does nothing when there is nothing to merge', () => {
        const bm = bmFromMesh(primitiveCube({size: 1}))
        const before = {v: bm.totvert, e: bm.totedge, f: bm.totface}
        const result = removeDoubles(bm, [...bm.verts], {distance: 0.001})
        expect(result.merged).toBe(0)
        expect({v: bm.totvert, e: bm.totedge, f: bm.totface}).toEqual(before)
        expect(bm.validate()).toEqual([])
    })

    it('collapses a grid onto itself when the distance swallows it', () => {
        const bm = bmFromMesh(primitiveGrid({xSegments: 2, ySegments: 2, size: 1}))
        const result = removeDoubles(bm, [...bm.verts], {distance: 10})
        expect(result.merged).toBeGreaterThan(0)
        // Every face has collapsed, so nothing is left to draw - but the mesh is still coherent.
        expect(bm.totvert).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('respects the connected option on touching but unjoined surfaces', () => {
        const joined = joinMeshes([
            {mesh: primitiveCube({size: 1})},
            {mesh: primitiveCube({size: 1}), matrix: mat4Translation([1, 0, 0])},
        ])
        const bm = bmFromMesh(joined)
        // The two cubes are separate shells: nothing connects one to the other, so a connected
        // search finds nothing to merge where the plain search merges the touching face.
        const connected = findDoublesByDistanceConnected([...bm.verts], 0.001)
        expect(connected.size).toBe(0)
        expect(findDoublesByDistance([...bm.verts], 0.001).size).toBe(4)
    })
})
