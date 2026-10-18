/**
 * Ground-truth parity for the edit-mode operator wrappers (`src/ops/editmeshTools.ts`) against
 * Blender 5.2.2's own `bpy.ops.mesh.*`, from `fixtures/editmesh-tools.json`
 * (`fixtures/gen-editmesh-tools.py`): each case starts from the selection edit mode held on entering
 * and compares the geometry, every edge, every face with its winding, the selection, the seams and
 * the sharp edges afterwards.
 */

import {describe, expect, it} from 'vitest'
import {buildInput, compareMeshes, compareUvs, FixtureInput, FixtureMesh, loadFixture, meshOf, setRawSelection} from './parity-util'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge, BMVert} from '../src/bmesh/types'
import {ElemFlag, SelectMode} from '../src/constants'
import {meshNormalsUpdate} from '../src/bmesh/normals'
import {
    beautifyFillSelection,
    deleteLooseSelection,
    flipNormalsSelection,
    markSeamSelection,
    markSharpSelection,
    normalsMakeConsistentSelection,
    pokeFacesSelection,
    quadsConvertToTrisSelection,
    triangleFillSelection,
    wireframeSelection,
} from '../src/ops/editmeshTools'
import type {TriangulateNgonMethod, TriangulateQuadMethod} from '../src/ops/triangulate'
import {edgeCollapseSelection, mergeSelection, MergeType} from '../src/ops/collapse'
import {edgeRotateSelection} from '../src/ops/rotateEdges'
import {dissolveDegenerateSelection} from '../src/ops/dissolveDegenerate'
import {selectHistoryStore} from '../src/bmesh/marking'
import {setValue} from '../src/bmesh/customdata'
import type {PokeCenterMode} from '../src/ops/poke'

interface EditCase {
    name: string
    mode: 'VERT' | 'EDGE' | 'FACE'
    op: string
    props: Record<string, any>
    input: FixtureInput
    extras: {seams?: number[][], sharp?: number[][], uv?: number[][][], history?: number[], cursor?: number[]}
    entered: {verts: number[], edges: number[][], faces: number[]}
    result: string[]
    output: FixtureMesh & {seams: number[][], sharp: number[][], uvs: number[][][] | null}
}

const fixture = loadFixture<EditCase>('editmesh-tools.json')

/**
 * Cases that fail for a known, filed reason; `it.fails` turns them green the day the reason is fixed,
 * so the list has to shrink then.
 */
const KNOWN_FAILING = new Map<string, string>([
    // `BM_face_triangulate`'s n-gon branch (`BLI_polyfill_calc_arena` / `BLI_polyfill_beautify`) is not
    // in this branch's kernel: issues/open/modelling-tools/kernel-triangulate-ngon-polyfill.md (track 2
    // has ported polyfill_2d in math/, f6a32af5, not merged here yet).
    ['triangulate ngon BEAUTY', 'kernel-triangulate-ngon-polyfill'],
    ['triangulate ngon CLIP', 'kernel-triangulate-ngon-polyfill'],
])
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}

/** RNA enum identifiers (`rna_enum_modifier_triangulate_*_method_items`) to the kernel's names. */
const QUAD: Record<string, TriangulateQuadMethod> = {
    BEAUTY: 'BEAUTY', FIXED: 'FIXED', FIXED_ALTERNATE: 'ALTERNATE', SHORTEST_DIAGONAL: 'SHORT_EDGE', LONGEST_DIAGONAL: 'LONG_EDGE',
}
const NGON: Record<string, TriangulateNgonMethod> = {BEAUTY: 'BEAUTY', CLIP: 'EAR_CLIP'}
/** `poke_center_modes` (`editmesh_tools.cc:5407`). */
const POKE_CENTER: Record<string, PokeCenterMode> = {MEDIAN_WEIGHTED: 'meanWeighted', MEDIAN: 'mean', BOUNDS: 'bounds'}

function run(bm: BMesh, c: EditCase): {ok: boolean} {
    const p = c.props
    switch (c.op) {
    case 'poke': return pokeFacesSelection(bm, {
        offset: p.offset, useRelativeOffset: p.use_relative_offset, centerMode: p.center_mode ? POKE_CENTER[p.center_mode] : undefined,
    })
    case 'quads_convert_to_tris': return quadsConvertToTrisSelection(bm, QUAD[p.quad_method ?? 'BEAUTY'], NGON[p.ngon_method ?? 'BEAUTY'])
    case 'beautify_fill': return beautifyFillSelection(bm, p.angle_limit ?? Math.PI)
    case 'wireframe': return wireframeSelection(bm, {
        useBoundary: p.use_boundary, useEvenOffset: p.use_even_offset, useRelativeOffset: p.use_relative_offset,
        useReplace: p.use_replace, thickness: p.thickness, offset: p.offset, useCrease: p.use_crease, creaseWeight: p.crease_weight,
    })
    case 'fill': return triangleFillSelection(bm, p.use_beauty ?? true)
    case 'mark_seam': return markSeamSelection(bm, !!p.clear)
    case 'mark_sharp': return markSharpSelection(bm, !!p.clear, !!p.use_verts)
    case 'flip_normals': return flipNormalsSelection(bm)
    case 'normals_make_consistent': return normalsMakeConsistentSelection(bm, !!p.inside)
    case 'delete_loose': return deleteLooseSelection(bm, {useVerts: p.use_verts, useEdges: p.use_edges, useFaces: p.use_faces})
    case 'merge': return mergeSelection(bm, (p.type ?? 'CENTER') as MergeType, !!p.uvs, c.extras.cursor as [number, number, number] ?? null)
    case 'edge_collapse': return edgeCollapseSelection(bm)
    case 'edge_rotate': return edgeRotateSelection(bm, !!p.use_ccw)
    case 'dissolve_degenerate': return dissolveDegenerateSelection(bm, p.threshold ?? 1e-4)
    }
    throw new Error(`no wrapper for mesh.${c.op}`)
}

/** Edges with `flag` set (or, with `invert`, clear), as sorted vertex-index pair keys through the pairing. */
function edgeKeys(bm: BMesh, flag: number, invert: boolean): string[] {
    const idx = new Map<BMVert, number>([...bm.verts].map((v, i) => [v, i]))
    const keys: string[] = []
    for (const e of bm.edges as Iterable<BMEdge>) {
        if (((e.hflag & flag) !== 0) === invert) continue
        const a = idx.get(e.v1)!, b = idx.get(e.v2)!
        keys.push(a < b ? `${a}-${b}` : `${b}-${a}`)
    }
    return keys.sort()
}

/** Blender's seams / sharp edges mapped into this mesh's vertex order through the position pairing. */
function mapEdgeKeys(bm: BMesh, want: FixtureMesh, pairs: number[][]): string[] {
    const got = [...bm.verts].map(v => [v.x, v.y, v.z])
    const map = want.positions.map(w => got.findIndex(g => Math.abs(g[0] - w[0]) < 1e-4 && Math.abs(g[1] - w[1]) < 1e-4 && Math.abs(g[2] - w[2]) < 1e-4))
    return pairs.map(([a, b]) => {
        const x = map[a], y = map[b]
        return x < y ? `${x}-${y}` : `${y}-${x}`
    }).sort()
}

describe('edit-mode tool wrappers match Blender 5.2.2 (editmesh-tools.json)', () => {
    it('the fixture was written by Blender 5.2', () => {
        expect(fixture.blender.startsWith('5.2')).toBe(true)
    })
    for (const c of fixture.cases) {
        (KNOWN_FAILING.has(c.name) ? it.fails : it)(c.name, () => {
            const {bm, verts, faces, edge} = buildInput({...c.input, select: undefined})
            for (const [a, b] of c.extras.seams ?? []) edge(a, b).hflag |= ElemFlag.Seam
            for (const [a, b] of c.extras.sharp ?? []) edge(a, b).hflag &= ~ElemFlag.Smooth
            if (c.extras.uv) {
                const layer = bm.addLayer('loop', 'UVMap', 'float2')
                c.extras.uv.forEach((uvs, fi) => faces[fi].loops().forEach((l, k) => setValue(l, bm.ldata, layer, uvs[k])))
            }
            // Edit mode has current normals when an operator runs (`EDBM_update` after every operator).
            meshNormalsUpdate(bm)
            bm.selectMode = MODE[c.mode]
            setRawSelection(bm, verts, faces, c.entered)
            for (const i of c.extras.history ?? []) selectHistoryStore(bm, verts[i])
            const r = run(bm, c)
            expect(r.ok).toBe(c.result[0] === 'FINISHED')
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(meshOf(bm), c.output, {selection: true})).toEqual([])
            expect(edgeKeys(bm, ElemFlag.Seam, false)).toEqual(mapEdgeKeys(bm, c.output, c.output.seams))
            expect(edgeKeys(bm, ElemFlag.Smooth, true)).toEqual(mapEdgeKeys(bm, c.output, c.output.sharp))
            expect(compareUvs(bm, c.output)).toEqual([])
        })
    }
})
