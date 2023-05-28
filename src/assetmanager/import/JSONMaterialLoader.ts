import {SimpleJSONLoader} from './SimpleJSONLoader'
import {ThreeViewer} from '../../viewer'
import {getEmptyMeta, SerializationMetaType, ThreeSerialization} from '../../utils/serialization'
import {IMaterial} from '../../core'

export class JSONMaterialLoader extends SimpleJSONLoader {

    viewer?: ThreeViewer

    async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any> {
        if (!this.viewer) throw 'Viewer not set in JSONMaterialLoader.'

        const json = await super.loadAsync(url, onProgress) as any
        return await JSONMaterialLoader.DeserializeMaterialJSON(json, this.viewer)
    }

    static async DeserializeMaterialJSON(json: any, viewer: ThreeViewer, meta?: SerializationMetaType, obj?: IMaterial|IMaterial[]) {
        meta = meta || getEmptyMeta()
        const json2 = {...json}
        if (json.images) {
            if (Array.isArray(json.images)) meta.images = Object.fromEntries(json.images.map((i: any) => [i.uuid, i]))
            else meta.images = json.images
            delete json2.images
        }
        if (json.textures) {
            if (Array.isArray(json.textures)) meta.textures = Object.fromEntries(json.textures.map((t: any) => [t.uuid, t]))
            else meta.textures = json.textures
            delete json2.textures
        }
        if (json.materials) {
            if (Array.isArray(json.materials)) meta.materials = Object.fromEntries(json.materials.map((m: any) => [m.uuid, m]))
            else meta.materials = json.materials
            delete json2.materials
        }
        const resources = await viewer.loadConfigResources(meta)
        return ThreeSerialization.Deserialize(json2, obj || undefined, resources)
    }
}
