import {
    AmbientLight2,
    AnyOptions,
    BaseImporterPlugin,
    BufferAttribute,
    BufferGeometry2,
    DataTexture,
    DirectionalLight2,
    FileLoader,
    IAssetImporter,
    ILoader,
    Importer, Mesh,
    Mesh2,
    Object3D,
    Object3D2,
    OrthographicCamera0,
    PerspectiveCamera0,
    PhysicalMaterial,
    PointLight2,
    Scene,
    Source,
    SpotLight2,
    SRGBColorSpace,
    Texture,
    UnlitMaterial,
} from 'threepipe'
import {parseBlend} from './js-blend/main.js'
import {createObjects} from './loader'
import {decompressBlend} from './decompress'

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
function resolveExternalTexture(blenderPath: string, srgb: boolean, importer: IAssetImporter, blendUrl: string): ExternalTextureRequest | null {
    if (typeof document === 'undefined') return null // image decoding needs the DOM
    const path = blenderPath.replace(/^\/\//, '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (!path) return null
    let url = importer.resolveURL(path)
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
    const isData = /\.(exr|hdr|rgbe)$/i.test(path.split(/[?#]/)[0])
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
async function importExternalTexture(req: ExternalTextureRequest, importer: IAssetImporter): Promise<void> {
    try {
        const imported: any = await importer.importSingle<Texture>(req.url)
        if (imported && imported.isTexture && imported.image) {
            // Copy the FULL texture state — source, type, format, filters, flipY — not just the image, so a
            // HalfFloat/Float DataTexture (EXR/HDR) uploads with the correct type (copying only the source
            // onto a default UnsignedByte texture crashes the GPU upload). But preserve the wrap mode the
            // loader set from the Blender node's Extension (copy would overwrite it with the importer's
            // ClampToEdge default → tiled UVs outside [0,1] would clamp/smear instead of repeat).
            const wrapS = req.texture.wrapS, wrapT = req.texture.wrapT
            req.texture.copy(imported)
            req.texture.wrapS = wrapS; req.texture.wrapT = wrapT
            req.texture.colorSpace = req.srgb ? SRGBColorSpace : imported.colorSpace
            // Align flipY=false data textures (EXR/HDR) to the flipY=true raster convention — see helper.
            if (imported.isDataTexture && imported.flipY === false) flipDataTextureRowsY(req.texture as DataTexture)
            req.texture.needsUpdate = true
        } else {
            console.warn('BlendLoadPlugin - external texture not found/unsupported:', req.path)
        }
    } catch (e) {
        console.warn('BlendLoadPlugin - external texture failed:', req.path, e)
    }
}

/**
 * Shape of the parsed Blender file passed to {@link BlendLoadOptions.onBlendLoad}.
 *
 * This is the raw `js.blend` FILE object — see `src/js-blend/parser/parser.js` for the
 * full DNA tree. Notable fields are typed here; everything else is untyped under `[k: string]`.
 */
export interface BlendFile {
    /** Three.js root constructed from the file's Blender objects. Same object returned as the Scene. */
    scene: Object3D
    /**
     * Embedded preview thumbnail (RGBA8, packed one pixel per `Uint32`). Absent on very old saves
     * or files saved with preview disabled. Typical size 128×128.
     * Convert via `<canvas>.createImageData` for display.
     */
    thumbnail?: {width: number, height: number, data: Uint32Array}
    /** Parsed Blender objects keyed by SDNA struct type, e.g. `objects.Object`, `objects.Mesh`, `objects.Material`. */
    objects: Record<string, any[]>
    /** SDNA template — Blender's runtime struct definitions parsed out of the DNA1 block. */
    template: any
    /** Memory-address-keyed lookup of every parsed block. */
    memory_lookup: Record<string, any>
    /** Raw `ArrayBuffer` of the decompressed `.blend` payload. */
    AB: ArrayBuffer
    [k: string]: any
}

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
    constructor() {
        super()
    }
    protected _importer = new Importer(class extends FileLoader implements ILoader {
        // The AssetImporter that constructed this loader (injected via the Importer onCtor below). Used to
        // load external textures through the full pipeline (correct loader per format + cache).
        assetImporter?: IAssetImporter
        async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any> {
            this.setResponseType('arraybuffer')
            let res: ArrayBuffer | null = (await super.loadAsync(url, onProgress)) as ArrayBuffer
            const decompressed = decompressBlend(res)
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
            const ctx = {
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
                loadExternalTexture: importer
                    ? (p: string, srgb: boolean) => {
                        const req = resolveExternalTexture(p, srgb, importer, url)
                        if (req) texReqs.push(req)
                        return req ? req.texture : null
                    }
                    : undefined,
            }
            const objects = await createObjects(blend, ctx)
            if (importer && texReqs.length) await Promise.all(texReqs.map(r => importExternalTexture(r, importer)))
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
        if (loader) (loader as any).assetImporter = assetImporter
        return loader
    })
}
