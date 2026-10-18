/**
 * Distribute Points on Faces (`GeometryNodeDistributePointsOnFaces`) -
 * `nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc` (declaration :28, random :528, poisson disk :573,
 * `node_geo_exec` :633). Corner triangles are the kernel's port of `mesh::corner_tris_calc`, the random numbers
 * Blender's `RandomNumberGenerator` (`src/blender/rand.ts`), the elimination search `BLI_kdtree` (`src/blender/kdtree.ts`).
 * `geometry::debug_randomize_point_order` only acts with Blender's debug flag set, so it is not applied.
 */

import {AttrDomain, cornerTriFaces, cornerTrisCalc, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {KDTree3} from '../../blender/kdtree'
import {quatNormalize} from '../../blender/math/rotation'
import {OB_NEGZ, OB_POSY, vecToQuat} from '../../blender/math/vecToQuat'
import {hash2, hashFloat3, hashFloatToFloat3} from '../../blender/noise'
import {RandomNumberGenerator} from '../../blender/rand'
import {elementwise, evaluateConstantField, FieldContext, FieldEvaluation, FieldOperation, GField} from '../../fields'
import {AttributeFieldInput} from '../../fields/inputs'
import {DataType} from '../../geometry/dataTypes'
import {ComponentType} from '../../geometry/GeometrySet'
import {PointCloud} from '../../geometry/components'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshFaceNormals, meshNormalsDomain, meshNormalsVArray, meshVertNormals} from '../../geometry/meshNormals'
import {sampleCornerAttribute, sampleFaceAttribute, sampleNormals, samplePointAttribute} from '../../geometry/meshSample'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/** "max(float, float)" with 0: `extract_non_negative_density` (:620). */
const maxZero = elementwise('max(float, float)', ['float', 'float'], ['float'], ([a, b], [o]) => { o[0] = a[0] < b[0] ? b[0] : a[0] })

/** `area_tri_v3` (`math_geom.cc:104`): half the length of `cross_tri_v3`. */
function areaTri(p: Float32Array, a: number, b: number, c: number): number {
    const n1 = [f32(p[a] - p[b]), f32(p[a + 1] - p[b + 1]), f32(p[a + 2] - p[b + 2])]
    const n2 = [f32(p[b] - p[c]), f32(p[b + 1] - p[c + 1]), f32(p[b + 2] - p[c + 2])]
    const x = f32(f32(n1[1] * n2[2]) - f32(n1[2] * n2[1]))
    const y = f32(f32(n1[2] * n2[0]) - f32(n1[0] * n2[2]))
    const z = f32(f32(n1[0] * n2[1]) - f32(n1[1] * n2[0]))
    return f32(f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z)))) * 0.5)
}

interface Sampled {
    positions: number[]
    bary: number[]
    tris: number[]
}

/** `calc_tri_point_offsets` (:94/:119): points per corner triangle; `densities` per corner or one value. */
function triPointCounts(mesh: MeshData, tris: Int32Array, density: Float32Array | number, seed: number): number[] {
    const p = mesh.positions, cv = mesh.cornerVerts
    const counts: number[] = []
    for (let t = 0; t < tris.length / 3; t++) {
        const c0 = tris[t * 3], c1 = tris[t * 3 + 1], c2 = tris[t * 3 + 2]
        const d = typeof density === 'number' ? density : f32(f32(f32(density[c0] + density[c1]) + density[c2]) / 3)
        const area = areaTri(p, cv[c0] * 3, cv[c1] * 3, cv[c2] * 3)
        const rng = new RandomNumberGenerator(hash2(t, seed))
        counts.push(rng.roundProbabilistic(f32(area * d)))
    }
    return counts
}

/** `sample_bary_coords` (:153). */
function sampleBaryCoords(mesh: MeshData, tris: Int32Array, counts: number[], seed: number): Sampled {
    const p = mesh.positions, cv = mesh.cornerVerts
    const out: Sampled = {positions: [], bary: [], tris: []}
    for (let t = 0; t < counts.length; t++) {
        if (!counts[t]) continue
        const v = [cv[tris[t * 3]] * 3, cv[tris[t * 3 + 1]] * 3, cv[tris[t * 3 + 2]] * 3]
        const rng = new RandomNumberGenerator(hash2(t, seed))
        // "Retain legacy behavior."
        rng.skip(1)
        for (let i = 0; i < counts[t]; i++) {
            const b = rng.getBarycentricCoordinates()
            for (let k = 0; k < 3; k++) out.positions.push(f32(f32(f32(b[0] * p[v[0] + k]) + f32(b[1] * p[v[1] + k])) + f32(b[2] * p[v[2] + k])))
            out.bary.push(b[0], b[1], b[2])
            out.tris.push(t)
        }
    }
    return out
}

/** `calc_full_density_factors_with_selection` (:513): the field on corners, 0 where not selected. */
function cornerDensities(mesh: MeshData, density: GField, selection: GField): Float32Array {
    const n = mesh.cornersNum
    const e = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Corner), n)
    const sel = e.evaluate(selection), d = e.evaluate(density)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) if (sel.get(i, 0)) out[i] = d.get(i, 0)
    return out
}

/** `propagate_attributes` (:322): point, corner and face attributes interpolated at the samples. */
function propagateAttributes(mesh: MeshData, accessor: ReturnType<PointCloud['accessor']>, meshAccessor: ReturnType<typeof meshAttributes>,
    tris: Int32Array, triFaces: Int32Array, s: Sampled): void {
    for (const name of meshAccessor.names()) {
        const meta = meshAccessor.lookupMeta(name)!
        if (meta.domain === AttrDomain.Edge) continue
        if (meshAccessor.isBuiltin(name) && !accessor.isBuiltin(name)) continue
        if (name === 'position') continue
        const src = meshAccessor.lookup(name)!
        const type = meta.type as DataType
        if (src.isSingle && accessor.add(name, AttrDomain.Point, type, src.single)) continue
        if (!accessor.contains(name)) accessor.add(name, AttrDomain.Point, type)
        const dst = accessor.layerForWrite(name)!.data
        if (meta.domain === AttrDomain.Point) samplePointAttribute(mesh.cornerVerts, tris, s.tris, s.bary, src, dst)
        else if (meta.domain === AttrDomain.Corner) sampleCornerAttribute(tris, s.tris, s.bary, src, dst)
        else if (meta.domain === AttrDomain.Face) sampleFaceAttribute(triFaces, s.tris, src, dst)
    }
}

function meshAttributes(mesh: MeshData) {
    return new FieldContext('mesh', mesh, AttrDomain.Point).attributes()
}

/** `compute_attribute_outputs` (:442) with `compute_normal_outputs` (:375) / legacy (:410). */
function attributeOutputs(mesh: MeshData, pc: PointCloud, tris: Int32Array, triFaces: Int32Array, s: Sampled,
    normalId: string | undefined, rotationId: string | undefined, legacyNormal: boolean): void {
    const n = s.tris.length
    const acc = pc.accessor()
    if (!acc.contains('id')) acc.add('id', AttrDomain.Point, 'int32')
    const ids = acc.layerForWrite('id')!.data
    for (let i = 0; i < n; i++) ids[i] = hash2(hashFloat3(s.bary[i * 3], s.bary[i * 3 + 1], s.bary[i * 3 + 2]), s.tris[i]) | 0
    if (!normalId) {
        // Blender creates the rotation attribute but fills it only from the normals (:458-473): without the Normal
        // output it keeps its default-constructed value.
        if (rotationId) acc.add(rotationId, AttrDomain.Point, 'quaternion')
        return
    }
    const normals = new Float32Array(n * 3)
    if (legacyNormal) {
        // `normal_tri_v3` of the triangle (:410).
        const p = mesh.positions, cv = mesh.cornerVerts
        for (let i = 0; i < n; i++) {
            const t = s.tris[i] * 3
            const a = cv[tris[t]] * 3, b = cv[tris[t + 1]] * 3, c = cv[tris[t + 2]] * 3
            const n1 = [f32(p[a] - p[b]), f32(p[a + 1] - p[b + 1]), f32(p[a + 2] - p[b + 2])]
            const n2 = [f32(p[b] - p[c]), f32(p[b + 1] - p[c + 1]), f32(p[b + 2] - p[c + 2])]
            const x = f32(f32(n1[1] * n2[2]) - f32(n1[2] * n2[1]))
            const y = f32(f32(n1[2] * n2[0]) - f32(n1[0] * n2[2]))
            const z = f32(f32(n1[0] * n2[1]) - f32(n1[1] * n2[0]))
            const d = f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))
            if (d > f32(1e-35)) {
                const inv = f32(1 / f32(Math.sqrt(d)))
                normals.set([f32(x * inv), f32(y * inv), f32(z * inv)], i * 3)
            }
        }
    } else {
        const domain = meshNormalsDomain(mesh)
        if (domain === 'point') {
            const cv = mesh.cornerVerts
            sampleNormals(t => [cv[tris[t * 3]], cv[tris[t * 3 + 1]], cv[tris[t * 3 + 2]]], s.tris, s.bary, meshVertNormals(mesh), normals)
        } else if (domain === 'face') {
            sampleFaceAttribute(triFaces, s.tris, GVArray.fromArray('float3', meshFaceNormals(mesh)), normals)
        } else {
            const cn = meshNormalsVArray(mesh, AttrDomain.Corner).materialize()
            sampleNormals(t => [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]], s.tris, s.bary, cn, normals)
        }
    }
    acc.add(normalId, AttrDomain.Point, 'float3', normals)
    if (rotationId) {
        // `normal_to_rotation` (:85).
        const rot = new Float32Array(n * 4)
        for (let i = 0; i < n; i++) rot.set(quatNormalize(vecToQuat(normals.subarray(i * 3, i * 3 + 3), OB_NEGZ, OB_POSY)), i * 4)
        acc.add(rotationId, AttrDomain.Point, 'quaternion', rot)
    }
}

function buildPointCloud(mesh: MeshData, tris: Int32Array, s: Sampled, normalId: string | undefined, rotationId: string | undefined, legacyNormal: boolean): PointCloud {
    const triFaces = cornerTriFaces(mesh)
    const pc = new PointCloud(s.tris.length)
    pc.positions.set(s.positions)
    const acc = pc.accessor()
    acc.add('radius', AttrDomain.Point, 'float', [f32(0.05)])
    propagateAttributes(mesh, acc, meshAttributes(mesh), tris, triFaces, s)
    attributeOutputs(mesh, pc, tris, triFaces, s, normalId, rotationId, legacyNormal)
    return pc
}

/** `vector.remove_and_reorder(i)`: the last element takes the removed one's place. */
function removeAndReorder(s: Sampled, i: number): void {
    const last = s.tris.length - 1
    for (let k = 0; k < 3; k++) {
        s.positions[i * 3 + k] = s.positions[last * 3 + k]
        s.bary[i * 3 + k] = s.bary[last * 3 + k]
    }
    s.tris[i] = s.tris[last]
    s.positions.length -= 3
    s.bary.length -= 3
    s.tris.length -= 1
}

registerNodeType({
    idname: 'GeometryNodeDistributePointsOnFaces',
    label: 'Distribute Points on Faces',
    properties: {distribute_method: 'RANDOM', use_legacy_normal: false},
    enums: {distribute_method: ['RANDOM', 'POISSON']},
    declare(b, node) {
        const poisson = node.prop<string>('distribute_method') === 'POISSON'
        b.input('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('FLOAT', 'Distance Min').min(0).subtype('DISTANCE').available(poisson)
        b.input('FLOAT', 'Density Max').default(10).min(0).available(poisson)
        b.input('FLOAT', 'Density').default(10).min(0).field().available(!poisson)
        b.input('FLOAT', 'Density Factor').default(1).min(0).max(1).subtype('FACTOR').field().available(poisson)
        b.input('INT', 'Seed')
        b.output('GEOMETRY', 'Points')
        b.output('VECTOR', 'Normal').field()
        b.output('ROTATION', 'Rotation').field()
    },
    execute(p) {
        const selection = p.field('Selection')
        const seed = Math.imul(p.int('Seed'), 5383843)
        const legacyNormal = p.node.prop<boolean>('use_legacy_normal')
        const rotationId = p.outputUsed('Rotation') ? p.anonymousName('Rotation') : undefined
        const normalId = p.outputUsed('Normal') ? p.anonymousName('Normal') : undefined
        const poisson = p.node.prop<string>('distribute_method') === 'POISSON'
        const nonNegative = (id: string) => new FieldOperation(maxZero, [p.field(id), GField.constant('float', [0])]).output(0)
        const keepPointCloud = (g: Parameters<Parameters<typeof foreachRealGeometry>[1]>[0], pc: PointCloud | undefined) => {
            for (const t of ['mesh', 'curves', 'instances'] as ComponentType[]) g.remove(t)
            g.setPointCloud(pc)
        }
        let out
        if (!poisson) {
            const density = nonNegative('Density')
            out = foreachRealGeometry(p.geometry('Mesh'), g => {
                const mesh = g.mesh
                let pc: PointCloud | undefined
                if (mesh) {
                    // `create_points_random` (:528).
                    const tris = cornerTrisCalc(mesh)
                    const counts = selection.dependsOnInput || density.dependsOnInput
                        ? triPointCounts(mesh, tris, cornerDensities(mesh, density, selection), seed)
                        : triPointCounts(mesh, tris, f32(evaluateConstantField(density)[0]), seed)
                    if (counts.some(c => c > 0)) {
                        const s = sampleBaryCoords(mesh, tris, counts, seed)
                        pc = buildPointCloud(mesh, tris, s, normalId, rotationId, legacyNormal)
                    }
                    keepPointCloud(g, pc)
                } else {
                    keepPointCloud(g, g.pointCloud)
                }
            }, p.options.scene)
        } else {
            const factors = nonNegative('Density Factor')
            const minimumDistance = p.float('Distance Min')
            const densityMax = p.float('Density Max')
            out = foreachRealGeometry(p.geometry('Mesh'), g => {
                const mesh = g.mesh
                if (!mesh) return
                // `create_points_poisson_disk` (:573).
                let pc: PointCloud | undefined
                if (densityMax > 0) {
                    const tris = cornerTrisCalc(mesh)
                    const counts = triPointCounts(mesh, tris, densityMax, seed)
                    if (counts.some(c => c > 0)) {
                        const s = sampleBaryCoords(mesh, tris, counts, seed)
                        const n = s.tris.length
                        const eliminated = new Uint8Array(n)
                        // `update_elimination_mask_for_close_points` (:221).
                        if (minimumDistance > 0) {
                            const tree = new KDTree3(n)
                            for (let i = 0; i < n; i++) tree.insert(i, s.positions[i * 3], s.positions[i * 3 + 1], s.positions[i * 3 + 2])
                            tree.balance()
                            for (let i = 0; i < n; i++) {
                                if (eliminated[i]) continue
                                tree.rangeSearch(s.positions[i * 3], s.positions[i * 3 + 1], s.positions[i * 3 + 2], minimumDistance, index => {
                                    if (index !== i) eliminated[index] = 1
                                    return true
                                })
                            }
                        }
                        // `update_elimination_mask_based_on_density_factors` (:245).
                        const factorsC = cornerDensities(mesh, factors, selection)
                        for (let i = 0; i < n; i++) {
                            if (eliminated[i]) continue
                            const t = s.tris[i] * 3
                            const b = [s.bary[i * 3], s.bary[i * 3 + 1], s.bary[i * 3 + 2]]
                            const probability = f32(f32(f32(factorsC[tris[t]] * b[0]) + f32(factorsC[tris[t + 1]] * b[1])) + f32(factorsC[tris[t + 2]] * b[2]))
                            if (hashFloatToFloat3(b[0], b[1], b[2]) > probability) eliminated[i] = 1
                        }
                        // `eliminate_points_based_on_mask` (:268): from the end, swapping in the last element.
                        for (let i = n - 1; i >= 0; i--) if (eliminated[i]) removeAndReorder(s, i)
                        if (s.tris.length) pc = buildPointCloud(mesh, tris, s, normalId, rotationId, legacyNormal)
                    }
                }
                keepPointCloud(g, pc)
            }, p.options.scene)
        }
        p.set('Points', out)
        if (normalId) p.set('Normal', GField.fromInput(new AttributeFieldInput(normalId, 'float3')))
        if (rotationId) p.set('Rotation', GField.fromInput(new AttributeFieldInput(rotationId, 'quaternion')))
    },
})
