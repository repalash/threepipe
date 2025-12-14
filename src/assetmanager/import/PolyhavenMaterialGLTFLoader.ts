import {type GLTF, GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader'
import {ILoader} from '../IImporter'
import {LoadingManager} from 'three'
import {ImportAddOptions} from '../AssetManager'
import {PhysicalMaterial, UnlitLineMaterial, UnlitMaterial} from '../../core'

export class PolyhavenMaterialGLTFLoader extends GLTFLoader implements ILoader<GLTF, PhysicalMaterial|undefined> {

    constructor(manager: LoadingManager) {
        super(manager)

        // GLTFLoader.ObjectConstructors.DirectionalLight = DirectionalLight2 as any
        // GLTFLoader.ObjectConstructors.PointLight = PointLight2 as any
        // GLTFLoader.ObjectConstructors.SpotLight = SpotLight2 as any
        GLTFLoader.ObjectConstructors.MeshStandardMaterial = PhysicalMaterial as any
        GLTFLoader.ObjectConstructors.MeshBasicMaterial = UnlitMaterial as any
        GLTFLoader.ObjectConstructors.MeshPhysicalMaterial = PhysicalMaterial as any
        GLTFLoader.ObjectConstructors.LineBasicMaterial = UnlitLineMaterial as any
        // GLTFLoader.ObjectConstructors.PointsMaterial = PointsMaterial2
    }

    /**
     * This is run post parse to extract the result material from the GLTF object
     * @param res
     * @param _
     */
    transform(res: GLTF, _: ImportAddOptions): PhysicalMaterial|undefined {
        // find the first PhysicalMaterial in the gltf and return it, if none found return undefined
        let material: PhysicalMaterial|undefined
        res.scene.traverse(o => {
            if (material) return
            const mat = (o as any).material
            if (mat && mat.isPhysicalMaterial) {
                material = mat as PhysicalMaterial
            }
        })
        return material
    }

}
