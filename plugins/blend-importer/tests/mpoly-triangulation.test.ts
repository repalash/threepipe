/**
 * The pre-3.6 `MPoly` triangulation, and what happens when a modifier fails.
 *
 * Both were found loading `bugatti.blend` (Blender 2.7x, 171 MB): it loaded on threepipe 0.5.1 and
 * "could not load" once the modifier stack landed. The cause was two old bugs meeting a new caller:
 *
 * - `createBufferGeometryOld` sized its buffers as `floor(totloop * 3 / 2)` and triangulated with a
 *   step-2 strip. A triangle reserved four slots and used three, so the index ended in unused zero
 *   entries and was usually not a whole number of triangles; and any face of five or more corners
 *   lost every triangle the strip did not touch - a pentagon its middle, a 12-gon half its area.
 *   0.5.1 rendered bugatti about 389k triangles short.
 * - The new Subsurf reads the index three at a time, walked off the end of that buffer, and threw.
 *   One throwing mesh rejected the whole file, and the importer reports that as an empty load, so it
 *   looked like a hang.
 * - Pre-3.6 files had no Catmull-Clark cage, so Subsurf fell back to Loop subdivision of that buffer -
 *   one vertex per corner, every triangle disconnected. Loop cannot smooth across a gap, so it produced
 *   four times the triangles and no smoothing; and since every vertex of a soup is a boundary vertex,
 *   its per-vertex scan over every edge went quadratic. bugatti was still subdividing after minutes.
 *
 * Fixtures are real `.blend` files; see `README.md` in this folder. Everything skips cleanly when the
 * corpus is absent.
 */

import {describe, expect, it} from 'vitest'
import * as THREE from 'threepipe'
import {fixturePath, loadBlend, pickMesh} from './fixtures'
import {createBufferGeometryOld} from '../src/loader/geometry'
import {subdivideGeometry} from '../src/loader/subdivide'
import {createMesh} from '../src/loader/mesh'
import {subdivideCage} from '../src/loader/catmull'

const ctx: any = {
    Object3D: THREE.Object3D, Mesh: THREE.Mesh, BufferGeometry: THREE.BufferGeometry,
    BufferAttribute: THREE.BufferAttribute, MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
    MeshBasicMaterial: THREE.MeshBasicMaterial,
}

const PUDDING = fixturePath('jiggly_pudding.blend')
const CUBE = fixturePath('default-cube.blend')
const HEXGRID = fixturePath('hexgrid_blender_geometry_nodes_demo.blend')
const PREVIEW = fixturePath('blender-5.0.0-preview.blend')

/** Faces of an `MPoly` mesh, as plain corner-count / loop-start pairs. */
function polys(mesh: any): {totloop: number, loopstart: number}[] {
    return Array.isArray(mesh.mpoly) ? mesh.mpoly : [mesh.mpoly]
}

/** The area of a polygon given by its corners, via Newell - independent of any triangulation. */
function polygonArea(points: number[][]): number {
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < points.length; i++) {
        const a = points[i]
        const b = points[(i + 1) % points.length]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    return Math.hypot(nx, ny, nz) / 2
}

function triangleArea(pos: ArrayLike<number>, a: number, b: number, c: number): number {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2]
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2]
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

describe.skipIf(!PUDDING)('MPoly triangulation: buffer size', () => {
    it('emits exactly n - 2 triangles per face, and nothing after them', async() => {
        const mesh = pickMesh(await loadBlend(PUDDING!), 'MEPudding')
        const faces = polys(mesh)
        expect(faces.filter(f => f.totloop === 3).length).toBeGreaterThan(0)

        const expected = faces.reduce((n, f) => n + Math.max(0, f.totloop - 2), 0)
        const geometry = createBufferGeometryOld(mesh, ctx)
        const index = geometry.getIndex()!

        // A whole number of triangles: the old sizing left 32 unused slots on this mesh, one per
        // triangle face, which is not divisible by three.
        expect(index.count % 3).toBe(0)
        expect(index.count / 3).toBe(expected)
        expect(geometry.getAttribute('position').count).toBe(index.count)
    })
})

describe.skipIf(!HEXGRID)('MPoly triangulation: n-gons keep their area', () => {
    for (const name of ['MECube.002', 'MEPlane.006', 'MECone.001']) {
        it(`${name}: every face's triangles cover the whole face`, async() => {
            const mesh = pickMesh(await loadBlend(HEXGRID!), name)
            const faces = polys(mesh)
            expect(faces.some(f => f.totloop >= 5)).toBe(true)

            const geometry = createBufferGeometryOld(mesh, ctx)
            const pos = geometry.getAttribute('position').array as Float32Array
            const index = geometry.getIndex()!.array as Uint32Array

            // Triangles come out in face order, n - 2 per face, so each face owns a known index range.
            let tri = 0
            for (const face of faces) {
                const corners: number[][] = []
                for (let c = 0; c < face.totloop; c++) {
                    const co = mesh.mvert[mesh.mloop[face.loopstart + c].v].co
                    corners.push([co[0], co[2], -co[1]])
                }
                let covered = 0
                for (let k = 0; k < face.totloop - 2; k++, tri++) {
                    covered += triangleArea(pos, index[tri * 3], index[tri * 3 + 1], index[tri * 3 + 2])
                }
                // The old strip dropped the middle triangle of every face with five or more corners, so
                // its triangles covered only part of the face. These faces are convex, where a fan is
                // exact.
                expect(covered).toBeCloseTo(polygonArea(corners), 5)
            }
            expect(tri * 3).toBe(index.length)
        })
    }

    it('leaves triangles and quads exactly as they were', async() => {
        const mesh = pickMesh(await loadBlend(HEXGRID!), 'MECone.001')
        const geometry = createBufferGeometryOld(mesh, ctx)
        const pos = geometry.getAttribute('position').array as Float32Array
        const index = geometry.getIndex()!.array as Uint32Array

        let tri = 0
        for (const face of polys(mesh)) {
            if (face.totloop === 3) {
                // One triangle, corners 0, 1, 2 in order - what the strip produced too.
                const want = [0, 1, 2].map(c => mesh.mvert[mesh.mloop[face.loopstart + c].v].co)
                for (let k = 0; k < 3; k++) {
                    const v = index[tri * 3 + k]
                    expect(pos[v * 3]).toBeCloseTo(want[k][0], 6)
                    expect(pos[v * 3 + 1]).toBeCloseTo(want[k][2], 6)
                    expect(pos[v * 3 + 2]).toBeCloseTo(-want[k][1], 6)
                }
            }
            tri += Math.max(0, face.totloop - 2)
        }
    })
})

describe.skipIf(!HEXGRID)('subdivision on the fixed triangulation', () => {
    it('runs on n-gon meshes and keeps a whole number of triangles', async() => {
        const mesh = pickMesh(await loadBlend(HEXGRID!), 'MECone.001')
        const base = createBufferGeometryOld(mesh, ctx)
        const sub = subdivideGeometry(base, ctx, 1)
        expect(sub).not.toBe(base)
        expect(sub.getIndex().count % 3).toBe(0)
        expect(sub.getIndex().count).toBe(base.getIndex()!.count * 4)
    })

    it('says what is wrong with a buffer that is not whole triangles, instead of reading past it', () => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
        g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 3]), 1))
        expect(() => subdivideGeometry(g, ctx, 1)).toThrow(/not a whole number of triangles/)
    })
})

describe.skipIf(!PREVIEW)('a failing modifier', () => {
    it('is skipped, and the object still loads with the geometry from before it', async() => {
        const blend = await loadBlend(PREVIEW!)
        const object = (blend.objects.Object ?? []).find((o: any) => o.id?.name === 'OBpreview_cube')
        expect(object).toBeTruthy()

        // Seed the per-datablock geometry cache with a buffer the Subsurf step must reject, so the
        // failure is real rather than mocked.
        const broken = new THREE.BufferGeometry()
        broken.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
        broken.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 3]), 1))
        const loaded = new WeakMap()
        loaded.set(object.data, broken)

        const errors: string[] = []
        const original = console.error
        console.error = (...args: any[]) => { errors.push(args.map(String).join(' ')) }
        let result: any
        try {
            result = createMesh(object, loaded, ctx)
        } finally {
            console.error = original
        }

        // The object is still created, on the geometry from before the failing step...
        expect(result).toBeTruthy()
        expect(result.geometry).toBe(broken)
        // ...and the failure is reported rather than swallowed.
        expect(errors.some(e => /modifier\(s\) failed and were skipped/.test(e) && /Subsurf/.test(e))).toBe(true)
    })
})

describe.skipIf(!CUBE)('MPoly files get the Catmull-Clark cage', () => {
    it('carries the n-gons, so Subsurf can smooth across faces', async() => {
        const mesh = pickMesh(await loadBlend(CUBE!))
        const geometry = createBufferGeometryOld(mesh, ctx)
        const cage = geometry.userData.__cage
        expect(cage).toBeTruthy()
        // Blender's default cube: eight shared vertices and six quads, not 36 disconnected corners.
        expect(cage.positions.length).toBe(8)
        expect(cage.faces.length).toBe(6)
        for (const f of cage.faces) expect(f.length).toBe(4)
        expect(cage.uvs.length).toBe(6)
        for (const f of cage.uvs) expect(f.length).toBe(4)
    })

    it('smooths a cube toward a sphere, which Loop on the corner soup could not', async() => {
        const mesh = pickMesh(await loadBlend(CUBE!))
        const geometry = createBufferGeometryOld(mesh, ctx)
        const extent = (g: any) => {
            const p = g.getAttribute('position').array as Float32Array
            let m = 0
            for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i]))
            return m
        }
        expect(extent(geometry)).toBeCloseTo(1, 5)

        // Catmull-Clark pulls every corner of a cube inward. Two levels on a unit cube bring the
        // furthest point well inside it.
        const smooth = subdivideCage(geometry.userData.__cage, ctx, 2)
        expect(extent(smooth)).toBeLessThan(0.9)

        // Loop on the disconnected corner buffer moves nothing: each triangle is subdivided alone and
        // all its corners are pinned, so the cube stays a cube. That is the path pre-3.6 files used to
        // take, and why their Subsurf did nothing but cost.
        const soup = subdivideGeometry(geometry, ctx, 2)
        expect(extent(soup)).toBeCloseTo(1, 5)
    })
})

describe('subdividing an open mesh', () => {
    it('stays linear in the number of boundary vertices', () => {
        // An unwelded grid: 40k triangles, 120k vertices, every one of them on a boundary. The
        // per-vertex scan over every edge made this about 10^10 steps; one pass makes it about 10^5.
        const quadsX = 200, quadsY = 100
        const pos: number[] = []
        const idx: number[] = []
        for (let y = 0; y < quadsY; y++) {
            for (let x = 0; x < quadsX; x++) {
                const quad = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
                for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
                    for (const corner of [a, b, c]) {
                        idx.push(pos.length / 3)
                        pos.push(quad[corner][0], 0, quad[corner][1])
                    }
                }
            }
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1))

        const t = Date.now()
        const sub = subdivideGeometry(g, ctx, 1, Infinity)
        const ms = Date.now() - t
        expect(sub.getIndex().count).toBe(idx.length * 4)
        // Generous: the linear pass takes well under a second here, the quadratic one minutes.
        expect(ms).toBeLessThan(10000)
    })
})
