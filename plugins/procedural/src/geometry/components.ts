/**
 * Geometry containers besides the mesh - `PointCloud`, `CurvesGeometry`, `Instances` - and the
 * attribute accessors of all four component types. Mirrors `blenkernel/BKE_pointcloud.hh`,
 * `BKE_curves.hh`, `BKE_instances.hh` and the attribute provider tables in
 * `blenkernel/intern/{mesh,pointcloud,curves,instances}_attributes.cc`.
 */

import {AttrDomain, AttributeLayer, AttributeStorage, MeshData} from '@threepipe/mesh-kernel'
import {AttributeAccessor, BuiltinAttribute, SingleDomainAccessor} from './attributeAccessor'
import {adaptMeshDomain} from './meshDomains'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {GVArray} from './varray'
import {createDefaultMixer} from './mixers'
import type {GeometrySet} from './GeometrySet'
import {meshAttributeChanged} from './meshRuntime'

const clampTo = (lo: number, hi: number) => (v: number[]) => v.map(x => Math.min(Math.max(x, lo), hi))

/** `mesh_attributes.cc:795-844`. */
export const MESH_BUILTINS: Readonly<Record<string, BuiltinAttribute>> = {
    'position': {domain: AttrDomain.Point, type: 'float3', deletable: false},
    'material_index': {domain: AttrDomain.Face, type: 'int32', validate: clampTo(0, 32767)},
    '.edge_verts': {domain: AttrDomain.Edge, type: 'int32x2', deletable: false, validate: v => v.map(x => Math.max(x, 0))},
    '.corner_vert': {domain: AttrDomain.Corner, type: 'int32', deletable: false, validate: v => v.map(x => Math.max(x, 0))},
    '.corner_edge': {domain: AttrDomain.Corner, type: 'int32', deletable: false, validate: v => v.map(x => Math.max(x, 0))},
    'sharp_face': {domain: AttrDomain.Face, type: 'bool'},
    'sharp_edge': {domain: AttrDomain.Edge, type: 'bool'},
}

/** `pointcloud_attributes.cc:34-48`. */
export const POINTCLOUD_BUILTINS: Readonly<Record<string, BuiltinAttribute>> = {
    'position': {domain: AttrDomain.Point, type: 'float3', deletable: false},
    'radius': {domain: AttrDomain.Point, type: 'float'},
}

/** `curves_attributes.cc:155-268` (curve type, handle type, knots and normal mode clamp to their enum ranges). */
export const CURVES_BUILTINS: Readonly<Record<string, BuiltinAttribute>> = {
    'position': {domain: AttrDomain.Point, type: 'float3', deletable: false},
    'radius': {domain: AttrDomain.Point, type: 'float'},
    'tilt': {domain: AttrDomain.Point, type: 'float'},
    'handle_left': {domain: AttrDomain.Point, type: 'float3'},
    'handle_right': {domain: AttrDomain.Point, type: 'float3'},
    // BEZIER_HANDLE_FREE .. BEZIER_HANDLE_ALIGN (DNA_curves_types.h)
    'handle_type_left': {domain: AttrDomain.Point, type: 'int8', validate: clampTo(0, 3)},
    'handle_type_right': {domain: AttrDomain.Point, type: 'int8', validate: clampTo(0, 3)},
    'nurbs_weight': {domain: AttrDomain.Point, type: 'float', defaultValue: [1]},
    'nurbs_order': {domain: AttrDomain.Curve, type: 'int8', defaultValue: [4], validate: v => v.map(x => Math.max(x, 1))},
    // NORMAL_MODE_MINIMUM_TWIST .. NORMAL_MODE_FREE
    'normal_mode': {domain: AttrDomain.Curve, type: 'int8', validate: clampTo(0, 2)},
    'custom_normal': {domain: AttrDomain.Point, type: 'float3'},
    // NURBS_KNOT_MODE_NORMAL .. NURBS_KNOT_MODE_ENDPOINT_BEZIER
    'knots_mode': {domain: AttrDomain.Curve, type: 'int8', validate: clampTo(0, 3)},
    // CURVE_TYPE_CATMULL_ROM .. CURVE_TYPES_NUM
    'curve_type': {domain: AttrDomain.Curve, type: 'int8', validate: clampTo(0, 4)},
    'resolution': {domain: AttrDomain.Curve, type: 'int32', defaultValue: [12], validate: v => v.map(x => Math.max(x, 1))},
    'cyclic': {domain: AttrDomain.Curve, type: 'bool'},
    'material_index': {domain: AttrDomain.Curve, type: 'int32', validate: clampTo(0, 32767)},
}

/** `instances_attributes.cc:26-40`. */
export const INSTANCES_BUILTINS: Readonly<Record<string, BuiltinAttribute>> = {
    'instance_transform': {domain: AttrDomain.Instance, type: 'float4x4', deletable: false},
    '.reference_index': {domain: AttrDomain.Instance, type: 'int32', deletable: false},
}

export const kernelTable = (t: Readonly<Record<string, BuiltinAttribute>>) =>
    Object.fromEntries(Object.entries(t).map(([k, v]) => [k, {domain: v.domain, type: v.type}]))

/** Mesh attribute access (`MeshComponent::attributes`, `mesh_attributes.cc`). */
export class MeshAccessor extends AttributeAccessor {
    readonly builtins = MESH_BUILTINS

    constructor(readonly mesh: MeshData) {
        super()
    }

    get storage(): AttributeStorage {
        return this.mesh.attributes
    }

    supportsDomain(domain: AttrDomain): boolean {
        return domain === AttrDomain.Point || domain === AttrDomain.Edge || domain === AttrDomain.Face || domain === AttrDomain.Corner
    }

    adaptDomain(varray: GVArray, from: AttrDomain, to: AttrDomain): GVArray | undefined {
        return adaptMeshDomain(this.mesh, varray, from, to)
    }

    // The built-in change tags (`changed_tags`, `mesh_attributes.cc:694`) run when an attribute is written through the
    // accessor (`GAttributeWriter::finish`), added with data (`fn.add`, :995) or removed (`fn.remove`, :958).

    add(name: string, domain: AttrDomain, type: DataType, init?: TypedArray | readonly number[]): boolean {
        const added = super.add(name, domain, type, init)
        if (added) meshAttributeChanged(this.mesh, name)
        return added
    }

    remove(name: string): boolean {
        const removed = super.remove(name)
        if (removed) meshAttributeChanged(this.mesh, name)
        return removed
    }

    /** The layer for an in-place write: tagged here, before the caller writes (nothing reads caches in between). */
    layerForWrite(name: string): AttributeLayer | undefined {
        const layer = super.layerForWrite(name)
        if (layer) meshAttributeChanged(this.mesh, name)
        return layer
    }
}

/** `PointCloud` (`DNA_pointcloud_types.h`, `BKE_pointcloud.hh`): points with attributes. */
export class PointCloud {
    readonly attributes: AttributeStorage
    /** Material slot names (`PointCloud::mat`), `''` for an empty slot - as `MeshData.materials`. */
    materials: string[] = []

    constructor(pointsNum = 0) {
        this.attributes = new AttributeStorage({[AttrDomain.Point]: pointsNum}, kernelTable(POINTCLOUD_BUILTINS))
        this.attributes.add({name: 'position', domain: AttrDomain.Point, type: 'float3'})
    }

    get pointsNum(): number {
        return this.attributes.domainSizes[AttrDomain.Point]
    }

    get positions(): Float32Array {
        return this.attributes.get('position')!.data as Float32Array
    }

    accessor(): AttributeAccessor {
        return new SingleDomainAccessor(this.attributes, POINTCLOUD_BUILTINS, AttrDomain.Point)
    }

    clone(): PointCloud {
        const out = Object.create(PointCloud.prototype) as PointCloud
        ;(out as {attributes: AttributeStorage}).attributes = this.attributes.clone()
        out.materials = this.materials.slice()
        return out
    }
}

/**
 * `CurvesGeometry` storage (`BKE_curves.hh`): points and curves domains plus the curve offsets.
 * Evaluation (bezier / Catmull-Rom / NURBS resolution, lengths) lives with the curve nodes.
 */
export class CurvesGeometry {
    readonly attributes: AttributeStorage
    /** Material slot names (`Curves::mat`), `''` for an empty slot - as `MeshData.materials`. */
    materials: string[] = []
    /** `curves_num + 1` offsets into the points (`curve_offsets`). */
    curveOffsets: Int32Array

    constructor(pointsNum = 0, curvesNum = 0) {
        this.attributes = new AttributeStorage({[AttrDomain.Point]: pointsNum, [AttrDomain.Curve]: curvesNum}, kernelTable(CURVES_BUILTINS))
        this.attributes.add({name: 'position', domain: AttrDomain.Point, type: 'float3'})
        this.curveOffsets = new Int32Array(curvesNum + 1)
    }

    get pointsNum(): number {
        return this.attributes.domainSizes[AttrDomain.Point]
    }

    get curvesNum(): number {
        return this.attributes.domainSizes[AttrDomain.Curve]
    }

    get positions(): Float32Array {
        return this.attributes.get('position')!.data as Float32Array
    }

    /** `points_by_curve()[i]` as `[start, end)`. */
    pointsRange(curve: number): [number, number] {
        return [this.curveOffsets[curve], this.curveOffsets[curve + 1]]
    }

    accessor(): AttributeAccessor {
        return new CurvesAccessor(this)
    }

    clone(): CurvesGeometry {
        const out = Object.create(CurvesGeometry.prototype) as CurvesGeometry
        ;(out as {attributes: AttributeStorage}).attributes = this.attributes.clone()
        out.curveOffsets = this.curveOffsets.slice()
        out.materials = this.materials.slice()
        return out
    }
}

/** `CurvesGeometry::adapt_domain` (`curves_geometry.cc:1891`) and its two directions (`:1803-1889`). */
class CurvesAccessor extends AttributeAccessor {
    readonly builtins = CURVES_BUILTINS

    constructor(readonly curves: CurvesGeometry) {
        super()
    }

    get storage(): AttributeStorage {
        return this.curves.attributes
    }

    supportsDomain(domain: AttrDomain): boolean {
        return domain === AttrDomain.Point || domain === AttrDomain.Curve
    }

    adaptDomain(varray: GVArray, from: AttrDomain, to: AttrDomain): GVArray | undefined {
        if (varray.size === 0) return undefined
        if (from === to) return varray
        if (varray.isSingle) return GVArray.fromSingle(varray.type, this.domainSize(to), varray.single)
        const c = DATA_TYPES[varray.type].components
        const off = this.curves.curveOffsets
        const n = this.curves.curvesNum
        if (from === AttrDomain.Point && to === AttrDomain.Curve) {
            const out = new DATA_TYPES[varray.type].array(n * c)
            if (varray.type === 'bool') {
                // A curve is selected if all of its control points were selected.
                for (let i = 0; i < n; i++) {
                    let all = 1
                    for (let p = off[i]; p < off[i + 1]; p++) if (!varray.get(p)) { all = 0; break }
                    out[i] = all
                }
                return GVArray.fromArray('bool', out)
            }
            const mixer = createDefaultMixer(varray.type, out)
            const src = varray.materialize()
            for (let i = 0; i < n; i++) for (let p = off[i]; p < off[i + 1]; p++) mixer.mixIn(i, src, p)
            mixer.finalize()
            return GVArray.fromArray(varray.type, out)
        }
        if (from === AttrDomain.Curve && to === AttrDomain.Point) {
            const out = new DATA_TYPES[varray.type].array(this.curves.pointsNum * c)
            for (let i = 0; i < n; i++) {
                for (let p = off[i]; p < off[i + 1]; p++) for (let k = 0; k < c; k++) out[p * c + k] = varray.get(i, k)
            }
            return GVArray.fromArray(varray.type, out)
        }
        return undefined
    }
}

/** `InstanceReference` (`BKE_instances.hh:56`). Objects and collections are referenced by name. */
export type InstanceReference =
    | {type: 'none'}
    | {type: 'object', name: string}
    | {type: 'collection', name: string}
    | {type: 'geometry', geometry: GeometrySet}

/**
 * `operator==(InstanceReference)` (`instances.cc:151`): geometry sets by their component pointers and name
 * (`GeometrySet::operator==`), IDs by name.
 */
export function instanceReferenceEquals(a: InstanceReference, b: InstanceReference): boolean {
    if (a.type !== b.type) return false
    if (a.type === 'geometry') return a.geometry.equals((b as typeof a).geometry)
    if (a.type === 'none') return true
    return a.name === (b as typeof a).name
}

/** `Instances` (`BKE_instances.hh:115`): references plus per-instance transforms and attributes. */
export class Instances {
    readonly attributes: AttributeStorage
    references: InstanceReference[] = []

    constructor(instancesNum = 0) {
        this.attributes = new AttributeStorage({[AttrDomain.Instance]: instancesNum}, kernelTable(INSTANCES_BUILTINS))
        this.attributes.add({name: 'instance_transform', domain: AttrDomain.Instance, type: 'float4x4'})
        this.attributes.add({name: '.reference_index', domain: AttrDomain.Instance, type: 'int32'})
    }

    get instancesNum(): number {
        return this.attributes.domainSizes[AttrDomain.Instance]
    }

    /** `transforms()`: 16 floats per instance, column major. */
    get transforms(): Float32Array {
        return this.attributes.get('instance_transform')!.data as Float32Array
    }

    /** `reference_handles()`. */
    get referenceHandles(): Int32Array {
        return this.attributes.get('.reference_index')!.data as Int32Array
    }

    /** `add_reference` (`instances.cc:264`): reuse an equal reference, else append. */
    addReference(ref: InstanceReference): number {
        const i = this.references.findIndex(r => instanceReferenceEquals(r, ref))
        if (i >= 0) return i
        this.references.push(ref)
        return this.references.length - 1
    }

    resize(n: number): void {
        this.attributes.resizeDomain(AttrDomain.Instance, n)
    }

    accessor(): AttributeAccessor {
        return new SingleDomainAccessor(this.attributes, INSTANCES_BUILTINS, AttrDomain.Instance)
    }

    clone(): Instances {
        const out = Object.create(Instances.prototype) as Instances
        ;(out as {attributes: AttributeStorage}).attributes = this.attributes.clone()
        out.references = this.references.slice()
        return out
    }
}

/**
 * Blender's mesh built-in table (`mesh_attributes.cc` `builtin_attributes()`): the kernel's default table also
 * fixes the editor's attributes (`.select_*`, `.hide_*`, creases, bevel weights, `uv_seam`) to one domain, which
 * Blender does not - geometry nodes can move `.select_poly` onto points. Meshes the procedural package creates or
 * writes use this table.
 */
export const BLENDER_MESH_TABLE = kernelTable(MESH_BUILTINS)

/** A new empty mesh with Blender's built-in table. */
export function newMeshData(): MeshData {
    const mesh = new MeshData()
    mesh.attributes.setBuiltins(BLENDER_MESH_TABLE)
    return mesh
}
