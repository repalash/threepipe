import type {GLTF, GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {Object3D} from 'three'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'

export class GLTFObject3DExtrasExtension {
    static readonly WebGiObject3DExtrasExtension = 'WEBGI_object3d_extras'

    /**
     * Also {@link Export}
     * @param _
     */
    static Import = (_: GLTFParser): GLTFLoaderPlugin =>({
        name: '__' + this.WebGiObject3DExtrasExtension, // __ is prefix so that the extension is added to userdata, and we can process later in afterRoot
        afterRoot: async(result: GLTF) => {
            const scenes = result.scenes || (result.scene ? [result.scene] : [])
            scenes.forEach(s=>{
                s.traverse((o: any)=>{
                    if (!o || !o.isObject3D) return
                    const ext = o.userData?.gltfExtensions?.[this.WebGiObject3DExtrasExtension]
                    if (!ext) {
                        if (o.isLight && !o.isAmbientLight) o.castShadow = true
                        return
                    }

                    const hasShadowDef = ext.castShadow !== undefined || ext.receiveShadow !== undefined
                    if (ext.castShadow !== undefined) o.castShadow = ext.castShadow
                    if (ext.receiveShadow !== undefined) o.receiveShadow = ext.receiveShadow
                    if (ext.visible !== undefined) o.visible = ext.visible
                    if (ext.frustumCulled !== undefined) o.frustumCulled = ext.frustumCulled
                    if (ext.renderOrder !== undefined) o.renderOrder = ext.renderOrder
                    // if (ext.userData !== undefined) o.userData = ext.userData
                    if (ext.layers !== undefined) o.layers.mask = ext.layers

                    if (hasShadowDef) {
                        o.userData.__keepShadowDef = true
                    }

                    delete o.userData.gltfExtensions[this.WebGiObject3DExtrasExtension]

                })
            })
        },
    })

    /**
     * Also {@link Import}
     * @param w
     * @constructor
     */
    static Export = (w: GLTFWriter): GLTFExporterPlugin => ({
        writeNode: (object: Object3D, nodeDef: any)=>{
            if (!object?.isObject3D) return
            if (!nodeDef.extensions) nodeDef.extensions = {}
            const dat: any = {}

            // non-default stuff from ObjectLoader.js

            if (object.castShadow !== undefined) dat.castShadow = object.castShadow
            if (object.receiveShadow !== undefined) dat.receiveShadow = object.receiveShadow
            if (object.visible === false) dat.visible = false
            if (object.frustumCulled === false) dat.frustumCulled = false
            if (object.renderOrder !== 0) dat.renderOrder = object.renderOrder
            if (object.layers.mask !== 1) dat.layers = object.layers.mask
            if (object.matrixAutoUpdate === false) dat.matrixAutoUpdate = false

            if (Object.keys(dat).length > 0) {
                nodeDef.extensions[this.WebGiObject3DExtrasExtension] = dat
                w.extensionsUsed[this.WebGiObject3DExtrasExtension] = true
            }
        },
    })

    // see GLTFDracoExportPlugin
    static Textures: Record<string, string|number>|undefined = undefined
}
