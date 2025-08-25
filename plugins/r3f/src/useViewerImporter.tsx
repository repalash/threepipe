import {ViewerRef} from './ViewerContextInternal.ts'
import {ImportAssetOptions, ImportResult} from 'threepipe'
import {clear, preload, suspend} from 'suspend-react'

type InputLike = string /* | string[]*/ | Readonly<string/* | string[]*/>

function loadingFn(
    viewer: ViewerRef,
    options: ImportAssetOptions,
    onImport?: (results: (ImportResult | undefined)[] | undefined) => void,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void, // todo
) {
    return async function(input: string) {
        // Go through the urls and load them
        const results = await viewer.current?.assetManager.importer.import(input, options)
        if (onImport) onImport(results)
        return results
    }
}

/**
 * Synchronously loads and caches assets with a viewer asset importer.
 *
 * Note: this hook's caller must be wrapped with `React.Suspense`
 */
export function useViewerImporter<I extends InputLike>(
    viewer: ViewerRef,
    input: I,
    options: ImportAssetOptions,
    onImport?: (obj: (ImportResult | undefined)[] | undefined) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
) {
    // Use suspense to load async assets
    const results = suspend(loadingFn(viewer, options, onImport, onProgress), [input])
    // Return the object(s)
    return results
}

/**
 * Preloads an asset into cache as a side-effect.
 */
useViewerImporter.preload = function <I extends InputLike>(
    viewer: ViewerRef,
    input: I,
    options: ImportAssetOptions,
    onImport: (obj: (ImportResult | undefined)[] | undefined) => void,
): void {
    return preload(loadingFn(viewer, options, onImport), [input])
}

/**
 * Removes a loaded asset from cache.
 */
useViewerImporter.clear = function <I extends InputLike>(
    input: I,
): void {
    const keys = (Array.isArray(input) ? input : [input]) as string[]
    return clear([...keys])
}
