/**
 * Materials variants extension
 * Modified from https://github.com/takahirox/three-gltf-extensions/blob/main/loaders/KHR_materials_variants/KHR_materials_variants.js
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_variants
 */

import {Material, Mesh, Object3D} from 'three'
import {GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {IObject3D} from '../../../core'

// export type OnUpdateType = ((arg0: Mesh, arg1: Material, arg2: any) => void) | null

/**
 * KHR_materials_variants specification allows duplicated variant names
 * but it makes handling the extension complex.
 * We ensure tha names and make it easier.
 * If you want to export the extension with the original names
 * you are recommended to write GLTFExporter plugin to restore the names.
 *
 * @param variantNames {Array<string>}
 * @return {Array<string>}
 */
const ensureUniqueNames = (variantNames: string[]): string[] => {
    const uniqueNames = []
    const knownNames = new Set()

    for (const name of variantNames) {
        let uniqueName = name
        let suffix = 0
        // @TODO: An easy solution.
        //        O(N^2) in the worst scenario where N is variantNames.length.
        //        Fix me if needed.
        while (knownNames.has(uniqueName)) {
            uniqueName = name + '.' + ++suffix
        }
        knownNames.add(uniqueName)
        uniqueNames.push(uniqueName)
    }

    return uniqueNames
}

/**
 * Convert mappings array to table object to make handling the extension easier.
 *
 * @param extensionDef {glTF.meshes[n].primitive.extensions.KHR_materials_variants}
 * @param variantNames {Array<string>} Required to be unique names
 * @return {Object}
 */
const mappingsArrayToTable = (extensionDef: any, variantNames: string[]): any => {
    const table: any = {}
    for (const mapping of extensionDef.mappings) {
        for (const variant of mapping.variants) {
            table[variantNames[variant]] = {
                material: null,
                gltfMaterialIndex: mapping.material,
            }
        }
    }
    return table
}

/**
 * @param object {THREE.Object3D}
 * @return {boolean}
 */
const compatibleObject = (object: Object3D) => {
    return (object as Mesh).material !== undefined && // easier than (!object.isMesh && !object.isLine && !object.isPoints)
        object.userData && // just in case
        object.userData._variantMaterials
}

export const khrMaterialsVariantsGLTF = 'KHR_materials_variants'
export class GLTFMaterialsVariantsExtensionImport {
    name = khrMaterialsVariantsGLTF

    constructor(public parser: GLTFParser) {
    }

    // Note that the following properties will be overridden even if they are pre-defined
    // - mesh.userData._variantMaterials
    async afterRoot(gltf: any) {
        const parser = this.parser
        const json = parser.json

        if (!json.extensions || !json.extensions[this.name]) return

        const extensionDef = json.extensions[this.name]
        const variantsDef = extensionDef.variants || []
        const variants = ensureUniqueNames(variantsDef.map((v: any) => v.name))

        // Save the _variantMaterials data under associated mesh.userData
        for (const scene of gltf.scenes) {
            // Save the variants data under associated mesh.userData
            (scene as IObject3D).traverse(object => {
                const association = parser.associations.get(object)

                if (!association || association.meshes === undefined || (association as any).primitives === undefined) {
                    return
                }

                const meshDef = json.meshes[association.meshes]
                const primitiveDef = meshDef.primitives[(association as any).primitives]
                const extensionsDef = primitiveDef.extensions

                if (!extensionsDef || !extensionsDef[this.name]) {
                    return
                }

                // object should be Mesh
                object.userData._variantMaterials = mappingsArrayToTable(extensionsDef[this.name], variants)
            })
        }

        // gltf.userData.variants = variants

        /**
         * @param object {THREE.Mesh}
         * @return {Promise}
         */
        const ensureLoadVariants = async(object: Mesh) => {
            const currentMaterial = object.material as Material
            const variantMaterials = object.userData._variantMaterials
            const pending = []
            for (const variantName in variantMaterials) {
                const variantMaterial = variantMaterials[variantName]
                if (variantMaterial.material) {
                    continue
                }
                const materialIndex = variantMaterial.gltfMaterialIndex
                pending.push(parser.getDependency('material', materialIndex).then(material => {
                    object.material = material
                    parser.assignFinalMaterial(object)
                    variantMaterials[variantName].material = object.material
                    // delete variantMaterials[variantName].gltfMaterialIndex // todo;
                }))
            }
            return Promise.all(pending).then(() => {
                object.material = currentMaterial
            })
        }

        await Promise.all(gltf.scenes.map(async(scene: Object3D) => {
            const pending: Promise<any>[] = []
            scene.traverse(o => compatibleObject(o) && pending.push(ensureLoadVariants(o as Mesh)))
            if (!scene.userData.__importData) scene.userData.__importData = {}
            scene.userData.__importData[khrMaterialsVariantsGLTF] = {
                names: variants,
            }
            return Promise.all(pending)
        }))

    }
}
