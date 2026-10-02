/**
 * Unit tests for the loaders created and cached by AssetImporter (Node).
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {Loader} from 'three'

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
})
