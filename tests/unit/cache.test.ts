/**
 * Unit test for overrideThreeCache (Node) - the three.js Cache patch that persists FileLoader responses in a CacheStorage.
 */
import {afterEach, describe, expect, it, vi} from 'vitest'
import {Cache as threeCache} from 'three'
import {overrideThreeCache} from '../../src/three/utils/cache'

// Minimal CacheStorage `Cache`, only the methods used by overrideThreeCache.
class FakeCache {
    entries = new Map<string, Response>()
    async match(url: string) {
        return this.entries.get(url)?.clone()
    }
    async put(url: string, response: Response) {
        this.entries.set(url, response)
    }
    async delete(url: string) {
        return this.entries.delete(url)
    }
}
const makeCache = () => new FakeCache() as FakeCache & Cache

const origGet = threeCache.get
const origAdd = threeCache.add
const origRemove = threeCache.remove

afterEach(() => {
    overrideThreeCache(undefined)
    vi.restoreAllMocks()
})

describe('overrideThreeCache', () => {
    it('does not patch without a storage, get returns a promise for FileLoader', async() => {
        overrideThreeCache(undefined)
        expect(threeCache.get).toBe(origGet)
        const res = threeCache.get('https://example.com/a.glb', 'arraybuffer')
        expect(res).toBeInstanceOf(Promise)
        expect(await res).toBeUndefined()
    })

    it('restores the original functions when the storage is changed or removed', () => {
        const a = makeCache()
        overrideThreeCache(a)
        const patchedGet = threeCache.get
        expect(patchedGet).not.toBe(origGet)
        overrideThreeCache(a) // same storage, no re-patch
        expect(threeCache.get).toBe(patchedGet)

        overrideThreeCache(makeCache())
        expect(threeCache.get).not.toBe(patchedGet)
        expect((threeCache as any)._orig.get).toBe(origGet)

        overrideThreeCache(undefined)
        overrideThreeCache(undefined)
        expect(threeCache.get).toBe(origGet)
        expect(threeCache.add).toBe(origAdd)
        expect(threeCache.remove).toBe(origRemove)
        expect((threeCache as any)._orig).toBeUndefined()
    })

    it('round-trips arraybuffer, text and json payloads', async() => {
        const cache = makeCache()
        overrideThreeCache(cache)

        await threeCache.add('https://example.com/a.bin', new Uint8Array([1, 2, 3]).buffer, 'arraybuffer')
        expect(new Uint8Array(await threeCache.get('https://example.com/a.bin', 'arraybuffer'))).toEqual(new Uint8Array([1, 2, 3]))

        await threeCache.add('https://example.com/a.txt', 'hello', 'text')
        expect(await threeCache.get('https://example.com/a.txt', 'text')).toBe('hello')

        // FileLoader adds the parsed object for json
        await threeCache.add('https://example.com/a.json', {a: 1, b: ['c']}, 'json')
        expect(await threeCache.get('https://example.com/a.json', 'json')).toEqual({a: 1, b: ['c']})
    })

    it('does not store empty payloads', async() => {
        const cache = makeCache()
        overrideThreeCache(cache)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await threeCache.add('https://example.com/a.bin', new ArrayBuffer(0), 'arraybuffer')
        await threeCache.add('https://example.com/a.txt', '', 'text')
        expect(cache.entries.size).toBe(0)
        expect(warn).toHaveBeenCalledTimes(2)
    })

    it('removes empty and undecodable entries and resolves to undefined', async() => {
        const cache = makeCache()
        overrideThreeCache(cache)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await cache.put('https://example.com/a.bin', new Response(new ArrayBuffer(0)))
        await cache.put('https://example.com/empty.json', new Response(''))
        await cache.put('https://example.com/bad.json', new Response('[object Object]'))

        expect(await threeCache.get('https://example.com/a.bin', 'arraybuffer')).toBeUndefined()
        expect(await threeCache.get('https://example.com/empty.json', 'json')).toBeUndefined()
        expect(await threeCache.get('https://example.com/bad.json', 'json')).toBeUndefined()
        expect(cache.entries.size).toBe(0)
        expect(warn).toHaveBeenCalledTimes(3)
    })

    it('skips only blob: urls, not paths starting with blob', async() => {
        const cache = makeCache()
        overrideThreeCache(cache)

        await threeCache.add('blob:https://example.com/uuid', 'data', 'text')
        expect(cache.entries.size).toBe(0)
        expect(await threeCache.get('blob:https://example.com/uuid', 'text')).toBeUndefined()

        await threeCache.add('blobstore/a.txt', 'data', 'text')
        expect(await threeCache.get('blobstore/a.txt', 'text')).toBe('data')
    })
})
