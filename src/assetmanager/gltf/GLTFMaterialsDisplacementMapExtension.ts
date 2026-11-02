import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {MeshStandardMaterial} from 'three'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {PhysicalMaterial} from '../../core'

/**
 * Displacement Map Extension
 *
 * displacementTexture and displacementScale are added to the material
 *
 * Specification: https://threepipe.org/docs/gltf-extensions/WEBGI_materials_displacementmap.html
 */
export class GLTFMaterialsDisplacementMapExtension {
    static readonly WebGiMaterialsDisplacementMapExtension = 'WEBGI_materials_displacementmap'
    static Import = (parser: GLTFParser): GLTFLoaderPlugin=> new GLTFMaterialsDisplacementMapExtensionImport(parser)
    static Export = (writer: GLTFWriter): GLTFExporterPlugin => new GLTFMaterialsDisplacementMapExtensionExport(writer)

    // see GLTFDracoExportPlugin
    static Textures: Record<string, string|number> = {
        displacementTexture: 'R',
    }
}

class GLTFMaterialsDisplacementMapExtensionImport {

    public name: string
    constructor(public parser: GLTFParser) {

        this.name = GLTFMaterialsDisplacementMapExtension.WebGiMaterialsDisplacementMapExtension

    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {

        const parser = this.parser
        const materialDef = parser.json.materials[ materialIndex ]

        if (!materialDef.extensions || !materialDef.extensions[ this.name ]) {

            return Promise.resolve()

        }

        const pending = []

        const extension = materialDef.extensions[ this.name ]

        if (extension.displacementScale !== undefined) {

            materialParams.displacementScale = extension.displacementScale

        }
        if (extension.displacementBias !== undefined) {

            materialParams.displacementBias = extension.displacementBias

        }

        if (extension.displacementTexture !== undefined) {

            pending.push(parser.assignTexture(materialParams, 'displacementMap', extension.displacementTexture))

        }

        return Promise.all(pending)

    }

}
export type {GLTFMaterialsDisplacementMapExtensionImport}

class GLTFMaterialsDisplacementMapExtensionExport {

    public name: string

    constructor(public writer: GLTFWriter) {

        this.name = GLTFMaterialsDisplacementMapExtension.WebGiMaterialsDisplacementMapExtension

    }

    writeMaterial(material: MeshStandardMaterial, materialDef: any) {

        if (!material.isMeshStandardMaterial || material.displacementScale === 0) return

        const writer = this.writer
        const extensionsUsed = writer.extensionsUsed

        const extensionDef: any = {}

        if (material.displacementScale !== PhysicalMaterial.MaterialProperties.displacementScale)
            extensionDef.displacementScale = material.displacementScale

        if (material.displacementBias !== PhysicalMaterial.MaterialProperties.displacementBias)
            extensionDef.displacementBias = material.displacementBias

        if (material.displacementMap && writer.checkEmptyMap(material.displacementMap)) {

            const displacementMapDef = {index: writer.processTexture(material.displacementMap)}
            writer.applyTextureTransform(displacementMapDef, material.displacementMap)
            extensionDef.displacementTexture = displacementMapDef

        }

        if (!Object.keys(extensionDef)) return

        materialDef.extensions = materialDef.extensions || {}
        materialDef.extensions[ this.name ] = extensionDef

        extensionsUsed[ this.name ] = true

    }

}
export type {GLTFMaterialsDisplacementMapExtensionExport}
