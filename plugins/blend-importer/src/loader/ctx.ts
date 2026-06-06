import {
    AmbientLight,
    BufferAttribute,
    BufferGeometry,
    DirectionalLight,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PointLight,
    SpotLight,
    Texture,
} from 'threepipe'

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
    /**
     * Load an external (file-path) image referenced by a Blender Image datablock, resolving it
     * relative to the `.blend`'s directory through threepipe's asset pipeline (cache + LoadingManager).
     * Returns a Texture whose image fills in asynchronously (the load is awaited by the loader before
     * the scene is returned). Returns `null` when unavailable (e.g. Node without a DOM). Provided by
     * `BlendLoadPlugin`; absent when the loader is driven outside that plugin.
     */
    loadExternalTexture?: (blenderPath: string, srgb: boolean) => Texture | null
}
