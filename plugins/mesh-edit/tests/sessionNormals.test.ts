/**
 * The edit session keeps the BMesh's normals current the way Blender's edit mode does
 * (`issues/open/modelling-tools/mesh-edit-normals-current.md`): computed on entry and after an undo
 * step (`BKE_editmesh_looptris_and_normals_calc`), and once after each committed operator or modal
 * transform (`EDBM_update` with `calc_normals`, `EditMeshState.update`) - not on every frame of a drag,
 * whose re-bake (`syncFromBMesh`) leaves them alone.
 */

import {describe, expect, it} from 'vitest'
import {
    BM_FROM_MESH_NORMALS,
    BMesh,
    bmFromMesh,
    bmToMesh,
    ElemFlag,
    extrudeSelection,
    faceSelectSet,
    primitiveCube,
    SelectMode,
    selectModeSet,
    selectNone,
} from '@threepipe/mesh-kernel'
import {EDIT_UPDATE_NONE, EDIT_UPDATE_NORMALS, EditMeshState} from '../src/EditMeshState'

type Normals = {faces: number[][], verts: number[][]}

const round = (n: number) => Math.round(n * 1e9) / 1e9 + 0
const normalsOf = (bm: BMesh): Normals => ({
    faces: [...bm.faces].map(f => [f.nx, f.ny, f.nz].map(round)),
    verts: [...bm.verts].map(v => [v.nx, v.ny, v.nz].map(round)),
})
/** What `BM_mesh_normals_update` gives the session's mesh as it is now (element order is kept by the round trip). */
const currentNormals = (bm: BMesh): Normals => normalsOf(bmFromMesh(bmToMesh(bm), BM_FROM_MESH_NORMALS))

/** Blender's default cube in a session, with its top face (+Z) selected in face mode. */
function cubeSession() {
    const state = EditMeshState.fromMeshData(primitiveCube({size: 2}))
    const bm = state.bm
    selectModeSet(bm, SelectMode.Face)
    selectNone(bm)
    const top = [...bm.faces].find(f => [...f.eachLoop()].every(l => Math.abs(l.v.z - 1) < 1e-9))!
    faceSelectSet(bm, top, true)
    return {state, bm}
}

/** The positions a modal move writes on each frame, without going through the session. */
function moveSelected(bm: BMesh, dz: number): void {
    for (const v of bm.verts) if (v.hflag & ElemFlag.Select) v.z += dz
}

describe('the edit session keeps normals current', () => {
    it('on entry, from a kernel mesh or from triangles', () => {
        const fromMesh = EditMeshState.fromMeshData(primitiveCube({size: 2}))
        expect(normalsOf(fromMesh.bm)).toEqual(currentNormals(fromMesh.bm))
        const corner = [...fromMesh.bm.verts].find(v => v.x > 0 && v.y > 0 && v.z > 0)!
        expect(corner.nz).toBeCloseTo(1 / Math.sqrt(3), 9)

        // A two-triangle quad, as a glTF would bring it.
        const fromTriangles = new EditMeshState({position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], index: [0, 1, 2, 0, 2, 3]})
        expect(normalsOf(fromTriangles.bm)).toEqual(currentNormals(fromTriangles.bm))
        for (const v of fromTriangles.bm.verts) expect([v.nx, v.ny, v.nz].map(round)).toEqual([0, 0, 1])
    })

    it('extrude and move: once after the extrude, not while the move runs, once when it ends', () => {
        const {state, bm} = cubeSession()
        expect(extrudeSelection(bm)).toBeTruthy()
        // The extrude half of `extrude_region_move` ends with `EDBM_update`.
        state.update(EDIT_UPDATE_NORMALS)
        expect(normalsOf(bm)).toEqual(currentNormals(bm))

        // Frames of the move: positions change, the drawn surface is re-baked, the normals are left.
        const atStart = normalsOf(bm)
        for (let i = 0; i < 5; i++) {
            moveSelected(bm, 0.2)
            state.syncFromBMesh()
        }
        expect(normalsOf(bm)).toEqual(atStart)
        // The four new side faces had no area when the move started: their normals are stale now.
        expect(normalsOf(bm)).not.toEqual(currentNormals(bm))

        // The move ends: one update, and the next operator starts with current normals.
        state.update(EDIT_UPDATE_NORMALS)
        expect(normalsOf(bm)).toEqual(currentNormals(bm))
        const sides = [...bm.faces].filter(f => Math.abs(f.nz) < 1e-9)
        expect(sides).toHaveLength(8) // the cube's four, and the extrusion's four
        for (const f of sides) expect(Math.hypot(f.nx, f.ny)).toBeCloseTo(1, 9)
        // The moved top keeps pointing up; the top ring's vertices lean out over the new sides.
        const topRing = [...bm.verts].filter(v => Math.abs(v.z - 2) < 1e-9)
        expect(topRing).toHaveLength(4)
        for (const v of topRing) expect(v.nz).toBeCloseTo(1 / Math.sqrt(3), 9)
    })

    it('an operator that says nothing went stale (hide) does not recompute them', () => {
        const {state, bm} = cubeSession()
        // One corner up: its faces tilt, so their normals change.
        bm.verts.values().next().value!.z += 1
        const before = normalsOf(bm)
        state.update(EDIT_UPDATE_NONE)
        expect(normalsOf(bm)).toEqual(before)
        expect(normalsOf(bm)).not.toEqual(currentNormals(bm))
    })

    it('an undo step rebuilds the BMesh with current normals', () => {
        const {state, bm} = cubeSession()
        bm.verts.values().next().value!.z += 1
        state.syncFromBMesh()
        state.syncToBMesh()
        expect(state.bm).not.toBe(bm)
        expect(normalsOf(state.bm)).toEqual(currentNormals(state.bm))
    })
})
