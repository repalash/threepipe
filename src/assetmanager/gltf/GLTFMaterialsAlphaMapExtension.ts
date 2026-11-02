import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {MeshStandardMaterial} from 'three'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'

/**
 * Alpha Map Extension
 *
 * alphaTexture is added to the material
 * This is separate from the alpha in base color texture. This is used when that is not supported in the viewer
 *
 * Specification: https://threepipe.org/docs/gltf-extensions/WEBGI_materials_alphamap.html
 */
export class GLTFMaterialsAlphaMapExtension {
    static readonly WebGiMaterialsAlphaMapExtension = 'WEBGI_materials_alphamap'
    static Import = (parser: GLTFParser): GLTFLoaderPlugin=> new GLTFMaterialsAlphaMapExtensionImport(parser)
    static Export = (writer: GLTFWriter): GLTFExporterPlugin => new GLTFMaterialsAlphaMapExtensionExport(writer)

    // see GLTFDracoExportPlugin
    static Textures: Record<string, string|number> = {
        alphaTexture: 'G',
    }
}

class GLTFMaterialsAlphaMapExtensionImport {

    public name: string
    constructor(public parser: GLTFParser) {

        this.name = GLTFMaterialsAlphaMapExtension.WebGiMaterialsAlphaMapExtension

    }

    // getMaterialType(materialIndex: number) { // todo: required?
    //
    //     const parser = this.parser
    //     const materialDef = parser.json.materials[ materialIndex ]
    //
    //     if (!materialDef.extensions || !materialDef.extensions[ this.name ]) return null
    //
    //     return MeshPhysicalMaterial
    //
    // }

    async extendMaterialParams(materialIndex: number, materialParams: any) {

        const parser = this.parser
        const materialDef = parser.json.materials[ materialIndex ]

        if (!materialDef.extensions || !materialDef.extensions[ this.name ]) {

            return Promise.resolve()

        }

        const pending = []

        const extension = materialDef.extensions[ this.name ]

        if (extension.alphaTexture !== undefined) {

            pending.push(parser.assignTexture(materialParams, 'alphaMap', extension.alphaTexture))

        }

        return Promise.all(pending)

    }

}
export type {GLTFMaterialsAlphaMapExtensionImport}

class GLTFMaterialsAlphaMapExtensionExport {

    public name: string

    constructor(public writer: GLTFWriter) {

        this.name = GLTFMaterialsAlphaMapExtension.WebGiMaterialsAlphaMapExtension

    }

    writeMaterial(material: MeshStandardMaterial, materialDef: any) {

        if (!material.isMeshStandardMaterial || !material.alphaMap) return

        const writer = this.writer
        const extensionsUsed = writer.extensionsUsed

        const extensionDef: any = {}

        if (material.alphaMap && writer.checkEmptyMap(material.alphaMap)) {

            const alphaMapDef = {index: writer.processTexture(material.alphaMap)}
            writer.applyTextureTransform(alphaMapDef, material.alphaMap)
            extensionDef.alphaTexture = alphaMapDef

        }

        if (!Object.keys(extensionDef)) return

        materialDef.extensions = materialDef.extensions || {}
        materialDef.extensions[ this.name ] = extensionDef

        extensionsUsed[ this.name ] = true

    }

}
export type {GLTFMaterialsAlphaMapExtensionExport}
