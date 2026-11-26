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
import {decodeTGA} from './loader/tga.js'
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
 * External textures load relative to the `.blend`: PNG, JPEG, WebP... with three's `TextureLoader`, TGA
 * with a built-in decoder. For other formats (EXR, HDR, KTX2), pass a loader with {@link setTextureLoader}.
 * Images that can't be used are reported in one warning per file.
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
        const issues: TextureIssues = {missing: [], unsupported: [], packedUnsupported: []}
        const ctx = createCtx(three, {
            loadExternalTexture: (p: string, srgb: boolean) => this._loadExternal(p, srgb, resourcePath, pending, issues),
            onTextureIssue: (_issue, name) => issues.packedUnsupported.push(name),
            onPending: (done) => pending.push(done),
        })
        const objects = await createObjects(blend, ctx)
        if (pending.length) await Promise.all(pending)
        reportTextureIssues(issues)
        const scene: Group = new three.Group()
        scene.name = 'Blend'
        if (objects.length) scene.add(...(objects as any[]))
        blend.scene = scene
        return {scene, blend}
    }

    // A placeholder texture now, filled when the image arrives; `pending` holds the load so parseAsync
    // can wait for it. Images that can't be loaded are collected in `issues`, reported once per file.
    private _loadExternal(blenderPath: string, srgb: boolean, resourcePath: string, pending: Promise<void>[], issues: TextureIssues): Texture | null {
        const path = blenderPath.replace(/^\/\//, '').replace(/\\/g, '/').replace(/^\.\//, '')
        if (!path) return null
        const custom = this._textureLoader
        const isTga = /\.tga$/i.test(path.split(/[?#]/)[0])
        if (!custom && (typeof document === 'undefined' || /\.(exr|hdr|rgbe|ktx2|dds|tif|tiff|psd)$/i.test(path))) {
            if (typeof document !== 'undefined') issues.unsupported.push(path)
            return null
        }
        const {manager, crossOrigin, requestHeader, withCredentials} = this as any
        // Not passed through manager.resolveURL here: the loaders below resolve it with the same manager,
        // and a URL modifier must see each URL once.
        const url = /^([a-z][a-z0-9+.-]*:|\/)/i.test(path) ? path : resourcePath + path

        let load: Promise<Texture | null>
        if (custom) {
            const res = custom(url, {path, srgb})
            if (!res || typeof (res as any).then !== 'function') {
                const tex = res as Texture | null
                if (tex && srgb) setSRGB(tex)
                return tex
            }
            load = res as Promise<Texture | null>
        } else if (isTga) {
            // TGA: browsers can't decode it, so fetch the bytes and decode them here.
            load = new Promise((resolve) => {
                const fl = new three.FileLoader(manager)
                fl.setResponseType('arraybuffer')
                if (fl.setRequestHeader) fl.setRequestHeader(requestHeader)
                if (fl.setWithCredentials) fl.setWithCredentials(withCredentials)
                fl.load(url, (buffer: ArrayBuffer) => {
                    try {
                        resolve(tgaTexture(buffer))
                    } catch (e) {
                        resolve(null)
                    }
                }, undefined, () => resolve(null))
            })
        } else {
            load = new Promise((resolve) => {
                const tl = new three.TextureLoader(manager)
                if (tl.setCrossOrigin) tl.setCrossOrigin(crossOrigin)
                if (tl.setRequestHeader) tl.setRequestHeader(requestHeader)
                tl.load(url, resolve, undefined, () => resolve(null))
            })
        }
        // Same class as what arrives, so copy() carries a valid upload path (a DataTexture's data can't
        // go through a plain Texture).
        // It starts as 1x1 white, so a material whose image never arrives renders untextured, not broken.
        const placeholder: Texture = isTga && !custom ? new three.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) : new three.Texture(whitePixel())
        pending.push(load.then((tex) => {
            if (!tex) {
                issues.missing.push(path)
                return
            }
            // Keep what the material set from the node tree: the wrap mode (Image Texture's Extension)
            // and the UV transform (a Mapping node); copy() would reset them to the loader's defaults.
            const {wrapS, wrapT, rotation} = placeholder
            const repeat = placeholder.repeat.clone(), offset = placeholder.offset.clone(), center = placeholder.center.clone()
            placeholder.copy(tex)
            placeholder.wrapS = wrapS
            placeholder.wrapT = wrapT
            placeholder.rotation = rotation
            placeholder.repeat.copy(repeat)
            placeholder.offset.copy(offset)
            placeholder.center.copy(center)
            if (srgb) setSRGB(placeholder)
            placeholder.needsUpdate = true
        }, () => {
            issues.missing.push(path)
        }))
        return placeholder
    }
}

// A 1x1 white canvas (external textures only load where there is a DOM).
function whitePixel(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const c2d = canvas.getContext('2d')
    if (c2d) {
        c2d.fillStyle = '#ffffff'
        c2d.fillRect(0, 0, 1, 1)
    }
    return canvas
}

/** Images of one .blend that couldn't be used, reported in one warning. */
interface TextureIssues {
    /** External files that weren't found or failed to load. */
    missing: string[]
    /** External files in a format this loader doesn't read (see setTextureLoader). */
    unsupported: string[]
    /** Images embedded in a format the loader can't decode (HDR, EXR...). */
    packedUnsupported: string[]
}

function reportTextureIssues(issues: TextureIssues) {
    const list = (a: string[]) => [...new Set(a)].join(', ')
    const parts: string[] = []
    if (issues.missing.length) parts.push(`not found or failed to load: ${list(issues.missing)}`)
    if (issues.unsupported.length) parts.push(`format needs a loader, see setTextureLoader(): ${list(issues.unsupported)}`)
    if (issues.packedUnsupported.length) parts.push(`packed in a format that can't be decoded: ${list(issues.packedUnsupported)}`)
    if (!parts.length) return
    const n = new Set([...issues.missing, ...issues.unsupported, ...issues.packedUnsupported]).size
    console.warn(`BlendLoader: ${n} image(s) left out of the materials. ${parts.join('; ')}`)
}

// An RGBA DataTexture from TGA bytes, uploaded flipped like an image texture.
function tgaTexture(buffer: ArrayBuffer): Texture {
    const tga = decodeTGA(buffer)
    const texture: any = new three.DataTexture(tga.data, tga.width, tga.height)
    texture.flipY = true
    texture.generateMipmaps = true
    texture.minFilter = three.LinearMipmapLinearFilter
    texture.magFilter = three.LinearFilter
    texture.needsUpdate = true
    return texture
}
