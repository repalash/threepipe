import {Rhino3dmLoader} from 'three/examples/jsm/loaders/3DMLoader.js'
import {Color, DoubleSide, InstancedMesh, LoadingManager, Material, Mesh, MeshStandardMaterial, Object3D} from 'three'

export class Rhino3dmLoader2 extends Rhino3dmLoader {
    public static LIBRARY_PATH = 'https://cdn.jsdelivr.net/npm/rhino3dm@7.15.0/'

    constructor(manager?: LoadingManager) {
        super(manager)
        this.setLibraryPath(Rhino3dmLoader2.LIBRARY_PATH)
    }
    public static ImportMaterials = true

    materials: Material[] = []

    protected _createMaterial(material: any): Material {
        if (!Rhino3dmLoader2.ImportMaterials) return this.materials[0] || new MeshStandardMaterial({
            color: new Color(1, 1, 1),
            metalness: 0.8,
            name: 'default',
            side: DoubleSide,
        })
        return super._createMaterial(material)
    }
    private _compareMaterials!: (material: Material) => Material

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

            // console.log(obj.userData.attributes)
            // instancing
            this._useInstancedMesh(obj)
            this._useMaterialSource(obj, layer)
        })
        this.materials = [] // so that next file load doesn't give the same materials.
        return ret
    }

    private _useMaterialSource(obj: Object3D, layer: any) {
        if (!Rhino3dmLoader2.ImportMaterials) return
        const mesh = obj as Mesh
        if ((mesh.material as any)?.name === 'default') {

            // https://developer.rhino3d.com/api/rhinoscript/object_methods/objectmaterialsource.htm
            const materialSource = mesh.userData.attributes?.materialSource || mesh.userData.defAttributes?.materialSource
            const colorSource = mesh.userData.attributes?.colorSource || mesh.userData.defAttributes?.colorSource
            // const materialSource = mesh.userData.defAttributes?.materialSource
            // console.log(materialSource, mesh.userData.attributes, mesh.userData.defAttributes)
            if (!materialSource && !colorSource) return
            if (materialSource?.value === 0 || materialSource?.value === 1 && colorSource?.value === 0) { // material from layer
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

    static ReplaceWithInstancedMesh = false
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
}

