import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {AttrDomain, ElemFlag} from '../constants'
import {Mat4, mat4Compose, mat4Translation} from '../math'
import {
    createCircle,
    createCone,
    createCube,
    createGrid,
    createIcoSphere,
    createUVSphere,
    primitiveCircle,
    primitiveCone,
    primitiveCube,
    primitiveGrid,
    primitiveIcoSphere,
    primitiveUVSphere,
} from './primitives'

// region helpers

/** Newell normal of a face, the only formula that is right for a non-planar n-gon. */
function faceNormal(f: BMFace): [number, number, number] {
    let nx = 0, ny = 0, nz = 0
    for (const l of f.eachLoop()) {
        const a = l.v
        const b = l.next.v
        nx += (a.y - b.y) * (a.z + b.z)
        ny += (a.z - b.z) * (a.x + b.x)
        nz += (a.x - b.x) * (a.y + b.y)
    }
    const len = Math.hypot(nx, ny, nz)
    return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0]
}

function faceCenter(f: BMFace): [number, number, number] {
    let x = 0, y = 0, z = 0
    for (const l of f.eachLoop()) {
        x += l.v.x
        y += l.v.y
        z += l.v.z
    }
    return [x / f.len, y / f.len, z / f.len]
}

function meshCenter(verts: BMVert[]): [number, number, number] {
    let x = 0, y = 0, z = 0
    for (const v of verts) {
        x += v.x
        y += v.y
        z += v.z
    }
    return [x / verts.length, y / verts.length, z / verts.length]
}

/**
 * Every face of a closed primitive must face away from the centre. A single flipped face makes the
 * dot negative, which is the failure mode a vertex-count assertion cannot see.
 */
function expectOutwardWinding(faces: BMFace[], verts: BMVert[], label: string): void {
    const c = meshCenter(verts)
    for (const f of faces) {
        const n = faceNormal(f)
        const fc = faceCenter(f)
        const r: [number, number, number] = [fc[0] - c[0], fc[1] - c[1], fc[2] - c[2]]
        const rl = Math.hypot(r[0], r[1], r[2])
        if (rl < 1e-9) continue // a face straddling the centre has no outward direction
        const dot = (n[0] * r[0] + n[1] * r[1] + n[2] * r[2]) / rl
        expect(dot, `${label}: face ${f.id} (len ${f.len}) points inward, dot ${dot}`).toBeGreaterThan(0)
    }
}

/** V - E + F for the whole mesh. */
function euler(bm: BMesh): number {
    return bm.totvert - bm.totedge + bm.totface
}

function expectValid(bm: BMesh): void {
    expect(bm.validate()).toEqual([])
}

/** Face length histogram as sorted `[sides, count]` pairs. */
function faceLengths(faces: BMFace[]): [number, number][] {
    const counts = new Map<number, number>()
    for (const f of faces) counts.set(f.len, (counts.get(f.len) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0] - b[0])
}

function counts(bm: BMesh) {
    return {v: bm.totvert, e: bm.totedge, f: bm.totface}
}

// endregion

describe('createGrid', () => {
    it('has (x+1)(y+1) verts, x*y quads and the edges that implies', () => {
        for (const [x, y] of [[1, 1], [2, 3], [4, 1], [10, 10]]) {
            const bm = new BMesh()
            const res = createGrid(bm, {xSegments: x, ySegments: y})
            expect(counts(bm), `${x}x${y}`).toEqual({
                v: (x + 1) * (y + 1),
                e: x * (y + 1) + y * (x + 1),
                f: x * y,
            })
            expect(res.verts.length).toBe((x + 1) * (y + 1))
            expect(res.faces.length).toBe(x * y)
            expectValid(bm)
            // A flat disc: V - E + F = 1.
            expect(euler(bm)).toBe(1)
        }
    })

    it('makes quads only, all on the z = 0 plane, spanning -size..size', () => {
        const bm = new BMesh()
        const res = createGrid(bm, {xSegments: 3, ySegments: 5, size: 2})
        expect(faceLengths(res.faces)).toEqual([[4, 3 * 5]])
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const v of res.verts) {
            expect(v.z).toBe(0)
            minX = Math.min(minX, v.x)
            maxX = Math.max(maxX, v.x)
            minY = Math.min(minY, v.y)
            maxY = Math.max(maxY, v.y)
        }
        expect(minX).toBeCloseTo(-2, 12)
        expect(maxX).toBeCloseTo(2, 12)
        expect(minY).toBeCloseTo(-2, 12)
        expect(maxY).toBeCloseTo(2, 12)
    })

    it('clamps the segment counts to at least one, as Blender does', () => {
        const bm = new BMesh()
        createGrid(bm, {xSegments: 0, ySegments: -4})
        expect(counts(bm)).toEqual({v: 4, e: 4, f: 1})
    })

    it('applies the matrix', () => {
        const bm = new BMesh()
        const res = createGrid(bm, {xSegments: 1, ySegments: 1, size: 1, matrix: mat4Translation([3, -2, 7])})
        for (const v of res.verts) expect(v.z).toBeCloseTo(7, 12)
        expect(meshCenter(res.verts)[0]).toBeCloseTo(3, 12)
        expect(meshCenter(res.verts)[1]).toBeCloseTo(-2, 12)
    })

    it('lays the first quad`s UVs out exactly as BM_mesh_calc_uvs_grid does', () => {
        const mesh = primitiveGrid({xSegments: 1, ySegments: 1, calcUVs: true})
        const uv = mesh.attributes.get('uv')!
        expect([...uv.data]).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
    })

    it('writes per-corner UVs covering the unit square', () => {
        const mesh = primitiveGrid({xSegments: 2, ySegments: 2, calcUVs: true})
        const uv = mesh.attributes.get('uv')!
        expect(uv.domain).toBe(AttrDomain.Corner)
        expect(uv.data.length).toBe(mesh.cornersNum * 2)
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
        for (let i = 0; i < mesh.cornersNum; i++) {
            minU = Math.min(minU, uv.data[i * 2])
            maxU = Math.max(maxU, uv.data[i * 2])
            minV = Math.min(minV, uv.data[i * 2 + 1])
            maxV = Math.max(maxV, uv.data[i * 2 + 1])
        }
        expect(minU).toBeCloseTo(0, 6)
        expect(maxU).toBeCloseTo(1, 6)
        expect(minV).toBeCloseTo(0, 6)
        expect(maxV).toBeCloseTo(1, 6)
    })
})

describe('createCube', () => {
    it('is 8 verts, 12 edges, 6 quads with V - E + F = 2', () => {
        const bm = new BMesh()
        const res = createCube(bm)
        expect(counts(bm)).toEqual({v: 8, e: 12, f: 6})
        expect(euler(bm)).toBe(2)
        expect(faceLengths(res.faces)).toEqual([[4, 6]])
        expectValid(bm)
    })

    it('winds every face outward', () => {
        const bm = new BMesh()
        const res = createCube(bm)
        expectOutwardWinding(res.faces, res.verts, 'cube')
    })

    it('puts the corners at +-size/2, and treats size 0 as 1', () => {
        const bm = new BMesh()
        const res = createCube(bm, {size: 3})
        for (const v of res.verts) {
            expect(Math.abs(v.x)).toBeCloseTo(1.5, 12)
            expect(Math.abs(v.y)).toBeCloseTo(1.5, 12)
            expect(Math.abs(v.z)).toBeCloseTo(1.5, 12)
        }

        const bm2 = new BMesh()
        const res2 = createCube(bm2, {size: 0})
        for (const v of res2.verts) expect(Math.abs(v.x)).toBeCloseTo(0.5, 12)
    })

    it('applies the matrix, including rotation and scale', () => {
        const bm = new BMesh()
        const m: Mat4 = mat4Compose([1, 2, 3], [0, 0, Math.PI / 2], [2, 2, 2])
        const res = createCube(bm, {size: 2, matrix: m})
        const c = meshCenter(res.verts)
        expect(c[0]).toBeCloseTo(1, 10)
        expect(c[1]).toBeCloseTo(2, 10)
        expect(c[2]).toBeCloseTo(3, 10)
        for (const v of res.verts) expect(Math.abs(v.z - 3)).toBeCloseTo(2, 10)
        expectOutwardWinding(res.faces, res.verts, 'transformed cube')
    })

    it('walks the cube cross cursor exactly as BM_mesh_calc_uvs_cube does', () => {
        const mesh = primitiveCube({calcUVs: true})
        const uv = mesh.attributes.get('uv')!
        // Face 0 starts at (0.375, 0) and walks a quarter-unit cell anticlockwise.
        expect([...uv.data.slice(0, 8)]).toEqual([0.375, 0, 0.625, 0, 0.625, 0.25, 0.375, 0.25])
        // The cursor then steps up one cell for face 1.
        expect([...uv.data.slice(8, 16)]).toEqual([0.375, 0.25, 0.625, 0.25, 0.625, 0.5, 0.375, 0.5])
    })

    it('unwraps to the cube cross, four corners per face', () => {
        const mesh = primitiveCube({calcUVs: true})
        const uv = mesh.attributes.get('uv')!
        expect(uv.data.length).toBe(24 * 2)
        for (let i = 0; i < 24; i++) {
            expect(uv.data[i * 2]).toBeGreaterThanOrEqual(0)
            expect(uv.data[i * 2]).toBeLessThanOrEqual(1)
            expect(uv.data[i * 2 + 1]).toBeGreaterThanOrEqual(0)
            expect(uv.data[i * 2 + 1]).toBeLessThanOrEqual(1)
        }
    })
})

describe('createCircle', () => {
    it('is a bare ring when the ends are not capped', () => {
        for (const n of [3, 8, 32]) {
            const bm = new BMesh()
            const res = createCircle(bm, {segments: n})
            expect(counts(bm), `${n} segments`).toEqual({v: n, e: n, f: 0})
            expect(res.faces).toEqual([])
            expectValid(bm)
        }
    })

    it('fills with a triangle fan when capTris is set', () => {
        const n = 16
        const bm = new BMesh()
        const res = createCircle(bm, {segments: n, capEnds: true, capTris: true})
        expect(counts(bm)).toEqual({v: n + 1, e: 2 * n, f: n})
        expect(faceLengths(res.faces)).toEqual([[3, n]])
        expect(euler(bm)).toBe(1)
        expectValid(bm)
    })

    it('fills with a single n-gon when capTris is not set, dissolving the fan and its centre', () => {
        const n = 16
        const bm = new BMesh()
        const res = createCircle(bm, {segments: n, capEnds: true, capTris: false})
        expect(counts(bm)).toEqual({v: n, e: n, f: 1})
        expect(res.faces.length).toBe(1)
        expect(res.faces[0].len).toBe(n)
        expect(euler(bm)).toBe(1)
        expectValid(bm)
    })

    it('puts every vertex at the requested radius, on z = 0', () => {
        const bm = new BMesh()
        const res = createCircle(bm, {segments: 24, radius: 2.5})
        for (const v of res.verts) {
            expect(Math.hypot(v.x, v.y)).toBeCloseTo(2.5, 10)
            expect(v.z).toBe(0)
        }
    })

    it('is symmetric across the axes, which is what sin_cos_from_fraction buys', () => {
        const bm = new BMesh()
        const res = createCircle(bm, {segments: 8, radius: 1})
        const xs = res.verts.map(v => v.x).sort((a, b) => a - b)
        for (let i = 0; i < xs.length / 2; i++) {
            // Exactly equal and opposite, not merely close: that is the point of the octant folding.
            // `Math.abs` only to normalise the signed zero at the two poles of the axis.
            expect(Math.abs(xs[i] + xs[xs.length - 1 - i])).toBe(0)
            expect(Math.abs(xs[i])).toBe(Math.abs(xs[xs.length - 1 - i]))
        }
    })

    it('unwraps the cap into the unit square', () => {
        const mesh = primitiveCircle({segments: 8, radius: 2, capEnds: true, capTris: true, calcUVs: true})
        const uv = mesh.attributes.get('uv')!
        for (let i = 0; i < mesh.cornersNum; i++) {
            const u = uv.data[i * 2]
            const v = uv.data[i * 2 + 1]
            expect(Math.hypot(u - 0.5, v - 0.5)).toBeLessThanOrEqual(0.5 + 1e-6)
        }
    })

    it('produces nothing for zero segments', () => {
        const bm = new BMesh()
        const res = createCircle(bm, {segments: 0})
        expect(counts(bm)).toEqual({v: 0, e: 0, f: 0})
        expect(res.verts).toEqual([])
    })
})

describe('createCone as a cylinder', () => {
    it('is an open tube when the ends are not capped', () => {
        const n = 12
        const bm = new BMesh()
        const res = createCone(bm, {segments: n, capEnds: false})
        expect(counts(bm)).toEqual({v: 2 * n, e: 3 * n, f: n})
        expect(faceLengths(res.faces)).toEqual([[4, n]])
        expect(euler(bm)).toBe(0) // an open tube
        expectValid(bm)
    })

    it('is 64 verts, 96 edges and 34 faces at 32 segments with n-gon caps', () => {
        const bm = new BMesh()
        const res = createCone(bm, {segments: 32})
        expect(counts(bm)).toEqual({v: 64, e: 96, f: 34})
        expect(euler(bm)).toBe(2)
        expect(faceLengths(res.faces)).toEqual([[4, 32], [32, 2]])
        expectValid(bm)
    })

    it('makes triangle-fan caps when capTris is set', () => {
        const n = 10
        const bm = new BMesh()
        const res = createCone(bm, {segments: n, capEnds: true, capTris: true})
        expect(counts(bm)).toEqual({v: 2 * n + 2, e: 5 * n, f: 3 * n})
        expect(euler(bm)).toBe(2)
        expect(faceLengths(res.faces)).toEqual([[3, 2 * n], [4, n]])
        expectValid(bm)
    })

    it('winds every face outward and honours radius and depth', () => {
        const bm = new BMesh()
        const res = createCone(bm, {segments: 16, radiusBottom: 2, radiusTop: 2, depth: 5})
        for (const v of res.verts) {
            const r = Math.hypot(v.x, v.y)
            // Either a rim vertex at radius 2 or one of the two cap centres on the axis.
            expect(r < 1e-9 || Math.abs(r - 2) < 1e-9, `radius ${r}`).toBe(true)
            expect(Math.abs(v.z)).toBeCloseTo(2.5, 12)
        }
        expectOutwardWinding(res.faces, res.verts, 'cylinder')
    })

    it('makes a truncated cone when the two radii differ', () => {
        const bm = new BMesh()
        const res = createCone(bm, {segments: 12, radiusBottom: 3, radiusTop: 1, depth: 2})
        expect(counts(bm)).toEqual({v: 24, e: 36, f: 14})
        for (const v of res.verts) {
            const r = Math.hypot(v.x, v.y)
            expect(Math.abs(r - (v.z < 0 ? 3 : 1))).toBeLessThan(1e-9)
        }
        expectOutwardWinding(res.faces, res.verts, 'truncated cone')
        expectValid(bm)
    })
})

describe('createCone as a cone', () => {
    it('collapses the zero-radius end to a single apex', () => {
        const n = 16
        const bm = new BMesh()
        const res = createCone(bm, {segments: n, radiusBottom: 0, radiusTop: 1, depth: 2})
        expect(counts(bm)).toEqual({v: n + 1, e: 2 * n, f: n + 1})
        expect(euler(bm)).toBe(2)
        expect(faceLengths(res.faces)).toEqual([[3, n], [n, 1]])
        expectValid(bm)

        const apex = res.verts.filter(v => Math.hypot(v.x, v.y) < 1e-9)
        expect(apex.length).toBe(1)
        expect(apex[0].z).toBeCloseTo(-1, 12)
    })

    it('collapses the other end too, and winds outward either way', () => {
        const n = 12
        for (const flip of [false, true]) {
            const bm = new BMesh()
            const res = createCone(bm, {
                segments: n,
                radiusBottom: flip ? 1 : 0,
                radiusTop: flip ? 0 : 1,
                depth: 2,
            })
            expect(counts(bm), `flip=${flip}`).toEqual({v: n + 1, e: 2 * n, f: n + 1})
            expect(euler(bm)).toBe(2)
            expectValid(bm)
            expectOutwardWinding(res.faces, res.verts, `cone flip=${flip}`)
        }
    })

    it('makes a triangle fan cap on the cone when capTris is set', () => {
        const n = 8
        const bm = new BMesh()
        const res = createCone(bm, {segments: n, radiusBottom: 0, capEnds: true, capTris: true})
        expect(faceLengths(res.faces)).toEqual([[3, 2 * n]])
        expect(euler(bm)).toBe(2)
        expectValid(bm)
    })
})

describe('createUVSphere', () => {
    it('has the ring counts the extrude-and-weld construction implies', () => {
        for (const [u, v] of [[3, 2], [8, 4], [32, 16]]) {
            const bm = new BMesh()
            createUVSphere(bm, {uSegments: u, vSegments: v})
            expect(counts(bm), `${u}x${v}`).toEqual({
                v: u * (v - 1) + 2,
                e: u * (2 * v - 1),
                f: u * v,
            })
            expect(euler(bm), `${u}x${v}`).toBe(2)
            expectValid(bm)
        }
    })

    it('is triangles at the poles and quads everywhere else', () => {
        const u = 12
        const v = 6
        const bm = new BMesh()
        const res = createUVSphere(bm, {uSegments: u, vSegments: v})
        expect(faceLengths(res.faces)).toEqual([[3, 2 * u], [4, u * (v - 2)]])

        // The triangles are exactly the ones touching a pole.
        const poles = res.verts.filter(vert => Math.hypot(vert.x, vert.y) < 1e-9)
        expect(poles.length).toBe(2)
        for (const f of res.faces) {
            const touchesPole = [...f.eachLoop()].some(l => poles.includes(l.v))
            expect(f.len === 3).toBe(touchesPole)
        }
    })

    it('puts every vertex at the radius, and the equator ring exactly there', () => {
        const bm = new BMesh()
        const res = createUVSphere(bm, {uSegments: 16, vSegments: 8, radius: 3})
        for (const vert of res.verts) {
            expect(Math.hypot(vert.x, vert.y, vert.z)).toBeCloseTo(3, 10)
        }
        const equator = res.verts.filter(vert => Math.abs(vert.z) < 1e-9)
        expect(equator.length).toBe(16)
        for (const vert of equator) expect(Math.hypot(vert.x, vert.y)).toBeCloseTo(3, 10)
    })

    it('winds every face outward, including across the seam and the poles', () => {
        const bm = new BMesh()
        const res = createUVSphere(bm, {uSegments: 16, vSegments: 8})
        expectOutwardWinding(res.faces, res.verts, 'uv sphere')
    })

    it('applies the matrix after building, so the sphere ends up moved', () => {
        const bm = new BMesh()
        const res = createUVSphere(bm, {uSegments: 8, vSegments: 4, radius: 1, matrix: mat4Translation([0, 0, 10])})
        for (const vert of res.verts) {
            expect(Math.hypot(vert.x, vert.y, vert.z - 10)).toBeCloseTo(1, 10)
        }
    })

    it('unwraps to a full latitude/longitude map', () => {
        const mesh = primitiveUVSphere({uSegments: 12, vSegments: 6, calcUVs: true})
        const uv = mesh.attributes.get('uv')!
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
        for (let i = 0; i < mesh.cornersNum; i++) {
            minU = Math.min(minU, uv.data[i * 2])
            maxU = Math.max(maxU, uv.data[i * 2])
            minV = Math.min(minV, uv.data[i * 2 + 1])
            maxV = Math.max(maxV, uv.data[i * 2 + 1])
        }
        expect(minU).toBeCloseTo(0, 6)
        expect(maxU).toBeGreaterThan(0.9)
        expect(minV).toBeCloseTo(0, 5)
        expect(maxV).toBeCloseTo(1, 5)
    })
})

describe('createIcoSphere', () => {
    it('is the bare icosahedron at one subdivision', () => {
        const bm = new BMesh()
        const res = createIcoSphere(bm, {subdivisions: 1})
        expect(counts(bm)).toEqual({v: 12, e: 30, f: 20})
        expect(euler(bm)).toBe(2)
        expect(faceLengths(res.faces)).toEqual([[3, 20]])
        expectValid(bm)
    })

    it('quadruples the faces per subdivision level', () => {
        for (const [subdiv, n] of [[2, 2], [3, 4], [4, 8]] as const) {
            const bm = new BMesh()
            const res = createIcoSphere(bm, {subdivisions: subdiv})
            expect(counts(bm), `subdiv ${subdiv}`).toEqual({
                v: 10 * n * n + 2,
                e: 30 * n * n,
                f: 20 * n * n,
            })
            expect(euler(bm)).toBe(2)
            expect(faceLengths(res.faces)).toEqual([[3, 20 * n * n]])
            expectValid(bm)
        }
    })

    it('puts every vertex on the sphere of the requested radius', () => {
        for (const subdiv of [1, 2, 3]) {
            const bm = new BMesh()
            const res = createIcoSphere(bm, {subdivisions: subdiv, radius: 2})
            for (const v of res.verts) {
                // Level 1 is Blender's literal table, which is only good to about 1e-5.
                expect(Math.hypot(v.x, v.y, v.z), `subdiv ${subdiv}`).toBeCloseTo(2, 4)
            }
        }
    })

    it('winds every face outward', () => {
        for (const subdiv of [1, 2, 3]) {
            const bm = new BMesh()
            const res = createIcoSphere(bm, {subdivisions: subdiv})
            expectOutwardWinding(res.faces, res.verts, `icosphere subdiv ${subdiv}`)
        }
    })

    it('applies the matrix after the subdivision, not before', () => {
        const bm = new BMesh()
        const res = createIcoSphere(bm, {subdivisions: 2, radius: 1, matrix: mat4Translation([5, 0, 0])})
        for (const v of res.verts) expect(Math.hypot(v.x - 5, v.y, v.z)).toBeCloseTo(1, 4)
    })

    it('carries Blender`s icosahedron unwrap', () => {
        const mesh = primitiveIcoSphere({subdivisions: 1, calcUVs: true})
        const uv = mesh.attributes.get('uv')!
        expect(uv.data.length).toBe(60 * 2)
        expect(uv.data[0]).toBeCloseTo(0.181819, 6)
        expect(uv.data[1]).toBeCloseTo(0, 6)
        expect(uv.data[2]).toBeCloseTo(0.272728, 6)
        expect(uv.data[3]).toBeCloseTo(0.157461, 6)
    })
})

describe('primitive* wrappers', () => {
    const cases: [string, () => ReturnType<typeof primitiveCube>][] = [
        ['grid', () => primitiveGrid({xSegments: 3, ySegments: 2, calcUVs: true})],
        ['cube', () => primitiveCube({calcUVs: true})],
        ['circle', () => primitiveCircle({segments: 9, capEnds: true, calcUVs: true})],
        ['cylinder', () => primitiveCone({segments: 9, calcUVs: true})],
        ['cone', () => primitiveCone({segments: 9, radiusBottom: 0, calcUVs: true})],
        ['uvsphere', () => primitiveUVSphere({uSegments: 9, vSegments: 5, calcUVs: true})],
        ['icosphere', () => primitiveIcoSphere({subdivisions: 2, calcUVs: true})],
    ]

    for (const [name, build] of cases) {
        it(`${name} converts to a valid MeshData`, () => {
            const mesh = build()
            expect(mesh.validate(), name).toEqual([])
            expect(mesh.vertsNum).toBeGreaterThan(0)
            expect(mesh.attributes.get('uv')).toBeTruthy()
        })
    }
})

describe('composition and selection', () => {
    it('two primitives in one mesh keep both intact', () => {
        const bm = new BMesh()
        const cube = createCube(bm, {size: 1, selectResult: false})
        const sphere = createUVSphere(bm, {uSegments: 8, vSegments: 4, matrix: mat4Translation([10, 0, 0])})
        expect(bm.totface).toBe(cube.faces.length + sphere.faces.length)
        expect(euler(bm)).toBe(4) // two closed surfaces
        expectValid(bm)
        expect(cube.faces.every(f => bm.faces.has(f))).toBe(true)
    })

    it('selects the new vertices and flushes up to the faces', () => {
        const bm = new BMesh()
        createCube(bm, {size: 1, selectResult: false})
        expect(bm.totvertsel).toBe(0)

        const res = createGrid(bm, {xSegments: 1, ySegments: 1})
        expect(res.verts.every(v => (v.hflag & ElemFlag.Select) !== 0)).toBe(true)
        expect(bm.totvertsel).toBe(4)
        expect(bm.totfacesel).toBe(1)
        // The cube built before it was deselected by the operator's selectNone.
        expect([...bm.faces].filter(f => f.hflag & ElemFlag.Select).length).toBe(1)
    })
})
