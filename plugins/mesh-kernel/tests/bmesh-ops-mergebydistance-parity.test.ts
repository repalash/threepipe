/**
 * Ground-truth parity for `mergeByDistanceSelection` against Blender's edit-mode
 * `bpy.ops.mesh.remove_doubles`, from `fixtures/bmesh-ops-mergebydistance.json`
 * (`fixtures/gen-bmesh-ops-mergebydistance.py`). Geometry, every edge, every face (with winding) and
 * the selection afterwards are compared.
 *
 * Blender 3.4.1 wrote the fixture and predates `use_centroid`; its weld leaves the target where it
 * is, which is `useCentroid: false` in the current source. The centroid default is checked by hand
 * below.
 *
 * One more version difference: which vertex of a *pair* survives. 3.4.1 ran
 * `BLI_kdtree_3d_calc_duplicates_fast`, where whichever vertex the balanced tree visits first keeps
 * its place; the current source runs `kdtree_calc_duplicates_cb` with `deduplicate_target_calc_fn`
 * (`bmo_removedoubles.cc:714`), which keeps the lower index of a pair "for stability". In the cube-lid
 * cases the tree visits the lid copy first, so 3.4.1 keeps the copy (z = 1.02) where the current
 * source keeps the cube corner (z = 1). Those cases are compared with the merge threshold as the
 * position tolerance - topology, winding and selection still exact - and the current-source survivor
 * is asserted on its own.
 */

import {describe, expect, it} from 'vitest'
import {buildInput, compareMeshes, FixtureInput, FixtureMesh, loadFixture, meshOf, setRawSelection} from './parity-util'
import {mergeByDistanceSelection} from '../src/ops/mergeByDistance'
import {SelectMode} from '../src/constants'
import {vertHideSet} from '../src/bmesh/marking'
import {BMesh} from '../src/bmesh/BMesh'
import {ElemFlag} from '../src/constants'

interface Case {
    name: string
    mode: 'VERT' | 'EDGE' | 'FACE'
    props: {threshold?: number, use_unselected?: boolean}
    input: FixtureInput & {hide: number[]}
    entered: {verts: number[], edges: number[][], faces: number[]}
    output: FixtureMesh
}

const fixture = loadFixture<Case>('bmesh-ops-mergebydistance.json')
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}
/**
 * Cases where 3.4.1's pair survivor differs from the current source's (see the module comment): the
 * survivors the current source keeps (`present`) and the partners it merges away (`absent`). On the
 * cube, every lid copy (z = 1.02) whose corner was selected goes; in edge mode only corners 1 and 3
 * (with lid copies 8 and 9) are selected, so lid copies 10 and 11 stay. On the gap strip, corners 1
 * and 2 survive and the copies 4 (1.05, 0, 0) and 7 (1, 1.05, 0) go.
 */
const PAIR_SURVIVOR_DIFFERS = new Map<string, {present: number[][], absent: number[][]}>([
    ['cube lid welded', {present: [[-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]],
        absent: [[-1, -1, 1.02], [-1, 1, 1.02], [1, 1, 1.02], [1, -1, 1.02]]}],
    ['cube lid edge mode', {present: [[-1, -1, 1], [-1, 1, 1], [1, 1, 1.02], [1, -1, 1.02]],
        absent: [[-1, -1, 1.02], [-1, 1, 1.02]]}],
    ['gap strip, all selected', {present: [[1, 0, 0], [1, 1, 0]], absent: [[1.05, 0, 0], [1, 1.05, 0]]}],
])

describe(`merge by distance matches Blender ${fixture.blender} (use_centroid off)`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const {bm, verts, faces} = buildInput({...c.input, select: undefined})
            bm.selectMode = MODE[c.mode]
            for (const i of c.input.hide) vertHideSet(bm, verts[i], true)
            setRawSelection(bm, verts, faces, c.entered)
            const r = mergeByDistanceSelection(bm, {
                threshold: c.props.threshold,
                useUnselected: c.props.use_unselected,
                useCentroid: false,
            })
            expect(r.ok).toBe(true)
            expect(bm.validate()).toEqual([])
            expect(r.removed).toBe(c.input.positions.length - c.output.positions.length)
            const got = meshOf(bm)
            if (!PAIR_SURVIVOR_DIFFERS.has(c.name)) {
                expect(compareMeshes(got, c.output, {selection: true})).toEqual([])
                return
            }
            expect(compareMeshes(got, c.output, {selection: true, tol: c.props.threshold})).toEqual([])
            // Current source: the lower index of each pair survives.
            const has = (q: number[]) => got.positions.some(p => p.every((x, i) => Math.abs(x - q[i]) < 1e-9))
            const {present, absent} = PAIR_SURVIVOR_DIFFERS.get(c.name)!
            expect(present.filter(q => !has(q))).toEqual([])
            expect(absent.filter(has)).toEqual([])
        })
    }
})

describe('merge by distance, current-source behaviour', () => {
    it('use_centroid (the default) moves the survivor to the cluster centroid', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(0.004, 0, 0)
        const c = bm.vertCreate(0, 0.005, 0)
        for (const v of [a, b, c]) v.hflag |= ElemFlag.Select
        bm.totvertsel = 3
        const r = mergeByDistanceSelection(bm, {threshold: 0.01})
        expect(r.removed).toBe(2)
        const [v] = [...bm.verts]
        expect([v.x, v.y, v.z].map(n => Math.round(n * 1e9) / 1e9)).toEqual([0.004 / 3, 0.005 / 3, 0].map(n => Math.round(n * 1e9) / 1e9))
    })

    it('does nothing without a selection', () => {
        const bm = new BMesh()
        bm.vertCreate(0, 0, 0)
        bm.vertCreate(0, 0, 0)
        expect(mergeByDistanceSelection(bm)).toEqual({ok: true, removed: 0})
        expect(bm.totvert).toBe(2)
    })
})
