import {GLTFExporter, GLTFExporterOptions, GLTFExporterPlugin} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {IExportParser} from '../IExporter'
import {GLTFWriter2} from './GLTFWriter2'
import {Object3D} from 'three'
import {ThreeViewer} from '../../viewer'
import {
    GLTFLightExtrasExtension,
    GLTFMaterialExtrasExtension,
    GLTFMaterialsAlphaMapExtension,
    GLTFMaterialsBumpMapExtension,
    GLTFMaterialsDisplacementMapExtension,
    GLTFMaterialsLightMapExtension,
    GLTFObject3DExtrasExtension,
    GLTFViewerConfigExtension,
} from '../gltf'
import {glbEncryptionProcessor} from '../gltf/gltfEncyptionHelpers'

export type GLTFExporter2Options = {
    /**
     * embed images in glb even when remote url is available, {@default false}
     */
    embedUrlImages?: boolean,
    /**
     * Embed previews of images in glb, {@default false}
     */
    embedUrlImagePreviews?: boolean,
    /**
     * export viewer config (scene settings)
     */
    viewerConfig?: boolean,
    /**
     * Extension to export to, default for object/scene = glb
     */
    exportExt?: string,
    preserveUUIDs?: boolean,
    /**
     * see GLTFDracoExporter and {@link GLTFMaterialExtrasExtension}
     */
    externalImagesInExtras?: boolean,
    /**
     * see GLTFViewerExport->processViewer, {@default false}
     */
    encodeUint16Rgbe?: boolean
    /**
     * Number of spaces to use when exporting to json, {@default 2}
     */
    jsonSpaces?: number,
    /**
     * Encrypt the exported file in a GLB container using {@link encryptKey}, {@default false}. Works only for glb export.
     */
    encrypt?: boolean,
    /**
     * Encryption key, if not provided, will be prompted, {@default undefined}. Works only for glb export.
     */
    encryptKey?: string|Uint8Array,

    [key: string]: any
} & GLTFExporterOptions

export class GLTFExporter2 extends GLTFExporter implements IExportParser {

    constructor() {
        super()
        this.processors.push(glbEncryptionProcessor)
    }

    register(callback: (writer: GLTFWriter2)=>GLTFExporterPlugin): this {
        return super.register(callback as any)
    }

    processors: ((obj: ArrayBuffer|any|Blob, options: GLTFExporter2Options) => Promise<ArrayBuffer|any|Blob>)[] = []

    async parseAsync(obj: ArrayBuffer|any, options: GLTFExporter2Options): Promise<Blob> {
        if (!obj) throw new Error('No object to export')
        let gltf = !obj.__isGLTFOutput && (Array.isArray(obj) || obj.isObject3D) ? await new Promise((resolve, reject) => this.parse(obj, resolve, reject, options)) : obj

        for (const processor of this.processors) {
            gltf = await processor(gltf, options)
        }

        if (gltf && gltf instanceof Blob) return gltf

        if (gltf && typeof gltf === 'object' && !gltf.byteLength) { // byteLength is for ArrayBuffer
            return new Blob([JSON.stringify(gltf, (k, v)=> k.startsWith('__') ? undefined : v, options.jsonSpaces ?? 2)], {type: 'model/gltf+json'})
        } else if (gltf) {
            return new Blob([gltf as ArrayBuffer], {type: 'model/gltf+binary'})
        } else {
            throw new Error('GLTFExporter2.parse() failed')
        }
    }

    parse(
        input: Object3D | Object3D[],
        onDone: (gltf: ArrayBuffer | {[key: string]: any}) => void,
        onError: (error: ErrorEvent) => void,
        options: GLTFExporter2Options = {},
    ): void {
        const gltfOptions: GLTFWriter2['options'] = {
            // default options
            binary: false,
            trs: false,
            onlyVisible: true,
            truncateDrawRange: true,
            externalImagesInExtras: !options.embedUrlImages && options.externalImagesInExtras || false, // this is handled in gltfMaterialExtrasWriter, also see GLTFDracoExporter
            maxTextureSize: Infinity,
            animations: [],
            includeCustomExtensions: true,
            exporterOptions: options,
        }
        if (options.exportExt === 'glb') {
            gltfOptions.binary = true
        }
        if (options.preserveUUIDs !== false) { // default true
            (Array.isArray(input) ? input : [input]).forEach((obj: Object3D) =>
                obj.traverse((obj1: Object3D) => {
                    if (obj1.uuid) obj1.userData.gltfUUID = obj1.uuid
                }))
        }
        // animations
        (Array.isArray(input) ? input : [input]).forEach((obj: Object3D) =>
            obj.traverse((obj1: Object3D) => {
                if (obj1.animations) {
                    for (const animation of obj1.animations) {
                        if ((animation as any).__gltfExport !== false && !gltfOptions.animations!.includes(animation)) {
                            gltfOptions.animations!.push(...obj1.animations)
                        }
                    }
                }
            }))

        return super.parse(input, (o: any)=> {
            if (options.preserveUUIDs !== false) { // default true
                (Array.isArray(input) ? input : [input]).forEach((obj: Object3D) =>
                    obj.traverse((obj1: Object3D) => {
                        delete obj1.userData.gltfUUID
                    }))
            }
            // eslint-disable-next-line @typescript-eslint/naming-convention
            onDone(Object.assign(o, {__isGLTFOutput: true}))
        }, onError, gltfOptions, new GLTFWriter2())
    }

    static ExportExtensions: ((parser: GLTFWriter2) => GLTFExporterPlugin)[] = [
        GLTFMaterialExtrasExtension.Export,
        GLTFObject3DExtrasExtension.Export,
        GLTFLightExtrasExtension.Export,
        GLTFMaterialsBumpMapExtension.Export,
        GLTFMaterialsDisplacementMapExtension.Export,
        GLTFMaterialsLightMapExtension.Export,
        GLTFMaterialsAlphaMapExtension.Export,
    ]

    setup(viewer: ThreeViewer, extraExtensions?: ((parser: GLTFWriter2) => GLTFExporterPlugin)[]): this {
        for (const ext of GLTFExporter2.ExportExtensions) this.register(ext)
        if (extraExtensions) for (const ext of extraExtensions) this.register(ext)

        // should be last
        this.register(this.gltfViewerWriter(viewer))
        return this

    }

    gltfViewerWriter(viewer: ThreeViewer): (parser: GLTFWriter2) => GLTFExporterPlugin {
        return (writer: GLTFWriter2) => ({
            afterParse: (input: any)=>{
                input = Array.isArray(input) ? input[0] : input
                if (!input?.userData?.rootSceneModelRoot ||
                    writer.options?.exporterOptions?.viewerConfig === false ||
                    input?.userData?.__exportViewerConfig === false
                ) return
                GLTFViewerConfigExtension.ExportViewerConfig(viewer, writer)
            },
        })
    }
}
