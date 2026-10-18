/**
 * The "how to move around" gestures derived from each preset's navigation spec, and the wheel
 * verdict that decides whether the hints talk about a mouse or a trackpad.
 */

import {describe, expect, it} from 'vitest'
import {Navigation} from '../src/input/Navigation'
import {blenderPreset} from '../src/keymap/presets/blender'
import {designPreset} from '../src/keymap/presets/design'
import type {NavigationGesture} from '../src/registry'

function navigation(spec = blenderPreset.navigation) {
    const target = {addEventListener() {}, removeEventListener() {}}
    const viewer = {canvas: target, scene: {...target, mainCamera: undefined}}
    const nav = new Navigation(viewer as never, () => undefined)
    nav.apply(spec, 'object')
    return nav
}

const summary = (g: NavigationGesture[]) => Object.fromEntries(g.map(x => [x.action, [x.kind, ...x.alternatives.map(a => a.kind)]]))

describe('Navigation.gestures', () => {
    it('blender, mouse: MMB orbits, Shift+MMB and RMB pan, the wheel zooms (km_view3d :1651-1667)', () => {
        expect(summary(navigation().gestures('mouse'))).toEqual({
            orbit: ['middle-drag', 'alt-drag'],
            pan: ['right-drag', 'shift-middle-drag', 'shift-alt-drag'],
            zoom: ['wheel'],
        })
    })

    it('blender, trackpad: two fingers orbit, Shift pans, pinch zooms (TRACKPADPAN :1653, TRACKPADZOOM :1667)', () => {
        const g = navigation().gestures('trackpad')
        expect(summary(g)).toEqual({
            orbit: ['two-finger', 'alt-drag'],
            pan: ['shift-two-finger', 'shift-alt-drag'],
            zoom: ['pinch', 'ctrl-two-finger'],
        })
        expect(g.map(x => x.gesture)).toEqual(['Two-finger scroll', 'Shift+two-finger scroll', 'Pinch'])
    })

    it('design: right-drag orbits, middle and Space pan; a trackpad pans with two fingers', () => {
        const nav = navigation(designPreset.navigation)
        expect(summary(nav.gestures('mouse'))).toEqual({
            orbit: ['right-drag', 'alt-drag'],
            pan: ['middle-drag', 'space-drag'],
            zoom: ['wheel'],
        })
        expect(summary(nav.gestures('trackpad'))).toEqual({
            orbit: ['shift-two-finger', 'alt-drag'],
            pan: ['two-finger', 'space-drag'],
            zoom: ['pinch', 'ctrl-two-finger'],
        })
    })

    it('never offers a left drag for an action when the left button selects', () => {
        const nav = navigation({...blenderPreset.navigation, orbit: 'left', altOrbit: false})
        expect(nav.gestures('mouse').find(g => g.action === 'orbit')).toBeUndefined()
    })
})

describe('Navigation device', () => {
    const wheel = (deltaY: number, extra: Partial<WheelEvent> = {}) => ({deltaMode: 0, deltaX: 0, deltaY, ctrlKey: false, ...extra})

    it('only unambiguous wheel events give a verdict', () => {
        expect(Navigation.wheelVerdict(wheel(3, {deltaMode: 1}))).toBe('mouse')
        expect(Navigation.wheelVerdict(wheel(100))).toBe('mouse')
        expect(Navigation.wheelVerdict(wheel(-120))).toBe('mouse')
        expect(Navigation.wheelVerdict(wheel(2.5))).toBe('trackpad')
        expect(Navigation.wheelVerdict(wheel(4, {deltaX: -2}))).toBe('trackpad')
        expect(Navigation.wheelVerdict(wheel(6, {ctrlKey: true}))).toBe('trackpad')
        // A large trackpad swipe, a small integer scroll: no verdict, the device stays as it was.
        expect(Navigation.wheelVerdict(wheel(12))).toBeNull()
        expect(Navigation.wheelVerdict(wheel(0, {deltaX: 150}))).toBeNull()
    })

    it('a chosen device wins over detection until set back to auto', () => {
        const nav = navigation()
        const seen: string[] = []
        nav.onDeviceChange = (d, s) => seen.push(`${d}:${s}`)
        ;(nav as any)._onWheel({...wheel(2.5), preventDefault() {}, stopPropagation() {}})
        expect([nav.device, nav.deviceSource]).toEqual(['trackpad', 'detected'])
        nav.setDevice('mouse')
        ;(nav as any)._onWheel({...wheel(1.5), preventDefault() {}, stopPropagation() {}})
        expect([nav.device, nav.deviceSource]).toEqual(['mouse', 'chosen'])
        nav.setDevice('auto')
        expect([nav.device, nav.deviceSource]).toEqual(['trackpad', 'detected'])
        expect(seen).toEqual(['trackpad:detected', 'mouse:chosen', 'trackpad:detected'])
    })
})
