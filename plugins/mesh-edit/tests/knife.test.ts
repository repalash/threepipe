/**
 * The knife's DOM layer: the Knife Tool Modal Map port (`knife/keymap.ts`) and `KnifeModal`.
 *
 * The replay suite feeds the interactive recordings of Blender's own modal knife
 * (`mesh-kernel/tests/fixtures/knife-interactive/`, see `gen-knife-interactive-fixtures.py`) through
 * DOM-shaped input - `KeyboardEvent.code`, pointer buttons, click counts, modifier flags - so it checks
 * that what a browser delivers reaches the knife as Blender's modal keymap would deliver it, end to end
 * to the same mesh Blender made. The kernel suite checks the same recordings one level down.
 */

import {describe, expect, it} from 'vitest'
import {KMAXDIST, selectAll} from '@threepipe/mesh-kernel'
import {knifeButtonToModal, knifeKeyToModal, KnifeKeyInput} from '../src/knife/keymap'
import {KnifeModal} from '../src/knife/KnifeModal'
import {
    buildFromBlender, compareMeshes, dumpMesh, faceFindNearestCpu, fixtureView, interactiveFixtures, RecordedEvent,
} from '../../mesh-kernel/tests/knifeBisectFixtures'

const key = (code: string, press = true, mods: Partial<KnifeKeyInput> = {}): KnifeKeyInput =>
    ({code, press, ctrl: false, shift: false, alt: false, meta: false, ...mods})

describe('knife modal keymap (blender_default.py km_knife_tool_modal_map)', () => {
    it('maps keys as Blender does', () => {
        expect(knifeKeyToModal(key('Escape'))).toEqual({item: 'CANCEL', release: false})
        expect(knifeKeyToModal(key('Escape', true, {shift: true}))?.item).toBe('CANCEL') // "any"
        expect(knifeKeyToModal(key('Enter'))?.item).toBe('CONFIRM')
        expect(knifeKeyToModal(key('NumpadEnter'))?.item).toBe('CONFIRM')
        expect(knifeKeyToModal(key('Space'))?.item).toBe('CONFIRM')
        expect(knifeKeyToModal(key('KeyZ', true, {ctrl: true}))?.item).toBe('UNDO')
        expect(knifeKeyToModal(key('KeyZ', true, {meta: true}))?.item).toBe('UNDO')
        expect(knifeKeyToModal(key('KeyZ'))?.item).toBe('Z_AXIS')
        expect(knifeKeyToModal(key('KeyZ', true, {shift: true}))).toBeNull()
        expect(knifeKeyToModal(key('KeyX'))?.item).toBe('X_AXIS')
        expect(knifeKeyToModal(key('KeyY'))?.item).toBe('Y_AXIS')
        expect(knifeKeyToModal(key('KeyA'))?.item).toBe('ANGLE_SNAP_TOGGLE')
        expect(knifeKeyToModal(key('KeyR'))?.item).toBe('CYCLE_ANGLE_SNAP_EDGE')
        expect(knifeKeyToModal(key('KeyC'))?.item).toBe('CUT_THROUGH_TOGGLE')
        expect(knifeKeyToModal(key('KeyC', true, {ctrl: true}))).toBeNull()
        expect(knifeKeyToModal(key('KeyS'))?.item).toBe('SHOW_DISTANCE_ANGLE_TOGGLE')
        expect(knifeKeyToModal(key('KeyV'))?.item).toBe('DEPTH_TEST_TOGGLE')
        expect(knifeKeyToModal(key('ShiftLeft'))).toEqual({item: 'SNAP_MIDPOINTS_ON', release: false})
        expect(knifeKeyToModal(key('ShiftRight', false))).toEqual({item: 'SNAP_MIDPOINTS_OFF', release: true})
        expect(knifeKeyToModal(key('ControlLeft'))?.item).toBe('IGNORE_SNAP_ON')
        expect(knifeKeyToModal(key('ControlRight', false))?.item).toBe('IGNORE_SNAP_OFF')
        expect(knifeKeyToModal(key('ShiftLeft', true, {repeat: true}))).toBeNull()
        // Releases of plain keys are not bound.
        expect(knifeKeyToModal(key('KeyC', false))).toBeNull()
        expect(knifeKeyToModal(key('KeyQ'))).toBeNull()
    })

    it('adds E (new cut) and Backspace (undo)', () => {
        expect(knifeKeyToModal(key('KeyE'))?.item).toBe('NEW_CUT')
        expect(knifeKeyToModal(key('Backspace'))?.item).toBe('UNDO')
        expect(knifeKeyToModal(key('KeyE', true, {shift: true}))).toBeNull()
    })

    it('maps buttons as Blender does', () => {
        const b = (button: number, press: boolean, clicks = 1, mods = {}) => ({button, press, clicks, ctrl: false, shift: false, alt: false, meta: false, ...mods})
        expect(knifeButtonToModal(b(0, true))).toEqual({item: 'ADD_CUT', release: false})
        expect(knifeButtonToModal(b(0, false))).toEqual({item: 'ADD_CUT', release: true})
        expect(knifeButtonToModal(b(0, true, 1, {ctrl: true, shift: true}))?.item).toBe('ADD_CUT') // "any"
        expect(knifeButtonToModal(b(0, true, 2))).toEqual({item: 'ADD_CUT_CLOSED', release: false})
        expect(knifeButtonToModal(b(1, true))).toEqual({item: 'PANNING', release: false})
        expect(knifeButtonToModal(b(2, true))?.item).toBe('NEW_CUT')
        expect(knifeButtonToModal(b(2, true, 1, {shift: true}))).toBeNull()
        expect(knifeButtonToModal(b(2, false))).toBeNull()
    })
})

/** Blender event types as the DOM names them. */
const DOM_CODE: Record<string, string> = {
    RET: 'Enter', ESC: 'Escape', SPACE: 'Space', LEFT_SHIFT: 'ShiftLeft', LEFT_CTRL: 'ControlLeft',
    A: 'KeyA', C: 'KeyC', R: 'KeyR', S: 'KeyS', V: 'KeyV', X: 'KeyX', Y: 'KeyY', Z: 'KeyZ', E: 'KeyE',
}

function replay(modal: KnifeModal, events: RecordedEvent[]): void {
    for (const e of events) {
        if (modal.done) break
        const mods = {ctrl: !!e.ctrl, shift: !!e.shift, alt: false, meta: false}
        if (e.type === 'MOUSEMOVE') modal.move(e.mval)
        else if (e.type === 'LEFTMOUSE' || e.type === 'RIGHTMOUSE' || e.type === 'MIDDLEMOUSE') {
            const button = e.type === 'LEFTMOUSE' ? 0 : e.type === 'MIDDLEMOUSE' ? 1 : 2
            modal.button({button, press: e.value === 'PRESS', clicks: e.value === 'PRESS' ? 1 : 0, ...mods}, e.mval)
        } else {
            const code = DOM_CODE[e.type]
            if (!code) throw new Error(`no DOM code for ${e.type}`)
            modal.key({code, press: e.value === 'PRESS', ...mods})
        }
    }
}

describe('KnifeModal replays Blender\'s modal knife from DOM input', () => {
    for (const fx of interactiveFixtures) {
        it(fx.name, () => {
            const bm = buildFromBlender(fx.input)
            selectAll(bm)
            const view = fixtureView(fx)
            const first = fx.events![0]
            const modal = new KnifeModal({
                bm, view, objectMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], mval: first.mval,
                findNearestFace: faceFindNearestCpu(bm, view, KMAXDIST * (fx.ui_scale_fac ?? 1)),
                // The recording was made at Blender's UI scale.
                uiScale: fx.ui_scale_fac,
            })
            replay(modal, fx.events!)
            expect(modal.status).toBe('finished')
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(dumpMesh(bm), fx.output)).toEqual([])
        })
    }
})
