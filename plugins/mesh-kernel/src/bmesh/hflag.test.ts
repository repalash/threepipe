import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {ElemFlag, ElemType, SelectMode} from '../constants'
import {faceSelectSet, selectHistoryStore, vertHideSet} from './marking'
import {edbmFlagDisableAll, elemHflagEnableTest, elemsHflagEnable} from './hflag'

function quadStrip() {
    const bm = new BMesh()
    const v = [0, 1, 2].flatMap(x => [0, 1].map(y => bm.vertCreate(x, y, 0)))
    const f0 = bm.faceCreate([v[0], v[2], v[3], v[1]])
    const f1 = bm.faceCreate([v[2], v[4], v[5], v[3]])
    return {bm, v, f0, f1}
}

describe('BM_mesh_elem_hflag_enable_test / disable', () => {
    it('stashes the selection in a tag and restores it (edbm_remove_doubles_exec pattern)', () => {
        const {bm, f0, f1} = quadStrip()
        // Face select mode, so the face tags are what the operator stashes (`htype_select = BM_FACE`).
        // In vertex mode a face deselect drops all its corners (`BM_face_select_set`, the
        // "temporarily invalid state" note) and the caller's `EDBM_selectmode_flush` repairs it.
        bm.selectMode = SelectMode.Face
        faceSelectSet(bm, f0, true)
        elemHflagEnableTest(bm, ElemType.Face, ElemFlag.Tag, true, true, ElemFlag.Select)
        expect(!!(f0.hflag & ElemFlag.Tag)).toBe(true)
        expect(!!(f1.hflag & ElemFlag.Tag)).toBe(false)
        edbmFlagDisableAll(bm, ElemFlag.Select)
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([0, 0, 0])
        elemHflagEnableTest(bm, ElemType.Face, ElemFlag.Select, true, true, ElemFlag.Tag)
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([4, 4, 1])
        expect(!!(f0.hflag & ElemFlag.Select)).toBe(true)
    })

    it('never selects a hidden element, and clearing Select clears the history', () => {
        const {bm, v} = quadStrip()
        vertHideSet(bm, v[0], true)
        selectHistoryStore(bm, v[1])
        elemHflagEnableTest(bm, ElemType.Vert, ElemFlag.Select, false, false, 0)
        expect(v[0].hflag & ElemFlag.Select).toBe(0)
        expect(bm.totvertsel).toBe(5)
        edbmFlagDisableAll(bm, ElemFlag.Select)
        expect(bm.selectHistory.length).toBe(0)
    })

    it('BMO_slot_buffer_hflag_enable selects through BM_elem_select_set', () => {
        const {bm, f1} = quadStrip()
        elemsHflagEnable(bm, [f1], ElemType.Face, ElemFlag.Select, true)
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([4, 4, 1])
    })
})
