import {describe, expect, it} from 'vitest'
import {bmFromMesh, bmToMesh, duplicateGeometry, MeshData, primitiveCube, selectHistoryActive} from '@threepipe/mesh-kernel'
import {runOnSelection} from '../src/commands/fill'
import {mergeByDistanceSelection} from '@threepipe/mesh-kernel'

/** A cube plus a copy of it moved 0.01 along X: what Shift+D, X, 0.01 leaves behind. */
function cubeAndNudgedCopy(): MeshData {
    const bm = bmFromMesh(primitiveCube({size: 2}))
    const dup = duplicateGeometry(bm, {verts: [...bm.verts], edges: [...bm.edges], faces: [...bm.faces]})
    for (const v of dup.verts) v.x += 0.01
    return bmToMesh(bm)
}

describe('runOnSelection (the fill commands\' selection plumbing)', () => {
    it('selects the listed elements, runs the edit-mode function, and reports the selection after', () => {
        const mesh = cubeAndNudgedCopy()
        expect([mesh.vertsNum, mesh.facesNum]).toEqual([16, 12])
        const copy = [8, 9, 10, 11, 12, 13, 14, 15]
        const none = runOnSelection(mesh, {verts: copy}, bm => mergeByDistanceSelection(bm, {threshold: 0.05}))
        // Only the copy is selected: no two selected vertices are within range.
        expect(none.result.removed).toBe(0)
        const merged = runOnSelection(mesh, {verts: copy}, bm => mergeByDistanceSelection(bm, {threshold: 0.05, useUnselected: true}))
        expect(merged.result.removed).toBe(8)
        expect([merged.mesh.vertsNum, merged.mesh.edgesNum, merged.mesh.facesNum]).toEqual([8, 12, 6])
        // The copy merged into the original's vertices, and the weld merges a double's flags (its
        // selection tag too) into the survivor (`BM_elem_flag_merge_ex`), so the survivors come back
        // selected - as Blender's fixture case "strip right quad selected, unselected targets" shows.
        const all = (n: number) => [...Array(n).keys()]
        expect(merged.selected).toEqual({verts: all(8), edges: all(12), faces: all(6)})
    })

    it('records vertices in list order as the select history, and rejects bad indices', () => {
        const mesh = bmToMesh(bmFromMesh(primitiveCube({size: 2})))
        let active = -1
        runOnSelection(mesh, {verts: [5, 2, 7]}, bm => { active = [...bm.verts].indexOf(selectHistoryActive(bm) as never) })
        expect(active).toBe(7)
        expect(() => runOnSelection(mesh, {verts: [8]}, () => 0)).toThrow(/out of range/)
    })
})
