import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {MeshStandardMaterial} from 'three'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {PhysicalMaterial} from '../../core'

/**
 * Bump Map Extension
 *
 * bumpTexture and bumpScale are added to the material
 *
 * Note - this is not deprecated as an official KHR extension now exists, but the importer is kept as it's used in many files.
 *
 * Specification: https://threepipe.org/docs/gltf-extensions/WEBGI_materials_bumpmap.html
 */
export class GLTFMaterialsBumpMapExtension {
    static readonly WebGiMaterialsBumpMapExtension = 'WEBGI_materials_bumpmap'
    static Import = (parser: GLTFParser): GLTFLoaderPlugin=> new GLTFMaterialsBumpMapExtensionImport(parser)
    static Export = (writer: GLTFWriter): GLTFExporterPlugin => new GLTFMaterialsBumpMapExtensionExport(writer)

    // see GLTFDracoExportPlugin
    static Textures: Record<string, string|number> = {
        bumpTexture: 'R',
    }
}

class GLTFMaterialsBumpMapExtensionImport {

    public name: string
    constructor(public parser: GLTFParser) {

        this.name = GLTFMaterialsBumpMapExtension.WebGiMaterialsBumpMapExtension

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

        if (extension.bumpScale !== undefined) {

            materialParams.bumpScale = extension.bumpScale

        }

        if (extension.bumpTexture !== undefined) {

            pending.push(parser.assignTexture(materialParams, 'bumpMap', extension.bumpTexture))

        }

        return Promise.all(pending)

    }

}
export type {GLTFMaterialsBumpMapExtensionImport}

class GLTFMaterialsBumpMapExtensionExport {

    public name: string

    constructor(public writer: GLTFWriter) {

        this.name = GLTFMaterialsBumpMapExtension.WebGiMaterialsBumpMapExtension

    }

    writeMaterial(material: MeshStandardMaterial, materialDef: any) {

        if (!material.isMeshStandardMaterial || material.bumpScale === 0) return

        const writer = this.writer
        const extensionsUsed = writer.extensionsUsed

        const extensionDef: any = {}

        if (material.bumpScale !== PhysicalMaterial.MaterialProperties.bumpScale)
            extensionDef.bumpScale = material.bumpScale

        if (material.bumpMap && writer.checkEmptyMap(material.bumpMap)) {

            const bumpMapDef = {index: writer.processTexture(material.bumpMap)}
            writer.applyTextureTransform(bumpMapDef, material.bumpMap)
            extensionDef.bumpTexture = bumpMapDef

        }

        if (!Object.keys(extensionDef)) return

        materialDef.extensions = materialDef.extensions || {}
        materialDef.extensions[ this.name ] = extensionDef

        extensionsUsed[ this.name ] = true

    }

}
export type {GLTFMaterialsBumpMapExtensionExport}
