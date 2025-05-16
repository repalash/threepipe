import {IGeometry, IMaterial, IObject3D} from '../../core'
import {BufferAttribute, InstancedMesh} from 'three'
// noinspection ES6PreferShortImport
import {copyObject3DUserData} from '../../utils/serialization'

export function autoGPUInstanceMeshes(matOrGeom: IMaterial|IGeometry) {
    if (!(<IMaterial>matOrGeom).isMaterial && !(<IGeometry>matOrGeom).isBufferGeometry) return
    const meshes = Array.from(matOrGeom.appliedMeshes).filter((m: any) =>
        !m.isInstancedMesh &&
            !!m.parent &&
            m.children.length === 0 &&
            !Array.isArray(m.material)
    )
    if (meshes.length < 2) return
    const getKey = (m: IObject3D) => {
        return m.parent!.uuid + '_' + m.geometry?.uuid + '_' + (m.material as IMaterial)?.uuid // + '_' + (m.matrix.determinant()<0)
    }
    const keyMeshMap = new Map<string, IObject3D[]>()
    for (const mesh1 of meshes) {
        const key = getKey(mesh1)
        if (!keyMeshMap.has(key)) keyMeshMap.set(key, [])
        keyMeshMap.get(key)!.push(mesh1)
        mesh1.updateMatrix()
    }
    const keys = keyMeshMap.keys()
    for (const key of keys) {
        const iMeshes = keyMeshMap.get(key)!
        const baseMesh = iMeshes[0]
        if (!baseMesh) continue
        if (iMeshes.length < 2) continue
        const inst = new InstancedMesh(baseMesh.geometry, baseMesh.material, iMeshes.length)
        const ud = baseMesh.userData
        baseMesh.userData = {}
        inst.copy(baseMesh)
        copyObject3DUserData(inst.userData, ud)
        const parent = baseMesh.parent!
        inst.position.set(0, 0, 0)
        inst.rotation.set(0, 0, 0)
        inst.scale.set(1, 1, 1)
        inst.updateMatrix()

        const translationAttr = new Float32Array(inst.count * 3)
        const rotationAttr = new Float32Array(inst.count * 4)
        const scaleAttr = new Float32Array(inst.count * 3)

        // const pos = new Vector3()
        // const quat = new Quaternion()
        // const scale = new Vector3()

        for (let i = 0; i < iMeshes.length; i++) {
            const m = iMeshes[i]
            // const mat = inst.matrix.clone().invert().multiply(m.matrix)
            const mat = m.matrix
            // mat.decompose(pos, quat, scale)
            if (mat.determinant() < 0) {
                mat.elements[0] *= -1
                mat.elements[1] *= -1
                mat.elements[2] *= -1
            }
            inst.setMatrixAt(i, mat)
            m.position.toArray(translationAttr, i * 3)
            m.quaternion.toArray(rotationAttr, i * 4)
            m.scale.toArray(scaleAttr, i * 3)
            m.removeFromParent()
            // ;(m.material as any)?.appliedMeshes?.delete(m)
            // m.geometry?.appliedMeshes?.delete(m)
            m.material = undefined
            m.geometry = undefined
        }
        // (inst.material as IMaterial).appliedMeshes?.add(inst)
        // inst.geometry.userData.__appliedMeshes.add(inst)

        // todo set position to center of all instances

        // @ts-expect-error todo not in ts
        inst.sourceTrs = {
            TRANSLATION: new BufferAttribute(translationAttr, 3),
            ROTATION: new BufferAttribute(rotationAttr, 4),
            SCALE: new BufferAttribute(scaleAttr, 3),
        }

        inst.instanceMatrix.needsUpdate = true
        parent.add(inst)
        ;(parent as any).setDirty()
    }
}

// added to three.js
// export class GLTFMeshGpuInstancingExporter implements GLTFExporterPlugin {
//     name = 'EXT_mesh_gpu_instancing'
//     constructor(public writer: GLTFWriter2) {
//     }
//
//     writeNode(object: any, nodeDef: any): void {
//         if (!object.isInstancedMesh) return
//
//         const writer = this.writer
//
//         const mesh = object as InstancedMesh
//
//         // @ts-expect-error not in ts
//         let attributes: any = mesh.sourceTrs
//         if (!attributes) {
//             const translationAttr = new Float32Array(mesh.count * 3)
//             const rotationAttr = new Float32Array(mesh.count * 4)
//             const scaleAttr = new Float32Array(mesh.count * 3)
//
//             const matrix = new Matrix4()
//             const position = new Vector3()
//             const quaternion = new Quaternion()
//             const scale = new Vector3()
//
//             for (let i = 0; i < mesh.count; i++) {
//                 mesh.getMatrixAt(i, matrix)
//                 matrix.decompose(position, quaternion, scale)
//
//                 position.toArray(translationAttr, i * 3)
//                 quaternion.toArray(rotationAttr, i * 4)
//                 scale.toArray(scaleAttr, i * 3)
//             }
//             attributes = {
//                 TRANSLATION: new BufferAttribute(translationAttr, 3),
//                 ROTATION: new BufferAttribute(rotationAttr, 4),
//                 SCALE: new BufferAttribute(scaleAttr, 3),
//             }
//         }
//
//         attributes = {
//             // @ts-expect-error todo add to ts
//             TRANSLATION: writer.processAccessor(attributes.TRANSLATION),
//             ROTATION: (writer as any).processAccessor(attributes.ROTATION),
//             SCALE: (writer as any).processAccessor(attributes.SCALE),
//         }
//
//         if (mesh.instanceColor)
//             attributes._COLOR_0 = (writer as any).processAccessor(mesh.instanceColor)
//
//         writer.extensionsUsed[ this.name ] = true
//         // @ts-expect-error todo add to ts
//         writer.extensionsRequired[ this.name ] = true
//
//         nodeDef.extensions = nodeDef.extensions || {}
//         nodeDef.extensions[ this.name ] = {attributes}
//     }
// }
