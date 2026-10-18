/**
 * Geometry and scenes exported from Blender (`porting/blender/geometry_dump.py`, the format the
 * comparator reads) turned back into `GeometrySet`s - the modifier's input mesh in Blender's own
 * element order, referenced objects for Object/Collection Info, images.
 */

import {AttrDomain, AttributeStorage} from '@threepipe/mesh-kernel'
import {DATA_TYPES, DataType} from '../geometry/dataTypes'
import {GeometrySet} from '../geometry/GeometrySet'
import {CurvesGeometry, InstanceReference, Instances, PointCloud} from '../geometry/components'
import type {ExpectedAttribute, ExpectedGeometry, ExpectedReference} from '../testing/compareGeometry'
import type {SceneProvider, SceneObject, SceneCollection, SceneImage} from '../runtime/context'
import type {DumpModifierInput} from './importBlenderDump'
import type {GeometryNodesEvaluator} from '../runtime/evaluator'
import {GField} from '../fields/field'
import {AttributeFieldInput} from '../fields/inputs'
import {socketDataType} from '../runtime/declaration'
import {socketTypeFromIdname, JSONValue} from '../runtime/types'
import {newMeshData} from '../geometry/components'

/** A reference to values in the dump's sidecar `.bin` file. */
export interface BinRef {
    bin: string
    dtype: 'f4' | 'i4' | 'u1'
    offset: number
    count: number
    /**
     * `'unorm8'` (bundles, `bundle_dump.py`): bytes k standing for the float32 `float(k) * (1.0f / 255.0f)`, the
     * float buffer Blender makes from an 8-bit image in a linear colour space; decoded back to those float32 bits.
     */
    encoding?: 'unorm8'
}

const UNORM8_SCALE = Math.fround(1 / 255)

/** Resolves {@link BinRef}s; in Node read the file, in the browser fetch it. */
export type BinResolver = (ref: BinRef) => ArrayLike<number>

/** A resolver over already-loaded `.bin` buffers, by file name. */
export function binResolver(files: Record<string, ArrayBuffer | Uint8Array>): BinResolver {
    // A view's bytes are copied once into their own buffer, so typed arrays can start at the refs' offsets.
    const buffers = new Map<string, ArrayBuffer>()
    return ref => {
        let buffer = buffers.get(ref.bin)
        if (!buffer) {
            const b = files[ref.bin]
            if (!b) throw new Error(`procedural: dump references '${ref.bin}', which was not loaded`)
            buffer = b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer : b
            buffers.set(ref.bin, buffer)
        }
        if (ref.dtype === 'u1') {
            const bytes = new Uint8Array(buffer, ref.offset, ref.count)
            if (ref.encoding !== 'unorm8') return bytes
            const out = new Float32Array(ref.count)
            for (let i = 0; i < out.length; i++) out[i] = bytes[i] * UNORM8_SCALE
            return out
        }
        return ref.dtype === 'f4' ? new Float32Array(buffer, ref.offset, ref.count) : new Int32Array(buffer, ref.offset, ref.count)
    }
}

function isBinRef(v: unknown): v is BinRef {
    return !!v && typeof v === 'object' && 'bin' in v && 'dtype' in v && 'offset' in v
}

/** A copy of `value` with every {@link BinRef} replaced by its numbers (what the comparator reads). */
export function inlineBinRefs<T>(value: T, resolve: BinResolver): T {
    if (isBinRef(value)) return Array.from(resolve(value)) as T
    if (Array.isArray(value)) return value.map(v => inlineBinRefs(v, resolve)) as T
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value)) out[k] = inlineBinRefs(v, resolve)
        return out as T
    }
    return value
}

function values(v: unknown, resolve: BinResolver | undefined): ArrayLike<number> {
    if (Array.isArray(v)) return v.map(x => (x === null ? NaN : x))
    if (isBinRef(v)) {
        if (!resolve) throw new Error('procedural: dump has binary arrays but no resolver was given')
        return resolve(v)
    }
    return []
}

const TYPES: Record<string, DataType> = {
    FLOAT: 'float', INT: 'int32', INT8: 'int8', BOOLEAN: 'bool', FLOAT2: 'float2', FLOAT_VECTOR: 'float3',
    FLOAT_COLOR: 'float4', BYTE_COLOR: 'byteColor', QUATERNION: 'quaternion', FLOAT4X4: 'float4x4',
    INT32_2D: 'int32x2', INT16_2D: 'int16x2',
}

const DOMAINS: Record<string, AttrDomain> = {
    POINT: AttrDomain.Point, EDGE: AttrDomain.Edge, FACE: AttrDomain.Face, CORNER: AttrDomain.Corner,
    CURVE: AttrDomain.Curve, INSTANCE: AttrDomain.Instance,
}

function fillAttributes(storage: AttributeStorage, attrs: ExpectedAttribute[], resolve: BinResolver | undefined, domainOverride?: AttrDomain): void {
    for (const a of attrs) {
        const type = TYPES[a.type]
        if (!type || a.values === null) continue
        const domain = domainOverride ?? DOMAINS[a.domain]
        let data = values(a.values, resolve)
        // `geometry_dump.py` writes byte colours as `color_srgb` (byte / 255).
        if (type === 'byteColor') data = Array.from(data, v => Math.round(v * 255))
        let layer = storage.get(a.name)
        // A vertex group (exported as a point float attribute) shadows an attribute of the same name: mesh lookups
        // try vertex groups first (`mesh_attributes.cc:878`). MeshData has one namespace, so the group replaces it.
        if (layer && (a as {vertexGroup?: boolean}).vertexGroup) {
            storage.remove(a.name)
            layer = undefined
        }
        if (!layer) layer = storage.add({name: a.name, domain, type})
        if (layer.data.length !== data.length) {
            throw new Error(`procedural: dumped attribute '${a.name}' has ${data.length} values, expected ${layer.data.length}`)
        }
        layer.data.set(data as ArrayLike<number> as number[])
    }
}

/** The geometry set of a dump (`read_geometry`). */
export function geometryFromDump(g: ExpectedGeometry, resolve?: BinResolver): GeometrySet {
    const out = new GeometrySet()
    out.name = g.name ?? ''
    if (g.mesh) {
        const m = g.mesh
        const mesh = newMeshData()
        const offsets = m.faceOffsets ? Array.from(values(m.faceOffsets, resolve))
            : [...(m.faceStarts ?? []), (m.faceStarts?.length ? m.faceStarts[m.faceStarts.length - 1] + m.faceSizes![m.faceSizes!.length - 1] : 0)]
        const edgesNum = typeof m.edges === 'number' ? m.edges : m.edges.length / 2
        mesh.resize({verts: m.vertices, edges: edgesNum, faces: offsets.length - 1, corners: offsets[offsets.length - 1] ?? 0})
        mesh.faceOffsets.set(offsets)
        fillAttributes(mesh.attributes, m.attributes, resolve)
        const mats = (m as {materials?: (string | null)[]}).materials
        if (mats) mesh.materials = mats.map(x => x ?? '')
        out.setMesh(mesh)
    }
    if (g.pointcloud) {
        const pc = new PointCloud(g.pointcloud.points)
        fillAttributes(pc.attributes, g.pointcloud.attributes, resolve)
        if (g.pointcloud.materials) pc.materials = g.pointcloud.materials.map(x => x ?? '')
        out.setPointCloud(pc)
    }
    if (g.curves) {
        const c = new CurvesGeometry(g.curves.points, g.curves.curves)
        if (g.curves.curveOffsets) c.curveOffsets.set(values(g.curves.curveOffsets, resolve) as number[])
        fillAttributes(c.attributes, g.curves.attributes, resolve)
        if (g.curves.materials) c.materials = g.curves.materials.map(x => x ?? '')
        out.setCurves(c)
    }
    if (g.instances) {
        const inst = new Instances(g.instances.count)
        fillAttributes(inst.attributes, g.instances.attributes.filter(a => a.name !== 'position'), resolve, AttrDomain.Instance)
        inst.references = g.instances.references.map((r: ExpectedReference): InstanceReference => {
            if (r.kind === 'none') return {type: 'none'}
            if (r.kind === 'geometry') return {type: 'geometry', geometry: geometryFromDump((r as {geometry: ExpectedGeometry}).geometry, resolve)}
            return {type: r.kind, name: r.name}
        })
        out.setInstances(inst)
    }
    return out
}

export interface DumpReferenced {
    objects: Record<string, {
        type: string, matrix_world: number[], parent: string | null, geometry: ExpectedGeometry | null
        /** Empties: the collection they instance (`Object::instance_collection`). */
        instance_collection?: string | null
    }>
    collections: Record<string, {objects: string[], children: string[], instance_offset: number[]}>
    images: Record<string, {size: [number, number], channels: number, isFloat?: boolean, isData?: boolean, alphaMode?: SceneImage['alphaMode'], pixels: unknown}>
}

/**
 * `object_get_evaluated_geometry_set` (geometry_set_instances.cc:42): the evaluated geometry; for an Empty
 * instancing a collection one identity instance of it (:63); otherwise - including objects the depsgraph
 * did not evaluate (:44), dumped with `geometry: null` - an empty set.
 */
function objectGeometry(d: DumpReferenced['objects'][string], resolve: BinResolver | undefined): GeometrySet {
    if (d.geometry) return geometryFromDump(d.geometry, resolve)
    if (d.type === 'EMPTY' && d.instance_collection) {
        const instances = new Instances(1)
        instances.referenceHandles[0] = instances.addReference({type: 'collection', name: d.instance_collection})
        instances.transforms.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
        const g = new GeometrySet()
        g.setInstances(instances)
        return g
    }
    return new GeometrySet()
}

/** A {@link SceneProvider} over a dump's referenced objects, collections and images. */
export function sceneFromDump(ref: DumpReferenced, resolve?: BinResolver): SceneProvider {
    const objects = new Map<string, SceneObject>()
    const images = new Map<string, SceneImage>()
    return {
        object(name) {
            let o = objects.get(name)
            if (!o) {
                const d = ref.objects[name]
                if (!d) return undefined
                o = {transform: Float32Array.from(d.matrix_world), geometry: objectGeometry(d, resolve)}
                objects.set(name, o)
            }
            return o
        },
        collection(name): SceneCollection | undefined {
            const c = ref.collections[name]
            if (!c) return undefined
            return {objects: c.objects, children: c.children, instanceOffset: [c.instance_offset[0], c.instance_offset[1], c.instance_offset[2]]}
        },
        image(name) {
            let img = images.get(name)
            if (!img) {
                const d = ref.images[name]
                if (!d) return undefined
                // `Image.pixels` is the float buffer for float images (`rna_Image_pixels_get`, rna_image.cc:647); for
                // byte images it is `byte / 255`, not the colour-managed buffer `IMB_float_from_byte` makes for the node.
                if (d.isFloat === false) throw new Error(`image "${name}": byte images need IMB_float_from_byte (colour management), not ported`)
                if (d.channels !== 4) throw new Error(`image "${name}": ${d.channels} channels, the Image Texture node reads RGBA float buffers`)
                const px = values(d.pixels, resolve)
                img = {width: d.size[0], height: d.size[1], pixels: px instanceof Float32Array ? px : Float32Array.from(px), alphaMode: d.alphaMode, isData: d.isData}
                images.set(name, img)
            }
            return img
        },
    }
}

/**
 * Set a modifier's dumped inputs on an evaluator: values as they are, attribute inputs
 * (`type == ATTRIBUTE`) as a field reading that attribute (`nodes/intern/geometry_nodes_execute.cc`).
 */
export function applyModifierInputs(ev: GeometryNodesEvaluator, inputs: Record<string, DumpModifierInput>): void {
    for (const [identifier, input] of Object.entries(inputs)) {
        const socket = ev.interfaceInputs.find(s => s.identifier === identifier)
        if (!socket) continue
        const type = socketTypeFromIdname(socket.socketType)
        if (type === 'GEOMETRY') continue
        if (input.type === 'ATTRIBUTE' && input.attribute_name) {
            const dt = socketDataType(type)
            if (!dt) throw new Error(`procedural: modifier input '${input.name}' reads an attribute but is not a field socket`)
            ev.setInput(identifier, GField.fromInput(new AttributeFieldInput(input.attribute_name, dt)))
            continue
        }
        if (input.value !== undefined) ev.setInput(identifier, input.value as JSONValue)
    }
}

export {DATA_TYPES}
