/**
 * The loop cut modal (`loopcut.ts`) against `loopcut_init` / `loopcut_modal` (`editmesh_loopcut.cc`):
 * hover previews the ring, the wheel and PageUp/PageDown step the cuts (Alt the smoothness), numbers
 * type them, Enter or a left click confirm, Esc (on release) or a right click cancel.
 */

import {describe, expect, it} from 'vitest'
import {BMEdge, BMesh, bmFromMesh, primitiveCube} from '@threepipe/mesh-kernel'
import {LoopCutModal} from '../src/loopcut'

function cubeEdge(): {bm: BMesh, edge: BMEdge} {
    const bm = bmFromMesh(primitiveCube())
    // A vertical edge: its ring is the four vertical edges.
    const edge = [...bm.edges].find(e => e.v1.x === e.v2.x && e.v1.y === e.v2.y)!
    return {bm, edge}
}

const key = (code: string, press = true, mods: {alt?: boolean} = {}) => ({
    code, key: code.startsWith('Digit') ? code.slice(5) : code, ctrl: false, shift: false, alt: !!mods.alt, press,
})

describe('LoopCutModal (editmesh_loopcut.cc)', () => {
    it('previews the ring of the edge under the cursor, one line per ring segment per cut', () => {
        const {edge} = cubeEdge()
        let hovered: BMEdge | null = edge
        const lc = new LoopCutModal({pickEdge: () => hovered}, 10, 10)
        expect(lc.edge).toBe(edge)
        // `loopcut_init` previews with one line whatever the cut count.
        expect(lc.preview.edges.length).toBe(4)
        expect(lc.status).toBe('Cuts: 1, Smoothness: 0.00')
        hovered = null
        lc.mouseMove(500, 500)
        expect(lc.edge).toBeNull()
        expect(lc.preview.edges.length).toBe(0)
    })

    it('the wheel and PageUp/PageDown step the cuts, never below one; Alt steps the smoothness', () => {
        const {edge} = cubeEdge()
        const lc = new LoopCutModal({pickEdge: () => edge}, 0, 0)
        lc.wheel(true, false)
        expect(lc.numberCuts).toBe(2)
        expect(lc.preview.edges.length).toBe(8)
        lc.key(key('PageUp'))
        expect(lc.numberCuts).toBe(3)
        expect(lc.status).toBe('Cuts: 3, Smoothness: 0.00')
        lc.key(key('PageDown'))
        lc.key(key('PageDown'))
        lc.key(key('PageDown'))
        expect(lc.numberCuts).toBe(1)
        lc.wheel(true, true)
        expect(lc.smoothness).toBeCloseTo(0.05, 9)
        expect(lc.numberCuts).toBe(1)
        // Releases do nothing (`if (event->val == KM_RELEASE) break`).
        lc.key(key('PageUp', false))
        expect(lc.numberCuts).toBe(1)
    })

    it('typed numbers set the cuts (NUM_NO_FRACTION) and Tab moves to the smoothness', () => {
        const {edge} = cubeEdge()
        const lc = new LoopCutModal({pickEdge: () => edge}, 0, 0)
        lc.key(key('Digit4'))
        expect(lc.numberCuts).toBe(4)
        expect(lc.preview.edges.length).toBe(16)
        lc.key({...key('Tab'), key: 'Tab'})
        lc.key(key('Digit1'))
        expect(lc.smoothness).toBe(1)
        expect(lc.numberCuts).toBe(4)
    })

    it('Enter and a left click confirm; Esc cancels on release; a right click cancels', () => {
        const {edge} = cubeEdge()
        const a = new LoopCutModal({pickEdge: () => edge}, 0, 0)
        a.key(key('Escape'))
        expect(a.state).toBe('running')
        a.key(key('Escape', false))
        expect(a.state).toBe('cancel')

        const b = new LoopCutModal({pickEdge: () => edge}, 0, 0)
        b.key(key('Enter'))
        expect(b.state).toBe('confirm')

        const c = new LoopCutModal({pickEdge: () => edge}, 0, 0)
        c.pointerDown(0)
        expect(c.state).toBe('confirm')

        const d = new LoopCutModal({pickEdge: () => edge}, 0, 0)
        d.pointerDown(2)
        expect(d.state).toBe('cancel')
    })

    it('smoothness is clamped to SUBD_SMOOTH_MAX', () => {
        const {edge} = cubeEdge()
        const lc = new LoopCutModal({pickEdge: () => edge, smoothness: 3.99}, 0, 0)
        lc.wheel(true, true)
        lc.wheel(true, true)
        expect(lc.smoothness).toBe(4)
    })
})
