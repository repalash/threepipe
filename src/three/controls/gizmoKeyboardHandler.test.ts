import {describe, expect, it, vi} from 'vitest'
import {EventDispatcher} from 'three'
import {gizmoActions} from './gizmoKeyboardHandler'
import {ViewerActions} from '../../viewer/ViewerActions'

describe('gizmoActions', () => {
    it('the keys work while the gizmo is enabled and attached; Space turns it on again while it is off', () => {
        const gizmo = {enabled: true, object: {} as object | undefined}
        const target = {
            active: () => gizmo.enabled && !!gizmo.object,
            attached: () => !!gizmo.object,
            toggleSpace: vi.fn(), adjustSize: vi.fn(), toggleAxis: vi.fn(),
            toggleEnabled: () => { gizmo.enabled = !gizmo.enabled },
            changed: vi.fn(),
        }
        const actions = gizmoActions('gizmo', 'Gizmo', target)
        const get = (id: string) => actions.find(a => a.id === 'gizmo.' + id)!
        get('toggleEnabled').run()
        expect([gizmo.enabled, get('toggleSpace').enabled!(), get('toggleEnabled').enabled!()]).toEqual([false, false, true])
        get('toggleEnabled').run()
        expect(gizmo.enabled).toBe(true)
        expect(target.changed).toHaveBeenCalledTimes(2)
        gizmo.object = undefined
        expect(get('toggleEnabled').enabled!()).toBe(false)
    })

    const gizmoTarget = (preferred = false) => {
        const events = new EventDispatcher<any>()
        return {
            events, preferred,
            active: () => true, attached: () => true,
            toggleSpace: vi.fn(), adjustSize: vi.fn(), toggleAxis: vi.fn(), toggleEnabled: vi.fn(), changed: vi.fn(),
        }
    }
    const press = (code: string, shiftKey = false) => {
        const e = Object.assign(new Event('keydown', {cancelable: true}), {key: code.replace('Key', '').toLowerCase(), code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey})
        window.dispatchEvent(e)
        return e
    }
    const withWindow = (f: () => void) => {
        const win = new EventTarget()
        const old = {addEventListener: globalThis.addEventListener, removeEventListener: globalThis.removeEventListener, dispatchEvent: globalThis.dispatchEvent}
        Object.assign(globalThis, {addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win), dispatchEvent: win.dispatchEvent.bind(win)})
        try {
            f()
        } finally {
            Object.assign(globalThis, old)
        }
    }

    it('the keys work with Shift held down (Shift snaps the gizmo while it moves)', () => withWindow(() => {
        const target = gizmoTarget()
        const actions = new ViewerActions()
        const unregister = actions.register(gizmoActions('gizmo', 'Gizmo', target))
        press('KeyX', true)
        press('KeyQ', true)
        expect([target.toggleAxis.mock.calls, target.toggleSpace.mock.calls.length]).toEqual([[[0]], 1])
        unregister()
    }))

    it('two gizmos with the same keys: one takes a key, the one used last (a press on a handle), else the preferred one', () => withWindow(() => {
        const transform = gizmoTarget(true), pivot = gizmoTarget()
        const actions = new ViewerActions()
        // the pivot gizmo registered last: it would win a tie
        const unregister = [actions.register(gizmoActions('transform', 'Transform', transform)), actions.register(gizmoActions('pivot', 'Pivot', pivot))]
        press('KeyX')
        expect([transform.toggleAxis.mock.calls.length, pivot.toggleAxis.mock.calls.length]).toEqual([1, 0])
        pivot.events.dispatchEvent({type: 'mouseDown'})
        press('KeyX')
        expect([transform.toggleAxis.mock.calls.length, pivot.toggleAxis.mock.calls.length]).toEqual([1, 1])
        transform.events.dispatchEvent({type: 'mouseDown'})
        press('Space')
        expect([transform.toggleEnabled.mock.calls.length, pivot.toggleEnabled.mock.calls.length]).toEqual([1, 0])
        unregister.forEach(f => f())
    }))

    it('the gizmo pressed last is kept for each viewer (its canvas): a press in another viewer does not change it', () => {
        const canvasA = {}, canvasB = {}
        const inA = (t: ReturnType<typeof gizmoTarget>) => Object.assign(t, {scope: () => canvasA})
        const inB = (t: ReturnType<typeof gizmoTarget>) => Object.assign(t, {scope: () => canvasB})
        const transformA = inA(gizmoTarget(true)), pivotA = inA(gizmoTarget())
        const transformB = inB(gizmoTarget(true)), pivotB = inB(gizmoTarget())
        const [ta, pa, tb, pb] = [transformA, pivotA, transformB, pivotB].map(t => gizmoActions('g', 'G', t)[0])
        pivotA.events.dispatchEvent({type: 'mouseDown'})
        transformB.events.dispatchEvent({type: 'mouseDown'})
        expect([ta.priority, pa.priority, tb.priority, pb.priority]).toEqual([1, 2, 2, 0])
    })
})
