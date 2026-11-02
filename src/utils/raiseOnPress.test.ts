import {describe, expect, test} from 'vitest'
import {raiseOnPress} from './raiseOnPress'

/** A panel element with listeners and the inline style properties that raiseOnPress sets */
function panel() {
    const listeners: Record<string, ((e: any) => void)[]> = {}
    const props = new Map<string, string>()
    const el = {
        style: {
            setProperty: (k: string, v: string) => props.set(k, v),
            removeProperty: (k: string) => props.delete(k),
        },
        addEventListener: (t: string, f: any) => (listeners[t] ??= []).push(f),
        removeEventListener: (t: string, f: any) => listeners[t] = (listeners[t] ?? []).filter(x => x !== f),
        press: () => (listeners.pointerdown ?? []).forEach(f => f({type: 'pointerdown'})),
        get raise() {
            return props.get('--ui-raise')
        },
    }
    return el
}

describe('raiseOnPress', () => {
    test('a pressed panel comes to the front; the others keep their order behind it', () => {
        const a = panel(), b = panel(), c = panel()
        const off = [a, b, c].map(p => raiseOnPress(p as any))
        // registered later: in front
        expect([a.raise, b.raise, c.raise]).toEqual(['0', '1', '2'])
        a.press()
        expect([b.raise, c.raise, a.raise]).toEqual(['0', '1', '2'])
        a.press() // already in front: no change
        expect([b.raise, c.raise, a.raise]).toEqual(['0', '1', '2'])
        c.press()
        expect([b.raise, a.raise, c.raise]).toEqual(['0', '1', '2'])
        off.forEach(f => f())
    })

    test('unregistered: the panel loses its place and its listener, the others close the gap', () => {
        const a = panel(), b = panel(), c = panel()
        const [offA, offB, offC] = [a, b, c].map(p => raiseOnPress(p as any))
        offB()
        expect(b.raise).toBeUndefined()
        expect([a.raise, c.raise]).toEqual(['0', '1'])
        b.press()
        expect([a.raise, c.raise]).toEqual(['0', '1'])
        offB() // twice: nothing
        offA()
        offC()
    })
})
