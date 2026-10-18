/**
 * Sampling nodes: Sample Index (`node_geo_sample_index.cc`, `bke::SampleIndexFunction` in
 * `blenkernel/intern/geometry_fields.cc:671-736`), Sample Nearest (`node_geo_sample_nearest.cc`) and Sample Nearest
 * Surface (`node_geo_sample_nearest_surface.cc` with `BaryWeightFromPositionFn` / `BaryWeightSampleFn`,
 * `blenkernel/intern/mesh_sample.cc:392-560`). Nearest queries use Blender's BVH trees (`src/geometry/meshBVH.ts`).
 *
 * Each node runs its multi-function the way `execute_multi_function_on_value_variant` does: once on single values,
 * or as a field operation when an input is a field.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {interpWeightsTriV3} from '../../blender/math/geom'
import {newNearest} from '../../blender/kdopbvh'
import {evaluateConstantField, FieldContext, FieldEvaluation, FieldOperation, GField, MultiFunction} from '../../fields'
import {DATA_TYPES, DataType, TypedArray} from '../../geometry/dataTypes'
import {ComponentType, GeometrySet} from '../../geometry/GeometrySet'
import {bvhFindNearest, meshBVHCornerTris, meshBVHEdges, meshBVHTrisForFaces, meshBVHVerts, meshCornerTriFaces, meshCornerTris, pointCloudBVH} from '../../geometry/meshBVH'
import {mix3} from '../../geometry/meshSample'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'
import {domainFromRNA, socketTypeFromRNA} from '../attributeTypes'

const FLT_MAX = 3.4028234663852886e38

/** `attribute_type_type_with_socket_fn` / `generic_attribute_type_supported_with_socket` (`rna_nodetree.cc:2399`). */
const SOCKET_ATTRIBUTE_TYPES = ['FLOAT', 'INT', 'BOOLEAN', 'FLOAT_VECTOR', 'FLOAT_COLOR', 'QUATERNION', 'FLOAT4X4']

/**
 * `execute_multi_function_on_value_variant` (`geometry_nodes_lazy_function.cc:502`): single inputs run the function
 * once and give single values, otherwise its outputs are field operations.
 */
function applyFunction(fn: MultiFunction, inputs: GField[]): GField[] {
    if (inputs.every(f => !f.dependsOnInput)) {
        const singles = inputs.map(f => GVArray.fromSingle(f.type, 1, evaluateConstantField(f)))
        const outs = fn.outputs.map(t => new DATA_TYPES[t].array(DATA_TYPES[t].components))
        fn.call(1, singles, outs)
        return fn.outputs.map((t, i) => GField.constant(t, Array.from(outs[i])))
    }
    const op = new FieldOperation(fn, inputs)
    return fn.outputs.map((_, i) => op.output(i))
}

/** `CPPType::value_initialize`: zeros for every type, including `math::Quaternion` (defaulted constructor). */
function valueInitialize(out: TypedArray, i: number, c: number): void {
    for (let k = 0; k < c; k++) out[i * c + k] = 0
}

// region Sample Index

/** `component_is_available` + `SampleIndexFunction::find_source_component` (`geometry_fields.cc:660-690`). */
function findSourceComponent(geometry: GeometrySet, domain: AttrDomain, types: ComponentType[]): ComponentType | undefined {
    return types.find(t => geometry.has(t) && geometry.domainSize(t, domain) !== 0)
}

/** Values of `field` on `domain` of a component (`prepare_for_execution`), computed on first use. */
function lazyComponentValues(geometry: GeometrySet, type: ComponentType, domain: AttrDomain, field: GField): () => GVArray {
    let values: GVArray | undefined
    return () => {
        if (!values) {
            const size = geometry.domainSize(type, domain)
            values = new FieldEvaluation(new FieldContext(type, geometry.get(type)!, domain), size).evaluate(field)
        }
        return values
    }
}

registerNodeType({
    idname: 'GeometryNodeSampleIndex',
    label: 'Sample Index',
    // `node_init` (:41).
    properties: {data_type: 'FLOAT', domain: 'POINT', clamp: false},
    enums: {data_type: SOCKET_ATTRIBUTE_TYPES, domain: ['POINT', 'EDGE', 'FACE', 'CORNER', 'CURVE', 'INSTANCE', 'LAYER']},
    // `node_declare` (:12).
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        b.input('GEOMETRY', 'Geometry')
        b.input(type, 'Value').hideValue().field()
        b.input('INT', 'Index')
        b.output(type, 'Value')
    },
    // `node_geo_exec` (:64).
    execute(p) {
        const geometry = p.geometry('Geometry')
        const domainName = p.node.prop<string>('domain')
        if (domainName === 'LAYER') throw new Error('Sample Index: the grease pencil layer domain is not supported (no grease pencil component)')
        const domain = domainFromRNA(domainName)
        const clamp = p.node.prop<boolean>('clamp')
        const valueField = p.field('Value')
        const dt = valueField.type
        const c = DATA_TYPES[dt].components
        const index = p.field('Index')
        const type = findSourceComponent(geometry, domain, ['mesh', 'pointcloud', 'curves', 'instances'])
        if (!type) return
        const size = geometry.domainSize(type, domain)
        const values = lazyComponentValues(geometry, type, domain, valueField)
        if (!index.dependsOnInput) {
            // :79: a single index evaluates just that element; out of range gives the type's default value.
            let i = evaluateConstantField(index)[0]
            if (clamp) i = Math.min(Math.max(i, 0), size - 1)
            const out = new DATA_TYPES[dt].array(c)
            if (i >= 0 && i < size) for (let k = 0; k < c; k++) out[k] = values().get(i, k)
            else for (let k = 0; k < c; k++) out[k] = DATA_TYPES[dt].defaultValue[k]
            p.set('Value', GField.constant(dt, Array.from(out)))
            return
        }
        let indexField = index
        if (clamp) {
            // :108: `std::clamp(value, 0, domain_size - 1)`.
            const clampFn: MultiFunction = {
                name: 'Clamp', inputs: ['int32'], outputs: ['int32'],
                call(n, ins, outs) {
                    for (let e = 0; e < n; e++) outs[0][e] = Math.min(Math.max(ins[0].get(e), 0), size - 1)
                },
            }
            indexField = new FieldOperation(clampFn, [index]).output(0)
        }
        // `SampleIndexFunction::call` (:713): out-of-range indices are value-initialised.
        const sampleFn: MultiFunction = {
            name: 'Sample Index', inputs: ['int32'], outputs: [dt],
            call(n, ins, outs) {
                const src = values()
                for (let e = 0; e < n; e++) {
                    const i = ins[0].get(e)
                    if (i >= 0 && i < src.size) for (let k = 0; k < c; k++) outs[0][e * c + k] = src.get(i, k)
                    else valueInitialize(outs[0], e, c)
                }
            },
        }
        p.set('Value', new FieldOperation(sampleFn, [indexField]).output(0))
    },
})

// endregion

// region Sample Nearest

const distanceSquared = (a: readonly number[], positions: ArrayLike<number>, v: number) => {
    const f = Math.fround
    const d0 = f(a[0] - positions[v * 3]), d1 = f(a[1] - positions[v * 3 + 1]), d2 = f(a[2] - positions[v * 3 + 2])
    return f(f(f(d0 * d0) + f(d1 * d1)) + f(d2 * d2))
}

/** Nearest triangle (`get_closest_mesh_tris` :139) of each position, through `BLI_bvhtree_find_nearest`. */
function closestTri(mesh: MeshData, co: number[]): number {
    const nearest = newNearest()
    return bvhFindNearest(meshBVHCornerTris(mesh), co, nearest)
}

/** `SampleNearestFunction::call` (:261) for one position. */
function sampleNearestIndex(geometry: GeometrySet, type: ComponentType, domain: AttrDomain, co: number[]): number {
    if (type === 'pointcloud') {
        // `get_closest_pointcloud_points` (:84).
        const tree = pointCloudBVH(geometry.pointCloud!)
        if (!tree.tree) return 0
        return bvhFindNearest(tree, co, newNearest())
    }
    const mesh = geometry.mesh!
    switch (domain) {
    case AttrDomain.Point: return bvhFindNearest(meshBVHVerts(mesh), co, newNearest())
    case AttrDomain.Edge: return bvhFindNearest(meshBVHEdges(mesh), co, newNearest())
    case AttrDomain.Face: return triFaces(mesh)[closestTri(mesh, co)]
    case AttrDomain.Corner: {
        // `get_closest_mesh_corners` (:169): the closest corner of the closest face.
        const face = triFaces(mesh)[closestTri(mesh, co)]
        const fo = mesh.faceOffsets, cv = mesh.cornerVerts, positions = mesh.positions
        let min = FLT_MAX
        let closest = 0
        for (let corner = fo[face]; corner < fo[face + 1]; corner++) {
            const d = distanceSquared(co, positions, cv[corner])
            if (d < min) {
                min = d
                closest = corner
            }
        }
        return closest
    }
    default:
        return 0
    }
}

/** `Mesh::corner_tri_faces()`. */
const triFaces = meshCornerTriFaces

registerNodeType({
    idname: 'GeometryNodeSampleNearest',
    label: 'Sample Nearest',
    // `node_init` (:78).
    properties: {domain: 'POINT'},
    // `rna_enum_attribute_domain_only_mesh_items`.
    enums: {domain: ['POINT', 'EDGE', 'FACE', 'CORNER']},
    // `node_declare` (:59).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.input('VECTOR', 'Sample Position').implicit('POSITION')
        b.output('INT', 'Index')
    },
    // `node_geo_exec` (:312).
    execute(p) {
        const geometry = p.geometry('Geometry')
        const domain = domainFromRNA(p.node.prop<string>('domain'))
        if (geometry.curves && !geometry.mesh && !geometry.pointCloud) {
            p.warn('The source geometry must contain a mesh or a point cloud')
            return
        }
        // `SampleNearestFunction` (:249): the first of mesh, point cloud with elements on the domain.
        const type = findSourceComponent(geometry, domain, ['mesh', 'pointcloud'])
        const fn: MultiFunction = {
            name: 'Sample Nearest', inputs: ['float3'], outputs: ['int32'],
            call(n, ins, outs) {
                for (let e = 0; e < n; e++) {
                    outs[0][e] = type ? sampleNearestIndex(geometry, type, domain, [ins[0].get(e, 0), ins[0].get(e, 1), ins[0].get(e, 2)]) : 0
                }
            },
        }
        p.set('Index', applyFunction(fn, [p.field('Sample Position')])[0])
    },
})

// endregion

// region Sample Nearest Surface

/** `SampleNearestSurfaceFunction` (:89): BVH trees per face group, built on first use (`prepare_for_execution` :116). */
function sampleNearestSurfaceFn(mesh: MeshData, groupIdField: GField): MultiFunction {
    let groups: {ids: Map<number, number>, trees: ReturnType<typeof meshBVHTrisForFaces>[]} | undefined
    const prepare = () => {
        if (groups) return groups
        const ids = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Face), mesh.facesNum).evaluate(groupIdField)
        // `IndexMask::from_group_ids` (`index_mask.cc:1210`): groups in order of first occurrence.
        const index = new Map<number, number>()
        const masks: number[][] = []
        for (let f = 0; f < mesh.facesNum; f++) {
            const id = ids.get(f)
            let g = index.get(id)
            if (g === undefined) {
                index.set(id, g = masks.length)
                masks.push([])
            }
            masks[g].push(f)
        }
        return groups = {ids: index, trees: masks.map(m => meshBVHTrisForFaces(mesh, m))}
    }
    return {
        name: 'Sample Nearest Surface', inputs: ['float3', 'int32'], outputs: ['int32', 'float3', 'bool'],
        call(n, ins, outs) {
            const g = prepare()
            for (let e = 0; e < n; e++) {
                const group = g.ids.get(ins[1].get(e))
                if (group === undefined) {
                    outs[0][e] = -1
                    outs[1][e * 3] = outs[1][e * 3 + 1] = outs[1][e * 3 + 2] = 0
                    outs[2][e] = 0
                    continue
                }
                const nearest = newNearest()
                bvhFindNearest(g.trees[group], [ins[0].get(e, 0), ins[0].get(e, 1), ins[0].get(e, 2)], nearest)
                outs[0][e] = nearest.index
                outs[1].set(nearest.co, e * 3)
                outs[2][e] = 1
            }
        },
    }
}

/** `BaryWeightFromPositionFn::call` (`mesh_sample.cc:411`), `sample_barycentric_weights<true>` (:159). */
function baryWeightFromPositionFn(mesh: MeshData): MultiFunction {
    return {
        name: 'Bary Weight from Position', inputs: ['float3', 'int32'], outputs: ['float3'],
        call(n, ins, outs) {
            const tris = meshCornerTris(mesh), cv = mesh.cornerVerts, positions = mesh.positions
            const pos = (v: number) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
            for (let e = 0; e < n; e++) {
                const t = ins[1].get(e)
                if (t === -1) {
                    outs[0][e * 3] = outs[0][e * 3 + 1] = outs[0][e * 3 + 2] = 0
                    continue
                }
                // `compute_bary_coord_in_triangle` (:379).
                const w = interpWeightsTriV3(pos(cv[tris[t * 3]]), pos(cv[tris[t * 3 + 1]]), pos(cv[tris[t * 3 + 2]]),
                    [ins[0].get(e, 0), ins[0].get(e, 1), ins[0].get(e, 2)])
                outs[0].set(w, e * 3)
            }
        },
    }
}

/**
 * `BaryWeightSampleFn` (`mesh_sample.cc:477`). Its source domain comes from `try_detect_native_field_domain`
 * (`geometry_fields.cc:1187`), which in 5.2.2 returns `nullopt` for every field (its loop returns after the first
 * input whatever it found), so the value is always evaluated on corners and mixed with `sample_corner_attribute`.
 */
function baryWeightSampleFn(mesh: MeshData, field: GField): MultiFunction {
    const dt: DataType = field.type
    const c = DATA_TYPES[dt].components
    let source: GVArray | undefined
    return {
        name: 'Sample Barycentric Triangles', inputs: ['int32', 'float3'], outputs: [dt],
        call(n, ins, outs) {
            source ??= new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Corner), mesh.cornersNum).evaluate(field)
            const src = source
            const tris = meshCornerTris(mesh)
            const get = (i: number, k: number) => src.get(i, k)
            for (let e = 0; e < n; e++) {
                const t = ins[0].get(e)
                if (t < 0) {
                    valueInitialize(outs[0], e, c)
                    continue
                }
                const w = [ins[1].get(e, 0), ins[1].get(e, 1), ins[1].get(e, 2)]
                mix3(dt, w, get, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2], outs[0], e)
            }
        },
    }
}

registerNodeType({
    idname: 'GeometryNodeSampleNearestSurface',
    label: 'Sample Nearest Surface',
    // `node_init` (:67).
    properties: {data_type: 'FLOAT'},
    enums: {data_type: SOCKET_ATTRIBUTE_TYPES},
    // `node_declare` (:25).
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        b.input('GEOMETRY', 'Mesh')
        b.input(type, 'Value').hideValue().field()
        b.input('INT', 'Group ID').hideValue().field()
        b.input('VECTOR', 'Sample Position').implicit('POSITION')
        b.input('INT', 'Sample Group ID').hideValue()
        b.output(type, 'Value')
        b.output('BOOLEAN', 'Is Valid')
    },
    // `node_geo_exec` (:208).
    execute(p) {
        const geometry = p.geometry('Mesh')
        const mesh = geometry.mesh
        if (!mesh || mesh.vertsNum === 0) return
        if (mesh.facesNum === 0) {
            p.warn('The source mesh must have faces')
            return
        }
        const value = p.field('Value')
        const [triangle, position, isValid] = applyFunction(sampleNearestSurfaceFn(mesh, p.field('Group ID')),
            [p.field('Sample Position'), p.field('Sample Group ID')])
        const [bary] = applyFunction(baryWeightFromPositionFn(mesh), [position, triangle])
        const [sampled] = applyFunction(baryWeightSampleFn(mesh, value), [triangle, bary])
        p.set('Value', sampled)
        p.set('Is Valid', isValid)
    },
})

// endregion
