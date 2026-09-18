import {describe, expect, it} from 'vitest'
import {MeshData} from './MeshData'
import {bakeGeometry, totalTriangleCount} from './bake'
import {primitiveCube} from './generate/primitives'
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

describe('shading', () => {
    // A new BMesh face is flat (`bmesh_core.cc:493`), so a generated primitive bakes with one normal
    // per corner rather than an averaged one per vertex. Getting this wrong is invisible in topology
    // tests and glaring in a render: every box looks inflated.
    it('bakes a generated cube flat, one normal per face', () => {
        const mesh = primitiveCube({size: 2})
        expect(mesh.attributes.get(AttrName.sharpFace)).toBeDefined()

        const {data} = bakeGeometry(mesh, {includeNormals: true})
        const normals = new Set<string>()
        for (let i = 0; i < data.normal!.length; i += 3) {
            normals.add([data.normal![i], data.normal![i + 1], data.normal![i + 2]]
                .map(n => n.toFixed(4)).join(','))
        }
        expect(normals.size).toBe(6)
        for (const n of normals) {
            // Each is an axis direction, not a corner-averaged diagonal.
            expect(n.split(',').filter(c => Math.abs(+c) > 0.001).length).toBe(1)
        }
    })

    it('bakes smoothed normals when the faces are marked smooth', () => {
        const mesh = primitiveCube({size: 2})
        mesh.attributes.get(AttrName.sharpFace)!.data.fill(0)

        const {data} = bakeGeometry(mesh, {includeNormals: true})
        const normals = new Set<string>()
        for (let i = 0; i < data.normal!.length; i += 3) {
            normals.add([data.normal![i], data.normal![i + 1], data.normal![i + 2]]
                .map(n => n.toFixed(4)).join(','))
        }
        expect(normals.size).toBe(8)
    })
})

describe('normals, against mesh_normals.cc', () => {
    const key = (n: number[]) => n.map(v => v.toFixed(4)).join(',')
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const normalise = (n: number[]) => {
        const l = Math.hypot(n[0], n[1], n[2])
        return [n[0] / l, n[1] / l, n[2] / l]
    }

    /** Newell's normal for one face, computed here so the test does not trust the bake for it. */
    function faceNormalOf(mesh: MeshData, face: number): number[] {
        const pos = mesh.positions
        const verts = mesh.faceVerts(face)
        const n = [0, 0, 0]
        for (let i = 0; i < verts.length; i++) {
            const a = verts[i] * 3
            const b = verts[(i + 1) % verts.length] * 3
            n[0] += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2])
            n[1] += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b])
            n[2] += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1])
        }
        return normalise(n)
    }

    /** The baked normals, one per corner, rounded so they can be compared by value. */
    function normalsOf(mesh: MeshData): string[] {
        const {data} = bakeGeometry(mesh, {includeNormals: true})
        const out: string[] = []
        for (let i = 0; i < data.normal!.length; i += 3) {
            out.push(key([data.normal![i], data.normal![i + 1], data.normal![i + 2]]))
        }
        return out
    }

    /**
     * Two faces meeting at one vertex with very different corner angles.
     *
     * A wide quad and a narrow sliver share the edge from the origin. Unweighted, the two face
     * normals count equally; Blender weights each by the angle it subtends *at that vertex*
     * (`normals_calc_verts`, `mesh_normals.cc:194`), so the quad dominates.
     */
    function unequalAngles(): MeshData {
        return MeshData.fromFaces({
            positions: [
                0, 0, 0,      // 0 - the shared vertex
                1, 0, 0,      // 1
                1, 0, 1,      // 2
                0, 0, 1,      // 3   wide quad, 90 degrees at vertex 0
                1, 0.02, 0,   // 4   sliver, folded up, about 1 degree at vertex 0
            ],
            faces: [[0, 1, 2, 3], [0, 4, 1]],
        })
    }

    it('weights each face by the angle it subtends at the vertex', () => {
        const mesh = unequalAngles()
        const normals = normalsOf(mesh).map(n => n.split(',').map(Number))

        // Corner 0 of the quad and corner 0 of the sliver are the same vertex in one smooth fan.
        expect(key(normals[0])).toBe(key(normals[4]))
        expect(Math.hypot(...normals[0])).toBeCloseTo(1, 4)

        // The weighted result is almost exactly the quad's own normal.
        const quad = faceNormalOf(mesh, 0)
        expect(dot(normals[0], quad)).toBeGreaterThan(0.999)

        // An unweighted average of the two face normals - what the bake used to do - is measurably
        // different, which is what makes this a test of the weighting rather than of the fan.
        const sliver = faceNormalOf(mesh, 1)
        const unweighted = normalise([quad[0] + sliver[0], quad[1] + sliver[1], quad[2] + sliver[2]])
        expect(dot(unweighted, quad)).toBeLessThan(0.996)
    })

    it('splits the normal fan at a sharp edge', () => {
        // A folded pair of quads sharing edge 3-2. Corner 2 of face 0 and corner 1 of face 1 are the
        // same vertex on either side of the fold, which is what the split has to separate.
        const build = () => MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 2, 0, 1, 2],
            faces: [[0, 1, 2, 3], [3, 2, 4, 5]],
        })

        const smooth = normalsOf(build())
        expect(smooth[2]).toBe(smooth[5])

        const mesh = build()
        const sharp = mesh.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool')
        const edgeVerts = mesh.edgeVerts
        let marked = 0
        for (let e = 0; e < mesh.edgesNum; e++) {
            const a = edgeVerts[e * 2]
            const b = edgeVerts[e * 2 + 1]
            if ((a === 2 && b === 3) || (a === 3 && b === 2)) {
                ;(sharp.data as Uint8Array)[e] = 1
                marked++
            }
        }
        expect(marked).toBe(1)

        const split = normalsOf(mesh)
        // Sharp: they no longer agree, and each takes its own face's normal.
        expect(split[2]).not.toBe(split[5])
        expect(split[2]).toBe(key(faceNormalOf(mesh, 0)))
        expect(split[5]).toBe(key(faceNormalOf(mesh, 1)))
        // The corners away from the fold were never merged, so they are unchanged.
        expect(split[0]).toBe(smooth[0])
    })

    it('treats a non-manifold edge as a fan delimiter', () => {
        // Three quads on one edge: `normals_calc_corners` does not merge across a non-manifold edge,
        // so each face keeps its own normal there rather than averaging all three.
        const mesh = MeshData.fromFaces({
            positions: [
                0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1,
                1, 1, 0, 0, 1, 0,
                1, -1, 0, 0, -1, 0,
            ],
            faces: [[0, 1, 2, 3], [0, 1, 4, 5], [0, 1, 6, 7]],
        })
        const normals = normalsOf(mesh)
        for (let f = 0; f < mesh.facesNum; f++) {
            const expected = key(faceNormalOf(mesh, f))
            for (let c = mesh.faceStart(f); c < mesh.faceStart(f) + mesh.faceSize(f); c++) {
                expect(normals[c]).toBe(expected)
            }
        }
    })
})
