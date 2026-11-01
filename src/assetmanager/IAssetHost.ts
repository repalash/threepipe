import type {WebGLRenderer} from 'three'
import type {AssetImporter} from './AssetImporter'
import type {MaterialManager} from './MaterialManager'
import type {SerializationMetaType, SerializationResourcesType} from '../utils/serialization'
import type {ThreeViewer} from '../viewer'

/**
 * What the asset loaders and exporters need from their owner: the importer, the material manager and a way to load
 * serialized resources. A {@link ThreeViewer} provides it, and so does an {@link AssetContext}, without a viewer.
 * @category Asset Manager
 */
export interface IAssetHost {
    readonly assetManager: {
        readonly importer: AssetImporter
        readonly materials: MaterialManager
    }
    /**
     * Loads the resources (textures, materials, geometries…) referenced by serialized data, like a viewer config or a
     * material file. See {@link ThreeViewer.loadConfigResources}
     */
    loadConfigResources(json: Partial<SerializationMetaType>, extraResources?: Partial<SerializationResourcesType>): Promise<SerializationMetaType>
    /**
     * Picks the data type of loaded HDR and EXR textures for the GPU. Without it, the loaders keep their default (half float).
     */
    readonly renderManager?: {readonly renderer: WebGLRenderer}
    /**
     * Canvas for the cameras created when importing a model.
     */
    readonly canvas?: HTMLCanvasElement
    /**
     * Writes the viewer config into exported glTF files, when exporting the scene's model root. Only a viewer has it.
     */
    toJSON?: ThreeViewer['toJSON']
}
