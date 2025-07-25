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
}
