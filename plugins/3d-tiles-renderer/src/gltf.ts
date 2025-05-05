import {
    GLTFCesiumRTCExtension,
    GLTFMeshFeaturesExtension,
    GLTFStructuralMetadataExtension,
// @ts-expect-error moduleResolution issue
} from '3d-tiles-renderer/plugins'
import {AssetManager} from 'threepipe'

export const gltfCesiumRTCExtension = {
    name: 'CESIUM_RTC' satisfies GLTFCesiumRTCExtension['name'],
    import: (_p)=>new GLTFCesiumRTCExtension(),
    export: (_w)=>({
        // todo - save center in userData and access to write back as extension value
    }),
    textures: undefined,
} satisfies AssetManager['gltfExtensions'][number]

export const gltfStructuralMetadataExtension = {
    name: 'EXT_structural_metadata' satisfies GLTFStructuralMetadataExtension['name'],
    import: (_p)=>new GLTFStructuralMetadataExtension(),
    export: (_w)=>({
        // todo
        // beforeParse: ()=>{
        //     throw new Error('not implemented')
        // },
    }),
    textures: undefined,
} satisfies AssetManager['gltfExtensions'][number]

export const gltfMeshFeaturesExtension = {
    name: 'EXT_mesh_features' satisfies GLTFMeshFeaturesExtension['name'],
    import: (_p)=>new GLTFMeshFeaturesExtension(),
    export: (_w)=>({
        // todo
        // beforeParse: ()=>{
        //     throw new Error('not implemented')
        // },
    }),
    // textures: undefined, // todo
} satisfies AssetManager['gltfExtensions'][number]
