/**
 * Shrink/Fatten (`transform_mode_shrink_fatten.cc`, `src/transform/shrinkFatten.ts`): the vertical
 * mouse input, the per-vertex normal in face select mode, even thickness (shell factor) and its Alt / S
 * toggles, and the saved `use_even_offset`.
 */

import {describe, expect, it} from 'vitest'
import {OrthographicCamera} from 'three'
import {BMesh, BMFace, BM_FROM_MESH_NORMALS, bmFromMesh, faceSelectSet, primitiveCube, SelectMode, selectNone} from '@threepipe/mesh-kernel'
import {TransformView} from '../src/transform/view'
import {TransInfo} from '../src/transform/TransInfo'
import type {ModalKeyEvent} from '../src/transform/keymap'

/** Orthographic, 8 units over 800 px, looking down -Z: 100 px of vertical travel is 1 unit. */
function orthoView(): TransformView {
    const cam = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
    cam.position.set(0, 0, 10)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
    return TransformView.fromCamera(cam, 800, 600)
}

const key = (code: string, press = true): ModalKeyEvent => ({code, key: code, ctrl: false, shift: false, alt: code.startsWith('Alt'), press})

function cubeWithFaces(...normals: [number, number, number][]): {bm: BMesh, faces: BMFace[]} {
    const bm = bmFromMesh(primitiveCube(), BM_FROM_MESH_NORMALS)
    selectNone(bm)
    bm.selectMode = SelectMode.Face
    const faces = normals.map(n => [...bm.faces].find(f => Math.abs(f.nx - n[0]) + Math.abs(f.ny - n[1]) + Math.abs(f.nz - n[2]) < 1e-6)!)
    for (const f of faces) faceSelectSet(bm, f, true)
    return {bm, faces}
}

const coords = (f: BMFace) => f.verts().map(v => [v.x, v.y, v.z])

function start(bm: BMesh, extra: Partial<ConstructorParameters<typeof TransInfo>[0]> = {}) {
    return new TransInfo({mode: 'shrinkFatten', view: orthoView(), mval: [400, 300], around: 'median', orientation: 'global', bm, ...extra})
}

describe('shrink/fatten', () => {
    it('drags up to fatten: twice the vertical travel, along the selected face\'s normal (INPUT_VERTICAL_ABSOLUTE)', () => {
        const {bm, faces: [top]} = cubeWithFaces([0, 0, 1])
        const before = coords(top)
        const t = start(bm)
        t.handleEvent({type: 'mousemove', mval: [400, 350]}) // 50 px up = 0.5 units, doubled
        expect(t.valuesFinal[0]).toBeCloseTo(1, 6)
        expect(t.header.startsWith('Shrink/Fatten: 1.0000')).toBe(true)
        coords(top).forEach((c, i) => expect(c).toEqual([before[i][0], before[i][1], before[i][2] + 1].map(x => expect.closeTo(x, 6))))
        t.handleEvent({type: 'mousemove', mval: [400, 250]}) // down: shrink
        coords(top).forEach((c, i) => expect(c[2]).toBeCloseTo(before[i][2] - 1, 6))
    })

    it('even thickness keeps a shared edge on both offset planes (shell factor), off by default', () => {
        const {bm, faces: [top, front]} = cubeWithFaces([0, 0, 1], [0, -1, 0])
        const shared = top.verts().filter(v => front.verts().includes(v))
        const t0 = start(bm, {modal: false, value: [0.5], shrinkFatten: {useEvenOffset: false}})
        for (const v of shared) {
            expect(v.z).toBeCloseTo(1 + 0.5 / Math.SQRT2, 6)
            expect(v.y).toBeCloseTo(-1 - 0.5 / Math.SQRT2, 6)
        }
        t0.restoreTransObjects()
        t0.flushVerts()
        const t1 = start(bm, {modal: false, value: [0.5], shrinkFatten: {useEvenOffset: true}})
        for (const v of shared) {
            expect(v.z).toBeCloseTo(1.5, 6)
            expect(v.y).toBeCloseTo(-1.5, 6)
        }
        expect(t1.saveProps().shrinkFatten).toEqual({useEvenOffset: true})
        expect(t1.saveProps().value).toEqual([0.5])
    })

    it('Alt holds even thickness, S toggles it, and S does not switch to Scale (transform_mode_is_changeable)', () => {
        const {bm, faces: [top, front]} = cubeWithFaces([0, 0, 1], [0, -1, 0])
        const shared = top.verts().filter(v => front.verts().includes(v))
        const t = start(bm)
        t.handleEvent({type: 'mousemove', mval: [400, 325]}) // 0.5
        expect(shared[0].z).toBeCloseTo(1 + 0.5 / Math.SQRT2, 6)
        t.handleEvent({type: 'key', event: key('AltLeft')})
        expect(shared[0].z).toBeCloseTo(1.5, 6)
        t.handleEvent({type: 'key', event: key('AltLeft', false)})
        expect(shared[0].z).toBeCloseTo(1 + 0.5 / Math.SQRT2, 6)
        t.handleEvent({type: 'key', event: key('KeyS')})
        expect(t.mode).toBe('shrinkFatten')
        expect(shared[0].z).toBeCloseTo(1.5, 6)
        expect(t.saveProps().shrinkFatten).toEqual({useEvenOffset: true})
    })

    it('typed values work (NumInput) and the operator\'s use_even_offset starts it on', () => {
        const {bm, faces: [top]} = cubeWithFaces([0, 0, 1])
        const t = start(bm, {shrinkFatten: {useEvenOffset: true}})
        t.handleEvent({type: 'key', event: {...key('Digit2'), key: '2'}})
        expect(t.valuesFinal[0]).toBe(2)
        top.verts().forEach(v => expect(v.z).toBeCloseTo(3, 6))
        expect(t.saveProps().shrinkFatten).toEqual({useEvenOffset: true})
    })
})
