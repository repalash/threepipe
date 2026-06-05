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
    UnlitMaterial,
} from 'threepipe'
import {parseBlend} from './js-blend/main.js'
import {createObjects} from './loader'
import {decompressBlend} from './decompress'

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
            }
            const objects = await createObjects(blend, ctx)
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
