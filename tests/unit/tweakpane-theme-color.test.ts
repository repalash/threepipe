import {describe, expect, test} from 'vitest'
import {defaultThemeColor, readThemeColor, ThemeDefaultStorageKey, ThemeStorageKey, writeThemeColor} from '../../plugins/tweakpane/src/themeColor'

function storage(values: Record<string, string> = {}) {
    const map = new Map(Object.entries(values))
    return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        map,
    }
}

describe('Tweakpane colour mode in localStorage', () => {
    test('the default follows the system setting', () => {
        expect([defaultThemeColor(false), defaultThemeColor(true)]).toEqual(['clean', 'clean-dark'])
    })

    test('nothing kept, no storage, or an unknown value: the default', () => {
        expect(readThemeColor(storage(), 'clean')).toBe('clean')
        expect(readThemeColor(undefined, 'clean-dark')).toBe('clean-dark')
        expect(readThemeColor(storage({[ThemeStorageKey]: 'purple'}), 'clean')).toBe('clean')
    })

    test('a kept value that was the default when it was written follows a new default', () => {
        const s = storage()
        writeThemeColor(s, 'clean', 'clean') // the first visit writes the default
        expect(s.map.get(ThemeDefaultStorageKey)).toBe('clean')
        expect(readThemeColor(s, 'clean')).toBe('clean')
        expect(readThemeColor(s, 'clean-dark')).toBe('clean-dark') // the system setting or the default changed
    })

    test('a colour mode that the person picked stays when the default changes', () => {
        const s = storage()
        writeThemeColor(s, 'blue', 'clean')
        expect(readThemeColor(s, 'clean')).toBe('blue')
        expect(readThemeColor(s, 'clean-dark')).toBe('blue')
    })

    test('a value of an earlier version (no default kept) counts as a pick unless it was an earlier default', () => {
        for (const old of ['blue', 'dark', 'light']) expect(readThemeColor(storage({[ThemeStorageKey]: old}), 'clean')).toBe('clean')
        expect(readThemeColor(storage({[ThemeStorageKey]: 'black'}), 'clean')).toBe('black')
        expect(readThemeColor(storage({[ThemeStorageKey]: 'clean-dark'}), 'clean')).toBe('clean-dark')
    })
})
