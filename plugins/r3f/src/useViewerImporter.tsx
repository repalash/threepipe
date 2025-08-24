import {ViewerRef} from './ViewerContextInternal.ts'
import {ImportAddOptions, ImportAssetOptions} from 'threepipe'
import {suspend, preload, clear} from 'suspend-react'

type InputLike = string | string[] | Readonly<string | string[]>

function loadingFn(
    viewer: ViewerRef,
    options: ImportAssetOptions,
    add: boolean,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void, // todo
) {
    return async function(...input: string[]) {
        // Go through the urls and load them
        return Promise.all(input.map(async i=>{
            return add ? viewer.current?.load(i, options) : viewer.current?.assetManager.importer.import(i, options) || Promise.resolve(undefined)
        }))
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
    options: ImportAssetOptions|ImportAddOptions,
    add: boolean,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
) {
    // Use suspense to load async assets
    const keys = (Array.isArray(input) ? input : [input]) as string[]
    const results = suspend(loadingFn(viewer, options, add, onProgress), [...keys])
    // Return the object(s)
    return Array.isArray(input) ? results : results[0]
}

/**
 * Preloads an asset into cache as a side-effect.
 */
useViewerImporter.preload = function <I extends InputLike>(
    viewer: ViewerRef,
    input: I,
    options: ImportAssetOptions,
    add: boolean,
): void {
    const keys = (Array.isArray(input) ? input : [input]) as string[]
    return preload(loadingFn(viewer, options, add), [...keys])
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
