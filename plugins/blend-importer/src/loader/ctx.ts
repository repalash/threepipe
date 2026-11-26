import type {
    AmbientLight,
    BufferAttribute,
    BufferGeometry,
    DirectionalLight,
    Euler,
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
    Vector2: typeof Vector2
    Vector3: typeof Vector3
    Euler: typeof Euler
    Quaternion: typeof Quaternion
    ShapeUtils: typeof ShapeUtils
    /** three.js constants used by the loader (`Side` and `Wrapping` values). */
    FrontSide: Side
    DoubleSide: Side
    RepeatWrapping: Wrapping
    ClampToEdgeWrapping: Wrapping
    MirroredRepeatWrapping: Wrapping
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
}

/** The `Ctx` fields that are plain three.js classes and constants, by their three.js export names. */
const THREE_KEYS = [
    'PointLight', 'SpotLight', 'DirectionalLight', 'AmbientLight', 'Object3D', 'PerspectiveCamera',
    'OrthographicCamera', 'Mesh', 'BufferGeometry', 'BufferAttribute', 'MeshPhysicalMaterial',
    'MeshBasicMaterial', 'Texture', 'Vector2', 'Vector3', 'Euler', 'Quaternion', 'ShapeUtils',
    'FrontSide', 'DoubleSide', 'RepeatWrapping', 'ClampToEdgeWrapping', 'MirroredRepeatWrapping',
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
