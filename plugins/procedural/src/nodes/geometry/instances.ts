/**
 * Instance nodes: Instance on Points (`node_geo_instance_on_points.cc`), Translate Instances
 * (`node_geo_translate_instances.cc`), Scale Instances (`node_geo_scale_instances.cc`), Realize Instances
 * (`node_geo_realize_instances.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {mat4FromLocQuatScale, mat4Multiply} from '../../blender/math/matrix'
import {elementwise, FieldContext, FieldEvaluation, FieldOperation, GField} from '../../fields'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {ComponentType, GeometrySet} from '../../geometry/GeometrySet'
import {Instances} from '../../geometry/components'
import {foreachRealGeometry, joinGeometries} from '../../geometry/joinGeometries'
import {MAX_DEPTH, realizeInstances, removeUnusedReferences} from '../../geometry/realizeInstances'
import {GVArray} from '../../geometry/varray'
import type {ExecParams} from '../../runtime/params'
import {registerNodeType} from '../../runtime/registry'

/** `mod_i` (`math_base_inline.cc:255`). */
const modI = (i: number, n: number) => ((i % n) + n) % n

/** `math::from_location<float4x4>(t)`. */
function fromLocation(t: ArrayLike<number>): Float32Array {
    const m = new Float32Array(16)
    m[0] = m[5] = m[10] = m[15] = 1
    m[12] = t[0]
    m[13] = t[1]
    m[14] = t[2]
    return m
}

/** Selected indices of an evaluated selection (`get_evaluated_selection_as_mask`). */
function selectionIndices(sel: GVArray, size: number): number[] {
    const out: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i, 0)) out.push(i)
    return out
}

/** `add_instances_from_component` (:52). */
function addInstancesFromComponent(geometry: GeometrySet, type: ComponentType, instance: GeometrySet, p: ExecParams): Instances | undefined {
    const attributes = geometry.attributes(type)!
    const domainNum = attributes.domainSize(AttrDomain.Point)
    const e = new FieldEvaluation(new FieldContext(type, geometry.get(type), AttrDomain.Point), domainNum)
    const selectionVA = e.evaluate(p.field('Selection'))
    const pick = e.evaluate(p.field('Pick Instance'))
    const indices = e.evaluate(p.field('Instance Index'))
    const rotations = e.evaluate(p.field('Rotation'))
    const scales = e.evaluate(p.field('Scale'))
    const selection = selectionIndices(selectionVA, domainNum)
    if (!selection.length) return undefined

    const dst = new Instances(selection.length)
    const handles = dst.referenceHandles
    const transforms = dst.transforms
    const positions = attributes.lookup('position', AttrDomain.Point, 'float3')!
    const srcInstances = instance.instances
    let handleMapping: number[] = []
    if (srcInstances && (!pick.isSingle || pick.single[0])) {
        handleMapping = srcInstances.references.map(r => dst.addReference(r))
    }
    const fullHandle = dst.addReference({type: 'geometry', geometry: instance})
    // Added last: it is the most likely to be removed later.
    const emptyHandle = dst.addReference({type: 'none'})
    selection.forEach((i, r) => {
        const m = mat4FromLocQuatScale(
            [positions.get(i, 0), positions.get(i, 1), positions.get(i, 2)],
            [rotations.get(i, 0), rotations.get(i, 1), rotations.get(i, 2), rotations.get(i, 3)],
            [scales.get(i, 0), scales.get(i, 1), scales.get(i, 2)])
        let handle = emptyHandle
        if (pick.get(i, 0)) {
            if (srcInstances) {
                const n = srcInstances.instancesNum
                const index = modI(indices.get(i, 0), Math.max(n, 1))
                if (index < n) {
                    handle = handleMapping[srcInstances.referenceHandles[index]]
                    // `mul_m4_m4_post(dst, src)`: dst = dst * src.
                    m.set(mat4Multiply(m, srcInstances.transforms.subarray(index * 16, index * 16 + 16)))
                }
            }
        } else {
            handle = fullHandle
        }
        transforms.set(m, r * 16)
        handles[r] = handle
    })
    if (pick.isSingle && pick.single[0] && (instance.mesh || instance.pointCloud || instance.curves)) {
        p.warn('Realized geometry is not used when pick instances is true')
    }

    // Point attributes become instance attributes (:162-196).
    const dstAttributes = dst.accessor()
    for (const name of attributes.names()) {
        if (name === 'position' || name === '.reference_index') continue
        if (attributes.isBuiltin(name) && !dstAttributes.isBuiltin(name)) continue
        const meta = attributes.lookupMeta(name)!
        const src = attributes.lookup(name, AttrDomain.Point)
        if (!src) continue
        const c = DATA_TYPES[meta.type].components
        const data = new DATA_TYPES[meta.type as DataType].array(selection.length * c)
        selection.forEach((i, r) => { for (let k = 0; k < c; k++) data[r * c + k] = src.get(i, k) })
        if (dstAttributes.contains(name)) dst.attributes.get(name)!.data.set(data)
        else dstAttributes.add(name, AttrDomain.Instance, meta.type, data)
    }
    return dst
}

registerNodeType({
    idname: 'GeometryNodeInstanceOnPoints',
    label: 'Instance on Points',
    declare(b) {
        b.input('GEOMETRY', 'Points')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('GEOMETRY', 'Instance')
        b.input('BOOLEAN', 'Pick Instance').field()
        b.input('INT', 'Instance Index').implicit('ID_OR_INDEX').field()
        b.input('ROTATION', 'Rotation').field()
        b.input('VECTOR', 'Scale').default([1, 1, 1]).subtype('XYZ').field()
        b.output('GEOMETRY', 'Instances')
    },
    // `node_geo_exec` (:200).
    execute(p) {
        const instance = p.geometry('Instance')
        let geometry = foreachRealGeometry(p.geometry('Points'), g => {
            const parts: GeometrySet[] = []
            for (const type of ['mesh', 'pointcloud', 'curves'] as ComponentType[]) {
                if (!g.has(type)) continue
                const inst = addInstancesFromComponent(g, type, instance, p)
                if (inst) parts.push(GeometrySet.fromInstances(inst))
            }
            const joined = joinGeometries(parts, {scene: p.options.scene})
            // `keep_only({Edit})` + `replace_instances`.
            for (const t of ['mesh', 'pointcloud', 'curves', 'instances'] as ComponentType[]) g.remove(t)
            if (joined.instances) g.setShared('instances', joined)
        }, p.options.scene)
        const inst = geometry.instancesForWrite()
        if (inst) removeUnusedReferences(inst)
        else geometry = geometry.copy()
        p.set('Instances', geometry)
    },
})

/** Evaluate instance fields with a selection on `InstancesFieldContext`. */
function evaluateOnInstances(instances: Instances, selection: GField, fields: GField[]): {selection: number[], values: GVArray[]} {
    const n = instances.instancesNum
    const e = new FieldEvaluation(new FieldContext('instances', instances, AttrDomain.Instance), n)
    const sel = selectionIndices(e.evaluate(selection), n)
    return {selection: sel, values: fields.map(f => e.evaluate(f))}
}

registerNodeType({
    idname: 'GeometryNodeTranslateInstances',
    label: 'Translate Instances',
    declare(b) {
        b.input('GEOMETRY', 'Instances')
        b.output('GEOMETRY', 'Instances')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Translation').subtype('TRANSLATION').field()
        b.input('BOOLEAN', 'Local Space').default(true).field()
    },
    // `translate_instances` (:31).
    execute(p) {
        const geometry = p.geometry('Instances')
        const instances = geometry.instancesForWrite()
        if (instances) {
            const {selection, values: [tr, local]} = evaluateOnInstances(instances, p.field('Selection'), [p.field('Translation'), p.field('Local Space')])
            const t = instances.transforms
            for (const i of selection) {
                const v = [tr.get(i, 0), tr.get(i, 1), tr.get(i, 2)]
                if (local.get(i, 0)) {
                    t.set(mat4Multiply(t.subarray(i * 16, i * 16 + 16), fromLocation(v)), i * 16)
                } else {
                    for (let k = 0; k < 3; k++) t[i * 16 + 12 + k] = f32(t[i * 16 + 12 + k] + v[k])
                }
            }
        }
        p.set('Instances', geometry)
    },
})

/** `rescale_m4` (`math_matrix_c.cc:2152`): scale the first three columns. */
function rescaleM4(m: Float32Array, s: ArrayLike<number>): void {
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = f32(m[c * 4 + r] * s[c])
}

registerNodeType({
    idname: 'GeometryNodeScaleInstances',
    label: 'Scale Instances',
    declare(b) {
        b.input('GEOMETRY', 'Instances')
        b.output('GEOMETRY', 'Instances')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Scale').subtype('XYZ').default([1, 1, 1]).field()
        b.input('VECTOR', 'Center').subtype('TRANSLATION').field()
        b.input('BOOLEAN', 'Local Space').default(true).field()
    },
    // `scale_instances` (:37).
    execute(p) {
        const geometry = p.geometry('Instances')
        const instances = geometry.instancesForWrite()
        if (instances) {
            const {selection, values: [scale, center, local]} = evaluateOnInstances(instances, p.field('Selection'),
                [p.field('Scale'), p.field('Center'), p.field('Local Space')])
            const t = instances.transforms
            for (const i of selection) {
                const pivot = [center.get(i, 0), center.get(i, 1), center.get(i, 2)]
                const neg = [-pivot[0], -pivot[1], -pivot[2]]
                const s = [scale.get(i, 0), scale.get(i, 1), scale.get(i, 2)]
                let m: Float32Array
                if (local.get(i, 0)) {
                    m = mat4Multiply(t.subarray(i * 16, i * 16 + 16), fromLocation(pivot))
                    rescaleM4(m, s)
                    m = mat4Multiply(m, fromLocation(neg))
                } else {
                    const original = t.slice(i * 16, i * 16 + 16)
                    m = fromLocation(pivot)
                    rescaleM4(m, s)
                    m = mat4Multiply(m, fromLocation(neg))
                    m = mat4Multiply(m, original)
                }
                t.set(m, i * 16)
            }
        }
        p.set('Instances', geometry)
    },
})

// `depth_override` / `selection_override` (node_geo_realize_instances.cc:54, :62).
const depthOverride = elementwise('depth_override', ['int32', 'bool'], ['int32'], ([d, all], [o]) => {
    o[0] = all[0] ? MAX_DEPTH : Math.max(d[0], 0)
})
const selectionOverride = elementwise('selection_override', ['int32', 'bool'], ['bool'], ([d, s], [o]) => {
    o[0] = d[0] === 0 ? 0 : s[0]
})

registerNodeType({
    idname: 'GeometryNodeRealizeInstances',
    label: 'Realize Instances',
    properties: {realize_to_point_domain: false},
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('BOOLEAN', 'Realize All').default(true).field()
        b.input('INT', 'Depth').default(0).min(0).field()
    },
    // `node_geo_exec` (:39).
    execute(p) {
        const geometry = p.geometry('Geometry')
        if (!geometry.instances) return p.set('Geometry', geometry)
        const depth = new FieldOperation(depthOverride, [p.field('Depth'), p.field('Realize All')]).output(0)
        const selection = new FieldOperation(selectionOverride, [depth, p.field('Selection')]).output(0)
        const instances = geometry.instances
        const n = instances.instancesNum
        const e = new FieldEvaluation(new FieldContext('instances', instances, AttrDomain.Instance), n)
        const depths = e.evaluate(depth)
        const sel = e.evaluate(selection)
        const depthArr = new Int32Array(n)
        const selArr = new Uint8Array(n)
        for (let i = 0; i < n; i++) {
            depthArr[i] = depths.get(i, 0)
            selArr[i] = sel.get(i, 0) ? 1 : 0
        }
        const result = realizeInstances(geometry, {
            keepOriginalIds: false, realizeInstanceAttributes: true,
            realizeToPointDomain: p.node.prop<boolean>('realize_to_point_domain'), scene: p.options.scene,
        }, {selection: selArr, depths: depthArr})
        result.name = geometry.name
        p.set('Geometry', result)
    },
})
