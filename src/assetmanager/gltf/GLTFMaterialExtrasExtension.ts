import type {GLTF, GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {ThreeSerialization} from '../../utils/serialization'
import {Color, DoubleSide, Material} from 'three'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {ITexture, LineMaterial2, PhysicalMaterial} from '../../core'
import {threeMaterialPropList} from '../../core/material/threeMaterialPropList'

export class GLTFMaterialExtrasExtension {
    static readonly WebGiMaterialExtrasExtension = 'WEBGI_material_extras'

    /**
     * for physical material
     * Also {@link Export}
     * @param loadConfigResources
     */
    static Import = (loadConfigResources: (res: any)=>any)=> (parser: GLTFParser): GLTFLoaderPlugin=>({
        name: '__' + GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension, // __ is prefix so that the extension is added to userdata, and we can process later in afterRoot
        afterRoot: async(result: GLTF) => {
            const scenes = result.scenes || (result.scene ? [result.scene] : [])
            for (const s of scenes) {
                const resExt = s.userData?.gltfExtensions?.[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension] // Note: see exporter for details of material extra resources in scene.
                const resources = resExt?.resources ? await loadConfigResources(resExt.resources) : {}

                s.traverse((obj: any)=>{
                    const o = obj?.material
                    if (!o?.isMaterial) return // todo array materials
                    const ext = o.userData?.gltfExtensions?.[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension]
                    if (!ext) return

                    // extras from MaterialLoader.js

                    if (ext.emissiveIntensity !== undefined) o.emissiveIntensity = ext.emissiveIntensity // kept for old versions, this is not saved in extras because of KHR_materials_emissive_strength
                    // bumpMap, displacementMap, lightMap, alphaMap moved to separate extensions

                    // if (material.shininess !== undefined) dat.shininess = material.shininess
                    if (ext.fog !== undefined) o.fog = ext.fog
                    if (ext.flatShading !== undefined) o.flatShading = ext.flatShading
                    if (ext.blending !== undefined) o.blending = ext.blending
                    // if (ext.combine !== undefined) o.combine = ext.combine
                    if (ext.side !== undefined) o.side = ext.side
                    if (ext.shadowSide !== undefined) o.shadowSide = ext.shadowSide
                    if (ext.depthFunc !== undefined) o.depthFunc = ext.depthFunc
                    if (ext.depthTest !== undefined) o.depthTest = ext.depthTest
                    if (ext.depthWrite !== undefined) o.depthWrite = ext.depthWrite
                    if (ext.colorWrite !== undefined) o.colorWrite = ext.colorWrite

                    if (ext.vertexColors !== undefined) o.vertexColors = ext.vertexColors // this is override, it is also set in GLTFLoader if geometry has vertex colors, todo: check how to do this in a better way
                    if (ext.alphaTest !== undefined) o.alphaTest = ext.alphaTest
                    if (ext.alphaHash !== undefined) o.alphaHash = ext.alphaHash

                    // if (ext.transparent !== undefined) o.transparent = ext.transparent // this is set by GLTFLoader based on alpha mode

                    if (ext.envMapIntensity !== undefined) o.envMapIntensity = ext.envMapIntensity // for when separateEnvMapIntensity is true
                    // if (ext.envMapSlotKey !== undefined) o.envMapSlotKey = ext.envMapSlotKey // in userdata

                    if (ext.blendSrc !== undefined) o.blendSrc = ext.blendSrc
                    if (ext.blendDst !== undefined) o.blendDst = ext.blendDst
                    if (ext.blendEquation !== undefined) o.blendEquation = ext.blendEquation
                    if (ext.blendSrcAlpha !== undefined) o.blendSrcAlpha = ext.blendSrcAlpha
                    if (ext.blendDstAlpha !== undefined) o.blendDstAlpha = ext.blendDstAlpha
                    if (ext.blendEquationAlpha !== undefined) o.blendEquationAlpha = ext.blendEquationAlpha
                    if (ext.blendColor !== undefined && o.blendColor !== undefined) (o.blendColor as Color).setHex(ext.blendColor)
                    if (ext.blendAlpha !== undefined) o.blendAlpha = ext.blendAlpha

                    if (ext.stencilWrite !== undefined) o.stencilWrite = ext.stencilWrite
                    if (ext.stencilWriteMask !== undefined) o.stencilWriteMask = ext.stencilWriteMask
                    if (ext.stencilFunc !== undefined) o.stencilFunc = ext.stencilFunc
                    if (ext.stencilRef !== undefined) o.stencilRef = ext.stencilRef
                    if (ext.stencilFuncMask !== undefined) o.stencilFuncMask = ext.stencilFuncMask
                    if (ext.stencilFail !== undefined) o.stencilFail = ext.stencilFail
                    if (ext.stencilZFail !== undefined) o.stencilZFail = ext.stencilZFail
                    if (ext.stencilZPass !== undefined) o.stencilZPass = ext.stencilZPass

                    if (ext.wireframe !== undefined) o.wireframe = ext.wireframe
                    if (ext.wireframeLinewidth !== undefined) o.wireframeLinewidth = ext.wireframeLinewidth
                    if (ext.wireframeLinecap !== undefined) o.wireframeLinecap = ext.wireframeLinecap
                    if (ext.wireframeLinejoin !== undefined) o.wireframeLinejoin = ext.wireframeLinejoin

                    if (ext.rotation !== undefined) o.rotation = ext.rotation

                    if (ext.linewidth !== undefined) o.linewidth = ext.linewidth
                    if (ext.worldUnits !== undefined) o.worldUnits = ext.worldUnits
                    if (ext.dashed !== undefined) o.dashed = ext.dashed
                    if (ext.dashSize !== undefined) o.dashSize = ext.dashSize
                    if (ext.dashScale !== undefined) o.dashScale = ext.dashScale
                    if (ext.dashOffset !== undefined) o.dashOffset = ext.dashOffset
                    if (ext.gapSize !== undefined) o.gapSize = ext.gapSize
                    if (ext.resolution !== undefined && o.resolution && o.resolution.fromArray) {
                        o.resolution.fromArray(ext.resolution)
                    }
                    // if (ext.scale !== undefined) o.scale = ext.scale

                    if (ext.polygonOffset !== undefined) o.polygonOffset = ext.polygonOffset
                    if (ext.polygonOffsetFactor !== undefined) o.polygonOffsetFactor = ext.polygonOffsetFactor
                    if (ext.polygonOffsetUnits !== undefined) o.polygonOffsetUnits = ext.polygonOffsetUnits

                    if (ext.dithering !== undefined) o.dithering = ext.dithering

                    if (ext.alphaToCoverage !== undefined) o.alphaToCoverage = ext.alphaToCoverage
                    if (ext.premultipliedAlpha !== undefined) o.premultipliedAlpha = ext.premultipliedAlpha

                    // if (ext.visible !== undefined) o.visible = ext.visible

                    if (ext.toneMapped !== undefined) o.toneMapped = ext.toneMapped

                    // we are ignoring the normalScale set from the GLTFLoader, because it is not correct in some cases.
                    // todo: check if this is still the case
                    if (ext.normalScale !== undefined && o.normalScale !== undefined) {
                        if (Array.isArray(ext.normalScale)) o.normalScale.fromArray(ext.normalScale)
                        else if (typeof ext.normalScale === 'number') o.normalScale.set(ext.normalScale, ext.normalScale)
                        else console.warn('normalScale is not an array or number', ext.normalScale)
                    }

                    if (ext.reflectivity !== undefined) o.reflectivity = ext.reflectivity // this is not present in the extras exporter because KHR_materials_ior, todo: kept for backward compatibility, remove ?
                    // if (ext.refractionRatio !== undefined) o.refractionRatio = ext.refractionRatio

                    // todo forceSinglePass

                    // todo: make extension for these like GLTFMaterialsBumpMapExtension
                    // if ( ext.gradientMap !== undefined ) o.gradientMap = getTexture( json.gradientMap );

                    Object.entries(ext).forEach(([key, value]: [string, any])=>{
                        if (key.startsWith('_')) return
                        if (value && value.resource && typeof value.resource === 'string') {
                            o[key] = ThreeSerialization.Deserialize(value, o[key], resources)
                        }
                    })

                    delete o.userData.gltfExtensions[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension]

                    // legacy bump map scale fix, test model - test model - http://samples.threepipe.org/tests/bumpmap_normalize_migrate.glb
                    const assetVersion = parser.json?.asset?.version ? parseFloat(parser.json?.asset?.version) : null
                    // https://github.com/repalash/three.js/commit/7b13bb515866f6a002928bd28d0a793cafeaeb1a
                    if ((o.userData.legacyBumpScale || assetVersion && assetVersion <= 2.0) && (o as any)?.bumpScale !== undefined && o?.bumpMap && o.defines) {
                        console.warn('MaterialManager: Old format material loaded, bump map might be incorrect.', o, (o as any).bumpScale)
                        o.defines.BUMP_MAP_SCALE_LEGACY = '1'
                        o.userData.legacyBumpScale = true
                        o.needsUpdate = true
                    }

                })

                // todo: check for resources that are not used and dispose them? see todo in ThreeViewer.fromJSON

                if (resExt) delete s.userData.gltfExtensions[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension]
            }
        },
    })

    /**
     * Also see {@link Import}
     * @param w
     * @constructor
     */
    static Export = (w: GLTFWriter): GLTFExporterPlugin&{materialExternalResources:any, serializedMeta: any}=> ({
        writeMaterial(material: Material & any, matDef: any) {
            if (!material?.isMaterial) return
            if (!matDef.extensions) matDef.extensions = {}
            const dat: any = {}

            // non-default stuff from MaterialLoader.js

            // hardcode fix for: emissive components are limited to stay within the 0 - 1 range to accommodate glTF spec. see threejs: #21849 and #22000.
            // not needed anymore.
            // if (material.emissiveIntensity !== undefined && material.emissive?.isColor) {
            //     const emissive = material.emissive.clone().multiplyScalar(material.emissiveIntensity)
            //     const maxEmissiveComponent = Math.max(emissive.r, emissive.g, emissive.b)
            //     if (maxEmissiveComponent > 1) {
            //         dat.emissiveIntensity = maxEmissiveComponent
            //     }
            // }

            // bumpMap, lightMap, alphaMap moved to separate extensions

            // if (material.shininess !== undefined) dat.shininess = material.shininess
            if (material.fog !== undefined && material.fog !== PhysicalMaterial.MaterialProperties.fog) dat.fog = material.fog
            if (material.flatShading !== undefined && material.flatShading !== PhysicalMaterial.MaterialProperties.flatShading) dat.flatShading = material.flatShading
            if (material.blending !== undefined && material.blending !== threeMaterialPropList.blending) dat.blending = material.blending
            // if (material.combine !== undefined && material.combine !== threeMaterialPropList.combine) dat.combine = material.combine
            if (material.side !== undefined && material.side !== DoubleSide) dat.side = material.side // DoubleSide handled in GLTF
            if (material.shadowSide !== undefined && material.shadowSide !== threeMaterialPropList.shadowSide) dat.shadowSide = material.shadowSide
            if (material.depthFunc !== undefined && material.depthFunc !== threeMaterialPropList.depthFunc) dat.depthFunc = material.depthFunc
            if (material.depthTest !== undefined && material.depthTest !== threeMaterialPropList.depthTest) dat.depthTest = material.depthTest
            if (material.depthWrite !== undefined && material.depthWrite !== threeMaterialPropList.depthWrite) dat.depthWrite = material.depthWrite
            if (material.colorWrite !== undefined && material.colorWrite !== threeMaterialPropList.colorWrite) dat.colorWrite = material.colorWrite

            if (material.vertexColors !== undefined && material.vertexColors !== threeMaterialPropList.vertexColors) dat.vertexColors = material.vertexColors // this is override, it is also set in GLTFLoader if geometry has vertex colors, todo: check how to do this in a better way
            if (material.alphaTest !== undefined && material.alphaTest !== threeMaterialPropList.alphaTest) dat.alphaTest = material.alphaTest
            if (material.alphaHash !== undefined && material.alphaHash !== threeMaterialPropList.alphaHash) dat.alphaHash = material.alphaHash

            if (material.envMapIntensity !== undefined && material.envMapIntensity !== PhysicalMaterial.MaterialProperties.envMapIntensity) dat.envMapIntensity = material.envMapIntensity // for when separateEnvMapIntensity is true
            // if (material.envMapSlotKey !== undefined && material.envMapSlotKey !== threeMaterialPropList.envMapSlotKey) dat.envMapSlotKey = material.envMapSlotKey // in userData

            if (material.blendSrc !== undefined && material.blendSrc !== threeMaterialPropList.blendSrc) dat.blendSrc = material.blendSrc
            if (material.blendDst !== undefined && material.blendDst !== threeMaterialPropList.blendDst) dat.blendDst = material.blendDst
            if (material.blendEquation !== undefined && material.blendEquation !== threeMaterialPropList.blendEquation) dat.blendEquation = material.blendEquation
            if (material.blendSrcAlpha !== undefined && material.blendSrcAlpha !== threeMaterialPropList.blendSrcAlpha) dat.blendSrcAlpha = material.blendSrcAlpha
            if (material.blendDstAlpha !== undefined && material.blendDstAlpha !== threeMaterialPropList.blendDstAlpha) dat.blendDstAlpha = material.blendDstAlpha
            if (material.blendEquationAlpha !== undefined && material.blendEquationAlpha !== threeMaterialPropList.blendEquationAlpha) dat.blendEquationAlpha = material.blendEquationAlpha
            if (material.blendColor !== undefined && material.blendColor !== threeMaterialPropList.blendColor) dat.blendColor = (material.blendColor as Color).getHex()
            if (material.blendAlpha !== undefined && material.blendAlpha !== threeMaterialPropList.blendAlpha) dat.blendAlpha = material.blendAlpha

            if (material.stencilWrite !== undefined && material.stencilWrite !== threeMaterialPropList.stencilWrite) dat.stencilWrite = material.stencilWrite
            if (material.stencilWriteMask !== undefined && material.stencilWriteMask !== threeMaterialPropList.stencilWriteMask) dat.stencilWriteMask = material.stencilWriteMask
            if (material.stencilFunc !== undefined && material.stencilFunc !== threeMaterialPropList.stencilFunc) dat.stencilFunc = material.stencilFunc
            if (material.stencilRef !== undefined && material.stencilRef !== threeMaterialPropList.stencilRef) dat.stencilRef = material.stencilRef
            if (material.stencilFuncMask !== undefined && material.stencilFuncMask !== threeMaterialPropList.stencilFuncMask) dat.stencilFuncMask = material.stencilFuncMask
            if (material.stencilFail !== undefined && material.stencilFail !== threeMaterialPropList.stencilFail) dat.stencilFail = material.stencilFail
            if (material.stencilZFail !== undefined && material.stencilZFail !== threeMaterialPropList.stencilZFail) dat.stencilZFail = material.stencilZFail
            if (material.stencilZPass !== undefined && material.stencilZPass !== threeMaterialPropList.stencilZPass) dat.stencilZPass = material.stencilZPass

            if (material.wireframe !== undefined && material.wireframe !== PhysicalMaterial.MaterialProperties.wireframe) dat.wireframe = material.wireframe
            if (material.wireframeLinewidth !== undefined && material.wireframeLinewidth !== PhysicalMaterial.MaterialProperties.wireframeLinewidth) dat.wireframeLinewidth = material.wireframeLinewidth
            if (material.wireframeLinecap !== undefined && material.wireframeLinecap !== PhysicalMaterial.MaterialProperties.wireframeLinecap) dat.wireframeLinecap = material.wireframeLinecap
            if (material.wireframeLinejoin !== undefined && material.wireframeLinejoin !== PhysicalMaterial.MaterialProperties.wireframeLinejoin) dat.wireframeLinejoin = material.wireframeLinejoin

            if (material.rotation !== undefined) dat.rotation = material.rotation

            if (material.linewidth !== undefined && material.linewidth !== LineMaterial2.MaterialProperties.linewidth) dat.linewidth = material.linewidth
            if (material.worldUnits !== undefined && material.worldUnits !== LineMaterial2.MaterialProperties.worldUnits) dat.worldUnits = material.worldUnits
            if (material.dashed !== undefined && material.dashed !== LineMaterial2.MaterialProperties.dashed) dat.dashed = material.dashed
            if (material.dashSize !== undefined && material.dashSize !== LineMaterial2.MaterialProperties.dashSize) dat.dashSize = material.dashSize
            if (material.dashScale !== undefined && material.dashScale !== LineMaterial2.MaterialProperties.dashScale) dat.dashScale = material.dashScale
            if (material.dashOffset !== undefined && material.dashOffset !== LineMaterial2.MaterialProperties.dashOffset) dat.dashOffset = material.dashOffset
            if (material.gapSize !== undefined && material.gapSize !== LineMaterial2.MaterialProperties.gapSize) dat.gapSize = material.gapSize
            // if (material.resolution !== undefined && material.resolution.isVector2 && (material.resolution.x !== LineMaterial2.MaterialProperties.resolution.x || material.resolution.y !== LineMaterial2.MaterialProperties.resolution.y)) dat.resolution = material.resolution.toArray()
            // if (material.scale !== undefined) dat.scale = material.scale

            if (material.polygonOffset !== undefined && material.polygonOffset !== threeMaterialPropList.polygonOffset) dat.polygonOffset = material.polygonOffset
            if (material.polygonOffsetFactor !== undefined && material.polygonOffsetFactor !== threeMaterialPropList.polygonOffsetFactor) dat.polygonOffsetFactor = material.polygonOffsetFactor
            if (material.polygonOffsetUnits !== undefined && material.polygonOffsetUnits !== threeMaterialPropList.polygonOffsetUnits) dat.polygonOffsetUnits = material.polygonOffsetUnits

            if (material.dithering !== undefined && material.dithering !== threeMaterialPropList.dithering) dat.dithering = material.dithering

            if (material.alphaToCoverage !== undefined && material.alphaToCoverage !== threeMaterialPropList.alphaToCoverage) dat.alphaToCoverage = material.alphaToCoverage
            if (material.premultipliedAlpha !== undefined && material.premultipliedAlpha !== threeMaterialPropList.premultipliedAlpha) dat.premultipliedAlpha = material.premultipliedAlpha

            // if (material.visible !== undefined && material.visible !== threeMaterialPropList.visible) dat.visible = material.visible

            if (material.toneMapped !== undefined && material.toneMapped !== threeMaterialPropList.toneMapped) dat.toneMapped = material.toneMapped

            // ignoring data from the GLTFExporter.
            if (material.normalScale !== undefined && material.normalScale.isVector2 && (material.normalScale.x !== PhysicalMaterial.MaterialProperties.normalScale.x || material.normalScale.y !== PhysicalMaterial.MaterialProperties.normalScale.y)) dat.normalScale = [material.normalScale.x, material.normalScale.y]

            // if (material.reflectivity !== undefined) dat.reflectivity = material.reflectivity // see KHR_materials_ior, and comments in parser.

            // if (material.refractionRatio !== undefined) dat.refractionRatio = material.refractionRatio

            // todo: make extension for this like GLTFMaterialsBumpMapExtension
            // if ( material.gradientMap !== undefined ) dat.gradientMap = getTexture( json.gradientMap );

            const resources = this.materialExternalResources[material.uuid]
            if (resources) {
                Object.entries(resources).forEach(([k, v]: [string, any|ITexture]) => {
                    if (k.startsWith('_')) return
                    let setFlag = false
                    if (v?.userData && v.userData.embedUrlImagePreviews === undefined) { // check ThreeSerialization texture serialization and GLTFWriter2.processTexture
                        v.userData.embedUrlImagePreviews = w.options.exporterOptions?.embedUrlImagePreviews
                        setFlag = true
                    }
                    dat[k] = ThreeSerialization.Serialize(v, this.serializedMeta)
                    if (v?.userData && setFlag) delete v.userData.embedUrlImagePreviews
                })
            }
            if (Object.keys(dat).length > 0) {
                matDef.extensions[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension] = dat
                w.extensionsUsed[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension] = true
            }
        },

        materialExternalResources: {},
        serializedMeta: {
            images: {},
            textures: {},
        },
        beforeParse(input) {
            this.materialExternalResources = {}
            // externalImagesInExtras: this is required because gltf-transform doesnt support external images in glb
            // see https://github.com/donmccurdy/glTF-Transform/discussions/644
            if (!w.options.externalImagesInExtras) return
            const materials: (Material&any)[] = [];
            (Array.isArray(input) ? input : [input]).forEach(obj=>{
                obj?.traverse((o: any)=>{
                    if (o && o.material?.isMaterial) materials.push(o.material)
                })
            })
            materials.forEach(material=>{
                if (material) {
                    if (!this.materialExternalResources[material.uuid])
                        this.materialExternalResources[material.uuid] = {}
                    this.materialExternalResources[material.uuid].__materialRef = material
                    Object.entries(material).forEach(([k, v]: [string, any])=>{
                        if (k.startsWith('_')) return
                        if (!v) return
                        if (!v.isTexture) return
                        if (
                            v.userData.rootPath
                            && (v.userData.rootPath.startsWith('http') || v.userData.rootPath.startsWith('data:'))
                        ) {
                            material[k] = null
                            this.materialExternalResources[material.uuid][k] = v
                        }
                    })
                }
            })
        },
        afterParse(_) {
            const vals = Object.values(this.materialExternalResources)
            if (vals.length < 1) return
            vals.forEach((resources: any)=>{
                const mat = resources.__materialRef
                if (!mat) return
                Object.entries(resources).forEach(([k, v]: [string, any])=>{
                    if (k.startsWith('_')) return
                    if (!v) return
                    mat[k] = v
                })
                delete this.materialExternalResources[mat.uuid]
            })
            const scene = w.json.scenes[w.json.scene || 0]
            if (!scene.extensions) scene.extensions = {}
            scene.extensions[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension] = {
                resources: this.serializedMeta,
            }
            w.extensionsUsed[GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension] = true
            // console.log(w)
        },
    })

    // see GLTFDracoExportPlugin
    static Textures: Record<string, string|number>|undefined = undefined
}
