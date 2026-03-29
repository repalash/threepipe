import {describe, test, expect} from 'vitest'
import {copyUserData} from './serialization'

describe('copyUserData', () => {
    test('copies primitive values', () => {
        const dest: any = {}
        const source = {name: 'test', count: 42, flag: true}
        copyUserData(dest, source)
        expect(dest.name).toBe('test')
        expect(dest.count).toBe(42)
        expect(dest.flag).toBe(true)
    })

    test('deep copies plain objects', () => {
        const dest: any = {}
        const source = {nested: {a: 1, b: 2}}
        copyUserData(dest, source)
        expect(dest.nested).toEqual({a: 1, b: 2})
        // should be a deep copy, not a reference
        expect(dest.nested).not.toBe(source.nested)
    })

    test('deep copies arrays', () => {
        const dest: any = {}
        const source = {items: [1, 2, 3]}
        copyUserData(dest, source)
        expect(dest.items).toEqual([1, 2, 3])
        expect(dest.items).not.toBe(source.items)
    })

    test('skips keys starting with __', () => {
        const dest: any = {}
        const source = {visible: true, __internal: 'secret'}
        copyUserData(dest, source)
        expect(dest.visible).toBe(true)
        expect(dest.__internal).toBeUndefined()
    })

    test('skips function values', () => {
        const dest: any = {}
        const source = {name: 'test', callback: () => {}}
        copyUserData(dest, source)
        expect(dest.name).toBe('test')
        expect(dest.callback).toBeUndefined()
    })

    test('respects ignoredKeysInRoot', () => {
        const dest: any = {}
        const source = {uuid: '123', name: 'test', data: 'keep'}
        copyUserData(dest, source, ['uuid'])
        expect(dest.uuid).toBeUndefined()
        expect(dest.name).toBe('test')
        expect(dest.data).toBe('keep')
    })

    test('calls clone() on objects that have it', () => {
        const cloneable = {
            value: 42,
            clone() { return {value: this.value, clone: this.clone} },
        }
        const dest: any = {}
        const source = {obj: cloneable}
        copyUserData(dest, source)
        expect(dest.obj.value).toBe(42)
        expect(dest.obj).not.toBe(cloneable)
    })

    test('skips texture-like objects (isTexture)', () => {
        const dest: any = {}
        const source = {tex: {isTexture: true, name: 'diffuse', clone: () => ({})}}
        copyUserData(dest, source)
        // should reference the same object, not clone
        expect(dest.tex).toBe(source.tex)
    })

    test('skips Object3D-like objects (isObject3D)', () => {
        const dest: any = {}
        const source = {obj: {isObject3D: true, name: 'mesh', clone: () => ({})}}
        copyUserData(dest, source)
        expect(dest.obj).toBe(source.obj)
    })

    test('skips objects with userDataSkipClone', () => {
        const dest: any = {}
        const source = {data: {userDataSkipClone: true, value: 1, clone: () => ({})}}
        copyUserData(dest, source)
        expect(dest.data).toBe(source.data)
    })

    test('returns dest unchanged when source is null/undefined', () => {
        const dest = {existing: true}
        expect(copyUserData(dest, null)).toBe(dest)
        expect(copyUserData(dest, undefined)).toBe(dest)
    })

    test('handles deeply nested structures', () => {
        const dest: any = {}
        const source = {a: {b: {c: {d: 'deep'}}}}
        copyUserData(dest, source)
        expect(dest.a.b.c.d).toBe('deep')
        expect(dest.a).not.toBe(source.a)
        expect(dest.a.b).not.toBe(source.a.b)
    })

    test('skips isMaterial objects (assigns by reference)', () => {
        const material = {isMaterial: true, name: 'standard', clone: () => ({})}
        const dest: any = {}
        const source = {mat: material}
        copyUserData(dest, source)
        // isMaterial is in the skipClone check, so it should be assigned by reference
        expect(dest.mat).toBe(material)
    })

    test('skips isBufferGeometry objects (assigns by reference)', () => {
        const geom = {isBufferGeometry: true, name: 'box', clone: () => ({})}
        const dest: any = {}
        const source = {geo: geom}
        copyUserData(dest, source)
        // isBufferGeometry is in the skipClone check, so it should be assigned by reference
        expect(dest.geo).toBe(geom)
    })

    test('skips when dest[key] is already a function', () => {
        const dest: any = {callback: () => 'original'}
        const source = {callback: 'newValue'}
        copyUserData(dest, source)
        // Line 515: typeof dest[key] === 'function' => continue
        expect(typeof dest.callback).toBe('function')
        expect(dest.callback()).toBe('original')
    })

    test('deep copies nested array of objects', () => {
        const dest: any = {}
        const source = {items: [{a: 1}, {b: 2}]}
        copyUserData(dest, source)
        expect(dest.items).toEqual([{a: 1}, {b: 2}])
        expect(dest.items).not.toBe(source.items)
        expect(dest.items[0]).not.toBe(source.items[0])
        expect(dest.items[1]).not.toBe(source.items[1])
    })

    test('symbol keys in ignoredKeysInRoot are respected', () => {
        const sym = Symbol('secret')
        const dest: any = {}
        const source = {visible: true}
        // Symbol keys in ignoredKeysInRoot won't actually match because Object.keys() only returns string keys.
        // This test documents that behavior: symbol keys in source are never iterated by Object.keys.
        ;(source as any)[sym] = 'hidden'
        copyUserData(dest, source, [sym])
        expect(dest.visible).toBe(true)
        // Symbol-keyed properties are never copied because Object.keys() doesn't return them
        expect(dest[sym]).toBeUndefined()
    })
})
