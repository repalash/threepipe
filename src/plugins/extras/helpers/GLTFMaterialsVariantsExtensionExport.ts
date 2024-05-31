/**
 * Materials variants extension
 * Modified from https://github.com/takahirox/three-gltf-extensions/blob/main/exporters/KHR_materials_variants/KHR_materials_variants_exporter.js
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_variants
 */

import {Material, Mesh, Object3D} from 'three'
import {khrMaterialsVariantsGLTF} from './GLTFMaterialsVariantsExtensionImport'
import {GLTFWriter2} from '../../../assetmanager'

/**
 * @param object {THREE.Object3D}
 * @return {boolean}
 */
const compatibleObject = (object: Object3D) => {
    return (object as Mesh).material !== undefined && // easier than (!object.isMesh && !object.isLine && !object.isPoints)
        object.userData && // just in case
        object.userData._variantMaterials &&
        !!Object.values(object.userData._variantMaterials).filter(m => compatibleMaterial((m as Mesh)?.material as any))
}

/**
 * @param material {THREE.Material}
 * @return {boolean}
 */
const compatibleMaterial = (material: Material) => {
    // @TODO: support multi materials?
    return material && material.isMaterial && !Array.isArray(material)
}

export class GLTFExporterMaterialsVariantsExtensionExport {
    name = khrMaterialsVariantsGLTF
    variantNames: string[] = []

    constructor(public writer: GLTFWriter2) {
    }

    beforeParse(objects: Object3D[]) {
        // Find all variant names and store them to the table
        const variantNameTable = new Set<string>()
        for (const object of objects) {
            object.traverse(o => {
                if (!compatibleObject(o)) {
                    return
                }
                const variantMaterials = o.userData._variantMaterials
                for (const variantName in variantMaterials) {
                    const variantMaterial = variantMaterials[variantName]
                    // Ignore unloaded variant materials
                    if (compatibleMaterial(variantMaterial.material)) {
                        variantNameTable.add(variantName)
                    }
                }
            })
        }
        // We may want to sort?
        variantNameTable.forEach(name => this.variantNames.push(name))
    }

    writeMesh(mesh: Mesh, meshDef: any) {
        if (!compatibleObject(mesh)) {
            return
        }

        const userData = mesh.userData
        const variantMaterials = userData._variantMaterials
        const mappingTable: Record<number, any> = {}
        for (const variantName in variantMaterials) {
            const variantMaterialInstance = variantMaterials[variantName].material
            if (!compatibleMaterial(variantMaterialInstance)) {
                continue
            }
            const variantIndex = this.variantNames.indexOf(variantName) // Shouldn't be -1
            const materialIndex = this.writer.processMaterial(variantMaterialInstance)!
            if (!mappingTable[materialIndex]) {
                mappingTable[materialIndex] = {
                    material: materialIndex,
                    variants: [],
                }
            }
            mappingTable[materialIndex].variants.push(variantIndex)
        }

        const mappingsDef = Object.values(mappingTable)
            .map(m => {return (m.variants as number[]).sort((a, b) => a - b) && m})
            .sort((a, b) => a.material - b.material)

        if (mappingsDef.length === 0) {
            return
        }

        const originalMaterialIndex = compatibleMaterial(userData._originalMaterial)
            ? this.writer.processMaterial(userData._originalMaterial) ?? -1 : -1

        for (const primitiveDef of meshDef.primitives) {
            // Override primitiveDef.material with original material.
            if (originalMaterialIndex >= 0) {
                primitiveDef.material = originalMaterialIndex
            }
            primitiveDef.extensions = primitiveDef.extensions || {}
            primitiveDef.extensions[this.name] = {mappings: mappingsDef}
        }
    }

    afterParse(_input: any) {
        if (this.variantNames.length === 0) {
            return
        }

        const root = this.writer.json
        root.extensions = root.extensions || {}

        const variantsDef = this.variantNames.map(n => {return {name: n}})
        root.extensions[this.name] = {variants: variantsDef}
        this.writer.extensionsUsed[this.name] = true
    }
}

export function gltfExporterMaterialsVariantsExtensionExport(writer: GLTFWriter2) {
    return new GLTFExporterMaterialsVariantsExtensionExport(writer)
}
