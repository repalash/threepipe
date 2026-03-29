import {describe, test, expect} from 'vitest'
import {isNonRelativeUrl, getPropDesc} from './browser-helpers'

describe('isNonRelativeUrl', () => {
    test('returns true for http URLs', () => {
        expect(isNonRelativeUrl('http://example.com/model.glb')).toBe(true)
    })

    test('returns true for https URLs', () => {
        expect(isNonRelativeUrl('https://samples.threepipe.org/file.hdr')).toBe(true)
    })

    test('returns true for data URLs', () => {
        expect(isNonRelativeUrl('data:image/png;base64,abc')).toBe(true)
    })

    test('returns true for asset:// URLs', () => {
        expect(isNonRelativeUrl('asset://model.glb')).toBe(true)
    })

    test('returns true for domain-relative URLs', () => {
        expect(isNonRelativeUrl('/assets/model.glb')).toBe(true)
    })

    test('returns true for protocol-relative URLs', () => {
        expect(isNonRelativeUrl('//cdn.example.com/model.glb')).toBe(true)
    })

    test('returns false for relative paths', () => {
        expect(isNonRelativeUrl('models/cube.glb')).toBe(false)
        expect(isNonRelativeUrl('./models/cube.glb')).toBe(false)
        expect(isNonRelativeUrl('../assets/texture.png')).toBe(false)
    })

    test('returns false for blob URLs', () => {
        expect(isNonRelativeUrl('blob:http://localhost/abc')).toBe(false)
    })

    test('empty string returns false', () => {
        expect(isNonRelativeUrl('')).toBe(false)
    })

    test('just "/" returns true (domain-relative)', () => {
        expect(isNonRelativeUrl('/')).toBe(true)
    })

    test('ftp:// protocol returns false (not in the check list)', () => {
        expect(isNonRelativeUrl('ftp://files.example.com/model.glb')).toBe(false)
    })

    test('URL with spaces returns false for relative path', () => {
        expect(isNonRelativeUrl('path with spaces/model.glb')).toBe(false)
    })

    test('URL with spaces starting with http is still true', () => {
        expect(isNonRelativeUrl('http://example.com/path with spaces/model.glb')).toBe(true)
    })
})

describe('getPropDesc', () => {
    test('finds property descriptor on prototype', () => {
        class Base {
            get value() { return 42 }
        }
        const obj = new Base()
        const {proto, protoDesc} = getPropDesc(obj, 'value')
        expect(protoDesc).toBeDefined()
        expect(protoDesc!.get).toBeDefined()
        expect(proto).toBe(Base.prototype)
    })

    test('finds property on parent prototype chain', () => {
        class Base {
            get value() { return 1 }
        }
        class Child extends Base {}
        const obj = new Child()
        const {protoDesc} = getPropDesc(obj, 'value')
        expect(protoDesc).toBeDefined()
        expect(protoDesc!.get).toBeDefined()
    })

    test('returns undefined for non-existent property', () => {
        const obj = {a: 1}
        const {protoDesc} = getPropDesc(obj, 'nonexistent' as any)
        expect(protoDesc).toBeUndefined()
    })

    test('deeply nested prototype chain (3+ levels)', () => {
        class GrandBase {
            get deep() { return 'grand' }
        }
        class Base extends GrandBase {}
        class Child extends Base {}
        class GrandChild extends Child {}
        const obj = new GrandChild()
        const {proto, protoDesc} = getPropDesc(obj, 'deep' as any)
        expect(protoDesc).toBeDefined()
        expect(protoDesc!.get).toBeDefined()
        // Should find it on GrandBase.prototype
        expect(proto).toBe(GrandBase.prototype)
    })

    test('property defined directly on object (not prototype) is not found', () => {
        // getPropDesc starts by calling Object.getPrototypeOf(obj) then checks,
        // so own properties defined with Object.defineProperty on the instance itself
        // are not found — it only walks prototypes.
        const obj: any = {}
        Object.defineProperty(obj, 'ownProp', {get: () => 42})
        const {protoDesc} = getPropDesc(obj, 'ownProp' as any)
        // The function skips the object itself, only checks prototypes.
        // Object.getPrototypeOf({}) is Object.prototype which doesn't have 'ownProp'
        expect(protoDesc).toBeUndefined()
    })
})
