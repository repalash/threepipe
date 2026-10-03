/**
 * Ground-truth parity for the knife (`src/ops/knife/`) and bisect (`src/ops/bisectPlane.ts`) ports
 * against Blender itself.
 *
 * Every case in `fixtures/knife-bisect/` was written by Blender 3.4.1 running
 * `fixtures/gen-knife-bisect-fixtures.py`: the input mesh as edit mode sees it, the operator's inputs and
 * the mesh Blender produced.
 * - Knife cases run `bpy.ops.mesh.knife_project`, Blender's non-interactive knife (`EDBM_mesh_knife`):
 *   the same line-hit, cut and edge-net code as the interactive tool, with snapping off. They carry the
 *   3D view's matrices and region size, and the screen polylines Blender cut along.
 * - Bisect cases run `bpy.ops.mesh.bisect` with the plane given (`mesh_bisect_exec`).
 *
 * The input is rebuilt the way `BM_mesh_bm_from_me` builds edit mode's BMesh - vertices, then edges in
 * Blender's edge order, then faces over those edges - so disk-cycle order, which the edge-net walk
 * reads, is Blender's. The comparison is order-free: Blender's vertex order is not even stable across
 * its own runs (it iterates pointer-keyed maps when splitting edges), so vertices are paired by
 * position (1e-4, Blender being float32 and the fixture rounded to 6 places), faces compared as cyclic
 * vertex sequences (which checks winding), and the edge sets compared as vertex pairs.
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge} from '../src/bmesh/types'
import {selectAll} from '../src/bmesh/marking'
import {knifeProject} from '../src/ops/knife/knife'
import {bisectSelection} from '../src/ops/bisectPlane'
import {triangleFill} from '../src/ops/triangleFill'
import {faceAttributeFill} from '../src/ops/faceAttributeFill'
import {buildFromBlender, compareMeshes, dumpMesh, Fixture, fixtures, fixtureView} from './knifeBisectFixtures'

function runKnife(fx: Fixture): BMesh {
    const bm = buildFromBlender(fx.input)
    selectAll(bm)
    knifeProject(bm, fixtureView(fx), fx.polys! as [number, number][][], {cutThrough: fx.cut_through, useTag: true})
    return bm
}

/** `mesh_bisect_exec`'s fill: `triangle_fill use_dissolve=true` then `face_attribute_fill`. */
function bisectFill(bm: BMesh, edges: BMEdge[], normal: [number, number, number]) {
    const filled = triangleFill(bm, edges, {normal, useDissolve: true})
    faceAttributeFill(bm, filled.faces, {useNormals: true, useData: true})
    return filled.faces
}

function runBisect(fx: Fixture): BMesh {
    const bm = buildFromBlender(fx.input)
    selectAll(bm)
    bisectSelection(bm, {
        planeCo: fx.plane_co as [number, number, number], planeNo: fx.plane_no as [number, number, number],
        clearInner: fx.clear_inner, clearOuter: fx.clear_outer, useFill: fx.use_fill, threshold: fx.threshold,
    }, bisectFill)
    return bm
}

describe('knife and bisect match Blender', () => {
    it('has the fixtures', () => {
        expect(fixtures.filter(f => f.kind === 'knife').length).toBeGreaterThanOrEqual(10)
        expect(fixtures.filter(f => f.kind === 'bisect').length).toBeGreaterThanOrEqual(10)
    })
    for (const fx of fixtures) {
        it(`${fx.name} (Blender ${fx.blender})`, () => {
            const bm = fx.kind === 'knife' ? runKnife(fx) : runBisect(fx)
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(dumpMesh(bm), fx.output)).toEqual([])
        })
    }
})
