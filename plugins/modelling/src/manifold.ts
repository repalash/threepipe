/**
 * The Manifold library for booleans (D6: Blender's own Manifold solver since 4.5; `manifold-3d@3.4.1`, the version
 * Blender pins). Loaded on first use, because it is a 500 kB WebAssembly module most sessions never need.
 *
 * `loadManifold()` resolves the `manifold-3d` package; a page that serves the module from elsewhere can pass
 * `locateFile` for the `.wasm`, and a host that already has an instance can hand it over with `setManifold()`.
 */

import type {ManifoldApi} from '@threepipe/mesh-kernel'

let api: ManifoldApi | null = null
let pending: Promise<ManifoldApi> | null = null

/** The loaded module, or null before `loadManifold()` has finished. */
export function getManifold(): ManifoldApi | null {
    return api
}

/** Use an already initialised `manifold-3d` module. */
export function setManifold(module: ManifoldApi): void {
    api = module
}

/** Load and initialise `manifold-3d` once. */
export function loadManifold(options: {locateFile?: (path: string) => string} = {}): Promise<ManifoldApi> {
    if (api) return Promise.resolve(api)
    pending ??= (async() => {
        const Module = (await import('manifold-3d')).default as unknown as (o?: object) => Promise<ManifoldApi & {setup(): void}>
        const wasm = await Module(options.locateFile ? {locateFile: options.locateFile} : undefined)
        wasm.setup()
        api = wasm
        return wasm
    })()
    return pending
}
