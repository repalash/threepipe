import {describe, expect, it, vi} from 'vitest'
import {gizmoActions} from './gizmoKeyboardHandler'

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
})
