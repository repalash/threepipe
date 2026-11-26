/**
 * The `.blend` -> `MeshData` n-gon import path, checked against real `.blend` files.
 *
 * Two kinds of assertion live here, and the distinction matters:
 *
 * - **Parity**, against arrays Blender itself wrote. The ground truth is the JSON in
 *   `plugins/mesh-kernel/tests/fixtures/`, extracted straight out of the DNA blocks by
 *   `extract-blend-fixture.mjs`. Nothing in it is derived or hand-written, so a decoding bug shows up
 *   as a mismatch rather than passing because both sides made the same mistake.
 * - **Behaviour** the importer is supposed to have: quads stay quads, per-corner UVs stay per corner,
 *   a concave n-gon tessellates without inverted triangles.
 *
 * The `.blend` sources are not in the repo; see `README.md` in this folder. Everything here skips
 * when they are absent, which is visible in the run rather than silent.
 */

import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    AttrDomain,
    AttrName,
    bakeGeometry,
    bmFromMesh,
    bmToMesh,
    MeshData,
} from '@threepipe/mesh-kernel'
import {createMeshData} from '../src/loader/meshData'
import {cageFromMeshData} from '../src/loader/catmull'
import {fixturePath, loadBlend, meshLayout, pickMesh} from './fixtures'

const here = dirname(fileURLToPath(import.meta.url))

/** Ground truth written by Blender, shared with the kernel's own parity suite. */
interface BlenderFixture {
    source: string
    mesh: string
    vertsNum: number
    edgesNum: number
    facesNum: number
    cornersNum: number
    faceOffsets: number[]
    positions: number[]
    edgeVerts: number[]
    cornerVerts: number[]
    cornerEdges: number[]
    uvName?: string
    uv?: number[]
}

function groundTruth(name: string): BlenderFixture {
    return JSON.parse(readFileSync(join(here, '../../mesh-kernel/tests/fixtures', name), 'utf8'))
}

/** Parse a fixture and decode its single mesh datablock, or `null` when the corpus is absent. */
async function importMesh(file: string, meshName?: string): Promise<MeshData | null> {
    const path = fixturePath(file)
    if (!path) return null
    const blend = await loadBlend(path)
    const datablock = pickMesh(blend, meshName)
    const reasons: string[] = []
    const mesh = createMeshData(datablock, r => reasons.push(r))
    if (!mesh) throw new Error(`${file}: createMeshData refused the mesh: ${reasons.join('; ')}`)
    return mesh
}

/** Face sizes as a `{size: count}` histogram - the cheapest way to say "these are still n-gons". */
function faceSizeHistogram(mesh: MeshData): Record<number, number> {
    const out: Record<number, number> = {}
    for (let f = 0; f < mesh.facesNum; f++) {
        const n = mesh.faceSize(f)
        out[n] = (out[n] ?? 0) + 1
    }
    return out
}

/** Newell normal of a face, from the mesh's own positions. */
function faceNormal(mesh: MeshData, f: number): [number, number, number] {
    const p = mesh.positions, cv = mesh.cornerVerts
    const start = mesh.faceOffsets[f], end = mesh.faceOffsets[f + 1]
    let nx = 0, ny = 0, nz = 0
    for (let c = start; c < end; c++) {
        const i = cv[c] * 3, j = cv[c + 1 === end ? start : c + 1] * 3
        nx += (p[i + 1] - p[j + 1]) * (p[i + 2] + p[j + 2])
        ny += (p[i + 2] - p[j + 2]) * (p[i] + p[j])
        nz += (p[i] - p[j]) * (p[i + 1] + p[j + 1])
    }
    const len = Math.hypot(nx, ny, nz) || 1
    return [nx / len, ny / len, nz / len]
}

/**
 * Cross product of a triangle's edges, dotted with the face normal. Positive means the triangle is
 * wound the same way as the face and has real area; zero or negative means a fan folded back on
 * itself, which is the failure mode a fan has on a concave polygon.
 */
function signedTriangleArea(mesh: MeshData, f: number, a: number, b: number, c: number): number {
    const p = mesh.positions
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    const n = faceNormal(mesh, f)
    return (cx * n[0] + cy * n[1] + cz * n[2]) / 2
}

/** Faces with at least one reflex corner - the ones a fan triangulation gets wrong. */
function concaveFaces(mesh: MeshData): number[] {
    const p = mesh.positions, cv = mesh.cornerVerts
    const out: number[] = []
    for (let f = 0; f < mesh.facesNum; f++) {
        const start = mesh.faceOffsets[f], size = mesh.faceSize(f)
        if (size < 4) continue
        const n = faceNormal(mesh, f)
        for (let k = 0; k < size; k++) {
            const a = cv[start + (k + size - 1) % size] * 3
            const b = cv[start + k] * 3
            const c = cv[start + (k + 1) % size] * 3
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
            const vx = p[c] - p[b], vy = p[c + 1] - p[b + 1], vz = p[c + 2] - p[b + 2]
            const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
            if (cx * n[0] + cy * n[1] + cz * n[2] < -1e-7) { out.push(f); break }
        }
    }
    return out
}

// region parity against Blender's own arrays

/**
 * Every fixture here also has a ground-truth JSON in the kernel's parity suite, so the importer can be
 * compared with what Blender wrote rather than with itself.
 */
const PARITY: {blend: string, mesh?: string, json: string, layout: string}[] = [
    {blend: 'blend-load-test-prim-cube.blend', json: 'blend-load-test-prim-cube.json', layout: 'customdata'},
    {blend: 'blend-load-test-prim-cube-tri.blend', json: 'blend-load-test-prim-cube-tri.json', layout: 'customdata'},
    {blend: 'blend-load-poly-test.blend', json: 'blend-load-poly-test.json', layout: 'customdata'},
    {blend: 'blend-load-test-prim.blend', json: 'blend-load-test-prim.json', layout: 'customdata'},
]

for (const {blend, mesh: meshName, json} of PARITY) {
    const path = fixturePath(blend)
    describe.skipIf(!path)(`${blend} matches Blender's own arrays`, () => {
        it('imports the element counts, topology and UVs Blender wrote', async() => {
            const expected = groundTruth(json)
            const mesh = (await importMesh(blend, meshName))!

            expect({
                verts: mesh.vertsNum, edges: mesh.edgesNum,
                faces: mesh.facesNum, corners: mesh.cornersNum,
            }).toEqual({
                verts: expected.vertsNum, edges: expected.edgesNum,
                faces: expected.facesNum, corners: expected.cornersNum,
            })

            expect([...mesh.faceOffsets]).toEqual(expected.faceOffsets)
            expect([...mesh.cornerVerts]).toEqual(expected.cornerVerts)

            // The edge set is Blender's *authored* one, index for index and endpoint for endpoint -
            // not a set re-derived from the faces. `MeshData.calculateEdges()` would produce the same
            // edges as a set but renumber them and normalise every pair to (low, high), and would
            // take `sharp_edge`, `uv_seam` and the creases with it. This is the assertion that says
            // it was not used.
            expect([...mesh.edgeVerts]).toEqual(expected.edgeVerts)
            expect([...mesh.cornerEdges]).toEqual(expected.cornerEdges)

            // Positions, after the Blender Z-up -> three Y-up rotation the importer applies.
            const positions = mesh.positions
            for (let v = 0; v < expected.vertsNum; v++) {
                expect(positions[v * 3]).toBe(expected.positions[v * 3])
                expect(positions[v * 3 + 1]).toBe(expected.positions[v * 3 + 2])
                expect(positions[v * 3 + 2]).toBe(-expected.positions[v * 3 + 1])
            }

            if (expected.uv) {
                const uv = mesh.attributes.require(expected.uvName!, AttrDomain.Corner, 'float2')
                expect(uv.data.length).toBe(expected.cornersNum * 2)
                expect([...uv.data]).toEqual(expected.uv)
            }

            expect(mesh.validate()).toEqual([])
        })
    })
}

// endregion

describe.skipIf(!fixturePath('blend-load-test-prim-cube.blend'))('quads stay quads', () => {
    it('imports a Blender cube as six quad faces, not twelve triangles', async() => {
        const mesh = (await importMesh('blend-load-test-prim-cube.blend'))!
        expect(mesh.facesNum).toBe(6)
        expect(faceSizeHistogram(mesh)).toEqual({4: 6})
    })

    it('keeps per-corner UVs at a seam instead of one per vertex', async() => {
        const mesh = (await importMesh('blend-load-test-prim-cube.blend'))!
        const uv = mesh.attributes.require('UVMap', AttrDomain.Corner, 'float2')
        expect(uv.data.length).toBe(mesh.cornersNum * 2)

        // A box unwrap gives at least one vertex whose corners carry different UVs. The old importer
        // assigned one UV per vertex ("last write wins"), so every one of those but the last was
        // lost; a corner-domain layer keeps them all.
        const perVert = new Map<number, Set<string>>()
        for (let c = 0; c < mesh.cornersNum; c++) {
            const v = mesh.cornerVerts[c]
            const key = `${uv.data[c * 2]},${uv.data[c * 2 + 1]}`
            const set = perVert.get(v) ?? new Set<string>()
            set.add(key)
            perVert.set(v, set)
        }
        const split = [...perVert.values()].filter(s => s.size > 1)
        expect(split.length).toBeGreaterThan(0)

        // ...and the bake keeps them: one output vertex per corner, so nothing has to be merged.
        const {data} = bakeGeometry(mesh, {includeNormals: true})
        expect(data.uv!.length).toBe(mesh.cornersNum * 2)
        expect([...data.uv!]).toEqual([...uv.data])
    })
})

describe.skipIf(!fixturePath('blend-load-poly-test.blend'))('n-gons', () => {
    it('imports faces of 3, 4, 8, 12 and 22 sides as authored', async() => {
        const mesh = (await importMesh('blend-load-poly-test.blend'))!
        // These counts come from the file: `poly_offset_indices` differences, per the ground truth.
        expect(faceSizeHistogram(mesh)).toEqual({3: 18, 4: 44, 8: 2, 12: 2, 22: 2})
    })

    it('ear-clips concave n-gons without the inverted triangles a fan produces', async() => {
        const mesh = (await importMesh('blend-load-poly-test.blend'))!
        const concave = concaveFaces(mesh)
        expect(concave.length).toBeGreaterThan(0)

        const {data, triangleToFace} = bakeGeometry(mesh, {includeNormals: true})
        const concaveSet = new Set(concave)
        const cv = mesh.cornerVerts

        // Every triangle of a concave face must be wound with the face and have real area.
        let checked = 0
        for (let t = 0; t < triangleToFace.length; t++) {
            const f = triangleToFace[t]
            if (!concaveSet.has(f)) continue
            const a = cv[data.index[t * 3]], b = cv[data.index[t * 3 + 1]], c = cv[data.index[t * 3 + 2]]
            expect(signedTriangleArea(mesh, f, a, b, c)).toBeGreaterThan(0)
            checked++
        }
        expect(checked).toBeGreaterThan(0)

        // The discriminator: a first-corner fan - what the importer used to do - does get at least one
        // of these faces wrong. Without this the test above could pass on a fixture where the fan
        // happens to be fine, and would not be evidence of anything.
        let fanFailures = 0
        for (const f of concave) {
            const start = mesh.faceOffsets[f], size = mesh.faceSize(f)
            for (let k = 1; k < size - 1; k++) {
                const area = signedTriangleArea(mesh, f, cv[start], cv[start + k], cv[start + k + 1])
                if (area <= 0) fanFailures++
            }
        }
        expect(fanFailures).toBeGreaterThan(0)
    })
})

describe.skipIf(!fixturePath('blend-load-poly-test.blend'))('the bake', () => {
    it('emits exactly the triangle count the old fan triangulation did', async() => {
        const mesh = (await importMesh('blend-load-poly-test.blend'))!
        // The legacy path emitted `faceSize - 2` triangles per face. Ear clipping emits the same
        // number for any simple polygon, so nothing downstream (index budgets, material group
        // offsets) moved - only which triangles they are.
        let fanTriangles = 0
        for (let f = 0; f < mesh.facesNum; f++) fanTriangles += mesh.faceSize(f) - 2

        const {data, triangleToFace} = bakeGeometry(mesh, {includeNormals: true})
        expect(triangleToFace.length).toBe(fanTriangles)
        expect(data.index.length).toBe(fanTriangles * 3)
        expect(data.position.length).toBe(mesh.cornersNum * 3)
    })

    it('round-trips through BMesh unchanged', async() => {
        const mesh = (await importMesh('blend-load-poly-test.blend'))!
        const back = bmToMesh(bmFromMesh(mesh))
        expect(back.validate()).toEqual([])
        expect({v: back.vertsNum, e: back.edgesNum, f: back.facesNum, c: back.cornersNum})
            .toEqual({v: mesh.vertsNum, e: mesh.edgesNum, f: mesh.facesNum, c: mesh.cornersNum})
        expect([...back.faceOffsets]).toEqual([...mesh.faceOffsets])
        expect([...back.cornerVerts]).toEqual([...mesh.cornerVerts])
        expect([...back.positions]).toEqual([...mesh.positions])
        expect([...back.edgeVerts]).toEqual([...mesh.edgeVerts])
        expect([...back.cornerEdges]).toEqual([...mesh.cornerEdges])
    })
})

describe('every on-disk mesh layout', () => {
    // One file per DNA layout. All three carry real n-gons, so all three go through the same path.
    const cases: {blend: string, mesh?: string, layout: string, faces: Record<number, number>}[] = [
        {blend: 'blend-load-test-prim-cube.blend', layout: 'customdata', faces: {4: 6}},
        {blend: 'blender-5.0.0-startup.blend', layout: 'attribute_storage', faces: {4: 6}},
        {blend: 'curve_bevel_profile.blend', mesh: 'MECircle', layout: 'mpoly', faces: {4: 96}},
    ]
    for (const {blend, mesh: meshName, layout, faces} of cases) {
        const path = fixturePath(blend)
        it.skipIf(!path)(`decodes the ${layout} layout (${blend})`, async() => {
            const parsed = await loadBlend(path!)
            const datablock = pickMesh(parsed, meshName)
            expect(meshLayout(datablock)).toBe(layout)
            const mesh = createMeshData(datablock)
            expect(mesh).not.toBeNull()
            expect(mesh!.validate()).toEqual([])
            expect(faceSizeHistogram(mesh!)).toEqual(faces)
            // The edge domain is the authored one on every layout, so `.corner_edge` is in range and
            // agrees with the corner vertices - which is what `validate()` above checks.
            expect(mesh!.edgesNum).toBeGreaterThan(0)
        })
    }
})

describe.skipIf(!fixturePath('blender-5.0.0-startup.blend'))('Blender 5.0 attributes', () => {
    it('reads `sharp_face` from attribute_storage', async() => {
        // `bke::AttrType::Bool` is 0. The old 5.0 reader looked for 50, which is `CD_PROP_BOOL` from
        // the *other* enum, so it never matched and every 5.0 file imported fully smooth-shaded.
        const mesh = (await importMesh('blender-5.0.0-startup.blend'))!
        const sharp = mesh.attributes.get(AttrName.sharpFace)
        expect(sharp).toBeTruthy()
        expect(sharp!.domain).toBe(AttrDomain.Face)
        expect(sharp!.data.length).toBe(mesh.facesNum)
        // Blender's startup cube is flat shaded.
        expect([...sharp!.data]).toEqual(new Array(mesh.facesNum).fill(1))
    })
})

describe.skipIf(!fixturePath('blend-load-test-prim-cube.blend'))('the Catmull-Clark cage', () => {
    it('is the imported n-gon mesh, per corner', async() => {
        const mesh = (await importMesh('blend-load-test-prim-cube.blend'))!
        const cage = cageFromMeshData(mesh)
        expect(cage.positions.length).toBe(mesh.vertsNum)
        expect(cage.faces.length).toBe(mesh.facesNum)
        for (let f = 0; f < mesh.facesNum; f++) expect(cage.faces[f]).toEqual(mesh.faceVerts(f))
        // UVs come across per corner, in face order, which is what makes the subdivider's
        // face-varying UV mesh able to split at a seam.
        expect(cage.uvs).not.toBeNull()
        const uv = mesh.attributes.require('UVMap', AttrDomain.Corner, 'float2')
        for (let f = 0; f < mesh.facesNum; f++) {
            const start = mesh.faceOffsets[f]
            expect(cage.uvs![f].length).toBe(mesh.faceSize(f))
            for (let k = 0; k < mesh.faceSize(f); k++) {
                expect(cage.uvs![f][k]).toEqual([uv.data[(start + k) * 2], uv.data[(start + k) * 2 + 1]])
            }
        }
        // One material slot (in fact none here), so no per-face slots - matching what the bake does
        // with geometry groups.
        expect(cage.materialIndices).toBeNull()
    })
})
