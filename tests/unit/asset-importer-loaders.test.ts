/**
 * Unit tests for the loaders created and cached by AssetImporter (Node).
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {Loader, Texture} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

class LoaderA extends Loader {
    disposed = false
    dispose() {
        this.disposed = true
    }
}
class LoaderB extends LoaderA {}

describe('AssetImporter loaders', () => {
    it('uses the same loader for files of an importer', () => {
        const importer = new tp.AssetImporter()
        importer.addImporter(new tp.Importer(LoaderA, ['abc'], ['model/abc'], true))
        const loader = importer.registerFile('a.abc')
        expect(loader).toBeInstanceOf(LoaderA)
        expect(importer.registerFile('folder/b.ABC')).toBe(loader)
        expect(importer.registerFile('data:model/abc;base64,AAAA')).toBe(loader)
    })

    it('does not use the loader of a removed importer', () => {
        const importer = new tp.AssetImporter()
        const importerA = new tp.Importer(LoaderA, ['abc'], ['model/abc'], true)
        importer.addImporter(importerA)
        const loaderA = importer.registerFile('a.abc') as LoaderA

        // replace the importer for the extension
        importer.removeImporter(importerA)
        expect(loaderA.disposed).toBe(true)
        expect(importer.registerFile('b.abc')).toBeUndefined()

        const importerB = new tp.Importer(LoaderB, ['abc'], ['model/abc'], true)
        importer.addImporter(importerB)
        const loaderB = importer.registerFile('c.abc')
        expect(loaderB).toBeInstanceOf(LoaderB)
        expect(importer.registerFile('data:model/abc;base64,AAAA')).toBe(loaderB)

        // and back
        importer.removeImporter(importerB)
        importer.addImporter(importerA)
        const loaderA2 = importer.registerFile('d.abc') as LoaderA
        expect(loaderA2).toBeInstanceOf(LoaderA)
        expect(loaderA2).not.toBeInstanceOf(LoaderB)
        expect(loaderA2).not.toBe(loaderA)
        expect(loaderA2.disposed).toBe(false)
    })

    it('keeps the loaders of other importers when one is removed', () => {
        const importer = new tp.AssetImporter()
        const importerA = new tp.Importer(LoaderA, ['abc'], [], true)
        const importerB = new tp.Importer(LoaderB, ['xyz'], [], true)
        importer.addImporter(importerA, importerB)
        const loaderA = importer.registerFile('a.abc') as LoaderA
        const loaderB = importer.registerFile('a.xyz') as LoaderB

        importer.removeImporter(importerA)
        expect(loaderA.disposed).toBe(true)
        expect(loaderB.disposed).toBe(false)
        expect(importer.registerFile('b.xyz')).toBe(loaderB)
    })

    it('creates new loaders after clearLoaderCache', () => {
        const importer = new tp.AssetImporter()
        importer.addImporter(new tp.Importer(LoaderA, ['abc'], [], true))
        const loader = importer.registerFile('a.abc') as LoaderA

        importer.clearLoaderCache()
        expect(loader.disposed).toBe(true)
        const loader2 = importer.registerFile('b.abc') as LoaderA
        expect(loader2).toBeInstanceOf(LoaderA)
        expect(loader2).not.toBe(loader)
        expect(loader2.disposed).toBe(false)
    })

    it('uses the loader of a given extension for a path with another extension', () => {
        // like a url ending in .zip loaded with `fileExtension: 'acgzip'`, after a .zip was loaded
        const importer = new tp.AssetImporter()
        importer.addImporter(new tp.Importer(LoaderA, ['zip'], [], true), new tp.Importer(LoaderB, ['special'], [], true))
        const loaderB = importer.registerFile('https://example.com/a.zip', undefined, 'special')
        expect(loaderB).toBeInstanceOf(LoaderB)
        const loaderA = importer.registerFile('https://example.com/b.zip')
        expect(loaderA).toBeInstanceOf(LoaderA)
        expect(importer.registerFile('https://example.com/c.zip', undefined, 'special')).toBe(loaderB)
        expect(importer.registerFile('https://example.com/d.zip')).toBe(loaderA)
    })

    it('a texture from a file has no rootPath of its file name, a texture from a url keeps its url', async() => {
        // like TextureLoader of the three.js fork: userData.rootPath is the path it loaded
        class TexLoader extends Loader {
            async loadAsync(url: string) {
                const t = new Texture()
                t.userData.rootPath = url
                return t
            }
        }
        const importer = new tp.AssetImporter()
        importer.addImporter(new tp.Importer(TexLoader, ['tex'], [], false))
        const fromFile = await importer.importFile<any>(new File([new Uint8Array(1)], 'a.tex'))
        expect(fromFile[0]?.isTexture).toBe(true)
        expect(fromFile[0].userData.rootPath).toBeUndefined()
        const fromZip = await importer.importFiles(new Map([['b.tex', new File([new Uint8Array(1)], 'b.tex')]]))
        expect(fromZip.get('b.tex')?.[0]?.userData.rootPath).toBeUndefined()
        const fromUrl = await importer.importSingle<any>('https://example.com/c.tex')
        expect(fromUrl.userData.rootPath).toBe('https://example.com/c.tex')
    })

    it('says done for a file loaded from the database, also without processRaw', async() => {
        class TexLoader extends Loader {
            async loadAsync() {
                return new Texture()
            }
        }
        const importer = new tp.AssetImporter()
        importer.addImporter(new tp.Importer(TexLoader, ['tex'], [], false))
        const states = new Map<string, string>()
        importer.addEventListener('importFile', e => states.set(e.path, e.state))
        await importer.importFiles(new Map([['a.tex', new File([new Uint8Array(1)], 'a.tex')]]), {processRaw: false})
        expect(states.get('a.tex')).toBe('done')
    })
})
