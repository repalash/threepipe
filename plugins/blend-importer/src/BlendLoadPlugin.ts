import {
    AmbientLight2,
    AnyOptions,
    BaseImporterPlugin,
    BufferAttribute,
    BufferGeometry2,
    DirectionalLight2,
    FileLoader,
    ILoader,
    Importer, Mesh,
    Mesh2,
    Object3D,
    Object3D2,
    OrthographicCamera0,
    PerspectiveCamera0,
    PhysicalMaterial,
    PointLight2,
    Scene, SpotLight2,
    SRGBColorSpace,
    Texture,
    TextureLoader,
    UnlitMaterial,
} from 'threepipe'
import {parseBlend} from './js-blend/main.js'
import {createObjects} from './loader'
import {decompressBlend} from './decompress'

/**
 * Load an external (file-path) image referenced by a Blender Image datablock. The path is resolved
 * relative to the `.blend`'s directory by threepipe's {@link LoadingManager} URL modifier (active while
 * the file is importing), so caching, dropped-sibling-file remap and progress tracking all apply.
 *
 * Returns the Texture immediately (its image fills in on load); the returned promise is collected so the
 * loader can await it before the scene is handed back. A missing file logs a warning and resolves
 * (no throw) so one bad path doesn't fail the whole import. Returns `null` outside a DOM (Node).
 */
function loadExternalBlendTexture(blenderPath: string, srgb: boolean, manager: any, pending: Promise<any>[]): Texture | null {
    if (typeof document === 'undefined') return null // TextureLoader decodes via an <img> element
    // Blender path conventions: leading "//" means relative to the .blend's directory; normalize
    // Windows separators and a leading "./". Absolute/remote paths are passed through as-is (and will
    // 404 gracefully if unreachable). The LoadingManager prepends the .blend's base URL to relatives.
    const path = blenderPath.replace(/^\/\//, '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (!path) return null
    const loader = new TextureLoader(manager)
    let texture: Texture | null = null
    const p = new Promise<void>((resolve) => {
        texture = loader.load(
            path,
            () => resolve(),
            undefined,
            () => { console.warn('BlendLoadPlugin - external texture not found:', blenderPath); resolve() },
        )
        if (srgb && texture) texture.colorSpace = SRGBColorSpace
    })
    pending.push(p)
    return texture
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
        async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any> {
            this.setResponseType('arraybuffer')
            let res: ArrayBuffer | null = (await super.loadAsync(url, onProgress)) as ArrayBuffer
            const decompressed = decompressBlend(res)
            // Drop the reference to the original (possibly compressed) buffer so it can be
            // garbage-collected while the parser works on the decompressed copy.
            res = null
            const blend = await parseBlend(decompressed)
            // console.log(bakeGetters(blend))
            // External textures load through this loader's LoadingManager (this.manager), which resolves
            // paths relative to the .blend and caches them. Collect the load promises so we can await them
            // below — while the AssetImporter's root context (relative-URL resolution) is still active.
            const pending: Promise<any>[] = []
            const manager = (this as any).manager
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
                loadExternalTexture: (p: string, srgb: boolean) => loadExternalBlendTexture(p, srgb, manager, pending),
            }
            const objects = await createObjects(blend, ctx)
            if (pending.length) await Promise.all(pending)
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
    }, ['blend'], ['application/x-blender'], true)
}
