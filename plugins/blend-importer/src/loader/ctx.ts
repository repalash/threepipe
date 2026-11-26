import type {
    AmbientLight,
    BufferAttribute,
    BufferGeometry,
    DataTexture,
    DirectionalLight,
    Euler,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PointLight,
    Quaternion,
    ShapeUtils,
    Side,
    SpotLight,
    Texture,
    Vector2,
    Vector3,
    Wrapping,
    MagnificationTextureFilter,
    MinificationTextureFilter,
} from 'threepipe'

/**
 * Everything the loader core needs from three.js, handed in rather than imported, so the same code
 * runs on threepipe (`BlendLoadPlugin`, with threepipe's extended classes) and on any plain three.js
 * build (`BlendLoader` from `@threepipe/plugin-blend-importer/three`). The types are threepipe's, used
 * for checking only; nothing here is imported at runtime.
 */
export interface Ctx {
    PointLight: typeof PointLight
    SpotLight: typeof SpotLight
    DirectionalLight: typeof DirectionalLight
    AmbientLight: typeof AmbientLight
    Object3D: typeof Object3D
    PerspectiveCamera: typeof PerspectiveCamera
    OrthographicCamera: typeof OrthographicCamera
    Mesh: typeof Mesh
    BufferGeometry: typeof BufferGeometry
    BufferAttribute: typeof BufferAttribute
    MeshPhysicalMaterial: typeof MeshPhysicalMaterial
    MeshBasicMaterial: typeof MeshBasicMaterial
    Texture: typeof Texture
    DataTexture: typeof DataTexture
    Vector2: typeof Vector2
    Vector3: typeof Vector3
    Euler: typeof Euler
    Matrix4: typeof Matrix4
    Quaternion: typeof Quaternion
    ShapeUtils: typeof ShapeUtils
    /** three.js constants used by the loader (`Side` and `Wrapping` values). */
    FrontSide: Side
    DoubleSide: Side
    RepeatWrapping: Wrapping
    ClampToEdgeWrapping: Wrapping
    MirroredRepeatWrapping: Wrapping
    LinearFilter: MagnificationTextureFilter
    LinearMipmapLinearFilter: MinificationTextureFilter
    /**
     * Mark a texture as sRGB: `colorSpace = SRGBColorSpace` on three r152+, `encoding = sRGBEncoding`
     * before that. Use {@link srgbSetter} to build it from a three namespace.
     */
    setSRGB: (texture: Texture) => void
    /**
     * Load an external (file-path) image referenced by a Blender Image datablock, resolving it
     * relative to the `.blend`'s directory. Returns a Texture whose image fills in asynchronously (the
     * load is awaited by the loader before the scene is returned). Returns `null` when unavailable (e.g.
     * Node without a DOM). Absent when the loader is driven without a texture loader.
     */
    loadExternalTexture?: (blenderPath: string, srgb: boolean) => Texture | null
    /**
     * Evaluate modifier stacks as Blender's viewport does, or as its renderer does. Default `'viewport'`
     * - see {@link BlendEvaluationMode}.
     */
    evaluationMode?: BlendEvaluationMode
    /**
     * Told about each image the loader couldn't use, so the caller can report them once per file instead
     * of once per image: `packed-unsupported` is an image embedded in a format the loader can't decode
     * (e.g. HDR or EXR). External images are reported by whoever provides `loadExternalTexture`.
     */
    onTextureIssue?: (issue: 'packed-unsupported', name: string) => void
    /**
     * Given each asynchronous step the import started (packed images decoding), so the caller can wait
     * for them before handing the scene over, the way three's GLTFLoader waits for its textures.
     */
    onPending?: (done: Promise<void>) => void
    /** Set by the loader: each base geometry's mesh source, for the Subsurf cage (`geometry.ts` `cageOf`). Lives as long as this import. */
    cageSources?: WeakMap<object, any>
}

/**
 * Which of Blender's two evaluations of a modifier stack the importer reproduces.
 *
 * Blender evaluates every stack in one of two modes and the mode decides two things: which modifiers
 * run - `required_mode = use_render ? eModifierMode_Render : eModifierMode_Realtime`
 * (`mesh_data_update.cc:303`, checked in `BKE_modifier_is_enabled`) - and, for Subsurf, which level -
 * `levels = use_render_params ? renderLevels : levels` (`MOD_subsurf.cc:86`). Its own exporters default
 * to the viewport (`IO_wavefront_obj.hh:53`, `export_eval_mode = DAG_EVAL_VIEWPORT`), and a real-time
 * viewer is the viewport case: a model authored with Subsurf `levels: 0, renderLevels: 2`, or with a
 * heavy modifier turned off in the viewport, is saying what it wants shown interactively.
 */
export type BlendEvaluationMode = 'viewport' | 'render'

/** The `Ctx` fields that are plain three.js classes and constants, by their three.js export names. */
const THREE_KEYS = [
    'PointLight', 'SpotLight', 'DirectionalLight', 'AmbientLight', 'Object3D', 'PerspectiveCamera',
    'OrthographicCamera', 'Mesh', 'BufferGeometry', 'BufferAttribute', 'MeshPhysicalMaterial',
    'MeshBasicMaterial', 'Texture', 'DataTexture', 'Vector2', 'Vector3', 'Euler', 'Matrix4', 'Quaternion', 'ShapeUtils',
    'FrontSide', 'DoubleSide', 'RepeatWrapping', 'ClampToEdgeWrapping', 'MirroredRepeatWrapping',
    'LinearFilter', 'LinearMipmapLinearFilter',
] as const

/**
 * `Ctx.setSRGB` for a three.js namespace: `colorSpace` (r152+) when textures have it, else the older
 * `encoding` (sRGBEncoding = 3001).
 */
export function srgbSetter(three: any): (texture: Texture) => void {
    return (texture: any) => {
        if ('colorSpace' in texture) texture.colorSpace = three.SRGBColorSpace ?? 'srgb'
        else texture.encoding = three.sRGBEncoding ?? 3001
    }
}

/**
 * Build a {@link Ctx} from a three.js namespace (`import * as THREE from 'three'`, or threepipe's
 * exports), with `overrides` for classes to substitute (threepipe's extended ones) and extras such as
 * `loadExternalTexture`.
 */
export function createCtx(three: any, overrides: Partial<Ctx> = {}): Ctx {
    const ctx: any = {}
    for (const k of THREE_KEYS) ctx[k] = three[k]
    ctx.setSRGB = srgbSetter(three)
    Object.assign(ctx, overrides)
    for (const k of THREE_KEYS) {
        if (ctx[k] === undefined) throw new Error(`BlendLoader: three.js export "${k}" is missing - this three.js version is too old`)
    }
    return ctx as Ctx
}
