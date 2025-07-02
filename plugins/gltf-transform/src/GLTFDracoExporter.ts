import {
    Extension,
    ExtensionProperty,
    GLTF,
    Graph,
    Property,
    PropertyType,
    ReaderContext,
    Texture,
    TextureChannel,
    TextureInfo,
    WebIO,
    WriterContext,
} from '@gltf-transform/core'
import {EncoderOptions} from '@gltf-transform/extensions/dist/khr-draco-mesh-compression/encoder'
import {ALL_EXTENSIONS, KHRDracoMeshCompression} from '@gltf-transform/extensions'
import {DRACOLoader2, GLTFExporter2, GLTFExporter2Options, GLTFViewerConfigExtension, IExportWriter} from 'threepipe'

/**
 * GLTF Draco Exporter
 *
 * Extension of GLTFExporter2 that runs the output through gltf-transform for draco compression.
 */
export class GLTFDracoExporter extends GLTFExporter2 implements IExportWriter {
    public loader?: DRACOLoader2 // required for loading draco libs.
    private _io: WebIO
    private _loadedLibs = false
    private _encoderOptions: EncoderOptions

    constructor(encoderOptions?: EncoderOptions, loader?: DRACOLoader2) {
        super()
        encoderOptions = encoderOptions || {
            method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
            encodeSpeed: 5,
        }
        this._io = new WebIO().registerExtensions(ALL_EXTENSIONS)
        this._encoderOptions = encoderOptions

        if (loader) {
            this.loader = loader
            this.loader.setDecoderConfig({type: 'js'}) // todo: hack for now.
            this.loader.preload(true, true)
        }

    }

    preload(): this {
        this._loadLibs()
        return this
    }

    private async _loadLibs() {
        if (this._loadedLibs || !this.loader) return

        const libs = await Promise.all([
            this.loader.initEncoder(),
            this.loader.initDecoder(),
        ])
        this._io.registerDependencies({
            ['draco3d.encoder']: libs[0],
            ['draco3d.decoder']: libs[1], // only required if we are loading a draco compressed gltf
        })
        this._loadedLibs = true

    }

    async parseAsync(obj: any, {compress = false, dracoOptions, ...options}: {compress: boolean, dracoOptions?: EncoderOptions} & GLTFExporter2Options, throwOnError = false): Promise<Blob> {
        if (!this.loader) {
            console.error('GLTFDracoExporter: No DRACOLoader2 instance provided')
            return super.parseAsync(obj, options)
        }
        await this._loadLibs()

        const ops = {...options}
        if (compress) {
            // externalImagesInExtras: this is required because gltf-transform doesn't support external images in glb
            // see https://github.com/donmccurdy/glTF-Transform/discussions/644
            ops.externalImagesInExtras = true
        }

        const uncompressed = await new Promise((resolve, reject) => this.parse(obj, resolve, reject, ops)) as any

        const uncompressedBlob = await super.parseAsync(uncompressed, ops)
        if (!compress) return uncompressedBlob

        try {
            if (!uncompressed) throw new Error('GLTFDracoExporter: gltf is null')

            let gltf = uncompressed

            const bytes = (gltf as ArrayBuffer).byteLength || Infinity

            const iDocument = await (typeof gltf === 'object' && !(gltf as any).byteLength ? this._io.readJSON({
                json: gltf as GLTF.IGLTF,
                resources: {},
            }) : this._io.readBinary(new Uint8Array(gltf as ArrayBuffer)))

            // iDocument.createExtension(GLTFViewerConfigExtensionGP)
            iDocument.createExtension(KHRDracoMeshCompression)
                .setRequired(true)
                .setEncoderOptions({...this._encoderOptions, ...dracoOptions ?? {}})

            if (ops.exportExt === 'glb') {
                gltf = await this._io.writeBinary(iDocument)
                if (isFinite(bytes)) {
                    console.log('DRACO Compression ratio: ' + ((gltf as ArrayBuffer).byteLength / bytes).toFixed(5))
                }
            } else {
                const jDoc = await this._io.writeJSON(iDocument)
                gltf = jDoc.json
                if (Object.values(jDoc.resources).filter(v => v).length > 0) {
                    console.warn('DRACOExporter: extra resources in resources not supported properly')
                    ;(gltf as any).resources = jDoc.resources
                }
            }

            gltf.__isGLTFOutput = true
            const blob = await super.parseAsync(gltf, ops) as any // this will just convert it to blob because __isGLTFOutput is set (checked in GLTFExporter2)
            if (!blob) throw new Error('GLTFDracoExporter: blob is null')
            blob.ext = 'glb'
            ;(blob as any).__uncompressed = uncompressedBlob
            return blob
        } catch (e) {
            if (throwOnError) throw e
            console.error('Unable to compress glb with DRACO extension, fallback to uncompressed')
            console.error(e)
            return uncompressedBlob
        }
    }

    addExtension(...extension: (typeof Extension)[]): this {
        this._io.registerExtensions(extension)
        return this
    }
    createAndAddExtension(name: string, textures?: Record<string, string|number>): this {
        return this.addExtension(createGenericExtensionClass(name, textures))
    }
    createAndAddExtensions(extensions: [string, Record<string, string|number>|undefined][]): this {
        return this.addExtension(...extensions.map(e=> createGenericExtensionClass(e[0], e[1])))
    }
}

declare module 'threepipe'{
    interface GLTFExporter2Options {
        compress?: boolean
        dracoOptions?: EncoderOptions
    }
}

// for @gltf-transform/core
class ViewerJSONExtensionProperty extends ExtensionProperty {
    readonly extensionName: string = GLTFViewerConfigExtension.ViewerConfigGLTFExtension
    readonly parentTypes: string[] = [PropertyType.SCENE]
    readonly propertyType: string = 'ViewerJSON'

    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected init(): void {return}

}
export class GLTFViewerConfigExtensionGP extends Extension {
    public readonly extensionName = GLTFViewerConfigExtension.ViewerConfigGLTFExtension
    public static readonly EXTENSION_NAME = GLTFViewerConfigExtension.ViewerConfigGLTFExtension
    private _viewerConfig: any = {}
    // private _texturesRef: [any, Texture][] = []

    read(context: ReaderContext): this {
        this._viewerConfig = {}
        context.jsonDoc.json.scenes?.forEach((sceneDef, sceneIndex)=>{
            if (sceneDef.extensions && sceneDef.extensions[GLTFViewerConfigExtension.ViewerConfigGLTFExtension]) {
                const prop = new ViewerJSONExtensionProperty(this.document.getGraph())
                context.scenes[sceneIndex].setExtension(GLTFViewerConfigExtension.ViewerConfigGLTFExtension, prop)
                this._viewerConfig = sceneDef.extensions[GLTFViewerConfigExtension.ViewerConfigGLTFExtension] as any
                // prop.setExtras()

                /*
                const buffers = [] as any[]

                Object.values(viewerConfig.resources).forEach((res: any) => {
                    Object.values(res).forEach((item: any) => {
                        if (!item.url) return
                        if (item.url.data?.image !== null) {
                            buffers.push(item.url)
                        }
                    })
                })
                const jsonDoc = context.jsonDoc
                console.log(buffers)
                for (const buffer of buffers) {
                    const img = buffer.data.image as number
                    const imageDef = jsonDoc.json.images![img]
                    const bufferViewDef = jsonDoc.json.bufferViews![imageDef.bufferView!]
                    const bufferDef = jsonDoc.json.buffers![bufferViewDef.buffer]
                    const bufferData = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER]
                    const byteOffset = bufferViewDef.byteOffset || 0
                    const byteLength = bufferViewDef.byteLength
                    const imageData = bufferData.slice(byteOffset, byteOffset + byteLength)
                    const texture = this.document.createTexture(imageDef.name)
                    texture.setImage(imageData)
                    this._texturesRef.push([buffer, texture])
                }
                */


            }
        })
        return this
    }

    write(context: WriterContext): this {
        this.document.getRoot().listScenes().forEach((scene)=>{
            const prop = scene.getExtension(GLTFViewerConfigExtension.ViewerConfigGLTFExtension)
            if (prop) {
                const sceneDef = context.jsonDoc.json.scenes?.[context.jsonDoc.json.scene || 0] // todo: get proper scene index, if working with multiple scenes
                if (sceneDef && Object.keys(this._viewerConfig).length > 0) {
                    sceneDef.extensions = sceneDef.extensions || {}

                    /*
                    console.log(context.jsonDoc.json.images)
                    for (const [buffer, texture] of this._texturesRef) {
                        const imageDef = context.createPropertyDef(texture) as GLTF.IImage
                        context.createImageData(imageDef, texture.getImage()!, texture)
                        buffer.data.image = context.jsonDoc.json.images!.push(imageDef) - 1
                        context.imageIndexMap.set(texture, buffer.data.image)
                    }
                    console.log(context.jsonDoc.json)
                    */

                    sceneDef.extensions[GLTFViewerConfigExtension.ViewerConfigGLTFExtension] = this._viewerConfig

                    // this._texturesRef = []
                    this._viewerConfig = {}

                }
            }
        })

        return this
    }

    required = true
}

class GenericExtensionProperty extends ExtensionProperty<any> {
    readonly extensionName: string
    readonly parentTypes: string[] = [PropertyType.MATERIAL, PropertyType.MESH, PropertyType.NODE, PropertyType.SCENE]
    readonly propertyType: string = 'GenericExtension'
    textures: Record<string, [TextureInfo, Texture|null]> = {}

    addTexture(key: string, texInfo: TextureInfo, texture: Texture | null, channels = 0x1111) {
        this.setRef(key, texture, {channels})
        this.textures[key] = [texInfo, texture]
    }

    constructor(graph: Graph<Property>, name: string, extensionName: string) {
        super(graph, name)
        this.extensionName = extensionName
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected init(): void {return}
}

// see transmission extension for reference
abstract class GenericExtension extends Extension {
    abstract readonly extensionName: string

    textureChannels: Record<string, number> = {}

    read(context: ReaderContext): this {
        const jsonDoc = context.jsonDoc
        // console.log(jsonDoc)
        const materialDefs = jsonDoc.json.materials || []
        const textureDefs = jsonDoc.json.textures || []
        materialDefs.forEach((materialDef, materialIndex) => {
            if (materialDef.extensions && materialDef.extensions[this.extensionName]) {
                const paramsExt = new GenericExtensionProperty(this.document.getGraph(), '', this.extensionName)
                context.materials[materialIndex].setExtension(this.extensionName, paramsExt)
                const paramsExtDef = materialDef.extensions[this.extensionName] as Record<string, any>
                const paramsExtDef2 = {...paramsExtDef}

                for (const [key, value] of Object.entries(paramsExtDef2)) {
                    if (typeof value?.index === 'number') { // this is a texture...
                        const textureInfoDef = value
                        const source = textureDefs[textureInfoDef.index]?.source
                        if (typeof source !== 'number') {
                            console.warn('GLTF Pipeline: source texture not found for texture info', textureInfoDef)
                            continue
                        }
                        const texture = context.textures[source]
                        const texInfo = new TextureInfo(this.document.getGraph())
                        const channels = this.textureChannels[key] ?? 0x1111
                        paramsExt.addTexture(key, texInfo, texture, channels)
                        context.setTextureInfo(texInfo, textureInfoDef)
                        delete paramsExtDef2[key]
                    }
                }

                paramsExt.setExtras(paramsExtDef2)
                // console.log({...paramsExtDef})
            }
        })
        const meshDefs = jsonDoc.json.meshes || []
        meshDefs.forEach((meshDef, meshIndex) => {
            if (meshDef.extensions && meshDef.extensions[this.extensionName]) {
                const paramsExt = new GenericExtensionProperty(this.document.getGraph(), '', this.extensionName)
                context.meshes[meshIndex].setExtension(this.extensionName, paramsExt)
                const paramsExtDef = meshDef.extensions[this.extensionName] as Record<string, any>
                paramsExt.setExtras(paramsExtDef)
            }
        })
        const nodeDefs = jsonDoc.json.nodes || []
        nodeDefs.forEach((nodeDef, nodeIndex) => {
            if (nodeDef.extensions && nodeDef.extensions[this.extensionName]) {
                const paramsExt = new GenericExtensionProperty(this.document.getGraph(), '', this.extensionName)
                context.nodes[nodeIndex].setExtension(this.extensionName, paramsExt)
                const paramsExtDef = nodeDef.extensions[this.extensionName] as Record<string, any>
                paramsExt.setExtras(paramsExtDef)
                // console.log(paramsExtDef)
            }
        })
        const sceneDefs = jsonDoc.json.scenes || []
        sceneDefs.forEach((sceneDef, sceneIndex) => {
            if (sceneDef.extensions && sceneDef.extensions[this.extensionName]) {
                const paramsExt = new GenericExtensionProperty(this.document.getGraph(), '', this.extensionName)
                context.scenes[sceneIndex].setExtension(this.extensionName, paramsExt)
                const paramsExtDef = sceneDef.extensions[this.extensionName] as Record<string, any>
                paramsExt.setExtras(paramsExtDef)
                // console.log(paramsExtDef)
            }
        })

        return this
    }

    write(context: WriterContext): this {
        const jsonDoc = context.jsonDoc
        this.document.getRoot()
            .listMaterials()
            .forEach((material) => {
                const paramsExt = material.getExtension<GenericExtensionProperty>(this.extensionName)
                // console.log(paramsExt)
                if (paramsExt) {
                    const materialIndex = context.materialIndexMap.get(material)!
                    const materialDef = jsonDoc.json.materials![materialIndex]
                    materialDef.extensions = materialDef.extensions || {}
                    const extensionDef = paramsExt.getExtras()
                    const extensionDef2 = {...extensionDef}

                    // console.log(paramsExt.textures)
                    for (const [key, value] of Object.entries(paramsExt.textures)) {
                        const textureInfo = value[0]
                        const textureLink = value[1]
                        const texture = textureLink

                        if (texture)
                            extensionDef2[key] = context.createTextureInfoDef(texture, textureInfo)

                        // console.log(texture)

                    }
                    // console.log(extensionDef2)

                    materialDef.extensions[this.extensionName] = extensionDef2
                }
            })
        this.document.getRoot()
            .listMeshes()
            .forEach((mesh) => {
                const paramsExt = mesh.getExtension<GenericExtensionProperty>(this.extensionName)
                if (paramsExt) {
                    const meshIndex = context.meshIndexMap.get(mesh)!
                    const meshDef = jsonDoc.json.meshes![meshIndex]
                    meshDef.extensions = meshDef.extensions || {}
                    meshDef.extensions[this.extensionName] = paramsExt.getExtras()
                }
            })
        this.document.getRoot()
            .listNodes()
            .forEach((node) => {
                const paramsExt = node.getExtension<GenericExtensionProperty>(this.extensionName)
                if (paramsExt) {
                    const nodeIndex = context.nodeIndexMap.get(node)!
                    const nodeDef = jsonDoc.json.nodes![nodeIndex]
                    nodeDef.extensions = nodeDef.extensions || {}
                    nodeDef.extensions[this.extensionName] = paramsExt.getExtras()
                }
            })
        this.document.getRoot()
            .listScenes()
            .forEach((scene) => {
                const paramsExt = scene.getExtension<GenericExtensionProperty>(this.extensionName)
                if (paramsExt) {
                    const sceneIndex = context.jsonDoc.json.scene || 0 // todo: get proper scene index, if working with multiple scenes, this will do the default one.
                    const sceneDef = jsonDoc.json.scenes![sceneIndex]
                    if (!sceneDef) return
                    sceneDef.extensions = sceneDef.extensions || {}
                    sceneDef.extensions[this.extensionName] = paramsExt.getExtras()
                }
            })

        return this
    }

}

function stringToChannel(s: string) {
    let r = 0
    if (s.includes('R')) r |= TextureChannel.R
    if (s.includes('G')) r |= TextureChannel.G
    if (s.includes('B')) r |= TextureChannel.B
    if (s.includes('A')) r |= TextureChannel.A
    return r
}

export function createGenericExtensionClass(name: string, textures?: Record<string, string|number>): typeof GenericExtension {
    return class extends GenericExtension {
        public static readonly EXTENSION_NAME = name
        readonly extensionName = name
        textureChannels: Record<string, number> = !textures ? {} : Object.fromEntries(
            Object.entries(textures)
                .map(([k, v])=>
                    [k, typeof v === 'number' ? v : stringToChannel(v)])
        )
    }
}
