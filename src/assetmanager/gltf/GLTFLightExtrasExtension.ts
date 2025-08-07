import type {GLTF, GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {ObjectLoader} from 'three'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'

export class GLTFLightExtrasExtension {
    static readonly WebGiLightExtrasExtension = 'WEBGI_light_extras'

    /**
     * Also {@link Export}
     * @param _
     */
    static Import = (_: GLTFParser): GLTFLoaderPlugin =>({
        name: '__' + this.WebGiLightExtrasExtension, // __ is prefix so that the extension is added to userdata, and we can process later in afterRoot
        afterRoot: async(result: GLTF) => {
            const scenes = result.scenes || (result.scene ? [result.scene] : [])
            scenes.forEach(s=>{
                s.traverse((o: any)=>{
                    if (!o.isLight) return
                    const ext = o.userData?.gltfExtensions?.[this.WebGiLightExtrasExtension]
                    if (!ext) {
                        return
                    }

                    // castShadow is in GLTFObject3DExtrasExtension
                    if (!o.shadow && ext.shadow) {
                        console.error('Light has no shadow, cannot import', o, ext)
                    }
                    // keep updated with ObjectLoader.js
                    if (ext.shadow && o.shadow) {
                        if (ext.shadow.bias !== undefined) o.shadow.bias = ext.shadow.bias
                        if (ext.shadow.normalBias !== undefined) o.shadow.normalBias = ext.shadow.normalBias
                        if (ext.shadow.radius !== undefined) o.shadow.radius = ext.shadow.radius
                        if (ext.shadow.mapSize !== undefined) o.shadow.mapSize.fromArray(ext.shadow.mapSize)
                        if (ext.shadow.camera !== undefined) {
                            o.shadow.camera = new ObjectLoader().parseObject(ext.shadow.camera, {}, {}, {}, {})
                        }
                    }

                    delete o.userData.gltfExtensions[this.WebGiLightExtrasExtension]
                })
            })
        },
    })

    /**
     * Also {@link Import}
     */
    static Export = (w: GLTFWriter): GLTFExporterPlugin=> ({
        writeNode: (object: any, nodeDef: any)=>{
            if (!object?.isLight) return
            if (!nodeDef.extensions) nodeDef.extensions = {}
            const dat: any = {}
            if (object.shadow) { // castShadow is in GLTFObject3DExtrasExtension
                dat.shadow = object.shadow.toJSON()
            }
            if (Object.keys(dat).length > 0) {
                nodeDef.extensions[this.WebGiLightExtrasExtension] = dat
                w.extensionsUsed[this.WebGiLightExtrasExtension] = true
            }
        },
    })

    // see GLTFDracoExportPlugin
    static Textures: Record<string, string|number>|undefined = undefined
}
