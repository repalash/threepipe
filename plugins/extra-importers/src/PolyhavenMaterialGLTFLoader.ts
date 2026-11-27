import {type GLTF, GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {LoadingManager} from 'three'
import {type ILoader, type ImportAddOptions, PhysicalMaterial, UnlitLineMaterial, UnlitMaterial} from 'threepipe'

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
     * Poly Haven's CDN keeps the textures of a material glTF in `Textures/<jpg|png>/<res>/<id>/`, not in the `textures/`
     * folder next to the glTF that the glTF names (that gives a 404). For a glTF loaded from there, the url of each texture
     * is worked out the same way, from the glTF's own url. Other urls load as they are.
     * @param path - the folder of the glTF, like `https://dl.polyhaven.org/file/ph-assets/Textures/gltf/1k/worn_planks/`
     * @param uri - an image uri in the glTF, like `textures/worn_planks_diff_1k.jpg`
     * @returns the url of the image on the CDN, or undefined when the rule doesn't apply
     */
    static PolyhavenTextureUrl(path: string, uri: string): string|undefined {
        const folder = /^(https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/Textures\/)gltf\/([^/]+)\/([^/]+)\/$/.exec(path)
        const file = /^textures\/([^/?#]+\.(jpe?g|png|exr))$/i.exec(uri)
        if (!folder || !file) return undefined
        return `${folder[1]}${file[2].toLowerCase().replace('jpeg', 'jpg')}/${folder[2]}/${folder[3]}/${file[1]}`
    }

    parse(data: string | ArrayBuffer, path: string, onLoad: (gltf: GLTF) => void, onError?: (event: ErrorEvent) => void, url?: string) {
        if (/^https:\/\/dl\.polyhaven\.org\//.test(path)) {
            const bytes = typeof data === 'string' ? undefined : new Uint8Array(data)
            const isGlb = !!bytes && bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'glTF'
            if (!isGlb) {
                const json = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(bytes))
                for (const image of json.images ?? []) {
                    const textureUrl = image.uri && PolyhavenMaterialGLTFLoader.PolyhavenTextureUrl(path, image.uri)
                    if (textureUrl) image.uri = textureUrl
                }
                data = JSON.stringify(json)
            }
        }
        return super.parse(data, path, onLoad, onError, url)
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
