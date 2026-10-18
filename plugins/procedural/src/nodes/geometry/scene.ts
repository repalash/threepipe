/**
 * Scene nodes: Object Info (`node_geo_object_info.cc`), Collection Info (`node_geo_collection_info.cc`). Objects
 * and collections come from the host's `SceneProvider` (`EvalOptions.scene`); `selfObject` names the modified
 * object (Blender's `params.self_object()`).
 */

import {f32} from '../../blender/f32'
import {invertM4M4Safe} from '../../blender/math/invertSafe'
import {Float4x4, mat4Multiply, mat4ToLocQuatScaleSafe} from '../../blender/math/matrix'
import {strcasecmpNatural} from '../../blender/string'
import {GField} from '../../fields'
import {GeometrySet} from '../../geometry/GeometrySet'
import {Instances} from '../../geometry/components'
import {transformGeometry} from '../../geometry/transform'
import type {SceneProvider} from '../../runtime/context'
import type {ExecParams} from '../../runtime/params'
import {registerNodeType} from '../../runtime/registry'

const IDENTITY = (): Float4x4 => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** `Object::world_to_object()`: `invert_m4_m4_safe(object_to_world)` (`object_update.cc:119`). */
function selfWorldToObject(p: ExecParams): Float4x4 | undefined {
    const name = p.options.selfObject
    const self = name ? p.options.scene?.object?.(name) : undefined
    if (!self) return undefined
    p.dependsOn(`object:${name}`, self.version ?? 0)
    return invertM4M4Safe(self.transform)
}

registerNodeType({
    idname: 'GeometryNodeObjectInfo',
    label: 'Object Info',
    properties: {transform_space: 'ORIGINAL'},
    enums: {transform_space: ['ORIGINAL', 'RELATIVE']},
    declare(b) {
        b.input('OBJECT', 'Object')
        b.input('BOOLEAN', 'As Instance')
        b.output('MATRIX', 'Transform')
        b.output('VECTOR', 'Location')
        b.output('ROTATION', 'Rotation')
        b.output('VECTOR', 'Scale')
        b.output('GEOMETRY', 'Geometry')
    },
    // `node_geo_exec` (:47).
    execute(p) {
        const ref = p.idRef('Object')
        if (!ref) return
        const object = p.options.scene?.object?.(ref.name)
        if (!object) {
            p.warn(`Object "${ref.name}" is not available in this scene`)
            return
        }
        p.dependsOn(`object:${ref.name}`, object.version ?? 0)
        const relative = p.node.prop<string>('transform_space') === 'RELATIVE'
        let transform: Float4x4 = Float32Array.from(object.transform)
        let selfInv: Float4x4 | undefined
        if (relative) {
            selfInv = selfWorldToObject(p)
            if (!selfInv) {
                p.warn('Cannot access object\'s transforms because it\'s not evaluated yet. This can happen when there is a dependency cycle')
                transform = IDENTITY()
            } else {
                transform = mat4Multiply(selfInv, object.transform)
            }
        }
        const {loc, rot, scale} = mat4ToLocQuatScaleSafe(transform, true)
        p.set('Location', GField.constant('float3', loc))
        p.set('Rotation', GField.constant('quaternion', rot))
        p.set('Scale', GField.constant('float3', scale))
        p.set('Transform', GField.constant('float4x4', Array.from(transform)))
        if (!p.outputUsed('Geometry')) return
        if (ref.name === p.options.selfObject) {
            p.warn('Geometry cannot be retrieved from the modifier object')
            return
        }
        let geometry: GeometrySet
        if (p.bool('As Instance')) {
            const inst = new Instances(1)
            inst.referenceHandles[0] = inst.addReference({type: 'object', name: ref.name})
            inst.transforms.set(relative && selfInv ? mat4Multiply(selfInv, object.transform) : IDENTITY())
            geometry = GeometrySet.fromInstances(inst)
        } else {
            geometry = object.geometry.copy()
            if (relative && selfInv) transformGeometry(geometry, mat4Multiply(selfInv, object.transform))
        }
        geometry.name = ref.name
        p.set('Geometry', geometry)
    },
})

/** `BKE_collection_has_object_recursive_instanced_orig_id`: the object in the collection, its children, or a collection one of their objects instances. */
function collectionHasObject(scene: SceneProvider, collection: string, object: string, seen = new Set<string>()): boolean {
    if (seen.has(collection)) return false
    seen.add(collection)
    const c = scene.collection?.(collection)
    if (!c) return false
    for (const o of c.objects) {
        if (o === object) return true
        const instanced = scene.object?.(o)?.geometry.instances?.references ?? []
        for (const r of instanced) if (r.type === 'collection' && collectionHasObject(scene, r.name, object, seen)) return true
    }
    return c.children.some(child => collectionHasObject(scene, child, object, seen))
}

registerNodeType({
    idname: 'GeometryNodeCollectionInfo',
    label: 'Collection Info',
    properties: {transform_space: 'ORIGINAL'},
    enums: {transform_space: ['ORIGINAL', 'RELATIVE']},
    declare(b) {
        b.input('COLLECTION', 'Collection')
        b.input('BOOLEAN', 'Separate Children')
        b.input('BOOLEAN', 'Reset Children')
        b.output('GEOMETRY', 'Instances')
    },
    // `node_geo_exec` (:47).
    execute(p) {
        const ref = p.idRef('Collection')
        if (!ref) return
        const scene = p.options.scene
        const collection = scene?.collection?.(ref.name)
        if (!scene || !collection) {
            p.warn(`Collection "${ref.name}" is not available in this scene`)
            return
        }
        p.dependsOn(`collection:${ref.name}`, collection.version ?? 0)
        const self = p.options.selfObject
        if (self && collectionHasObject(scene, ref.name, self)) {
            p.warn('Collection contains current object')
            return
        }
        const relative = p.node.prop<string>('transform_space') === 'RELATIVE'
        const selfInv = relative ? selfWorldToObject(p) ?? IDENTITY() : undefined
        const offset = collection.instanceOffset
        const inst = new Instances(0)
        if (p.bool('Separate Children')) {
            const reset = p.bool('Reset Children')
            const entries: {handle: number, name: string, transform: Float4x4}[] = []
            for (const childName of collection.children) {
                let t = IDENTITY()
                if (!reset) {
                    const child = scene.collection?.(childName)
                    const co = child?.instanceOffset ?? [0, 0, 0]
                    for (let k = 0; k < 3; k++) t[12 + k] = f32(t[12 + k] + co[k])
                    if (relative) t = mat4Multiply(selfInv!, t)
                    else for (let k = 0; k < 3; k++) t[12 + k] = f32(t[12 + k] - offset[k])
                }
                entries.push({handle: inst.addReference({type: 'collection', name: childName}), name: childName, transform: t})
            }
            for (const objName of collection.objects) {
                const handle = inst.addReference({type: 'object', name: objName})
                let t = IDENTITY()
                if (!reset) {
                    if (relative) t = Float32Array.from(selfInv!)
                    else for (let k = 0; k < 3; k++) t[12 + k] = f32(t[12 + k] - offset[k])
                    const ob = scene.object?.(objName)
                    if (!ob) throw new Error(`procedural: object '${objName}' of collection '${ref.name}' is not provided by the scene`)
                    t = mat4Multiply(t, ob.transform)
                }
                entries.push({handle, name: objName, transform: t})
            }
            // `std::ranges::sort` by natural name order (:117).
            entries.sort((a, b) => strcasecmpNatural(a.name, b.name))
            inst.resize(entries.length)
            entries.forEach((e, i) => {
                inst.referenceHandles[i] = e.handle
                inst.transforms.set(e.transform, i * 16)
            })
        } else {
            let t = IDENTITY()
            if (relative) {
                for (let k = 0; k < 3; k++) t[12 + k] = offset[k]
                t = mat4Multiply(selfInv!, t)
            }
            inst.resize(1)
            inst.referenceHandles[0] = inst.addReference({type: 'collection', name: ref.name})
            inst.transforms.set(t)
        }
        const geometry = GeometrySet.fromInstances(inst)
        geometry.name = ref.name
        p.set('Instances', geometry)
    },
})
