import {describe, expect, it} from 'vitest'
import {MeshData} from './MeshData'
import {bakeGeometry, totalTriangleCount} from './bake'
import {AttrDomain, AttrName} from './constants'

function cube(): MeshData {
    const s = 0.5
    return MeshData.fromFaces({
        positions: [-s,-s,-s, -s,-s,s, -s,s,-s, -s,s,s, s,-s,-s, s,-s,s, s,s,-s, s,s,s],
        faces: [[0,1,3,2],[2,3,7,6],[6,7,5,4],[4,5,1,0],[2,6,4,0],[7,3,1,5]],
    })
}

describe('bakeGeometry', () => {
    it('produces one vertex per corner and two triangles per quad', () => {
        const {data, triangleToFace} = bakeGeometry(cube())
        expect(data.position.length / 3).toBe(24)
        expect(data.index.length).toBe(36) // 6 quads x 2 tris x 3
        expect(triangleToFace.length).toBe(12)
        expect(totalTriangleCount(cube())).toBe(12)
    })

    it('maps every triangle back to a real face', () => {
        const mesh = cube()
        const {triangleToFace} = bakeGeometry(mesh)
        for (const f of triangleToFace) expect(f).toBeGreaterThanOrEqual(0)
        for (const f of triangleToFace) expect(f).toBeLessThan(mesh.facesNum)
        // Each quad contributes exactly two triangles.
        const counts = new Map<number, number>()
        for (const f of triangleToFace) counts.set(f, (counts.get(f) ?? 0) + 1)
        expect([...counts.values()]).toEqual([2, 2, 2, 2, 2, 2])
    })

    it('tessellates a concave n-gon without spilling outside it', () => {
        // An L-shape: a fan from vertex 0 would cross the notch, ear clipping must not.
        const mesh = MeshData.fromFaces({
            positions: [0,0,0, 2,0,0, 2,1,0, 1,1,0, 1,2,0, 0,2,0],
            faces: [[0,1,2,3,4,5]],
        })
        const {data, triangleToFace} = bakeGeometry(mesh)
        expect(triangleToFace.length).toBe(4) // n - 2
        const {index: idx, position: pos} = data
        const X = (i: number) => pos[i * 3]
        const Y = (i: number) => pos[i * 3 + 1]
        // Total tessellated area must equal the L's true area (3), not the hull's (4).
        let area = 0
        for (let t = 0; t < idx.length; t += 3) {
            const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]]
            area += Math.abs((X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a))) / 2
        }
        expect(area).toBeCloseTo(3, 5)
    })

    it('carries per-corner UVs straight through', () => {
        const mesh = cube()
        const uv = mesh.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2'})
        for (let c = 0; c < mesh.cornersNum; c++) { uv.data[c*2] = c/100; uv.data[c*2+1] = 1-c/100 }
        const {data} = bakeGeometry(mesh)
        expect(data.uv!.length / 2).toBe(24)
        expect(data.uv![3 * 2]).toBeCloseTo(0.03, 5)
    })

    it('uses face normals for flat faces and smoothed ones otherwise', () => {
        const mesh = cube()
        const sharp = mesh.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool')
        sharp.data[0] = 1
        const {data} = bakeGeometry(mesh)
        const n = data.normal!
        // Face 0 is flat, so all four of its corners share one axis-aligned normal.
        const [nx, ny, nz] = [n[0], n[1], n[2]]
        expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5)
        for (let c = 1; c < 4; c++) {
            expect(n[c * 3]).toBeCloseTo(nx, 5)
            expect(n[c * 3 + 2]).toBeCloseTo(nz, 5)
        }
    })

    it('emits a faceIndex attribute when asked', () => {
        const {data} = bakeGeometry(cube(), {includeFaceIndex: true})
        expect(data.faceIndex!.length).toBe(24)
        expect(data.faceIndex![0]).toBe(0)
        expect(data.faceIndex![23]).toBe(5)
    })

    it('refuses to bake an invalid mesh', () => {
        const mesh = cube()
        mesh.cornerVerts[0] = 99
        expect(() => bakeGeometry(mesh)).toThrow(/cannot bake an invalid MeshData/)
    })

    it('imports and runs with no renderer dependency', async () => {
        // The kernel must not pull in three: its module scope builds a Texture, which needs ImageData
        // and fails to load under Node. This test is the guard on that.
        expect(typeof globalThis.ImageData).toBe('undefined')
        const mod = await import('./bake')
        expect(typeof mod.bakeGeometry).toBe('function')
    })
})
