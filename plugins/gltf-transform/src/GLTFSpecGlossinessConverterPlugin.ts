import {AViewerPluginSync, DRACOLoader2, GLTFBinaryExtension, GLTFLoader2, GLTFParser, ThreeViewer} from 'threepipe'
import {Extension, WebIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {GLTFDracoExportPlugin} from './GLTFDracoExportPlugin'
import {metalRough} from '@gltf-transform/functions'

/**
 * GLTFSpecGlossinessConverterPlugin
 *
 * Plugin that adds a gltf loader extension that automatically converts GLTF files with specular glossiness materials ([KHR_materials_pbrSpecularGlossiness](https://kcoley.github.io/glTF/extensions/2.0/Khronos/KHR_materials_pbrSpecularGlossiness/)) to metallic roughness during import.
 *
 * To use this plugin, simply add it to the viewer and import a file with specular glossiness materials.
 * If `confirm` is set to true, a confirmation dialog will be shown before the conversion.
 */
export class GLTFSpecGlossinessConverterPlugin extends AViewerPluginSync {
    enabled = true

    static readonly PluginType = 'GLTFSpecGlossinessConverterPlugin'
    toJSON: any = undefined

    // dependencies = [GLTFDracoExportPlugin]

    /**
     * Whether to show the confirmation dialog when loading a GLTF file with specular glossiness materials.
     * If set to false, the conversion will be done automatically without confirmation.
     * To disable the conversion entirely, disable the plugin.
     */
    confirm = true
    /**
     * The message to show in the confirmation dialog when loading a GLTF file with specular glossiness materials.
     */
    confirmMessage = 'GLTF Load: This file includes specular glossiness materials, do you want to convert it to metallic roughness before load?'

    private _loaderCreate({loader}: {loader: GLTFLoader2}) {
        if (!loader.isGLTFLoader2) return

        const ep = this._viewer?.getPlugin(GLTFDracoExportPlugin)
        if (!ep) {
            console.error('GLTFSpecGlossinessConverterPlugin requires GLTFDracoExportPlugin in the plugin for extra extensions')
        }
        loader.register(gltfKhrPbrSpecularGlossinessConverter(async(m)=>!this.enabled ? false : !this.confirm ? true : this._viewer?.dialog.confirm(this.confirmMessage || m) ?? true, ep?.gltfTransformExtensions))
    }

    constructor() {
        super()
        this._loaderCreate = this._loaderCreate.bind(this)
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        v.assetManager.importer.addEventListener('loaderCreate', this._loaderCreate as any)
    }

    onRemove(v: ThreeViewer) {
        v.assetManager.importer.removeEventListener('loaderCreate', this._loaderCreate as any)
        return super.onRemove(v)
    }
}


export const gltfKhrPbrSpecularGlossinessConverter = (confirm?: (s: string)=>Promise<boolean>, extensions?: (typeof Extension)[])=>(parser: GLTFParser)=>({
    name: 'KHR_materials_pbrSpecularGlossiness',
    beforeRoot: async() => {
        try {
            if (!parser.json.extensionsUsed || !parser.json.extensionsUsed.includes('KHR_materials_pbrSpecularGlossiness')) return
            const doConfirm = parser.importOptions?.confirmSpecGlossConversion ?? true
            if (doConfirm && confirm && !await confirm('Convert KHR_materials_pbrSpecularGlossiness to KHR_materials_pbrMetallicRoughness?')) return

            const json = parser.json
            const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerExtensions(extensions ?? [])

            if (parser.extensions.KHR_draco_mesh_compression) {
                const dracoLoader = parser.extensions.KHR_draco_mesh_compression.dracoLoader as DRACOLoader2
                if (!dracoLoader.isDRACOLoader2) {
                    console.error('gltfKhrPbrSpecularGlossinessConverter: DRACOLoader2 required')
                    return
                }
                const decoder = await dracoLoader.initDecoder()
                io.registerDependencies({
                    // 'draco3d.encoder': libs[0],
                    ['draco3d.decoder']: decoder,
                })
            }

            const document = await io.readJSON({
                json, resources: {
                    ['@glb.bin']: new Uint8Array(parser.extensions.KHR_binary_glTF?.body),
                },
            })


            // Convert materials.
            await document.transform(metalRough())

            // no need to compress
            if (parser.extensions.KHR_draco_mesh_compression) {
                document.getRoot().listExtensionsUsed().find(e => e.extensionName === 'KHR_draco_mesh_compression')?.dispose()
            }

            // Write back to GLB.
            const res = await io.writeBinary(document)
            const binaryExtension = new GLTFBinaryExtension(res.buffer as any)
            parser.extensions.KHR_binary_glTF = binaryExtension
            parser.json = JSON.parse(binaryExtension.content)

            // this doesn't work for some reason
            // const res = await io.writeJSON(document, {format: Format.GLB})
            // parser.extensions.KHR_binary_glTF.data = res.resources['@glb.bin'].buffer as any
            // parser.extensions.KHR_binary_glTF.content = res.json
            // parser.json = res.json
        } catch (e) {
            console.error(e)
            return
        }
    },
})

declare module 'threepipe'{
    interface ImportAddOptions{
        /**
         * Whether to confirm the conversion of specular glossiness materials to metallic roughness.
         * @default true
         */
        confirmSpecGlossConversion?: boolean
    }
}
