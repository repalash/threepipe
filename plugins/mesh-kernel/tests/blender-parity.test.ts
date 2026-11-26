/**
 * Ground-truth parity against Blender.
 *
 * Every other test in this package is a *self-consistency* test: `MeshData.test.ts` checks the
 * kernel against its own invariants, and `convert.test.ts` checks `bmFromMesh` against `bmToMesh`.
 * A bug present in both directions passes all of them. This suite is the independent check: the
 * expectations come out of `.blend` files that Blender itself wrote, decoded by
 * `tests/fixtures/extract-blend-fixture.mjs` straight from the DNA blocks (see `fixtures/README.md`).
 *
 * Nothing here is hand-written. If an assertion below is wrong, the fix is in the kernel or in the
 * extractor, never in an expected array.
 *
 * On edge ordering: Blender's edge *index order* is not reproducible and is not asserted. Primitives
 * write edges in construction order, and `mesh_calc_edges` (`blenkernel/intern/mesh_calc_edges.cc`)
 * fills a set of per-thread `VectorSet<OrderedEdge>` maps chosen by `edge_hash_2`, so the resulting
 * index order depends on the thread partition. What *is* meaningful, and what is asserted, is the
 * edge set as unordered vertex pairs plus the corner -> edge mapping under that correspondence.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {bmFromMesh, bmToMesh} from '../src/bmesh/convert'
import {edgeFaceCount, edgeIsBoundary, edgeIsManifold, edgeIsWire} from '../src/bmesh/structure'

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** Exactly the shape `extract-blend-fixture.mjs` writes. */
interface BlenderFixture {
    source: string
    mesh: string
    blenderVersion: string
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

function loadFixture(name: string): BlenderFixture {
    return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8')) as BlenderFixture
}

/** The face-vertex lists Blender's `poly_offset_indices` + `.corner_vert` describe. */
function blenderFaces(gt: BlenderFixture): number[][] {
    const faces: number[][] = []
    for (let f = 0; f < gt.facesNum; f++) {
        faces.push(gt.cornerVerts.slice(gt.faceOffsets[f], gt.faceOffsets[f + 1]))
    }
    return faces
}

/** Canonical key for an undirected edge. Blender's `OrderedEdge` (`BLI_ordered_edge.hh`). */
function edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`
}

function edgeKeys(edgeVerts: ArrayLike<number>, edgesNum: number): string[] {
    const out: string[] = new Array(edgesNum)
    for (let e = 0; e < edgesNum; e++) out[e] = edgeKey(edgeVerts[e * 2], edgeVerts[e * 2 + 1])
    return out
}

/**
 * Build a `MeshData` the way an importer that only knows faces would: positions plus face-vertex
 * lists, with the edge domain and `.corner_edge` derived by the kernel's `calculateEdges()`.
 */
function meshFromBlenderFaces(gt: BlenderFixture): MeshData {
    return MeshData.fromFaces({positions: gt.positions, faces: blenderFaces(gt)})
}

/**
 * Load Blender's arrays into a `MeshData` verbatim - positions, `.edge_verts`, `.corner_vert`,
 * `.corner_edge` and the face offsets - deriving nothing. This is what the blend importer should do.
 */
function meshFromBlenderArrays(gt: BlenderFixture): MeshData {
    const mesh = new MeshData()
    mesh.resize({verts: gt.vertsNum, edges: gt.edgesNum, faces: gt.facesNum, corners: gt.cornersNum})
    mesh.positions.set(gt.positions)
    mesh.edgeVerts.set(gt.edgeVerts)
    mesh.cornerVerts.set(gt.cornerVerts)
    mesh.cornerEdges.set(gt.cornerEdges)
    mesh.faceOffsets.set(gt.faceOffsets)
    if (gt.uv) mesh.attributes.add({name: gt.uvName!, domain: AttrDomain.Corner, type: 'float2', data: gt.uv})
    return mesh
}

/** Faces per edge, counted from Blender's own `.corner_edge` array. */
function blenderEdgeFaceCounts(gt: BlenderFixture): number[] {
    const counts = new Array(gt.edgesNum).fill(0)
    for (let c = 0; c < gt.cornersNum; c++) counts[gt.cornerEdges[c]]++
    return counts
}

const FIXTURES = [
    // A Blender-authored cube: all quads, closed, one UV map. The smallest case where a wrong
    // corner -> edge mapping is still visible.
    'blend-load-test-prim-cube',
    // The same cube triangulated: 18 edges including the 6 new diagonals, all faces triangles.
    'blend-load-test-prim-cube-tri',
    // An architectural panel: closed, but with 8-, 12- and 22-sided n-gons alongside tris and quads.
    'blend-load-poly-test',
    // A UV sphere: 448 quads + 64 pole triangles, closed, two high-valence pole vertices.
    'blend-load-test-prim',
    // Two disconnected triangle pairs from a glTF label decal: open, so 8 of its 10 edges are
    // boundaries, and its positions and UVs are awkward floats rather than round numbers.
    'blend-load-test-label',
    // A non-manifold building part from the Buildify asset: 21 of its 178 edges carry three faces
    // and 27 are boundaries, so the radial cycle is exercised beyond the clean two-face case.
    'blend-buildify-nonmanifold',
]

describe.each(FIXTURES)('Blender parity: %s', name => {
    const gt = loadFixture(name)

    describe('the fixture itself', () => {
        it('holds the counts and arrays Blender wrote, at the right lengths', () => {
            expect(gt.faceOffsets.length).toBe(gt.facesNum + 1)
            expect(gt.positions.length).toBe(gt.vertsNum * 3)
            expect(gt.edgeVerts.length).toBe(gt.edgesNum * 2)
            expect(gt.cornerVerts.length).toBe(gt.cornersNum)
            expect(gt.cornerEdges.length).toBe(gt.cornersNum)
            expect(gt.faceOffsets[0]).toBe(0)
            expect(gt.faceOffsets[gt.facesNum]).toBe(gt.cornersNum)
            if (gt.uv) expect(gt.uv.length).toBe(gt.cornersNum * 2)
        })

        it("Blender's own .corner_edge agrees with its .edge_verts", () => {
            // Not a kernel assertion - it proves the extractor read the right blocks, and it is the
            // ground truth every `calculateEdges()` assertion below is measured against.
            const keys = edgeKeys(gt.edgeVerts, gt.edgesNum)
            const mismatched: string[] = []
            for (let f = 0; f < gt.facesNum; f++) {
                const start = gt.faceOffsets[f]
                const size = gt.faceOffsets[f + 1] - start
                for (let k = 0; k < size; k++) {
                    const a = gt.cornerVerts[start + k]
                    const b = gt.cornerVerts[start + (k + 1) % size]
                    const e = gt.cornerEdges[start + k]
                    if (keys[e] !== edgeKey(a, b)) {
                        mismatched.push(`corner ${start + k}: edge ${e} is ${keys[e]}, corner spans ${edgeKey(a, b)}`)
                    }
                }
            }
            expect(mismatched).toEqual([])
        })

        it('has no duplicate edges', () => {
            expect(new Set(edgeKeys(gt.edgeVerts, gt.edgesNum)).size).toBe(gt.edgesNum)
        })
    })

    describe('calculateEdges() against the edge set Blender wrote', () => {
        it('has no loose edges, which is the precondition for deriving the edge set at all', () => {
            // `calculateEdges()` only ever sees faces, so an edge Blender stored that belongs to no
            // face cannot be recovered. None of these fixtures has one; if a future fixture does, the
            // assertions below must be scoped to the face-incident subset rather than relaxed.
            expect(blenderEdgeFaceCounts(gt).filter(c => c === 0)).toEqual([])
        })

        it("derives exactly Blender's edge count", () => {
            // The headline parity result. `calculateEdges()` sees only positions and face-vertex
            // lists; the count it arrives at must be the one already in the file.
            const mesh = meshFromBlenderFaces(gt)
            expect(mesh.edgesNum).toBe(gt.edgesNum)
        })

        it("derives exactly Blender's edges, compared as an unordered set of vertex pairs", () => {
            // Ordering is deliberately not compared - see the file header.
            const mesh = meshFromBlenderFaces(gt)
            const derived = edgeKeys(mesh.edgeVerts, mesh.edgesNum)
            expect(new Set(derived)).toEqual(new Set(edgeKeys(gt.edgeVerts, gt.edgesNum)))
            expect(derived.length).toBe(new Set(derived).size)
        })

        it("derives a .corner_edge mapping equivalent to Blender's under that correspondence", () => {
            // Remap each derived edge index to the Blender edge index carrying the same vertex pair,
            // then require the whole `.corner_edge` array to match element for element. This is the
            // strongest statement that survives a legitimate difference in edge ordering.
            const mesh = meshFromBlenderFaces(gt)
            const blenderIndexOf = new Map(edgeKeys(gt.edgeVerts, gt.edgesNum).map((k, e) => [k, e]))
            const derivedKeys = edgeKeys(mesh.edgeVerts, mesh.edgesNum)
            const toBlender = derivedKeys.map(k => {
                const e = blenderIndexOf.get(k)
                if (e === undefined) throw new Error(`derived an edge ${k} that Blender does not have`)
                return e
            })
            const remapped = Array.from(mesh.cornerEdges, e => toBlender[e])
            expect(remapped).toEqual(gt.cornerEdges)
        })

        it("numbers the same edges differently from Blender - a relabelling, not a disagreement", () => {
            // This documents the known, legitimate difference rather than leaving it implicit.
            // Blender's stored order comes from its primitive builders or from the threaded
            // `mesh_calc_edges` hash maps; the kernel numbers edges in first-encounter order while
            // walking faces. The claim asserted here is that the derived-to-Blender correspondence
            // used above is a bijection - every Blender edge index is hit exactly once - so the two
            // numberings are the same edge set under a permutation. Downstream code must therefore
            // never assume edge index parity with a .blend file.
            const mesh = meshFromBlenderFaces(gt)
            const blenderIndexOf = new Map(edgeKeys(gt.edgeVerts, gt.edgesNum).map((k, e) => [k, e]))
            const toBlender = edgeKeys(mesh.edgeVerts, mesh.edgesNum).map(k => blenderIndexOf.get(k))
            expect(toBlender.filter(e => e === undefined)).toEqual([])
            expect([...toBlender].sort((a, b) => a! - b!)).toEqual(Array.from({length: gt.edgesNum}, (_, e) => e))
        })

        it('normalises each edge to (low, high) where Blender keeps the authored orientation', () => {
            // A second legitimate difference, called out so it is never mistaken for corruption:
            // `calculateEdges()` stores `OrderedEdge`-style (v_low, v_high) pairs, while Blender's
            // primitive builders write whichever direction the edge was created in - the cube fixture
            // stores 7 of its 12 edges as (high, low). `.corner_edge` and `validate()` are both
            // orientation-agnostic, so nothing downstream depends on the choice.
            const mesh = meshFromBlenderFaces(gt)
            for (let e = 0; e < mesh.edgesNum; e++) {
                expect(mesh.edgeVerts[e * 2]).toBeLessThan(mesh.edgeVerts[e * 2 + 1])
            }
        })
    })

    describe('validate() on real Blender topology', () => {
        it('accepts the arrays Blender wrote, with nothing derived', () => {
            expect(meshFromBlenderArrays(gt).validate()).toEqual([])
        })

        it('accepts the mesh again after the kernel re-derives its edges', () => {
            const mesh = meshFromBlenderArrays(gt)
            mesh.calculateEdges()
            expect(mesh.validate()).toEqual([])
            expect(mesh.edgesNum).toBe(gt.edgesNum)
        })

        it("re-deriving .corner_edge from Blender's edges reproduces Blender's array exactly", () => {
            // `calculateCornerEdges()` keeps the authored edge domain, so here the indices themselves
            // must match, not just the correspondence.
            const mesh = meshFromBlenderArrays(gt)
            mesh.cornerEdges.fill(-1)
            mesh.calculateCornerEdges()
            expect([...mesh.cornerEdges]).toEqual(gt.cornerEdges)
        })
    })

    describe('bmToMesh(bmFromMesh(m)) against Blender', () => {
        it("reproduces Blender's positions, face offsets and corner verts exactly", () => {
            const after = bmToMesh(bmFromMesh(meshFromBlenderArrays(gt)))
            expect(after.validate()).toEqual([])
            expect(after.vertsNum).toBe(gt.vertsNum)
            expect(after.edgesNum).toBe(gt.edgesNum)
            expect(after.facesNum).toBe(gt.facesNum)
            expect(after.cornersNum).toBe(gt.cornersNum)
            expect([...after.positions]).toEqual(gt.positions)
            expect([...after.faceOffsets]).toEqual(gt.faceOffsets)
            expect([...after.cornerVerts]).toEqual(gt.cornerVerts)
        })

        it("reproduces Blender's .edge_verts and .corner_edge exactly, orientation included", () => {
            // Nothing in the round trip renumbers or reorients edges, so unlike `calculateEdges()`
            // these must come back byte-identical - including Blender's `(2, 0)` rather than `(0, 2)`.
            const after = bmToMesh(bmFromMesh(meshFromBlenderArrays(gt)))
            expect([...after.edgeVerts]).toEqual(gt.edgeVerts)
            expect([...after.cornerEdges]).toEqual(gt.cornerEdges)
        })

        it('preserves the UV layer Blender authored', () => {
            // Every fixture has one; asserting that rather than skipping keeps a fixture that lost
            // its UV map from turning this into a silent no-op.
            expect(gt.uv).toBeDefined()
            const after = bmToMesh(bmFromMesh(meshFromBlenderArrays(gt)))
            const layer = after.attributes.get(gt.uvName!)
            expect(layer).toBeDefined()
            expect(layer!.domain).toBe(AttrDomain.Corner)
            expect(layer!.type).toBe('float2')
            expect([...layer!.data]).toEqual(gt.uv)
        })
    })

    describe('topology invariants implied by the Blender data', () => {
        it('has the Euler characteristic the file implies', () => {
            const expected = gt.vertsNum - gt.edgesNum + gt.facesNum
            const bm = bmFromMesh(meshFromBlenderArrays(gt))
            expect(bm.totvert - bm.totedge + bm.totface).toBe(expected)
            // A closed orientable genus-0 surface gives 2, but `blend-load-test-label` is open (and
            // in two components) and `blend-buildify-nonmanifold` is neither closed nor manifold, so
            // the expected value is taken from the file rather than asserted to be 2.
            expect(bm.totloop).toBe(gt.cornersNum)
        })

        it("gives every edge the face count Blender's .corner_edge implies", () => {
            const expected = blenderEdgeFaceCounts(gt)
            const bm = bmFromMesh(meshFromBlenderArrays(gt))
            // `bmFromMesh` creates edges in `.edge_verts` order and `bm.edges` is insertion-ordered,
            // so edge `i` here is Blender's edge `i`.
            const actual = [...bm.edges].map(e => edgeFaceCount(e))
            expect(actual).toEqual(expected)
        })

        it('agrees with Blender on which edges are boundaries and which are manifold', () => {
            // A .blend can legitimately hold loose edges (0 faces), boundaries (1) and non-manifold
            // fans (3+), so this compares the classification rather than asserting manifoldness.
            const expected = blenderEdgeFaceCounts(gt)
            const bm = bmFromMesh(meshFromBlenderArrays(gt))
            const edges = [...bm.edges]
            expect(edges.map(e => edgeIsWire(e))).toEqual(expected.map(c => c === 0))
            expect(edges.map(e => edgeIsBoundary(e))).toEqual(expected.map(c => c === 1))
            expect(edges.map(e => edgeIsManifold(e))).toEqual(expected.map(c => c === 2))
        })
    })
})

describe('Blender parity: fixture set', () => {
    it('covers triangles, quads, n-gons, boundaries and non-manifold edges', () => {
        // A guard on the fixture set rather than on the kernel: if someone trims the list, the
        // shapes the parity claims rest on should stop being asserted loudly rather than quietly.
        const sizes = new Set<number>()
        let hasBoundary = false, hasNonManifold = false
        for (const name of FIXTURES) {
            const gt = loadFixture(name)
            for (let f = 0; f < gt.facesNum; f++) sizes.add(gt.faceOffsets[f + 1] - gt.faceOffsets[f])
            const counts = blenderEdgeFaceCounts(gt)
            if (counts.some(c => c === 1)) hasBoundary = true
            if (counts.some(c => c > 2)) hasNonManifold = true
        }
        expect(sizes.has(3)).toBe(true)
        expect(sizes.has(4)).toBe(true)
        expect([...sizes].some(s => s > 4)).toBe(true)
        expect(hasBoundary).toBe(true)
        expect(hasNonManifold).toBe(true)
    })

    it('uses the required attribute names Blender uses, not translated ones', () => {
        // The kernel claims a blend round trip needs no name translation table. These are the exact
        // strings in the fixtures' DNA layers.
        expect(AttrName.position).toBe('position')
        expect(AttrName.edgeVerts).toBe('.edge_verts')
        expect(AttrName.cornerVert).toBe('.corner_vert')
        expect(AttrName.cornerEdge).toBe('.corner_edge')
    })
})
