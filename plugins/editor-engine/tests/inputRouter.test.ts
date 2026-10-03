/**
 * The input router's dispatch rules, driven without a DOM: focus awareness, modal precedence,
 * suspension, repeat handling and the capture-phase stop.
 */

import {beforeAll, describe, expect, it} from 'vitest'
import {InputRouter, InputRouterHost} from '../src/input/InputRouter'

// The root test setup aliases `window` to `globalThis`, which has no event target API in Node; the
// router only registers listeners there, and `route()` is driven directly below.
beforeAll(() => {
    const w = globalThis as any
    w.addEventListener ??= () => {}
    w.removeEventListener ??= () => {}
})
import {Keymap} from '../src/keymap/Keymap'
import {blenderPreset} from '../src/keymap/presets/blender'
import type {EditorMode, KeyBinding} from '../src/registry'

function fakeEvent(code: string, extra: Record<string, unknown> = {}): KeyboardEvent & {prevented: boolean, stopped: boolean} {
    const e: any = {
        code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false,
        target: null, prevented: false, stopped: false,
        preventDefault() { this.prevented = true },
        stopPropagation() { this.stopped = true },
        ...extra,
    }
    return e
}

function makeRouter(opts: {mode?: EditorMode, modal?: (e: KeyboardEvent) => boolean} = {}) {
    const dispatched: KeyBinding[] = []
    const host: InputRouterHost = {
        canvas: {addEventListener() {}, removeEventListener() {}} as unknown as HTMLCanvasElement,
        mode: () => opts.mode ?? 'object',
        keymap: () => new Keymap(blenderPreset),
        handleModalKey: opts.modal ?? (() => false),
        dispatch: b => { dispatched.push(b) },
    }
    const router = new InputRouter(host)
    return {router, dispatched}
}

describe('InputRouter', () => {
    it('routes a bound key to its operator and stops it reaching the plugins', () => {
        const {router, dispatched} = makeRouter()
        const e = fakeEvent('KeyZ', {ctrlKey: true})
        expect(router.route(e)).toMatchObject({id: 'edit.undo'})
        expect(dispatched[0].id).toBe('edit.undo')
        expect(e.prevented && e.stopped).toBe(true)
    })

    it('leaves keys typed into a form control alone', () => {
        const {router, dispatched} = makeRouter()
        for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
            const e = fakeEvent('KeyZ', {ctrlKey: true, target: {tagName}})
            expect(router.route(e)).toBeNull()
        }
        expect(router.route(fakeEvent('KeyA', {target: {tagName: 'DIV', isContentEditable: true}}))).toBeNull()
        expect(dispatched).toHaveLength(0)
    })

    it('lets Space and Enter activate a focused button, but takes other keys', () => {
        const {router} = makeRouter()
        const button = {tagName: 'BUTTON', getAttribute: () => null}
        expect(router.route(fakeEvent('Space', {target: button}))).toBeNull()
        expect(router.route(fakeEvent('Enter', {target: button}))).toBeNull()
        expect(router.route(fakeEvent('KeyZ', {ctrlKey: true, target: button}))).toMatchObject({id: 'edit.undo'})
    })

    it('gives a running modal operator every key first', () => {
        const taken: string[] = []
        const {router, dispatched} = makeRouter({modal: e => { taken.push(e.code); return e.code !== 'KeyQ' }})
        expect(router.route(fakeEvent('KeyX'))).toBe('modal')
        expect(router.route(fakeEvent('KeyZ', {ctrlKey: true}))).toBe('modal')
        // A key the modal declines falls through to the keymap.
        expect(router.route(fakeEvent('KeyQ'))).toBeNull()
        expect(taken).toEqual(['KeyX', 'KeyZ', 'KeyQ'])
        expect(dispatched).toHaveLength(0)
    })

    it('uses the mode-specific binding', () => {
        expect(makeRouter({mode: 'object'}).router.route(fakeEvent('Tab'))).toMatchObject({id: 'object.enter_edit'})
        expect(makeRouter({mode: 'edit'}).router.route(fakeEvent('Tab'))).toMatchObject({id: 'mesh.exit_edit'})
    })

    it('ignores auto-repeat unless the binding allows it', () => {
        const {router, dispatched} = makeRouter({mode: 'edit'})
        expect(router.route(fakeEvent('KeyE', {repeat: true}))).toBeNull()
        expect(router.route(fakeEvent('KeyZ', {ctrlKey: true, repeat: true}))).toMatchObject({id: 'edit.undo'})
        expect(dispatched.map(b => b.id)).toEqual(['edit.undo'])
    })

    it('stands down while suspended, and honours the host filter', () => {
        const {router, dispatched} = makeRouter()
        router.suspend('dialog')
        expect(router.route(fakeEvent('KeyZ', {ctrlKey: true}))).toBeNull()
        router.resume('dialog')
        router.filter = e => e.code !== 'KeyZ'
        expect(router.route(fakeEvent('KeyZ', {ctrlKey: true}))).toBeNull()
        router.filter = null
        expect(router.route(fakeEvent('KeyZ', {ctrlKey: true}))).toMatchObject({id: 'edit.undo'})
        expect(dispatched).toHaveLength(1)
    })
})
