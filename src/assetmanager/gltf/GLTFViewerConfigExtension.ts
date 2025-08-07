import type {GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {ISerializedViewerConfig, ThreeViewer} from '../../viewer'
import {Group, ImageUtils} from 'three'
import {RGBEPNGLoader} from '../import/RGBEPNGLoader'
import {SerializationResourcesType} from '../../utils'
import {RootSceneImportResult} from '../IAssetImporter'
import {halfFloatToRgbe} from '../../three'

export class GLTFViewerConfigExtension {

    static readonly ViewerConfigGLTFExtension = 'WEBGI_viewer'

    // region Import
    /**
     * Import viewer config from glTF(exported from {@link GLTFViewerConfigExtension.ExportViewerConfig}) and sets in scene.importedViewerConfig
     * Must be called from afterRoot in gltf loader. Used in {@link GLTFLoader2.setup}
     * Only imports, does not apply.
     * @param parser
     * @param viewer
     * @param resultScenes
     * @param scene
     */
    static async ImportViewerConfig(parser: GLTFParser, viewer: ThreeViewer, resultScenes: Group[], scene?: any): Promise<Partial<ISerializedViewerConfig>> {
        if (!scene) {
            const scenes = (parser.json.scenes as Group[]) || []
            if (scenes.length !== 1) {
                for (const scene1 of scenes) {
                    const i = scenes.indexOf(scene1)
                    await this.ImportViewerConfig(parser, viewer, i >= 0 ? [resultScenes[i]] : resultScenes, scene1)
                }
                return {}
            }
            scene = scenes[0]
        }
        const resultScene = resultScenes.length > 0 ? resultScenes[0] : undefined

        const viewerConfig1: Partial<ISerializedViewerConfig> = scene.extensions?.[this.ViewerConfigGLTFExtension]
        // console.log({...viewerConfig?.resources})

        if (!viewerConfig1) return {}

        const viewerConfig: ISerializedViewerConfig = {
            type: 'ThreeViewer',
            version: '0',
            plugins: [],
            assetType: 'config',
            ...viewerConfig1,
        }
        if (viewerConfig.resources) {
            await this._parseArrayBuffers(viewerConfig.resources, parser)

            // Find empty resources and try to find them in the glTF as a dependency by saved UUID.
            const extraResources = await this._parseExtraResources(viewerConfig.resources, parser, viewer)

            viewerConfig.resources = await viewer.loadConfigResources(viewerConfig.resources || {}, extraResources)

        }

        if (resultScene) (resultScene as RootSceneImportResult).importedViewerConfig = viewerConfig

        return viewerConfig
    }

    /**
     * Find resources in parser from uuid
     * @param currentResources
     * @param parser
     * @param viewer
     * @private
     */
    private static async _parseExtraResources(currentResources: {textures?: Record<string, any>, materials?: Record<string, any>}, parser: GLTFParser, viewer: ThreeViewer) {
        const extraResources: any = {
            textures: {},
            materials: {},
        }

        if (currentResources.textures && parser.json.textures)
            for (const [uuid, texture] of [...Object.entries(currentResources.textures)]) {
                // console.log(texture) // todo: texture should be {} but its {userData:undefined}, why?
                if ((texture as any).uuid || !uuid) continue
                delete currentResources.textures[uuid]

                const texIndex = parser.json.textures.findIndex((t: any) =>
                    t.extras?.uuid === uuid ||
                    parser.json.samplers?.[t.sampler]?.extras?.uuid === uuid ||
                    parser.json.images?.[t.source]?.extras?.t_uuid === uuid
                )
                // This HAS To be called from afterRoot in gltf loader.
                // And make sure that texture is not cloned in any gltf extension like khr_texture_transform, which happens in three.js by default and it's commented in custom fork.
                if (texIndex >= 0)
                    extraResources.textures[uuid] = await parser.getDependency('texture', texIndex)
            }

        // todo: need to test, because materials are also cloned in GLTFLoader.js
        if (currentResources.materials && parser.json.materials)
            for (const [uuid, material] of [...Object.entries(currentResources.materials)]) {
                // console.log(material)
                if ((material as any).uuid || !uuid) continue
                delete currentResources.materials[uuid]

                const matIndex = parser.json.materials.findIndex((m: any) => m.extras?.uuid === uuid)
                if (matIndex >= 0) {
                    const mat = await parser.getDependency('material', matIndex)
                    extraResources.materials[uuid] = viewer.assetManager.materials.convertToIMaterial(mat)
                }
            }

        // todo: do same for other dependencies?
        return extraResources
    }

    private static async _parseArrayBuffers(resources: Partial<SerializationResourcesType>, parser: GLTFParser) {
        const buffers: any = []
        Object.values(resources).forEach((res: any) => {
            Object.values(res).forEach((item: any) => {
                if (!item.url) return
                if (item.url.type === 'Uint16Array' && item.url.data) {
                    // item.url.data = new Uint16Array(item.url.data)
                    buffers.push(item.url)
                }
                if (item.url.type === 'Uint8Array' && item.url.data) {
                    // item.url.data = new Uint8Array(item.url.data)
                    buffers.push(item.url)
                }
            })
        })

        for (const buff of buffers) {
            const imgIndex = buff.data.image
            const img = parser.json.images[imgIndex]
            const bufferView = await parser.getDependency('bufferView', img.bufferView)

            // todo: add more checks
            if (img.mimeType.startsWith('image/') && buff.type === 'Uint16Array' && buff.encoding === 'rgbe') {
                // todo: find a optimal way, this has too many cross conversions
                // const view2 = (bufferView as ArrayBuffer).slice(0, bufferView.byteLength - 4)

                const blob = new Blob([bufferView])
                // const blob2 = new Blob([await blob.text()], {type: img.mimeType})
                let url = URL.createObjectURL(blob)
                const encodingVersion = buff.encodingVersion || 1
                if (encodingVersion < 2) {
                    url = 'data:image/png;base64,' + btoa(await blob.text())
                }
                // fetch(url).then(async r=>r.blob()).then(b=>console.log(b))
                // console.log(view2)
                buff.data = (await new RGBEPNGLoader().parseAsync(url, undefined, encodingVersion < 3)).data
                URL.revokeObjectURL(url)
                delete buff.encoding
                delete buff.encodingVersion
            } else {
                buff.data = bufferView
            }
        }
    }

    // endregion

    // region Export

    /**
     * Export viewer config to glTF(can be imported by {@link GLTFViewerConfigExtension.ImportViewerConfig}).
     * Used in {@link GLTFExporter2}
     * @param viewer
     * @param writer
     * @constructor
     */
    static ExportViewerConfig(viewer: ThreeViewer, writer: GLTFWriter): void {
        const viewerData = viewer.toJSON(true, undefined)

        const json = writer.json
        this._bundleExtraResources(json, viewerData)

        this._bundleArrayBuffers(viewerData, writer)

        const scene = writer.json.scenes[writer.json.scene || 0]
        if (!scene.extensions) scene.extensions = {}
        writer.extensionsUsed[this.ViewerConfigGLTFExtension] = true
        scene.extensions[this.ViewerConfigGLTFExtension] = viewerData
    }

    private static _bundleArrayBuffers(viewerData: any, writer: GLTFWriter) {
        // For DataTextures like env map with custom rgbe encoding
        // Create objects of TypedArray
        const buffers: any = []
        Object.values(viewerData.resources).forEach((res: any) => {
            if (res) Object.values(res).forEach((item: any) => {
                if (!item.url) return
                if (item.url.type === 'Uint16Array' && item.url.data) {
                    if (!(item.url.data instanceof Uint16Array)) item.url.data = new Uint16Array(item.url.data)
                    buffers.push(item.url)
                }
                if (item.url.type === 'Uint8Array' && item.url.data) {
                    if (!(item.url.data instanceof Uint8Array)) item.url.data = new Uint8Array(item.url.data)
                    buffers.push(item.url) // todo: just use jpeg or PNG for this
                }
            })
        })
        // console.log(writer)
        for (const buffer of buffers) {
            // todo:[update: done one case below] check if buffer is of image, if yes convert to rgbe with png compression blob. [or this can be done while serializing the DataTexture]

            let mime = 'application/octet-stream'
            if (buffer.mimeType) mime = buffer.mimeType
            // console.log(buffer, buffer.data)
            const encodeUint16Rgbe = writer.options.exporterOptions.encodeUint16Rgbe // disabled for now, todo: add a UI option to enable this
            if (encodeUint16Rgbe && buffer.type === 'Uint16Array' && buffer.width > 0 && buffer.height > 0) { // import for this is handled in gltf.ts:importViewer.
                // todo: also check if this is indeed an hdr image or something else like LUT or other kind of embedded file.

                const encodingVersion: any = 3

                // todo: can we optimize this? this is too many steps
                const d = encodingVersion < 3 ? halfFloatToRgbe2(buffer.data, 4) : halfFloatToRgbe(buffer.data, 4)
                const id = new ImageData(d, buffer.width, buffer.height)

                const b64 = ImageUtils.getDataURL(id, true).split(',')[1]

                mime = 'image/png'
                if (encodingVersion === 1) {
                    buffer.data = atob(b64)
                } else if (encodingVersion === 2 || encodingVersion === 3) {
                    buffer.data = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
                } else {
                    throw new Error('Invalid encoding version')
                }
                buffer.encoding = 'rgbe'
                buffer.encodingVersion = encodingVersion
            }
            // console.log(mime, buffer)

            // const blob = new Blob([buffer.data], {type: mime})
            if (!writer.json.images) writer.json.images = []
            const img: any = {
                mimeType: mime,
            }
            // console.log(buffer, img)
            const imgIndex = writer.json.images.push(img) - 1
            const data = buffer.data
            img.bufferView = writer.processBufferViewImageBuffer(data)
            // console.log(buffer)
            buffer.data = {image: imgIndex}

        }
    }

    /**
     * Find the resources that are in the viewer config AND in writer.json and use the ones in writer and remove from viewer Config.
     * For now (for the lack of a better way) we can let the resources be exported twice and removed from resources. Overhead will be just for some images.
     * @param json
     * @param viewerData
     * @private
     */
    private static _bundleExtraResources(json: GLTFWriter['json'], viewerData: any) {
        if (json.textures && json.samplers && json.images && viewerData.resources.textures)
            [...Object.entries(viewerData.resources.textures)].forEach(([uuid, texture]: [string, any]) => {
                const tex = json.textures.find((t: any) => // find same texture in gltf writer
                    t.extras?.uuid === uuid ||
                    json.samplers[t.sampler]?.extras?.uuid === uuid ||
                    json.images[t.source]?.extras?.t_uuid === uuid // todo: remove t_uuid when sampler extras supported by gltf-transform: https://github.com/donmccurdy/glTF-Transform/issues/645
                )
                if (!tex) return
                // console.log('Removing texture', uuid, tex, texture)
                if (texture.image && viewerData.resources.images && viewerData.resources.images[texture.image]) {
                    delete viewerData.resources.images[texture.image] // assuming images are only referenced once.
                }
                viewerData.resources.textures[uuid] = {} // set to empty, can be read from the gltf data after loading gltf
            })

        // todo: test
        if (json.materials && viewerData.resources.materials)
            [...Object.entries(viewerData.resources.materials)].forEach(([uuid, _]: [string, any]) => {
                const mat = json.materials.find((m: any) => m.extras?.uuid === uuid) // same material in gltf writer
                if (!mat) return
                viewerData.resources.materials[uuid] = {} // set to empty, can be read from the gltf data after loading gltf
            })

        // todo: do same for object references?
    }

    // endregion

}

/**
 * @deprecated old version. see {@link halfFloatToRgbe} to convert half float buffer to rgbe
 * adapted from https://github.com/enkimute/hdrpng.js/blob/3a62b3ae2940189777df9f669df5ece3e78d9c16/hdrpng.js#L235
 * channels = 4 for RGBA data or 3 for RGB data. buffer from THREE.DataTexture
 * @param buffer
 * @param channels
 * @param res
 */
function halfFloatToRgbe2(buffer: Uint16Array, channels = 3, res?: Uint8ClampedArray): Uint8ClampedArray {
    let r, g, b, v, s
    const l = buffer.byteLength / (channels * 2) | 0
    res = res || new Uint8ClampedArray(l * 4)
    for (let i = 0;i < l;i++) {
        r = buffer[i * channels]; g = buffer[i * channels + 1]; b = buffer[i * channels + 2]
        v = Math.max(Math.max(r, g), b)
        const e = Math.ceil(Math.log2(v)); s = Math.pow(2, e - 8)
        res[i * 4] = r / s | 0
        res[i * 4 + 1] = g / s | 0
        res[i * 4 + 2] = b / s | 0
        res[i * 4 + 3] = e + 128
    }
    return res
}
