/**
 * `.blend` loading for plain three.js projects, without threepipe.
 *
 * ```ts
 * import {BlendLoader} from '@threepipe/plugin-blend-importer/three'
 *
 * const {scene} = await new BlendLoader().loadAsync('model.blend')
 * myScene.add(scene)
 * ```
 *
 * This entry imports `three` (as a namespace) and nothing from threepipe, so it uses whatever three.js
 * version the project has. Features that changed between versions are detected at runtime (e.g.
 * `texture.colorSpace` on r152+, `texture.encoding` before).
 *
 * @module
 */
import * as THREE from 'three'
import type {Group, LoadingManager, Texture} from 'three'
import {gunzipSync} from 'fflate'
import {parseBlend} from './js-blend/main.js'
import {createObjects} from './loader'
import {createCtx, srgbSetter} from './loader/ctx'
import {decompressBlend} from './decompress'
import type {BlendFileData} from './blendFile'

/** The parsed `.blend`, with `scene` the three.js `Group` holding its objects. */
export type BlendFile = BlendFileData<Group>

/** What {@link BlendLoader} resolves with. */
export interface BlendLoaderResult {
    /** A `Group` holding the file's objects (meshes, lights, cameras, empties), Y-up. */
    scene: Group
    /** The parsed file: embedded thumbnail, raw DNA structs, etc. See {@link BlendFile}. */
    blend: BlendFile
}

/**
 * Loads an external (file-path) image a Blender material references.
 *
 * Return the texture three.js-style, synchronously, filling in when its loader finishes (e.g.
 * `(url) => new EXRLoader().load(url)`): it is used as-is, of whatever class. Or return a promise of
 * an image `Texture`, which the loader waits for before resolving. Return or resolve null to skip.
 *
 * @param url - the image's URL, already resolved against the `.blend`'s location.
 * @param info - `path`: the path as written in the `.blend` (after `//` and `\` are normalised);
 * `srgb`: true for colour maps (base colour, emission), false for data maps (roughness, normal...).
 */
export type BlendTextureLoadFunction = (url: string, info: {path: string, srgb: boolean}) => Texture | null | Promise<Texture | null>

const three: any = THREE
const setSRGB = srgbSetter(three)

// `LoaderUtils.extractUrlBase`, which not every three.js version has.
function urlBase(url: string): string {
    const i = url.replace(/[?#].*$/, '').lastIndexOf('/')
    return i === -1 ? './' : url.slice(0, i + 1)
}

/**
 * three.js loader for Blender `.blend` files: uncompressed, gzip (Blender 2.x) and zstd (Blender
 * 3.0+) files, Blender 2.5 to 5.x. Meshes keep Blender's triangulation, flat/smooth shading, Auto
 * Smooth and sharp edges, UVs and material slots. Principled BSDF materials map to
 * `MeshPhysicalMaterial` the way Blender's glTF exporter maps them, with packed and external textures.
 * Lights, cameras and the object hierarchy are kept.
 *
 * Use like any three.js loader: `load(url, onLoad, onProgress, onError)`, `loadAsync(url)`, or
 * `parse(arrayBuffer, resourcePath, onLoad, onError)`. `setPath`, `setResourcePath`,
 * `setCrossOrigin`, `setRequestHeader`, `setWithCredentials` and the `LoadingManager` apply as for
 * other three.js loaders.
 *
 * External textures load with three's `TextureLoader` (PNG, JPEG, WebP...) relative to the `.blend`.
 * For other formats (EXR, HDR, KTX2), pass a loader with {@link setTextureLoader}.
 */
export class BlendLoader extends (three.Loader as typeof THREE.Loader) {
    private _textureLoader: BlendTextureLoadFunction | null = null

    constructor(manager?: LoadingManager) {
        super(manager)
    }

    /**
     * Load external images with your own function instead of three's `TextureLoader`, e.g. to support
     * EXR or HDR maps with `EXRLoader`/`RGBELoader`. See {@link BlendTextureLoadFunction}.
     */
    setTextureLoader(fn: BlendTextureLoadFunction | null): this {
        this._textureLoader = fn
        return this
    }

    load(url: string, onLoad: (result: BlendLoaderResult) => void, onProgress?: (event: ProgressEvent) => void, onError?: (err: unknown) => void): void {
        const {manager, path, requestHeader, withCredentials} = this as any
        let resourcePath: string
        if ((this as any).resourcePath) resourcePath = (this as any).resourcePath
        else if (path) resourcePath = urlBase(path + url)
        else resourcePath = urlBase(url)

        manager.itemStart(url)
        const fail = (e: unknown) => {
            if (onError) onError(e)
            else console.error(e)
            manager.itemError(url)
            manager.itemEnd(url)
        }
        const loader = new three.FileLoader(manager)
        loader.setPath(path)
        loader.setResponseType('arraybuffer')
        if (loader.setRequestHeader) loader.setRequestHeader(requestHeader)
        if (loader.setWithCredentials) loader.setWithCredentials(withCredentials)
        loader.load(url, (data: ArrayBuffer) => {
            this.parse(data, resourcePath, (result) => {
                onLoad(result)
                manager.itemEnd(url)
            }, fail)
        }, onProgress, fail)
    }

    async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<BlendLoaderResult> {
        return new Promise((resolve, reject) => this.load(url, resolve, onProgress, reject))
    }

    parse(data: ArrayBuffer, resourcePath: string, onLoad: (result: BlendLoaderResult) => void, onError?: (err: unknown) => void): void {
        this.parseAsync(data, resourcePath).then(onLoad, onError ?? ((e) => console.error(e)))
    }

    /**
     * Parse a `.blend` already in memory. `resourcePath` is the base URL that external textures are
     * resolved against (the `.blend`'s directory); leave it empty to skip them.
     */
    async parseAsync(data: ArrayBuffer, resourcePath = ''): Promise<BlendLoaderResult> {
        const blend = await parseBlend(decompressBlend(data, gunzipSync)) as BlendFile
        const pending: Promise<void>[] = []
        const ctx = createCtx(three, {
            loadExternalTexture: (p: string, srgb: boolean) => this._loadExternal(p, srgb, resourcePath, pending),
        })
        const objects = await createObjects(blend, ctx)
        if (pending.length) await Promise.all(pending)
        const scene: Group = new three.Group()
        scene.name = 'Blend'
        if (objects.length) scene.add(...(objects as any[]))
        blend.scene = scene
        return {scene, blend}
    }

    // A placeholder texture now, filled when the image arrives; `pending` holds the load so parseAsync
    // can wait for it. A missing or unsupported image logs a warning and leaves the material without it.
    private _loadExternal(blenderPath: string, srgb: boolean, resourcePath: string, pending: Promise<void>[]): Texture | null {
        const path = blenderPath.replace(/^\/\//, '').replace(/\\/g, '/').replace(/^\.\//, '')
        if (!path) return null
        const custom = this._textureLoader
        if (!custom && (typeof document === 'undefined' || /\.(exr|hdr|rgbe|ktx2|dds|tga|tif|tiff)$/i.test(path))) {
            if (typeof document !== 'undefined') console.warn(`BlendLoader: "${path}" needs a texture loader for its format, see setTextureLoader()`)
            return null
        }
        const {manager, crossOrigin, requestHeader} = this as any
        let url = /^([a-z][a-z0-9+.-]*:|\/)/i.test(path) ? path : resourcePath + path
        if (manager.resolveURL) url = manager.resolveURL(url)

        let load: Promise<Texture | null>
        if (custom) {
            const res = custom(url, {path, srgb})
            if (!res || typeof (res as any).then !== 'function') {
                const tex = res as Texture | null
                if (tex && srgb) setSRGB(tex)
                return tex
            }
            load = res as Promise<Texture | null>
        } else {
            load = new Promise((resolve) => {
                const tl = new three.TextureLoader(manager)
                if (tl.setCrossOrigin) tl.setCrossOrigin(crossOrigin)
                if (tl.setRequestHeader) tl.setRequestHeader(requestHeader)
                tl.load(url, resolve, undefined, () => resolve(null))
            })
        }
        const placeholder: Texture = new three.Texture()
        pending.push(load.then((tex) => {
            if (!tex) {
                console.warn(`BlendLoader: external texture not found or unsupported: ${path}`)
                return
            }
            // Keep the wrap mode the material set from the Image Texture node's Extension.
            const {wrapS, wrapT} = placeholder
            placeholder.copy(tex)
            placeholder.wrapS = wrapS
            placeholder.wrapT = wrapT
            if (srgb) setSRGB(placeholder)
            placeholder.needsUpdate = true
        }, (e) => {
            console.warn(`BlendLoader: external texture failed: ${path}`, e)
        }))
        return placeholder
    }
}
