import {GLTFExporter, GLTFExporterPlugin} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {IExportWriter} from '../IExporter'
import {GLTFWriter2} from './GLTFWriter2'
import {AnimationClip, BufferAttribute, BufferGeometry, Object3D} from 'three'
import {ThreeViewer} from '../../viewer'
import {
    glbEncryptionProcessor,
    GLTFLightExtrasExtension,
    GLTFMaterialExtrasExtension,
    GLTFMaterialsAlphaMapExtension,
    GLTFMaterialsDisplacementMapExtension,
    GLTFMaterialsLightMapExtension,
    GLTFObject3DExtrasExtension,
    GLTFViewerConfigExtension,
} from '../gltf'
import {IGeometry, IObject3D, MeshLine, MeshLineSegments} from '../../core'

export interface GLTFExporter2Options {
    /**
     * embed images in glb even when remote url is available
     * @default false
     */
    embedUrlImages?: boolean,
    /**
     * Embed previews of images in glb
     * @default false
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
     * see GLTFViewerExport->processViewer
     * @default false
     */
    encodeUint16Rgbe?: boolean
    /**
     * Number of spaces to use when exporting to json
     * @default 2
     */
    jsonSpaces?: number,
    /**
     * Encrypt the exported file in a GLB container using {@link encryptKey}
     * @default false.
     * Works only for glb export.
     */
    encrypt?: boolean,
    /**
     * Encryption key, if not provided, will be prompted
     * @default undefined.
     * Works only for glb export.
     */
    encryptKey?: string|Uint8Array,


    // From GLTFExporter

    /**
     * Export position, rotation and scale instead of matrix per node.
     * Default is false
     */
    trs?: boolean;

    /**
     * Export only visible objects.
     * Default is false.
     */
    onlyVisible?: boolean;

    /**
     * Export just the attributes within the drawRange, if defined, instead of exporting the whole array.
     * Default is true.
     */
    truncateDrawRange?: boolean;

    /**
     * Restricts the image maximum size (both width and height) to the given value. This option works only if embedImages is true.
     * Default is Infinity.
     */
    maxTextureSize?: number;

    /**
     * List of animations to be included in the export.
     */
    animations?: AnimationClip[];

    /**
     * Generate indices for non-index geometry and export with them.
     * Default is false.
     */
    forceIndices?: boolean;

    /**
     * Export custom glTF extensions defined on an object's userData.gltfExtensions property.
     * Default is true.
     */
    includeCustomExtensions?: boolean;

    [key: string]: any
}

export class GLTFExporter2 extends GLTFExporter implements IExportWriter {

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
        const gltfOptions = {
            // default options
            binary: false as boolean,
            trs: options.trs ?? false,
            onlyVisible: options.onlyVisible ?? false,
            truncateDrawRange: options.truncateDrawRange ?? true,
            externalImagesInExtras: !options.embedUrlImages && options.externalImagesInExtras || false, // this is handled in gltfMaterialExtrasWriter, also see GLTFDracoExporter
            maxTextureSize: options.maxTextureSize ?? Infinity,
            animations: options.animations ?? [],
            includeCustomExtensions: options.includeCustomExtensions ?? true,
            forceIndices: options.forceIndices ?? false, // todo implement
            exporterOptions: options,
            ignoreInvalidMorphTargetTracks: options.ignoreInvalidMorphTargetTracks,
            ignoreEmptyTextures: options.ignoreEmptyTextures,
        } satisfies GLTFWriter2['options']
        if (options.exportExt === 'glb') {
            gltfOptions.binary = true
        }

        const meshLines = new Map<MeshLine|MeshLineSegments, IGeometry>();

        // collect animations and preserveUUID(default true)
        (Array.isArray(input) ? input : [input]).forEach((obj: IObject3D) =>
            obj.traverse((obj1: IObject3D) => {
                if (options.preserveUUIDs !== false && obj1.uuid) obj1.userData.gltfUUID = obj1.uuid

                // save the root where gltf animations are set, this is required since objects can have the same name in diff hierarchies
                if (obj1.animations) {
                    for (const animation of obj1.animations) {
                        if (animation.__gltfExport === false) continue
                        const rootRefs: string[] = animation.userData.rootRefs || []
                        if (options.preserveUUIDs !== false && obj1.uuid) {
                            if (!rootRefs.includes(obj1.uuid)) {
                                rootRefs.push(obj1.uuid)
                            }
                        } else if (obj1.name) {
                            if (!rootRefs.includes(obj1.name)) {
                                rootRefs.push(obj1.name)
                            }
                        }
                        animation.userData.rootRefs = rootRefs
                        if (!gltfOptions.animations.includes(animation))
                            gltfOptions.animations.push(animation)
                    }
                }

                const geometry = (obj1 as MeshLine|MeshLineSegments).geometry

                // for mesh lines, create a temp line (BufferGeometry) so GLTFExporter correctly saves it as mode = line.
                if (typeof geometry?.getPositions === 'function'
                // && !obj1.geometry?.attributes.position
                && obj1.isLine === undefined && obj1.isLineSegments === undefined
                && (obj1.isLine2 || obj1.isLineSegments2)
                && !meshLines.has(obj1 as MeshLine|MeshLineSegments)
                ) {
                    const positions = geometry.getPositions()
                    if (positions) {
                        const colors = geometry.getColors && (obj1 as MeshLine|MeshLineSegments).geometry.getColors()
                        const g1 = new BufferGeometry()
                        g1.attributes.position = new BufferAttribute(positions, 3)
                        if (colors) g1.attributes.color = new BufferAttribute(colors, 3)
                        g1.name = geometry.name
                        g1.userData = geometry.userData
                        g1.uuid = geometry.uuid
                        // todo groups? anything else
                        meshLines.set(obj1 as MeshLine|MeshLineSegments, obj1.geometry as any)
                        if (obj1.assetType)
                            obj1._currentGeometry = g1 as any
                        else
                            obj1.geometry = g1 as any

                        if ((obj1 as MeshLine).isLine2) obj1.isLine = true
                        else if ((obj1 as MeshLine).isLineSegments2) {
                            obj1.isLine = true
                            obj1.isLineSegments = true
                        }
                    }
                }

                // todo move this to asset exporter?
                if (obj1.children && obj1._sChildren) {
                    // @ts-expect-error temp
                    obj1._tChildren = obj1.children
                    obj1.children = obj1._sChildren as IObject3D[]
                }
            }))

        const onDone1 = (o: any)=> {
            if (options.preserveUUIDs !== false) { // default true
                (Array.isArray(input) ? input : [input]).forEach((obj: Object3D) =>
                    obj.traverse((obj1: IObject3D) => {
                        delete obj1.userData.gltfUUID

                        if (meshLines.has(obj1 as MeshLine|MeshLineSegments) && obj1.geometry) {
                            const g = obj1.geometry
                            const g1 = meshLines.get(obj1 as MeshLine|MeshLineSegments) as any
                            if (obj1.assetType)
                                obj1._currentGeometry = g1
                            else
                                obj1.geometry = g1
                            g.dispose(true)
                            if (obj1.isLine) delete obj1.isLine
                            if (obj1.isLineSegments) delete obj1.isLineSegments
                        }

                        // todo move this to asset exporter?
                        // @ts-expect-error temp
                        if (obj1._tChildren) {
                            // @ts-expect-error temp
                            obj1.children = obj1._tChildren
                            // @ts-expect-error temp
                            delete obj1._tChildren
                        }
                    }))
            }
            // eslint-disable-next-line @typescript-eslint/naming-convention
            onDone(Object.assign(o, {__isGLTFOutput: true}))
        }
        return super.parse(input, onDone1, onError, gltfOptions, new GLTFWriter2())
    }

    static ExportExtensions: ((parser: GLTFWriter2) => GLTFExporterPlugin)[] = [
        GLTFMaterialExtrasExtension.Export,
        GLTFObject3DExtrasExtension.Export,
        GLTFLightExtrasExtension.Export,
        // GLTFMaterialsBumpMapExtension.Export, // deprecated
        GLTFMaterialsDisplacementMapExtension.Export,
        GLTFMaterialsLightMapExtension.Export,
        GLTFMaterialsAlphaMapExtension.Export,
        // (w)=>new GLTFMeshGpuInstancingExporter(w), // added to threejs
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

declare module 'three'{
    interface AnimationClip {
        /**
         * Whether to export this animation in glTF format.
         * @default true
         */
        __gltfExport?: boolean;
        userData: {
            clipActions?: Record<string, any[]>
            [key: string]: any
        }
    }
}
