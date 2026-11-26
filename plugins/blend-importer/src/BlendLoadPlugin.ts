import {
    AmbientLight2,
    AnyOptions,
    BaseImporterPlugin,
    BufferAttribute,
    BufferGeometry2,
    ClampToEdgeWrapping,
    DataTexture,
    DirectionalLight2,
    DoubleSide,
    Euler,
    FileLoader,
    FrontSide,
    gunzipSync,
    LinearFilter,
    LinearMipmapLinearFilter,
    IAssetImporter,
    ILoader,
    Importer, Mesh,
    Matrix4,
    Mesh2,
    MirroredRepeatWrapping,
    Object3D,
    Object3D2,
    OrthographicCamera0,
    PerspectiveCamera0,
    PhysicalMaterial,
    PointLight2,
    Quaternion,
    RepeatWrapping,
    Scene,
    ShapeUtils,
    Source,
    SpotLight2,
    SRGBColorSpace,
    Texture,
    ThreeViewer,
    UnlitMaterial,
    Vector2,
    Vector3,
} from 'threepipe'
import {parseBlend} from './js-blend/main.js'
import {createObjects} from './loader'
import {decompressBlend} from './decompress'
import type {BlendEvaluationMode} from './loader/ctx'
import {createCtx} from './loader/ctx'
import type {BlendFileData} from './blendFile'
import {decodeTGA} from './loader/tga.js'

/** What went wrong with a .blend's images, reported in one warning when the import finishes. */
interface TextureIssues {
    /** External files that aren't there. */
    missing: string[]
    /** External files in a format no registered importer reads. */
    unsupported: string[]
    /** Images embedded in a format the loader can't decode (HDR, EXR...). */
    packedUnsupported: string[]
    /** External files that were found but failed to import. */
    failed: string[]
}

function reportTextureIssues(issues: TextureIssues, blendUrl: string) {
    const parts: string[] = []
    const list = (a: string[]) => [...new Set(a)].join(', ')
    if (issues.missing.length) parts.push(`not found: ${list(issues.missing)}`)
    if (issues.unsupported.length) parts.push(`no importer for the format: ${list(issues.unsupported)}`)
    if (issues.packedUnsupported.length) parts.push(`packed in a format that can't be decoded: ${list(issues.packedUnsupported)}`)
    if (issues.failed.length) parts.push(`failed to import: ${list(issues.failed)}`)
    if (!parts.length) return
    const n = new Set([...issues.missing, ...issues.unsupported, ...issues.packedUnsupported, ...issues.failed]).size
    console.warn(`BlendLoadPlugin - ${n} image(s) of "${blendUrl.split(/[?#]/)[0].split('/').pop()}" left out of the materials. ${parts.join('; ')}`)
}

// File extension of a Blender image path, lower case.
const extOf = (path: string) => (path.split(/[?#]/)[0].split('/').pop()?.split('.').pop() ?? '').toLowerCase()

// Whether any importer registered with the AssetImporter reads files with this extension. `importers` and
// `ext` are public on threepipe's AssetImporter/Importer (0.3.0 and later) but not on the interface.
function canImport(importer: IAssetImporter, ext: string): boolean {
    const importers: any[] | undefined = (importer as any).importers
    if (!Array.isArray(importers)) return true // can't tell: let the import decide
    return importers.some(i => {
        const exts = typeof i?.ext === 'function' ? i.ext() : i?.ext
        return Array.isArray(exts) && exts.includes(ext)
    })
}

/**
 * Reads `.tga` files for the AssetImporter (threepipe has no TGA loader): an RGBA `DataTexture`, uploaded
 * flipped like an image texture. The decoder is three.js's TGALoader's (see `loader/tga.js`).
 */
class TGATextureLoader extends FileLoader implements ILoader {
    async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any> {
        this.setResponseType('arraybuffer')
        const buffer = await super.loadAsync(url, onProgress) as ArrayBuffer
        const tga = decodeTGA(buffer)
        const texture = new DataTexture(tga.data, tga.width, tga.height)
        texture.flipY = true
        texture.generateMipmaps = true
        texture.minFilter = LinearMipmapLinearFilter
        texture.magFilter = LinearFilter
        texture.needsUpdate = true
        return texture
    }
}

interface ExternalTextureRequest { texture: Texture, url: string, srgb: boolean, path: string }

/**
 * Resolve a Blender Image file path to an absolute URL relative to the `.blend`, and return a placeholder
 * {@link Texture} plus a request to import it later. Resolution happens NOW, while the importer's root
 * context for this `.blend` is active — the actual import is deferred (see {@link importExternalTexture})
 * because importing re-enters the AssetImporter and would clobber that root context for sibling textures.
 *
 * Blender path conventions: leading `//` means relative to the `.blend`'s directory; `\` separators and a
 * leading `./` are normalised. Returns `null` in Node (no DOM) or for an empty path.
 */
function resolveExternalTexture(blenderPath: string, srgb: boolean, importer: IAssetImporter, blendUrl: string, issues: TextureIssues): ExternalTextureRequest | null {
    if (typeof document === 'undefined') return null // image decoding needs the DOM
    const path = blenderPath.replace(/^\/\//, '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (!path) return null
    // No importer for the format: say so once, at the end, instead of an AssetImporter error per image.
    if (!canImport(importer, extOf(path))) {
        issues.unsupported.push(path)
        return null
    }
    // resolveURL is on threepipe's AssetImporter (0.3.0+) but not declared on IAssetImporter.
    let url: string = (importer as any).resolveURL(path)
    // Fall back to joining against the .blend's directory if the importer didn't make it absolute
    // (e.g. the root context wasn't applied) — keeps relative sibling textures resolvable.
    if (url === path && !/^([a-z][a-z0-9+.-]*:|\/|blob:|data:)/i.test(url)) {
        url = blendUrl.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + path
    }
    // Start as a benign 1x1 texture so a failed/unsupported import leaves a harmless map (white) instead of
    // an undefined-image texture that crashes the GPU upload. The placeholder must match the imported
    // texture's CLASS: EXR/HDR import as a DataTexture (float data, different GPU upload path) — a regular
    // Texture placeholder would crash on upload even after copying. Replaced by the real image on success.
    // Detect EXR/HDR from the Blender PATH's extension, not the resolved `url`: a dropped/registered file
    // (folder drop, importFiles) resolves to a blob: URL with the real path in the #fragment
    // (`blob:…uuid#/dir/x.exr`), so testing `url` would miss the extension and wrongly pick a non-data
    // Texture placeholder — breaking the GPU upload (texSubImage2D) and the UI preview (putImageData) of
    // EXR/HDR maps. `path` always carries the true extension.
    const isData = /\.(exr|hdr|rgbe|tga)$/i.test(path.split(/[?#]/)[0])
    let texture: Texture
    if (isData) {
        texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    } else {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const c2d = canvas.getContext('2d')
        if (c2d) { c2d.fillStyle = '#ffffff'; c2d.fillRect(0, 0, 1, 1) }
        texture = new Texture(canvas)
    }
    texture.needsUpdate = true
    if (srgb) texture.colorSpace = SRGBColorSpace
    return {texture, url, srgb, path}
}

/**
 * Vertically flip a DataTexture's pixel rows into a PRIVATE copy and reseat its `source`.
 *
 * Why: EXR/HDR import as `DataTexture`s with `flipY=false`, while the blend importer's raster maps
 * (jpg/png via the AssetImporter) import as image textures with `flipY=true`. WebGL's `UNPACK_FLIP_Y`
 * only applies to DOM/ImageBitmap uploads, NOT to `ArrayBufferView` (DataTexture) uploads — so a data
 * map ends up sampled vertically mirrored relative to the raster maps on the SAME UVs. On a material
 * that mixes them (e.g. jpg base color + EXR normal/roughness) the normal/rough/displacement detail
 * lands upside-down and fights the diffuse — the normal map appears not to work. Pre-flipping the data
 * makes a `flipY=false` data texture sample identically to a `flipY=true` raster, restoring alignment;
 * three + Blender share the OpenGL (`nor_gl`) green-up convention, so `normalScale` stays positive.
 *
 * The flip goes into a fresh typed array + `Source` so we never mutate the AssetImporter-CACHED source
 * (the same EXR is reused across materials — Plane and Sphere here share one normal map).
 */
function flipDataTextureRowsY(tex: DataTexture): void {
    const img: any = tex.image
    const data: any = img?.data
    if (!data?.length || !img.width || !img.height) return
    const {width, height} = img
    const elemsPerRow = data.length / height // width * channels-per-pixel
    if (!Number.isInteger(elemsPerRow)) return
    const flipped = new (data.constructor as new (n: number) => typeof data)(data.length)
    for (let y = 0; y < height; y++) {
        flipped.set(data.subarray(y * elemsPerRow, (y + 1) * elemsPerRow), (height - 1 - y) * elemsPerRow)
    }
    const newImage = {data: flipped, width, height}
    tex.image = newImage
    tex.source = new Source(newImage)
    tex.needsUpdate = true
}

/**
 * Import a resolved external texture through threepipe's {@link IAssetImporter} — which selects the correct
 * loader per format (EXR/HDR/KTX2/JPG/PNG/WebP/...) and applies its cache and progress tracking, so any
 * format threepipe supports works, not just browser-native rasters. Fills the placeholder texture from the
 * result. Missing/unsupported files log a warning and resolve (no throw) so one bad path doesn't fail the
 * whole import.
 */
async function importExternalTexture(req: ExternalTextureRequest, importer: IAssetImporter, issues: TextureIssues): Promise<void> {
    // A missing file would make the AssetImporter log three errors; check first with a HEAD request
    // (http(s) only - blob:/data: URLs of dropped files exist by construction). If the server or CORS
    // refuses HEAD, fall through and let the import try.
    if (/^https?:/i.test(req.url) && typeof fetch === 'function') {
        try {
            const res = await fetch(req.url, {method: 'HEAD'})
            if (res.status === 404 || res.status === 410) {
                issues.missing.push(req.path)
                return
            }
        } catch (e) {
            // network/CORS error on HEAD: try the import anyway
        }
    }
    try {
        const imported: any = await importer.importSingle<Texture>(req.url)
        if (imported && imported.isTexture && imported.image) {
            // Copy the FULL texture state — source, type, format, filters, flipY — not just the image, so a
            // HalfFloat/Float DataTexture (EXR/HDR) uploads with the correct type (copying only the source
            // onto a default UnsignedByte texture crashes the GPU upload). But preserve the wrap mode (from the
            // node's Extension) and the UV transform (from a Mapping node) the loader set on the placeholder —
            // copy() would overwrite them with the importer's defaults (ClampToEdge, repeat 1 / offset 0).
            const wrapS = req.texture.wrapS, wrapT = req.texture.wrapT, rotation = req.texture.rotation
            const repeat = req.texture.repeat.clone(), offset = req.texture.offset.clone(), center = req.texture.center.clone()
            req.texture.copy(imported)
            req.texture.wrapS = wrapS; req.texture.wrapT = wrapT; req.texture.rotation = rotation
            req.texture.repeat.copy(repeat); req.texture.offset.copy(offset); req.texture.center.copy(center)
            req.texture.colorSpace = req.srgb ? SRGBColorSpace : imported.colorSpace
            // Align flipY=false data textures (EXR/HDR) to the flipY=true raster convention — see helper.
            if (imported.isDataTexture && imported.flipY === false) flipDataTextureRowsY(req.texture as DataTexture)
            req.texture.needsUpdate = true
        } else {
            issues.failed.push(req.path)
        }
    } catch (e) {
        issues.failed.push(req.path)
    }
}

/**
 * Shape of the parsed Blender file passed to {@link BlendLoadOptions.onBlendLoad}. `scene` is the
 * threepipe root built from the file's objects. See {@link BlendFileData}.
 */
export type BlendFile = BlendFileData<Object3D>

/**
 * Loader options consumed by `BlendLoadPlugin`. Pass via `viewer.load(url, options)`.
 */
export interface BlendLoadOptions {
    /**
     * Called once after parsing, before the Scene is returned to the asset pipeline. Use to read
     * metadata that isn't represented in the three.js Scene — Blender's embedded thumbnail, raw
     * DNA struct data, library/kinematics references, etc.
     *
     * The callback's return value is ignored. Don't put data here onto `userData` (the import/export
     * pipeline will round-trip it as JSON — large typed arrays like the thumbnail will balloon
     * exports or fail serialization).
     *
     * @example
     * ```ts
     * viewer.load('scene.blend', {
     *     onBlendLoad: (blend) => {
     *         if (blend.thumbnail) {
     *             // render the embedded preview to a <canvas>...
     *         }
     *     },
     * })
     * ```
     */
    onBlendLoad?: (blend: BlendFile) => void
}

/**
 * Adds support for loading Blender `.blend`, `application/x-blender` files and data URIs.
 *
 * Handles uncompressed, gzip-compressed (Blender ≤ 2.93), and zstd-compressed (Blender 3.0+ default)
 * files. See {@link BlendLoadOptions} for callback hooks, including access to the embedded thumbnail
 * and the raw parsed DNA tree.
 */
export class BlendLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'BlendLoadPlugin'

    /**
     * Evaluate modifier stacks the way Blender's viewport does (`'viewport'`, the default, and what
     * Blender's own exporters do) or the way its renderer does (`'render'`). The mode decides which
     * modifiers run and which Subsurf level is used; the render level is usually higher, and every
     * extra level quadruples the triangles. See {@link BlendEvaluationMode}.
     */
    evaluationMode: BlendEvaluationMode = 'viewport'

    constructor() {
        super()
    }

    // `.tga` support for the AssetImporter, so external TGA maps in .blend files load. Added only when no
    // other importer already reads .tga, and removed with the plugin.
    protected _tgaImporter = new Importer(TGATextureLoader, ['tga'], ['image/x-tga', 'image/x-targa', 'image/tga'], false)
    private _addedTga = false

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        const importer = viewer.assetManager.importer
        if (!canImport(importer, 'tga')) {
            importer.addImporter(this._tgaImporter)
            this._addedTga = true
        }
    }

    onRemove(viewer: ThreeViewer) {
        if (this._addedTga) {
            viewer.assetManager.importer.removeImporter(this._tgaImporter)
            this._addedTga = false
        }
        super.onRemove(viewer)
    }

    protected _importer = new Importer(class extends FileLoader implements ILoader {
        // The AssetImporter that constructed this loader (injected via the Importer onCtor below). Used to
        // load external textures through the full pipeline (correct loader per format + cache).
        assetImporter?: IAssetImporter
        // The plugin that registered this loader, for its import settings. Injected below like the importer.
        plugin?: BlendLoadPlugin
        async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any> {
            this.setResponseType('arraybuffer')
            let res: ArrayBuffer | null = (await super.loadAsync(url, onProgress)) as ArrayBuffer
            const decompressed = decompressBlend(res, gunzipSync)
            // Drop the reference to the original (possibly compressed) buffer so it can be
            // garbage-collected while the parser works on the decompressed copy.
            res = null
            const blend = await parseBlend(decompressed)
            // console.log(bakeGetters(blend))
            // External textures: resolve each path NOW (the importer's root context for this .blend is
            // active during createObjects), then import them all AFTER createObjects — importing re-enters
            // the AssetImporter and would otherwise clobber the root context for sibling textures.
            const importer = this.assetImporter
            const texReqs: ExternalTextureRequest[] = []
            const issues: TextureIssues = {missing: [], unsupported: [], packedUnsupported: [], failed: []}
            const ctx = createCtx({
                Texture, DataTexture, Vector2, Vector3, Euler, Matrix4, Quaternion, ShapeUtils, SRGBColorSpace,
                FrontSide, DoubleSide, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping,
                LinearFilter, LinearMipmapLinearFilter,
            }, {
                Object3D: Object3D2,
                Mesh: Mesh2 as typeof Mesh,
                MeshPhysicalMaterial: PhysicalMaterial,
                MeshBasicMaterial: UnlitMaterial,
                PerspectiveCamera: PerspectiveCamera0,
                OrthographicCamera: OrthographicCamera0,
                PointLight: PointLight2,
                DirectionalLight: DirectionalLight2,
                SpotLight: SpotLight2,
                AmbientLight: AmbientLight2,
                BufferGeometry: BufferGeometry2,
                BufferAttribute: BufferAttribute,
                evaluationMode: this.plugin?.evaluationMode,
                loadExternalTexture: importer
                    ? (p: string, srgb: boolean) => {
                        const req = resolveExternalTexture(p, srgb, importer, url, issues)
                        if (req) texReqs.push(req)
                        return req ? req.texture : null
                    }
                    : undefined,
                onTextureIssue: (_issue, name) => issues.packedUnsupported.push(name),
            })
            const objects = await createObjects(blend, ctx)
            if (importer && texReqs.length) await Promise.all(texReqs.map(r => importExternalTexture(r, importer, issues)))
            reportTextureIssues(issues, url)
            const root = new Object3D()
            root.add(...objects)
            blend.scene = root
            return blend
        }

        transform(res: BlendFile, options: AnyOptions & BlendLoadOptions): Scene {
            if (typeof options.onBlendLoad === 'function') {
                options.onBlendLoad(res)
            }
            return res.scene as unknown as Scene
        }
    }, ['blend'], ['application/x-blender'], true, (loader, assetImporter) => {
        // Inject the AssetImporter so the loader can import external textures through the full pipeline.
        if (loader) {
            (loader as any).assetImporter = assetImporter
            ;(loader as any).plugin = this
        }
        return loader
    })
}
