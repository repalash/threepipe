/**
 * Realize Instances - port of `geometry/intern/realize_instances.cc` (Blender 5.2.2) for meshes, point
 * clouds, curves and instances. Grease pencil, volumes, edit hints, bundles, `CD_ORIGINDEX` layers,
 * vertex group names and custom normals are not ported: inputs carrying them throw rather than lose
 * data silently.
 *
 * The three steps are Blender's: preprocess every unique geometry (`preprocess_*`, which also decides
 * the attributes of the result), gather one task per instance of each geometry
 * (`gather_realize_tasks_recursive` :771), then execute the tasks (`execute_realize_*_tasks`).
 * Blender's single-value join (`try_join_single_value_attribute` :525) only changes how an attribute
 * is stored, not its values, so results here are always arrays.
 */

import {AttrDomain, AttributeStorage, MeshData} from '@threepipe/mesh-kernel'
import {hash2} from '../blender/noise'
import {isIdentityTransform, mat4Multiply, transformPoint} from '../blender/math/matrix'
import {allocate, DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {GVArray} from './varray'
import {convertElement, isConvertible} from './typeConversions'
import {GeometrySet} from './GeometrySet'
import {
    CURVES_BUILTINS,
    CurvesGeometry,
    INSTANCES_BUILTINS,
    InstanceReference,
    Instances,
    MESH_BUILTINS,
    MeshAccessor,
    PointCloud,
    POINTCLOUD_BUILTINS,
} from './components'
import {AttributeAccessor, BuiltinAttribute} from './attributeAccessor'
import type {SceneProvider} from '../runtime/context'
import {newMeshData} from './components'

export interface RealizeInstancesOptions {
    /** Keep ids of the original geometry instead of mixing in instance ids (Join Geometry uses this). */
    keepOriginalIds?: boolean
    /** Propagate instance attributes to the realized geometry. */
    realizeInstanceAttributes?: boolean
    /** Instance attributes on curves go to points (true) or curves (false). */
    realizeToPointDomain?: boolean
    /** Resolves object and collection references. */
    scene?: SceneProvider
}

export interface VariedDepthOptions {
    /** Top-level instances to realize (all when undefined). */
    selection?: Uint8Array
    /** Realize depth per top-level instance; -1 is all levels (`MAX_DEPTH`). */
    depths?: Int32Array
}

export const MAX_DEPTH = -1

type Kind = {domain: AttrDomain, type: DataType}

/** `GeometrySet::GatheredAttributes` (`geometry_set.cc:707`): names in insertion order, kinds merged. */
class GatheredAttributes {
    readonly names: string[] = []
    readonly kinds: Kind[] = []

    add(name: string, kind: Kind): void {
        const i = this.names.indexOf(name)
        if (i < 0) {
            this.names.push(name)
            this.kinds.push({...kind})
        } else {
            this.kinds[i].domain = domainHighestPriority(this.kinds[i].domain, kind.domain)
            this.kinds[i].type = typeHighestComplexity(this.kinds[i].type, kind.type)
        }
    }
}

/** `attribute_domain_priority` (`blenkernel/intern/attribute_access.cc:297`). */
function domainPriority(d: AttrDomain): number {
    switch (d) {
    case AttrDomain.Instance: return 0
    case AttrDomain.Curve: return 2
    case AttrDomain.Face: return 3
    case AttrDomain.Edge: return 4
    case AttrDomain.Point: return 5
    case AttrDomain.Corner: return 6
    default: return 0
    }
}

function domainHighestPriority(a: AttrDomain, b: AttrDomain): AttrDomain {
    return domainPriority(b) > domainPriority(a) ? b : a
}

/** `attribute_data_type_complexity` (`attribute_access.cc:237`); this package's `float4` is ColorFloat. */
const COMPLEXITY: Record<DataType, number> = {
    bool: 0, int8: 1, int32: 2, float: 3, int16x2: 4, int32x2: 5, float2: 6, float3: 7,
    byteColor: 9, quaternion: 10, float4: 11, float4x4: 12,
}

function typeHighestComplexity(a: DataType, b: DataType): DataType {
    return COMPLEXITY[b] > COMPLEXITY[a] ? b : a
}

type ComponentType = 'mesh' | 'pointcloud' | 'curves' | 'instances'

const BUILTINS: Record<ComponentType, Readonly<Record<string, BuiltinAttribute>>> = {
    mesh: MESH_BUILTINS, pointcloud: POINTCLOUD_BUILTINS, curves: CURVES_BUILTINS, instances: INSTANCES_BUILTINS,
}

function accessorOf(g: GeometrySet, type: ComponentType): AttributeAccessor | undefined {
    return g.attributes(type)
}

function componentOf(g: GeometrySet, type: ComponentType): object | undefined {
    return g.get(type)
}

// region instance references

/** `convert_collection_to_instances` (`instances.cc:74`). */
function collectionToInstances(name: string, scene: SceneProvider | undefined): Instances {
    const c = scene?.collection?.(name)
    if (!c) throw new Error(`procedural: collection '${name}' is not provided by the scene`)
    const n = c.children.length + c.objects.length
    const inst = new Instances(n)
    const handles = inst.referenceHandles
    const transforms = inst.transforms
    let i = 0
    for (const child of c.children) {
        const cc = scene!.collection!(child)
        if (!cc) throw new Error(`procedural: collection '${child}' is not provided by the scene`)
        const t = transforms.subarray(i * 16, i * 16 + 16)
        t.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
        for (let k = 0; k < 3; k++) t[12 + k] = Math.fround(Math.fround(t[12 + k] + cc.instanceOffset[k]) - c.instanceOffset[k])
        handles[i] = inst.addReference({type: 'collection', name: child})
        i++
    }
    for (const objName of c.objects) {
        const ob = scene!.object?.(objName)
        if (!ob) throw new Error(`procedural: object '${objName}' is not provided by the scene`)
        const base = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c.instanceOffset[0], -c.instanceOffset[1], -c.instanceOffset[2], 1])
        mat4Multiply(base, ob.transform, transforms.subarray(i * 16, i * 16 + 16))
        handles[i] = inst.addReference({type: 'object', name: objName})
        i++
    }
    return inst
}

/** `InstanceReference::to_geometry_set` (`instances.cc:111`). */
export function referenceToGeometry(ref: InstanceReference, scene: SceneProvider | undefined): GeometrySet {
    switch (ref.type) {
    case 'none': return new GeometrySet()
    case 'geometry': return ref.geometry
    case 'object': {
        const ob = scene?.object?.(ref.name)
        if (!ob) throw new Error(`procedural: object '${ref.name}' is not provided by the scene`)
        return ob.geometry
    }
    case 'collection':
        return GeometrySet.fromInstances(collectionToInstances(ref.name, scene))
    }
}

/** Every object of a collection, recursively (`FOREACH_COLLECTION_OBJECT_RECURSIVE`: own objects, then children, unique). */
function collectionObjectsRecursive(name: string, scene: SceneProvider | undefined, out: string[]): string[] {
    const c = scene?.collection?.(name)
    if (!c) throw new Error(`procedural: collection '${name}' is not provided by the scene`)
    for (const o of c.objects) if (!out.includes(o)) out.push(o)
    for (const child of c.children) collectionObjectsRecursive(child, scene, out)
    return out
}

/** `Instances::foreach_referenced_geometry` (`geometry_set_instances.cc:75`). */
function foreachReferencedGeometry(inst: Instances, scene: SceneProvider | undefined, fn: (g: GeometrySet) => void): void {
    for (const ref of inst.references) {
        switch (ref.type) {
        case 'object': fn(referenceToGeometry(ref, scene)); break
        case 'collection':
            for (const o of collectionObjectsRecursive(ref.name, scene, [])) fn(referenceToGeometry({type: 'object', name: o}, scene))
            break
        case 'geometry': fn(ref.geometry); break
        default: break
        }
    }
}

// endregion

// region attribute gathering

/** `gather_attribute_propagation_components` (`realize_instances.cc:903`). */
function gatherPropagationComponents(
    g: GeometrySet, type: ComponentType, o: Required<RealizeInstancesOptions>, depth: number, maxDepth: number | undefined,
    out: {geometry: GeometrySet, type: ComponentType}[], seen: Set<object>,
): void {
    const c = componentOf(g, type)
    if (c && !seen.has(c)) {
        seen.add(c)
        out.push({geometry: g, type})
    }
    if (depth === maxDepth) return
    const inst = g.instances
    if (!inst) return
    if (o.realizeInstanceAttributes && !seen.has(inst)) {
        seen.add(inst)
        out.push({geometry: g, type: 'instances'})
    }
    for (const ref of inst.references) {
        gatherPropagationComponents(referenceToGeometry(ref, o.scene), type, o, depth + 1, maxDepth, out, seen)
    }
}

/** `gather_attribute_propagation_components_with_custom_depths` (`:940`). */
function gatherPropagationComponentsWithDepths(
    g: GeometrySet, type: ComponentType, o: Required<RealizeInstancesOptions>, v: Required<VariedDepthOptions>,
    out: {geometry: GeometrySet, type: ComponentType}[], seen: Set<object>,
): void {
    const c = componentOf(g, type)
    if (c && !seen.has(c)) {
        seen.add(c)
        out.push({geometry: g, type})
    }
    const inst = g.instances
    if (!inst) return
    const handles = inst.referenceHandles
    const maxDepth: (number | undefined)[] = inst.references.map(() => 0)
    for (let i = 0; i < inst.instancesNum; i++) {
        if (!v.selection[i]) continue
        const r = handles[i]
        if (maxDepth[r] === undefined) continue
        const d = v.depths[i]
        if (d === MAX_DEPTH) maxDepth[r] = undefined
        else maxDepth[r] = Math.max(maxDepth[r]!, d)
    }
    let anything = false
    inst.references.forEach((ref, r) => {
        if (maxDepth[r] === 0) return
        gatherPropagationComponents(referenceToGeometry(ref, o.scene), type, o, 1, maxDepth[r], out, seen)
        anything = true
    })
    if (anything && o.realizeInstanceAttributes && !seen.has(inst)) {
        seen.add(inst)
        out.push({geometry: g, type: 'instances'})
    }
}

/** `gather_attributes_to_propagate` (`:1004`). */
function gatherAttributesToPropagate(g: GeometrySet, type: ComponentType, o: Required<RealizeInstancesOptions>, v: Required<VariedDepthOptions>): GatheredAttributes {
    const top = g.instances?.instancesNum ?? 0
    const comps: {geometry: GeometrySet, type: ComponentType}[] = []
    const seen = new Set<object>()
    const allMax = v.depths.every(d => d === MAX_DEPTH) && v.selection.every(s => s !== 0) && v.selection.length === top
    if (allMax) gatherPropagationComponents(g, type, o, 0, undefined, comps, seen)
    else gatherPropagationComponentsWithDepths(g, type, o, v, comps, seen)
    const result = new GatheredAttributes()
    for (const comp of comps) {
        const acc = accessorOf(comp.geometry, comp.type)!
        for (const name of acc.names()) {
            const meta = acc.lookupMeta(name)!
            if (acc.isBuiltin(name) && !Object.prototype.hasOwnProperty.call(BUILTINS[type], name)) continue
            if (comp.type === 'instances' && (name === 'instance_transform' || name === '.reference_index')) continue
            let domain = meta.domain
            if (type !== 'instances' && domain === AttrDomain.Instance) {
                domain = type === 'curves' && !o.realizeToPointDomain ? AttrDomain.Curve : AttrDomain.Point
            }
            result.add(name, {domain, type: meta.type})
        }
    }
    return result
}

interface Ordered {
    names: string[]
    kinds: Kind[]
}

function ordered(g: GatheredAttributes, skip: readonly string[], flags: Record<string, () => void>): Ordered {
    const out: Ordered = {names: [], kinds: []}
    g.names.forEach((name, i) => {
        if (skip.includes(name)) return
        if (flags[name]) {
            flags[name]()
            return
        }
        out.names.push(name)
        out.kinds.push(g.kinds[i])
    })
    return out
}

// endregion

/** Per-instance fallback values for attributes missing on the instanced geometry (`AttributeFallbacksArray`). */
type Fallbacks = (readonly number[] | undefined)[]

/** `prepare_attribute_fallbacks` (`:602`): instance attributes that exist in the ordered set, converted. */
function prepareFallbacks(inst: Instances, order: Ordered): {index: number, values: ArrayLike<number>, type: DataType}[] {
    const out: {index: number, values: ArrayLike<number>, type: DataType}[] = []
    const acc = inst.accessor()
    for (const name of acc.names()) {
        const i = order.names.indexOf(name)
        if (i < 0) continue
        const meta = acc.lookupMeta(name)!
        const expected = order.kinds[i].type
        const data = acc.storage.get(name)!.data
        if (meta.type !== expected) {
            if (!isConvertible(meta.type, expected)) continue
            const conv = allocate(expected, inst.instancesNum, false)
            for (let e = 0; e < inst.instancesNum; e++) convertElement(meta.type, expected, data, e, conv, e)
            out.push({index: i, values: conv, type: expected})
        } else {
            out.push({index: i, values: data, type: expected})
        }
    }
    return out
}

interface PointCloudInfo {
    pc: PointCloud
    attributes: (GVArray | undefined)[]
    storedIds?: GVArray
    radii?: GVArray
}

interface MeshInfo {
    mesh: MeshData
    materialIndexMap: number[]
    attributes: (GVArray | undefined)[]
    storedVertIds?: GVArray
    materialIndices: GVArray
}

interface CurveInfo {
    curves: CurvesGeometry
    attributes: (GVArray | undefined)[]
    storedIds?: GVArray
    radius?: GVArray
    handleLeft?: Float32Array
    handleRight?: Float32Array
}

interface Task<I> {
    start: number[]
    info: I
    transform: Float32Array
    fallbacks: Fallbacks
    id: number
}

interface Context {
    pointclouds: Fallbacks
    meshes: Fallbacks
    curves: Fallbacks
    instances: Fallbacks
    id: number
}

/** `realize_instances(geometry_set, options, varied_depth_option)` (`realize_instances.cc:2912`). */
export function realizeInstances(geometry: GeometrySet, options: RealizeInstancesOptions = {}, varied: VariedDepthOptions = {}): GeometrySet {
    if (!geometry.instances) return geometry
    const top = geometry.instances.instancesNum
    const o: Required<RealizeInstancesOptions> = {
        keepOriginalIds: options.keepOriginalIds ?? false,
        realizeInstanceAttributes: options.realizeInstanceAttributes ?? true,
        realizeToPointDomain: options.realizeToPointDomain ?? true,
        scene: options.scene as SceneProvider,
    }
    const v: Required<VariedDepthOptions> = {
        selection: varied.selection ?? new Uint8Array(top).fill(1),
        depths: varied.depths ?? new Int32Array(top).fill(MAX_DEPTH),
    }

    // `propagate_instances_to_keep` (:2876): unselected top-level instances stay instances.
    let keep: Instances | undefined
    if (v.selection.some(s => !s)) keep = filterInstances(geometry.instances, v.selection, false)

    let g = geometry
    if (o.keepOriginalIds) g = removeIdAttributeFromInstances(g)

    // Preprocess.
    const pcFlags = {id: false, radius: false}
    const pcOrder = ordered(gatherAttributesToPropagate(g, 'pointcloud', o, v), ['position'], {
        id: () => { pcFlags.id = true },
        radius: () => { pcFlags.radius = true },
    })
    const meshFlags = {id: false, materialIndex: false}
    const meshOrder = ordered(gatherAttributesToPropagate(g, 'mesh', o, v), ['position', '.edge_verts', '.corner_vert', '.corner_edge', 'custom_normal'], {
        'id': () => { meshFlags.id = true },
        'material_index': () => { meshFlags.materialIndex = true },
    })
    const curveFlags = {id: false, fillId: false}
    const curveOrder = ordered(gatherAttributesToPropagate(g, 'curves', o, v), ['position', 'radius', 'handle_left', 'handle_right', 'custom_normal'], {
        id: () => { curveFlags.id = true },
        fill_id: () => { curveFlags.fillId = true },
    })
    const instOrder = ordered(gatherAttributesToPropagate(g, 'instances', o, v), ['id'], {})

    const pcs: PointCloud[] = []
    const meshes: MeshData[] = []
    const curvesList: CurvesGeometry[] = []
    const gatherUnique = (geo: GeometrySet) => {
        if (geo.pointCloud && geo.pointCloud.pointsNum > 0 && !pcs.includes(geo.pointCloud)) pcs.push(geo.pointCloud)
        if (geo.mesh && geo.mesh.vertsNum > 0 && !meshes.includes(geo.mesh)) meshes.push(geo.mesh)
        if (geo.curves && geo.curves.curvesNum > 0 && !curvesList.includes(geo.curves)) curvesList.push(geo.curves)
        if (geo.instances) foreachReferencedGeometry(geo.instances, o.scene, gatherUnique)
    }
    gatherUnique(g)

    const pcInfos: PointCloudInfo[] = pcs.map(pc => {
        const acc = pc.accessor()
        return {
            pc,
            attributes: pcOrder.names.map((n, i) => acc.contains(n) ? acc.lookupOrDefault(n, pcOrder.kinds[i].domain, pcOrder.kinds[i].type) : undefined),
            storedIds: pcFlags.id && acc.lookupMeta('id')?.domain === AttrDomain.Point && acc.lookupMeta('id')?.type === 'int32' ? acc.lookup('id') : undefined,
            radii: pcFlags.radius ? acc.lookupOrDefault('radius', AttrDomain.Point, 'float', [0.01]) : undefined,
        }
    })

    // Materials (`preprocess_meshes` :1535): every slot of every mesh in order, "no material" once.
    const materials: (string | null)[] = []
    const addMaterial = (m: string | null) => {
        if (!materials.includes(m)) materials.push(m)
    }
    for (const mesh of meshes) {
        if (mesh.attributes.has('custom_normal')) throw new Error('procedural: realizing meshes with custom normals is not ported yet')
        if (mesh.materials.length === 0) addMaterial(null)
        else mesh.materials.forEach(m => addMaterial(m || null))
    }
    meshFlags.materialIndex ||= materials.length > 1
    const meshInfos: MeshInfo[] = meshes.map(mesh => {
        const acc = new MeshAccessor(mesh)
        return {
            mesh,
            materialIndexMap: mesh.materials.length === 0 ? [materials.indexOf(null)] : mesh.materials.map(m => materials.indexOf(m || null)),
            attributes: meshOrder.names.map((n, i) => acc.contains(n) ? acc.lookupOrDefault(n, meshOrder.kinds[i].domain, meshOrder.kinds[i].type) : undefined),
            storedVertIds: meshFlags.id && acc.lookupMeta('id')?.domain === AttrDomain.Point && acc.lookupMeta('id')?.type === 'int32' ? acc.lookup('id') : undefined,
            materialIndices: acc.lookupOrDefault('material_index', AttrDomain.Face, 'int32', [0]),
        }
    })
    let curvesRadius = false
    let curvesHandles = false
    const curveInfos: CurveInfo[] = curvesList.map(curves => {
        const acc = curves.accessor()
        if (acc.contains('custom_normal')) throw new Error('procedural: realizing curves with custom normals is not ported yet')
        const info: CurveInfo = {
            curves,
            attributes: curveOrder.names.map((n, i) => acc.contains(n) ? acc.lookupOrDefault(n, curveOrder.kinds[i].domain, curveOrder.kinds[i].type) : undefined),
            storedIds: curveFlags.id && acc.lookupMeta('id')?.domain === AttrDomain.Point && acc.lookupMeta('id')?.type === 'int32' ? acc.lookup('id') : undefined,
        }
        if (acc.contains('radius')) {
            info.radius = acc.lookup('radius', AttrDomain.Point, 'float')
            curvesRadius = true
        }
        if (acc.contains('handle_right')) {
            info.handleLeft = acc.lookup('handle_left', AttrDomain.Point, 'float3')!.materialize() as Float32Array
            info.handleRight = acc.lookup('handle_right', AttrDomain.Point, 'float3')!.materialize() as Float32Array
            curvesHandles = true
        }
        return info
    })
    if (curveFlags.fillId) throw new Error('procedural: realizing curves with fill_id (grease pencil fills) is not ported yet')

    const createIdOnAny = pcFlags.id || meshFlags.id || curveFlags.id

    // Gather.
    const pcTasks: Task<PointCloudInfo>[] = []
    const meshTasks: Task<MeshInfo>[] = []
    const curveTasks: Task<CurveInfo>[] = []
    const instToMerge: {inst: Instances, transform: Float32Array, fallbacks: Fallbacks}[] = []
    const offsets = {pc: 0, vert: 0, edge: 0, face: 0, corner: 0, point: 0, curve: 0}
    if (keep) instToMerge.push({inst: keep, transform: identity(), fallbacks: instOrder.names.map(() => undefined)})

    const rootContext: Context = {
        pointclouds: pcOrder.names.map(() => undefined),
        meshes: meshOrder.names.map(() => undefined),
        curves: curveOrder.names.map(() => undefined),
        instances: instOrder.names.map(() => undefined),
        id: 0,
    }
    // `initialize_curves_builtin_attribute_defaults` (:2282).
    if (curveInfos.length) {
        const acc = curveInfos[0].curves.accessor()
        curveOrder.names.forEach((n, i) => {
            if (acc.isBuiltin(n)) rootContext.curves[i] = acc.builtinDefault(n)
        })
    }

    const gatherRecursive = (geo: GeometrySet, depth: number, targetDepth: number, base: Float32Array, ctx: Context) => {
        // Components in `GeometrySet::get_components()` order: mesh, point cloud, instances, volume, curves.
        if (geo.mesh && geo.mesh.vertsNum > 0) {
            const info = meshInfos[meshes.indexOf(geo.mesh)]
            meshTasks.push({start: [offsets.vert, offsets.edge, offsets.face, offsets.corner], info, transform: base, fallbacks: ctx.meshes, id: ctx.id})
            offsets.vert += geo.mesh.vertsNum
            offsets.edge += geo.mesh.edgesNum
            offsets.corner += geo.mesh.cornersNum
            offsets.face += geo.mesh.facesNum
        }
        if (geo.pointCloud && geo.pointCloud.pointsNum > 0) {
            const info = pcInfos[pcs.indexOf(geo.pointCloud)]
            pcTasks.push({start: [offsets.pc], info, transform: base, fallbacks: ctx.pointclouds, id: ctx.id})
            offsets.pc += geo.pointCloud.pointsNum
        }
        if (geo.instances) {
            if (depth === targetDepth) {
                instToMerge.push({inst: geo.instances, transform: base, fallbacks: ctx.instances})
            } else if (geo.instances.instancesNum > 0) {
                gatherForInstances(geo.instances, depth, targetDepth, base, ctx)
            }
        }
        if (geo.curves && geo.curves.curvesNum > 0) {
            const info = curveInfos[curvesList.indexOf(geo.curves)]
            curveTasks.push({start: [offsets.point, offsets.curve], info, transform: base, fallbacks: ctx.curves, id: ctx.id})
            offsets.point += geo.curves.pointsNum
            offsets.curve += geo.curves.curvesNum
        }
    }

    // `gather_realize_tasks_for_instances` (:677).
    const gatherForInstances = (inst: Instances, depth: number, targetDepth: number, base: Float32Array, baseCtx: Context) => {
        const handles = inst.referenceHandles
        const transforms = inst.transforms
        let storedIds: ArrayLike<number> | undefined
        if (createIdOnAny) {
            const meta = inst.accessor().lookupMeta('id')
            if (meta && meta.domain === AttrDomain.Instance && meta.type === 'int32') storedIds = inst.attributes.get('id')!.data
        }
        const fb = {
            pointclouds: prepareFallbacks(inst, pcOrder), meshes: prepareFallbacks(inst, meshOrder),
            curves: prepareFallbacks(inst, curveOrder), instances: prepareFallbacks(inst, instOrder),
        }
        const isTop = depth === 0
        for (let i = 0; i < inst.instancesNum; i++) {
            if (isTop && !v.selection[i]) continue
            const childTarget = isTop ? v.depths[i] : targetDepth
            const ref = inst.references[handles[i]]
            const transform = mat4Multiply(base, transforms.subarray(i * 16, i * 16 + 16))
            const ctx: Context = {
                pointclouds: [...baseCtx.pointclouds], meshes: [...baseCtx.meshes], curves: [...baseCtx.curves], instances: [...baseCtx.instances], id: 0,
            }
            const set = (list: {index: number, values: ArrayLike<number>, type: DataType}[], ptrs: Fallbacks) => {
                for (const a of list) {
                    const c = DATA_TYPES[a.type].components
                    ptrs[a.index] = Array.from({length: c}, (_, k) => a.values[i * c + k])
                }
            }
            set(fb.pointclouds, ctx.pointclouds)
            set(fb.meshes, ctx.meshes)
            set(fb.curves, ctx.curves)
            set(fb.instances, ctx.instances)
            let localId = 0
            if (createIdOnAny) localId = storedIds ? storedIds[i] >>> 0 : i
            ctx.id = hash2(baseCtx.id, localId)
            gatherRecursive(referenceToGeometry(ref, o.scene), depth + 1, childTarget, transform, ctx)
        }
    }

    gatherRecursive(g, 0, MAX_DEPTH, identity(), rootContext)

    const result = new GeometrySet()
    result.name = geometry.name
    executeInstancesTasks(instToMerge, instOrder, result)
    executePointCloudTasks(o, pcTasks, pcOrder, offsets.pc, pcFlags, result)
    executeMeshTasks(o, meshTasks, meshOrder, offsets, meshFlags, materials, meshInfos, result)
    executeCurveTasks(o, curveTasks, curveOrder, offsets, curveFlags, curvesRadius, curvesHandles, result)
    return result
}

function identity(): Float32Array {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

/** `Instances::remove(mask)` (`instances.cc:296`): keep the instances where `mask` equals `keep`. */
export function filterInstances(inst: Instances, mask: Uint8Array, keepSelected: boolean): Instances {
    const keepIdx: number[] = []
    for (let i = 0; i < inst.instancesNum; i++) if ((mask[i] !== 0) === keepSelected) keepIdx.push(i)
    const out = new Instances(keepIdx.length)
    out.references = inst.references.slice()
    for (const layer of inst.attributes.layers()) {
        const c = DATA_TYPES[layer.type as DataType].components
        let dst = out.attributes.get(layer.name)
        if (!dst) dst = out.attributes.add({name: layer.name, domain: layer.domain, type: layer.type})
        keepIdx.forEach((src, j) => {
            for (let k = 0; k < c; k++) dst!.data[j * c + k] = layer.data[src * c + k]
        })
    }
    removeUnusedReferences(out)
    return out
}

/** `Instances::remove_unused_references` (`instances.cc:322`). */
export function removeUnusedReferences(inst: Instances): void {
    if (inst.instancesNum === 0) {
        inst.references = []
        return
    }
    if (inst.references.length === 1) return
    const used = inst.references.map(() => false)
    const handles = inst.referenceHandles
    for (let i = 0; i < inst.instancesNum; i++) used[handles[i]] = true
    if (used.every(u => u)) return
    const map: number[] = []
    const refs: InstanceReference[] = []
    inst.references.forEach((r, i) => {
        if (!used[i]) {
            map.push(-1)
            return
        }
        map.push(refs.length)
        refs.push(r)
    })
    for (let i = 0; i < inst.instancesNum; i++) handles[i] = map[handles[i]]
    inst.references = refs
}

/** `remove_id_attribute_from_instances` (`:2858`), which also calls `ensure_geometry_instances`. */
function removeIdAttributeFromInstances(g: GeometrySet): GeometrySet {
    if (!g.instances) return g
    const out = g.copy()
    const inst = out.instancesForWrite()!
    inst.accessor().remove('id')
    ensureGeometryInstances(inst, undefined)
    inst.references = inst.references.map(r => r.type === 'geometry' ? {type: 'geometry', geometry: removeIdAttributeFromInstances(r.geometry)} : r)
    return out
}

/**
 * `Instances::ensure_geometry_instances` (`geometry_set_instances.cc:107`): object and collection
 * references become geometry references (named after the ID).
 */
export function ensureGeometryInstances(inst: Instances, scene: SceneProvider | undefined): void {
    inst.references = inst.references.map((ref): InstanceReference => {
        switch (ref.type) {
        case 'none': return {type: 'geometry', geometry: new GeometrySet()}
        case 'geometry': return ref
        case 'object': {
            if (!scene) return ref
            const g = referenceToGeometry(ref, scene).copy()
            g.name = ref.name
            if (g.instances) ensureGeometryInstances(g.instancesForWrite()!, scene)
            return {type: 'geometry', geometry: g}
        }
        case 'collection': {
            if (!scene) return ref
            const objects = collectionObjectsRecursive(ref.name, scene, [])
            const ci = new Instances(objects.length)
            const c = scene.collection!(ref.name)!
            objects.forEach((name, i) => {
                ci.referenceHandles[i] = ci.addReference({type: 'object', name})
                const t = ci.transforms.subarray(i * 16, i * 16 + 16)
                t.set(scene.object!(name)!.transform)
                for (let k = 0; k < 3; k++) t[12 + k] = Math.fround(t[12 + k] - c.instanceOffset[k])
            })
            ensureGeometryInstances(ci, scene)
            const g = GeometrySet.fromInstances(ci)
            g.name = ref.name
            return {type: 'geometry', geometry: g}
        }
        }
    })
}

/** `create_result_ids` (`:458`). */
function createResultIds(keepOriginal: boolean, stored: GVArray | undefined, taskId: number, dst: Int32Array): void {
    if (keepOriginal) {
        if (!stored) dst.fill(0)
        else for (let i = 0; i < dst.length; i++) dst[i] = stored.get(i)
    } else if (!stored) {
        for (let i = 0; i < dst.length; i++) dst[i] = hash2(taskId, i)
    } else {
        for (let i = 0; i < dst.length; i++) dst[i] = hash2(taskId, stored.get(i) >>> 0)
    }
}

/** `copy_generic_attributes_to_result` (`:426`). */
function copyGenericAttributes(
    src: (GVArray | undefined)[], fallbacks: Fallbacks, order: Ordered, range: (d: AttrDomain) => [number, number], dst: AttributeStorage,
): void {
    order.names.forEach((name, i) => {
        const layer = dst.get(name)!
        const [start, count] = range(order.kinds[i].domain)
        const c = DATA_TYPES[order.kinds[i].type].components
        const s = src[i]
        if (s) {
            for (let e = 0; e < count; e++) for (let k = 0; k < c; k++) layer.data[(start + e) * c + k] = s.get(e, k)
        } else {
            const value = fallbacks[i] ?? DATA_TYPES[order.kinds[i].type].defaultValue
            for (let e = 0; e < count; e++) for (let k = 0; k < c; k++) layer.data[(start + e) * c + k] = value[k]
        }
    })
}

/** `add_instance_attributes_to_single_geometry` (`:1359`). */
function addInstanceAttributesToSingle(order: Ordered, fallbacks: Fallbacks, acc: AttributeAccessor): void {
    order.names.forEach((name, i) => {
        const value = fallbacks[i]
        if (!value) return
        acc.add(name, order.kinds[i].domain, order.kinds[i].type, value)
    })
}

/** `execute_instances_tasks` (`:1111`). */
function executeInstancesTasks(tasks: {inst: Instances, transform: Float32Array, fallbacks: Fallbacks}[], order: Ordered, result: GeometrySet): void {
    if (!tasks.length) return
    const total = tasks.reduce((s, t) => s + t.inst.instancesNum, 0)
    const dst = new Instances(total)
    let offset = 0
    for (const t of tasks) {
        const map = t.inst.references.map(r => dst.addReference(r))
        for (let i = 0; i < t.inst.instancesNum; i++) {
            dst.referenceHandles[offset + i] = map[t.inst.referenceHandles[i]]
            mat4Multiply(t.transform, t.inst.transforms.subarray(i * 16, i * 16 + 16), dst.transforms.subarray((offset + i) * 16, (offset + i) * 16 + 16))
        }
        offset += t.inst.instancesNum
    }
    const acc = dst.accessor()
    order.names.forEach((name, ai) => {
        if (name === 'instance_transform' || name === '.reference_index') return
        const type = order.kinds[ai].type
        acc.add(name, AttrDomain.Instance, type)
        const layer = dst.attributes.get(name)!
        const c = DATA_TYPES[type].components
        let off = 0
        for (const t of tasks) {
            const src = t.inst.accessor().lookup(name, order.kinds[ai].domain, type)
            for (let i = 0; i < t.inst.instancesNum; i++) {
                for (let k = 0; k < c; k++) {
                    layer.data[(off + i) * c + k] = src ? src.get(i, k) : (t.fallbacks[ai] ?? DATA_TYPES[type].defaultValue)[k]
                }
            }
            off += t.inst.instancesNum
        }
    })
    result.setInstances(dst)
}

/** `execute_realize_pointcloud_tasks` (`:1379`). */
function executePointCloudTasks(
    o: Required<RealizeInstancesOptions>, tasks: Task<PointCloudInfo>[], order: Ordered, total: number,
    flags: {id: boolean, radius: boolean}, result: GeometrySet,
): void {
    if (!tasks.length) return
    if (tasks.length === 1) {
        const t = tasks[0]
        const pc = t.info.pc.clone()
        if (!isIdentityTransform(t.transform)) {
            const p = pc.positions
            for (let i = 0; i < pc.pointsNum; i++) transformPoint(t.transform, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p, i * 3)
        }
        addInstanceAttributesToSingle(order, t.fallbacks, pc.accessor())
        result.setPointCloud(pc)
        return
    }
    const dst = new PointCloud(total)
    // `:1417`: the first point cloud's material slots.
    dst.materials = tasks[0].info.pc.materials.slice()
    const acc = dst.accessor()
    if (flags.id) acc.add('id', AttrDomain.Point, 'int32')
    if (flags.radius) acc.add('radius', AttrDomain.Point, 'float')
    order.names.forEach((n, i) => acc.add(n, AttrDomain.Point, order.kinds[i].type))
    const pos = dst.positions
    for (const t of tasks) {
        const start = t.start[0]
        const src = t.info.pc.positions
        const n = t.info.pc.pointsNum
        const skip = isIdentityTransform(t.transform)
        for (let i = 0; i < n; i++) {
            if (skip) pos.set(src.subarray(i * 3, i * 3 + 3), (start + i) * 3)
            else transformPoint(t.transform, src[i * 3], src[i * 3 + 1], src[i * 3 + 2], pos, (start + i) * 3)
        }
        if (flags.id) createResultIds(o.keepOriginalIds, t.info.storedIds, t.id, (dst.attributes.get('id')!.data as Int32Array).subarray(start, start + n))
        if (flags.radius) {
            const r = dst.attributes.get('radius')!.data
            for (let i = 0; i < n; i++) r[start + i] = t.info.radii!.get(i)
        }
        copyGenericAttributes(t.info.attributes, t.fallbacks, order, () => [start, n], dst.attributes)
    }
    result.setPointCloud(dst)
}

/** `execute_realize_mesh_tasks` (`:1984`) and `execute_realize_mesh_task` (`:1673`). */
function executeMeshTasks(
    o: Required<RealizeInstancesOptions>, tasks: Task<MeshInfo>[], order: Ordered,
    offsets: {vert: number, edge: number, face: number, corner: number},
    flags: {id: boolean, materialIndex: boolean}, materials: (string | null)[], infos: MeshInfo[], result: GeometrySet,
): void {
    if (!tasks.length) return
    if (tasks.length === 1) {
        const t = tasks[0]
        const mesh = t.info.mesh.clone()
        if (!isIdentityTransform(t.transform)) {
            // `bke::mesh_transform(mesh, transform, false)`: positions only (no custom normals here).
            const p = mesh.positions
            for (let i = 0; i < mesh.vertsNum; i++) transformPoint(t.transform, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p, i * 3)
        }
        addInstanceAttributesToSingle(order, t.fallbacks, new MeshAccessor(mesh))
        result.setMesh(mesh)
        return
    }
    const dst = newMeshData()
    dst.resize({verts: offsets.vert, edges: offsets.edge, faces: offsets.face, corners: offsets.corner})
    dst.materials = materials.map(m => m ?? '')
    const acc = new MeshAccessor(dst)
    if (flags.id) acc.add('id', AttrDomain.Point, 'int32')
    order.names.forEach((n, i) => acc.add(n, order.kinds[i].domain, order.kinds[i].type))
    const pos = dst.positions
    const ev = dst.edgeVerts
    const cv = dst.cornerVerts
    const ce = dst.cornerEdges
    const fo = dst.faceOffsets
    for (const t of tasks) {
        const m = t.info.mesh
        const [sv, se, sf, sc] = t.start
        const src = m.positions
        const skip = isIdentityTransform(t.transform)
        for (let i = 0; i < m.vertsNum; i++) {
            if (skip) pos.set(src.subarray(i * 3, i * 3 + 3), (sv + i) * 3)
            else transformPoint(t.transform, src[i * 3], src[i * 3 + 1], src[i * 3 + 2], pos, (sv + i) * 3)
        }
        const sev = m.edgeVerts
        for (let i = 0; i < m.edgesNum * 2; i++) ev[se * 2 + i] = sev[i] + sv
        const scv = m.cornerVerts, sce = m.cornerEdges
        for (let i = 0; i < m.cornersNum; i++) {
            cv[sc + i] = scv[i] + sv
            ce[sc + i] = sce[i] + se
        }
        for (let i = 0; i < m.facesNum; i++) fo[sf + i] = m.faceOffsets[i] + sc
        if (flags.id) createResultIds(o.keepOriginalIds, t.info.storedVertIds, t.id, (dst.attributes.get('id')!.data as Int32Array).subarray(sv, sv + m.vertsNum))
        copyGenericAttributes(t.info.attributes, t.fallbacks, order, d => {
            switch (d) {
            case AttrDomain.Point: return [sv, m.vertsNum]
            case AttrDomain.Edge: return [se, m.edgesNum]
            case AttrDomain.Face: return [sf, m.facesNum]
            default: return [sc, m.cornersNum]
            }
        }, dst.attributes)
    }
    fo[offsets.face] = offsets.corner
    joinMaterialIndices(materials, infos, tasks, dst)
    result.setMesh(dst)
}

/** `join_mesh_material_indices` (`:1925`). */
function joinMaterialIndices(materials: (string | null)[], infos: MeshInfo[], tasks: Task<MeshInfo>[], dst: MeshData): void {
    if (materials.length <= 1) return
    const mapped = (info: MeshInfo, index: number) => {
        if (info.mesh.materials.length === 0) return info.materialIndexMap[0]
        return index >= 0 && index < info.mesh.materials.length ? info.materialIndexMap[index] : info.materialIndexMap[0]
    }
    // `calc_material_index_max_hint` returns 0 when every mesh maps to slot 0: no attribute then.
    const maxHint = (() => {
        let max = -Infinity
        for (const info of infos) {
            if (!info.materialIndices.isSingle) return undefined
            max = Math.max(max, mapped(info, info.materialIndices.single[0]))
        }
        return max
    })()
    if (maxHint === 0) return
    const acc = new MeshAccessor(dst)
    // `calc_single_value_material_index`.
    const first = infos[0].materialIndices.isSingle ? mapped(infos[0], infos[0].materialIndices.single[0]) : undefined
    if (first !== undefined && infos.every(i => i.materialIndices.isSingle && mapped(i, i.materialIndices.single[0]) === first)) {
        acc.add('material_index', AttrDomain.Face, 'int32', [first])
        return
    }
    acc.add('material_index', AttrDomain.Face, 'int32')
    const out = dst.attributes.get('material_index')!.data
    for (const t of tasks) {
        const info = t.info
        const sf = t.start[2]
        const n = info.mesh.facesNum
        if (info.mesh.materials.length === 0) {
            out.fill(mapped(info, 0), sf, sf + n)
        } else if (info.materialIndices.isSingle) {
            out.fill(mapped(info, info.materialIndices.single[0]), sf, sf + n)
        } else {
            const slots = info.mesh.materials.length
            for (let i = 0; i < n; i++) {
                const s = info.materialIndices.get(i)
                out[sf + i] = s >= 0 && s < slots ? info.materialIndexMap[s] : 0
            }
        }
    }
}

/** `execute_realize_curve_tasks` (`:2443`) and `execute_realize_curve_task` (`:2299`). */
function executeCurveTasks(
    o: Required<RealizeInstancesOptions>, tasks: Task<CurveInfo>[], order: Ordered, offsets: {point: number, curve: number},
    flags: {id: boolean}, createRadius: boolean, createHandles: boolean, result: GeometrySet,
): void {
    if (!tasks.length) return
    if (tasks.length === 1) {
        const t = tasks[0]
        const c = t.info.curves.clone()
        if (!isIdentityTransform(t.transform)) transformCurves(c, t.transform)
        addInstanceAttributesToSingle(order, t.fallbacks, c.accessor())
        result.setCurves(c)
        return
    }
    const dst = new CurvesGeometry(offsets.point, offsets.curve)
    // `:2491` `curves_copy_parameters(first_curves_id, ...)` (`curves.cc:316`): the first curves' material slots.
    dst.materials = tasks[0].info.curves.materials.slice()
    const acc = dst.accessor()
    if (flags.id) acc.add('id', AttrDomain.Point, 'int32')
    order.names.forEach((n, i) => acc.add(n, order.kinds[i].domain, order.kinds[i].type))
    if (createHandles) {
        acc.add('handle_left', AttrDomain.Point, 'float3')
        acc.add('handle_right', AttrDomain.Point, 'float3')
    }
    if (createRadius) acc.add('radius', AttrDomain.Point, 'float')
    const pos = dst.positions
    for (const t of tasks) {
        const cg = t.info.curves
        const [sp, sc] = t.start
        const np = cg.pointsNum, nc = cg.curvesNum
        const write = (src: ArrayLike<number>, dstArr: ArrayLike<number> & {[i: number]: number}) => {
            const skip = isIdentityTransform(t.transform)
            for (let i = 0; i < np; i++) {
                if (skip) for (let k = 0; k < 3; k++) dstArr[(sp + i) * 3 + k] = src[i * 3 + k]
                else transformPoint(t.transform, src[i * 3], src[i * 3 + 1], src[i * 3 + 2], dstArr as Float32Array, (sp + i) * 3)
            }
        }
        write(cg.positions, pos)
        if (createHandles) {
            const hl = dst.attributes.get('handle_left')!.data as Float32Array, hr = dst.attributes.get('handle_right')!.data as Float32Array
            if (t.info.handleLeft) write(t.info.handleLeft, hl)
            else hl.fill(0, sp * 3, (sp + np) * 3)
            if (t.info.handleRight) write(t.info.handleRight, hr)
            else hr.fill(0, sp * 3, (sp + np) * 3)
        }
        if (createRadius) {
            const r = dst.attributes.get('radius')!.data
            for (let i = 0; i < np; i++) r[sp + i] = t.info.radius ? t.info.radius.get(i) : 1
        }
        for (let i = 0; i < nc; i++) dst.curveOffsets[sc + i] = sp + cg.curveOffsets[i]
        if (flags.id) createResultIds(o.keepOriginalIds, t.info.storedIds, t.id, (dst.attributes.get('id')!.data as Int32Array).subarray(sp, sp + np))
        copyGenericAttributes(t.info.attributes, t.fallbacks, order, d => d === AttrDomain.Curve ? [sc, nc] : [sp, np], dst.attributes)
    }
    dst.curveOffsets[offsets.curve] = offsets.point
    result.setCurves(dst)
}

/** `CurvesGeometry::transform` (`curves_geometry.cc`): positions and handles. */
export function transformCurves(c: CurvesGeometry, m: Float32Array): void {
    for (const name of ['position', 'handle_left', 'handle_right']) {
        const layer = c.attributes.get(name)
        if (!layer) continue
        const p = layer.data as Float32Array
        for (let i = 0; i < c.pointsNum; i++) transformPoint(m, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p, i * 3)
    }
    if (c.attributes.has('custom_normal')) throw new Error('procedural: transforming curve custom normals is not ported yet')
}

export type {TypedArray}
