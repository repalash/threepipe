import {Rhino3dmLoader} from 'three/examples/jsm/loaders/3DMLoader.js'
import {
    Color,
    DoubleSide,
    InstancedMesh,
    Line,
    LineSegments,
    LoadingManager,
    Material,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Points,
} from 'three'
import {getUrlQueryParam} from 'ts-browser-helpers'

export class Rhino3dmLoader2 extends Rhino3dmLoader {
    // todo since 8.4.0(next version) it's not able to load some files like https://drive.google.com/file/d/1mWOCGIOWmaC4L7IxCvWM9dgeVYeDl8L-/view (request for access)
    //  gets stuck at `rhino.File3dm.fromByteArray` call in the worker. Note three.js uses 8.4.0 version of rhino3dm.
    /**
     * Path to the rhino3dm.js library, default uses jsdelivr CDN
     * You may want to set this to your own path or use {@link Rhino3dmLoader2.setLibraryPath}
     * @default `https://cdn.jsdelivr.net/npm/rhino3dm@${getUrlQueryParam('rhino3dm', '8.0.1')}/`
     */
    public static LIBRARY_PATH = `https://cdn.jsdelivr.net/npm/rhino3dm@${getUrlQueryParam('rhino3dm', '8.0.1')}/`

    constructor(manager?: LoadingManager) {
        super(manager)
        this.setLibraryPath(Rhino3dmLoader2.LIBRARY_PATH)
    }
    public static ImportMaterials = true
    public static ForceLayerMaterials = false
    public static ReplaceWithInstancedMesh = false
    public static HideLineMesh = false
    public static HidePointMesh = false
    public static LoadUserDataStrings = true
    public static LoadUserDataWarnings = true

    materials: Material[] = []

    // eslint-disable-next-line @typescript-eslint/naming-convention
    _createMaterial(material: any): Material {
        if (!Rhino3dmLoader2.ImportMaterials) return this.materials[0] || new MeshStandardMaterial({
            color: new Color(1, 1, 1),
            metalness: 0.8,
            name: 'default',
            side: DoubleSide,
        })
        return super._createMaterial(material)
    }
    private declare _compareMaterials: (material: Material) => Material

    async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<Object3D> {
        const ret = await super.loadAsync(url, onProgress)
        ret.rotateX(-Math.PI / 2) // since models are rotated
        if (ret.userData.materials) delete ret.userData.materials // we don't want them saved in the file during export

        // console.log(ret.userData)

        const layers = ret.userData.layers
        ret.traverse((obj) => {
            const castShadow = obj.userData.attributes?.castsShadows
            const receiveShadow = obj.userData.attributes?.receivesShadows
            obj.castShadow = castShadow
            obj.receiveShadow = receiveShadow
            const layerIndex = obj.userData.attributes?.layerIndex ?? obj.userData.defAttributes?.layerIndex
            const layer = layers[layerIndex]
            if (layer) obj.userData.rhinoLayer = layer
            obj.userData.rhino3dmRoot = ret.uuid

            if (!Rhino3dmLoader2.LoadUserDataStrings)
                obj.userData.strings = []
            if (!Rhino3dmLoader2.LoadUserDataWarnings)
                delete obj.userData.warnings

            this._hideLineMesh(obj)
            this._useInstancedMesh(obj)
            this._useMaterialSource(obj, layer)
        })
        this.materials = [] // so that next file load doesn't give the same materials.
        return ret
    }

    private _useMaterialSource(obj: Object3D, layer: any) {
        if (!Rhino3dmLoader2.ImportMaterials) return
        const mesh = obj as Mesh
        if ((mesh.material as any)?.name === 'default' || Rhino3dmLoader2.ForceLayerMaterials) {

            // https://developer.rhino3d.com/api/rhinoscript/object_methods/objectmaterialsource.htm
            const materialSource = mesh.userData.attributes?.materialSource || mesh.userData.defAttributes?.materialSource
            const colorSource = mesh.userData.attributes?.colorSource || mesh.userData.defAttributes?.colorSource
            // const materialSource = mesh.userData.defAttributes?.materialSource
            // console.log(materialSource, mesh.userData.attributes, mesh.userData.defAttributes)
            if (!Rhino3dmLoader2.ForceLayerMaterials && !materialSource && !colorSource) return
            if (Rhino3dmLoader2.ForceLayerMaterials ||
                (materialSource?.value === 0 || materialSource?.value === 1 && colorSource?.value === 0)
            ) { // material from layer
                if (layer) {
                    mesh.material = this._compareMaterials(this._createMaterial({
                        diffuseColor: layer.color,
                        name: layer.name,
                        transparency: 0,
                        textures: [],
                    }))
                }
            } else if (materialSource?.value === 3 || materialSource?.value === 1 && colorSource?.value === 3) { // material from parent
                mesh.traverseAncestors((parent: any) => {
                    if (parent?.material) mesh.material = parent.material
                })
            } else if (materialSource && materialSource.value !== 1) {
                console.warn('Unknown material source', materialSource, mesh, mesh.userData.attributes)
            }
        }
    }

    private _useInstancedMesh(obj: Object3D) {
        if (!Rhino3dmLoader2.ReplaceWithInstancedMesh) return
        if (obj.children.length <= 0) return
        const children = obj.children
        const geometries = children.map((c: any) => c.geometry)
        const uniqueGeometries = geometries.filter((g, i) => geometries.indexOf(g) === i)
        uniqueGeometries.forEach((g) => {
            const instances = children.filter((c: any) => c.geometry === g)
            const instances2 = instances.length > 0 ? instances.filter((c: any) => c.material === (instances[0] as any).material) : []
            if (instances2.length > 1) {
                const instanced = new InstancedMesh(g, (instances2[0] as any).material, instances2.length)
                instanced.userData = {...instances2[0].userData}
                instanced.userData.instanceUserData = []
                instanced.userData.attributes = instanced.userData.defAttributes || instanced.userData.attributes
                if (instanced.userData.defAttributes) delete instanced.userData.defAttributes
                instanced.name = instanced.userData.attributes?.name || instances2[0].name
                instances2.forEach((c: any, i: number) => {
                    instanced.setMatrixAt(i, c.matrix)
                    obj.remove(c)
                    instanced.userData.instanceUserData.push(c.userData)
                })
                obj.add(instanced)
            }
        })
    }

    private _hideLineMesh(obj: Object3D) {
        if (!Rhino3dmLoader2.HideLineMesh && !Rhino3dmLoader2.HidePointMesh) return
        if (obj.children.length <= 0) return
        const toHide: any[] = []
        obj.traverse((c) => {
            if (c && (
                Rhino3dmLoader2.HideLineMesh && ((c as Line).isLine || (c as LineSegments).isLineSegments))
                ||
                Rhino3dmLoader2.HidePointMesh && (c as Points).isPoints
            ) toHide.push(c)
        })
        toHide.forEach((c) => {
            c.userData.visible_3dm = c.visible
            c.visible = false
        })
    }
}

