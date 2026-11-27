/**
 * DRACOLoader2 with three.js r185's DRACOLoader, which keeps the URL of each decoder file (decoderPaths) and passes
 * URLs to _loadLibrary: the libraries set by file name (SetDecoderJsString, SetDecoderWasmBinary) are still found, and
 * the encoder files load from the decoder folder.
 */
import {afterEach, beforeAll, describe, expect, test, vi} from 'vitest'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

afterEach(() => {
    tp.DRACOLoader2.LibraryValueMap = {}
})

describe('DRACOLoader2', () => {
    test('a library set by file name is found by its URL', async() => {
        tp.DRACOLoader2.SetDecoderJsString('decoder js')
        const loader = new tp.DRACOLoader2()
        expect(loader.decoderPath).toBe(tp.DRACOLoader2.DRACO_LIBRARY_PATH)
        const url = (loader as any).decoderPaths.dep_js
        expect(url).toBe(tp.DRACOLoader2.DRACO_LIBRARY_PATH + 'draco_decoder.js')
        await expect(loader._loadLibrary(url, 'text')).resolves.toBe('decoder js')
    })
    test('the encoder files load from the decoder folder', async() => {
        const loader = new tp.DRACOLoader2()
        loader.setDecoderPath('https://example.com/draco/')
        const load = vi.spyOn(loader, '_loadLibrary').mockResolvedValue('')
        await loader.initEncoder().catch(() => undefined) // the mocked library is not an encoder
        expect(load).toHaveBeenCalledWith('https://example.com/draco/draco_encoder.js', 'text')
    })
})
