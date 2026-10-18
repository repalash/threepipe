import {describe, expect, it} from 'vitest'
import {bevelEdges, bmFromMesh, bmToMesh, primitiveCube} from '@threepipe/mesh-kernel'
import {meshDetail} from '../src/commands/session'

/**
 * `inspect {detail}` has to say which vertices each edge index joins, because `bevel {edges}` and
 * `deleteElements {edges}` take edge indices and nothing else exposes their order.
 * (issues/open/modelling-tools/command-no-edge-listing.md)
 */
describe('inspect detail lists edges', () => {
    it('lists every edge as a vertex pair in MeshData edge order', () => {
        const mesh = primitiveCube({size: 2})
        const d = meshDetail(mesh)
        expect(d.edgeVerts).toHaveLength(12)
        const ev = mesh.edgeVerts
        d.edgeVerts.forEach(([a, b], i) => expect([a, b]).toEqual([ev[i * 2], ev[i * 2 + 1]]))
        // Every face side is one of the listed edges, and every edge is a side of two faces.
        const key = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`
        const listed = new Map(d.edgeVerts.map(([a, b]) => [key(a, b), 0]))
        for (const f of d.faceVerts) {
            for (let i = 0; i < f.length; i++) {
                const k = key(f[i], f[(i + 1) % f.length])
                expect(listed.has(k)).toBe(true)
                listed.set(k, listed.get(k)! + 1)
            }
        }
        expect([...listed.values()].every(n => n === 2)).toBe(true)
    })

    it('is the order bevel addresses: the listed edge is the one that gets bevelled', () => {
        const mesh = primitiveCube({size: 2})
        const d = meshDetail(mesh)
        // The top edge along x at z = +1: both ends at y = 1, z = 1.
        const target = d.edgeVerts.findIndex(([a, b]) =>
            [a, b].every(v => d.vertices[v][1] === 1 && d.vertices[v][2] === 1))
        expect(target).toBeGreaterThanOrEqual(0)
        const bm = bmFromMesh(mesh)
        const edge = [...bm.edges][target]
        bevelEdges(bm, [edge], {offset: 0.2, segments: 1})
        const after = bmToMesh(bm)
        // One chamfer: 6 + 1 faces, and no vertex left at the bevelled corner line (y = 1, z = 1).
        expect(after.facesNum).toBe(7)
        const p = after.positions
        for (let v = 0; v < after.vertsNum; v++) {
            expect(Math.abs(p[v * 3 + 1] - 1) < 1e-6 && Math.abs(p[v * 3 + 2] - 1) < 1e-6).toBe(false)
        }
    })

    it('caps all three lists at the limit and says how many were left out', () => {
        const d = meshDetail(primitiveCube({size: 2}), 5)
        expect([d.vertices.length, d.faceVerts.length, d.edgeVerts.length]).toEqual([5, 5, 5])
        expect([d.verticesTruncated, d.facesTruncated, d.edgesTruncated]).toEqual([3, 1, 7])
    })
})
