/** Interpolate Curves (`GeometryNodeInterpolateCurves`) - `nodes/geometry/nodes/node_geo_interpolate_curves.cc` (Blender 5.2.2). */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {KDTree3} from '../../blender/kdtree'
import {axisAngleNormalizedToMat3Ex} from '../../blender/math/matrixC'
import {cross3, dot3, interpolate3, V3} from '../../blender/math/vec'
import {AttributeFieldInput, FieldContext, FieldEvaluation, GField, lookupMultiFunction, FieldOperation} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {accumulateLengths, CURVE_TYPE_CATMULL_ROM} from '../../geometry/curvesEval'
import {fillCurveTypes} from '../../geometry/curvesEdit'
import {DATA_TYPES, DataType, TypedArray} from '../../geometry/dataTypes'
import {GeometrySet} from '../../geometry/GeometrySet'
import {createDefaultMixer, mix2} from '../../geometry/mixers'
import {mixIndicesWeighted} from '../../geometry/mixIndices'
import {sampleAtLength} from '../../geometry/resampleCurves'
import {registerNodeType} from '../../runtime/registry'
import type {MeshData} from '@threepipe/mesh-kernel'
import type {PointCloud} from '../../geometry/components'
import type {AttributeAccessor} from '../../geometry/attributeAccessor'

const FLT_EPSILON = f32(1.1920928955078125e-7)

/** `normalize_v3` (`math_vector_inline.cc:872`): multiplies by `1 / length`; returns the length. */
function normalizeV3(a: V3): {v: V3, len: number} {
    let d = dot3(a, a)
    if (d > f32(1.0e-35)) {
        d = f32(Math.sqrt(d))
        const m = f32(1 / d)
        return {v: [f32(a[0] * m), f32(a[1] * m), f32(a[2] * m)], len: d}
    }
    return {v: [0, 0, 0], len: 0}
}

/** `ortho_v3_v3` (`math_vector.cc:593`) with `axis_dominant_v3_single` (`math_geom_inline.cc:86`). */
function orthoV3V3(v: V3): V3 {
    const x = Math.abs(v[0]), y = Math.abs(v[1]), z = Math.abs(v[2])
    const axis = x > y ? (x > z ? 0 : 2) : (y > z ? 1 : 2)
    if (axis === 0) return [f32(-v[1] - v[2]), v[0], v[0]]
    if (axis === 1) return [v[1], f32(-v[0] - v[2]), v[1]]
    return [v[2], v[2], f32(-v[0] - v[1])]
}

/** `rotation_between_vecs_to_mat3` (`math_rotation_c.cc:493`): a C `float m[3][3]` (row `i` = column `i` of `float3x3`). */
function rotationBetweenVecsToMat3(v1: V3, v2: V3): Float32Array {
    let {v: axis, len: angleSin} = normalizeV3(cross3(v1, v2))
    let angleCos = dot3(v1, v2)
    if (angleSin > FLT_EPSILON) return axisAngleNormalizedToMat3Ex(axis, angleSin, angleCos)
    if (angleCos > 0) {
        const m = new Float32Array(9)
        m[0] = m[4] = m[8] = 1
        return m
    }
    axis = normalizeV3(orthoV3V3(v1)).v
    angleSin = 0
    angleCos = -1
    return axisAngleNormalizedToMat3Ex(axis, angleSin, angleCos)
}

/** `float3x3 * float3` (`BLI_math_matrix_types.hh`): `result += b[c] * a[c]` over the columns. */
function mulMat3Vec(m: Float32Array, b: V3): V3 {
    const r: V3 = [0, 0, 0]
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) r[k] = f32(r[k] + f32(b[c] * m[c * 3 + k]))
    return r
}

/** `length_parameterize::sample_at_lengths` (`length_parameterize.cc:73`): a new hint per 512 samples. */
function sampleAtLengths(lengths: ArrayLike<number>, sampleLengths: number[], segments: Int32Array, factors: Float32Array): void {
    let hint = {segmentIndex: -1, segmentStart: 0, segmentLengthInv: 0}
    for (let i = 0; i < sampleLengths.length; i++) {
        if (i % 512 === 0) hint = {segmentIndex: -1, segmentStart: 0, segmentLengthInv: 0}
        sampleAtLength(lengths, sampleLengths[i], segments, factors, i, hint)
    }
}

interface Neighbors {
    indices: Int32Array
    weights: Float32Array
    counts: Int32Array
    max: number
}

/** `find_neighbor_guides` (:134). */
function findNeighborGuides(positions: Float32Array, pointGroupIds: ArrayLike<number>, kdtrees: Map<number, KDTree3>, guidesByGroup: Map<number, number[]>,
    maxNeighborCount: number): Neighbors {
    const n = positions.length / 3
    const nb: Neighbors = {indices: new Int32Array(n * maxNeighborCount), weights: new Float32Array(n * maxNeighborCount), counts: new Int32Array(n), max: maxNeighborCount}
    for (let child = 0; child < n; child++) {
        const group = pointGroupIds[child]
        const kdtree = kdtrees.get(group)
        if (!kdtree) {
            nb.counts[child] = 0
            continue
        }
        const numGuides = guidesByGroup.get(group)!.length
        const useExtra = numGuides > maxNeighborCount
        const toFind = maxNeighborCount + (useExtra ? 1 : 0)
        const nearest = kdtree.findNearestN(positions[child * 3], positions[child * 3 + 1], positions[child * 3 + 2], toFind)
        if (nearest.length === 0) {
            nb.counts[child] = 0
            continue
        }
        const base = child * maxNeighborCount
        let totWeight = 0
        if (useExtra) {
            // `std::max_element` by distance: the first largest.
            let maxDistance = nearest[0].dist
            for (const r of nearest) if (maxDistance < r.dist) maxDistance = r.dist
            if (maxDistance === 0) {
                nb.counts[child] = 1
                nb.indices[base] = nearest[0].index
                nb.weights[base] = 1
                continue
            }
            let counter = 0
            for (const r of nearest) {
                const weight = f32(f32(maxDistance - r.dist) / Math.max(r.dist, f32(0.000001)))
                if (weight > 0) {
                    totWeight = f32(totWeight + weight)
                    nb.indices[base + counter] = r.index
                    nb.weights[base + counter] = weight
                    counter++
                }
            }
            nb.counts[child] = counter
        } else {
            let counter = 0
            for (const r of nearest) {
                const weight = f32(1 / Math.max(r.dist, f32(0.000001)))
                if (weight > 0) {
                    totWeight = f32(totWeight + weight)
                    nb.indices[base + counter] = r.index
                    nb.weights[base + counter] = weight
                    counter++
                }
            }
            nb.counts[child] = counter
        }
        if (totWeight > 0) {
            const factor = f32(1 / totWeight)
            for (let i = 0; i < nb.counts[child]; i++) nb.weights[base + i] = f32(nb.weights[base + i] * factor)
        }
    }
    return nb
}

/** The point source of the node: the point cloud, else the mesh (`node_geo_exec`, :807). */
type PointSource = ({type: 'pointcloud', data: PointCloud} | {type: 'mesh', data: MeshData}) & {accessor: AttributeAccessor}

/** `generate_interpolated_curves` (:686). */
function generateInterpolatedCurves(guides: CurvesGeometry, source: PointSource, guidesUp: GField, pointsUp: GField, guideGroup: GField, pointGroup: GField,
    maxNeighbors: number, indexId: string | undefined, weightId: string | undefined): CurvesGeometry {
    const ce = new FieldEvaluation(new FieldContext('curves', guides, AttrDomain.Curve), guides.curvesNum)
    const guidesUpV = ce.evaluate(guidesUp)
    const guideGroupIds = ce.evaluate(guideGroup).materialize()
    const pointsNum = source.type === 'pointcloud' ? source.data.pointsNum : source.data.vertsNum
    const pe = new FieldEvaluation(new FieldContext(source.type, source.data, AttrDomain.Point), pointsNum)
    const pointsUpV = pe.evaluate(pointsUp)
    const pointGroupIds = pe.evaluate(pointGroup).materialize()

    // `separate_guides_by_group` (:65), `compute_points_per_curve_by_group` (:79).
    const guidesByGroup = new Map<number, number[]>()
    for (let c = 0; c < guides.curvesNum; c++) {
        const g = guideGroupIds[c]
        let list = guidesByGroup.get(g)
        if (!list) guidesByGroup.set(g, list = [])
        list.push(c)
    }
    const size = (c: number) => guides.curveOffsets[c + 1] - guides.curveOffsets[c]
    const pointsPerCurveByGroup = new Map<number, number>()
    for (const [group, list] of guidesByGroup) {
        let n = size(list[0])
        for (const c of list.slice(1)) {
            if (size(c) !== n) {
                n = -1
                break
            }
        }
        if (n !== -1) pointsPerCurveByGroup.set(group, n)
    }
    // `build_kdtrees_for_root_positions` (:103).
    const gpos = guides.positions
    const kdtrees = new Map<number, KDTree3>()
    for (const [group, list] of guidesByGroup) {
        const tree = new KDTree3(list.length)
        for (const c of list) {
            const first = guides.curveOffsets[c]
            tree.insert(c, gpos[first * 3], gpos[first * 3 + 1], gpos[first * 3 + 2])
        }
        tree.balance()
        kdtrees.set(group, tree)
    }
    const pointPositions = source.data.positions
    const nb = findNeighborGuides(pointPositions, pointGroupIds, kdtrees, guidesByGroup, maxNeighbors)

    // `compute_point_counts_per_child` (:239).
    const numChild = pointsNum
    const pointsPerChild = new Int32Array(numChild)
    const direct = new Uint8Array(numChild)
    for (let child = 0; child < numChild; child++) {
        const count = nb.counts[child]
        if (count === 0) {
            pointsPerChild[child] = 1
            continue
        }
        const perGroup = pointsPerCurveByGroup.get(pointGroupIds[child]) ?? -1
        if (perGroup !== -1) {
            pointsPerChild[child] = perGroup
            direct[child] = 1
            continue
        }
        let sum = 0
        for (let i = 0; i < count; i++) sum = f32(sum + f32(nb.weights[child * maxNeighbors + i] * size(nb.indices[child * maxNeighbors + i])))
        // `std::max<int>(1, roundf(sum))`.
        pointsPerChild[child] = Math.max(1, Math.sign(sum) * Math.round(Math.abs(sum)))
    }
    const childOffsets = new Int32Array(numChild + 1)
    for (let c = 0; c < numChild; c++) childOffsets[c + 1] = childOffsets[c] + pointsPerChild[c]
    const child = new CurvesGeometry(childOffsets[numChild], numChild)
    child.curveOffsets.set(childOffsets)

    // `parameterize_guide_curves` (:286): accumulated segment lengths of the open guides.
    const paramOffsets = new Int32Array(guides.curvesNum + 1)
    for (let c = 0; c < guides.curvesNum; c++) paramOffsets[c + 1] = paramOffsets[c] + Math.max(0, size(c) - 1)
    const paramLengths = new Float32Array(paramOffsets[guides.curvesNum])
    for (let c = 0; c < guides.curvesNum; c++) {
        const [s, e] = guides.pointsRange(c)
        accumulateLengths(gpos.subarray(s * 3, e * 3), false, paramLengths, paramOffsets[c])
    }
    /** Sample segments/factors of a guide for `n` child points (:413-423); undefined for a single-point guide. */
    const sampling = (guide: number, n: number) => {
        const ls = paramLengths.subarray(paramOffsets[guide], paramOffsets[guide + 1])
        if (ls.length === 0) return undefined
        const factor = n - 1 === 0 ? 0 : f32(ls[ls.length - 1] / (n - 1))
        const sampleLengths = Array.from({length: n}, (_, i) => f32(i * factor))
        const segments = new Int32Array(n), factors = new Float32Array(n)
        sampleAtLengths(ls, sampleLengths, segments, factors)
        return {segments, factors}
    }

    // `interpolate_curve_shapes` (:318).
    const cpos = child.positions
    for (let c = 0; c < numChild; c++) {
        const [s, e] = child.pointsRange(c)
        const count = nb.counts[c]
        const childUp: V3 = [pointsUpV.get(c, 0), pointsUpV.get(c, 1), pointsUpV.get(c, 2)]
        const root: V3 = [pointPositions[c * 3], pointPositions[c * 3 + 1], pointPositions[c * 3 + 2]]
        for (let i = s; i < e; i++) cpos.set(root, i * 3)
        if (count === 0) continue
        for (let ni = 0; ni < count; ni++) {
            const guide = nb.indices[c * maxNeighbors + ni]
            const weight = nb.weights[c * maxNeighbors + ni]
            const gs = guides.curveOffsets[guide]
            const gp = (i: number): V3 => [gpos[(gs + i) * 3], gpos[(gs + i) * 3 + 1], gpos[(gs + i) * 3 + 2]]
            const gRoot = gp(0)
            const guideUp: V3 = [guidesUpV.get(guide, 0), guidesUpV.get(guide, 1), guidesUpV.get(guide, 2)]
            const same = guideUp[0] === childUp[0] && guideUp[1] === childUp[1] && guideUp[2] === childUp[2]
            const rot = same ? undefined : rotationBetweenVecsToMat3(guideUp, childUp)
            const addTo = (i: number, rel: V3) => {
                const r = rot ? mulMat3Vec(rot, rel) : rel
                for (let k = 0; k < 3; k++) cpos[i * 3 + k] = f32(cpos[i * 3 + k] + f32(weight * r[k]))
            }
            if (direct[c]) {
                for (let i = 0; i < e - s; i++) {
                    const pos = gp(i)
                    addTo(s + i, [f32(pos[0] - gRoot[0]), f32(pos[1] - gRoot[1]), f32(pos[2] - gRoot[2])])
                }
                continue
            }
            const smp = sampling(guide, e - s)
            if (!smp) {
                const r = rot ? mulMat3Vec(rot, gRoot) : gRoot
                const global: V3 = [f32(r[0] * weight), f32(r[1] * weight), f32(r[2] * weight)]
                for (let i = s; i < e; i++) for (let k = 0; k < 3; k++) cpos[i * 3 + k] = f32(cpos[i * 3 + k] + global[k])
                continue
            }
            for (let i = 0; i < e - s; i++) {
                const sample = interpolate3(gp(smp.segments[i]), gp(smp.segments[i] + 1), smp.factors[i])
                addTo(s + i, [f32(sample[0] - gRoot[0]), f32(sample[1] - gRoot[1]), f32(sample[2] - gRoot[2])])
            }
        }
    }
    fillCurveTypes(child, CURVE_TYPE_CATMULL_ROM)

    // `interpolate_curve_attributes` (:449).
    const acc = child.accessor()
    const guideAcc = guides.accessor()
    const ALLOWED_BUILTINS = new Set(['radius', 'tilt', 'resolution', 'cyclic'])
    for (const layer of guides.attributes.layers()) {
        if (guideAcc.isBuiltin(layer.name) && !ALLOWED_BUILTINS.has(layer.name)) continue
        const type = layer.type as DataType
        const cc = DATA_TYPES[type].components
        const src = layer.data as TypedArray
        if (layer.domain === AttrDomain.Curve) {
            if (!child.attributes.get(layer.name) && !acc.add(layer.name, AttrDomain.Curve, type)) continue
            const dstLayer = child.attributes.get(layer.name)!
            if (dstLayer.domain !== AttrDomain.Curve || dstLayer.type !== type) continue
            for (let c = 0; c < numChild; c++) {
                const count = nb.counts[c]
                mixIndicesWeighted(type, src, nb.indices.subarray(c * maxNeighbors, c * maxNeighbors + count), nb.weights.subarray(c * maxNeighbors, c * maxNeighbors + count),
                    dstLayer.data as TypedArray, c)
            }
            continue
        }
        if (!child.attributes.get(layer.name) && !acc.add(layer.name, AttrDomain.Point, type)) continue
        const dstLayer = child.attributes.get(layer.name)!
        if (dstLayer.domain !== AttrDomain.Point || dstLayer.type !== type) continue
        const mixer = createDefaultMixer(type, dstLayer.data as TypedArray)
        const value = new DATA_TYPES[type].array(cc)
        for (let c = 0; c < numChild; c++) {
            const [s, e] = child.pointsRange(c)
            const count = nb.counts[c]
            for (let ni = 0; ni < count; ni++) {
                const guide = nb.indices[c * maxNeighbors + ni]
                const weight = nb.weights[c * maxNeighbors + ni]
                const gs = guides.curveOffsets[guide]
                if (direct[c]) {
                    for (let i = 0; i < e - s; i++) mixer.mixIn(s + i, src, gs + i, weight)
                    continue
                }
                const smp = sampling(guide, e - s)
                if (!smp) {
                    for (let i = s; i < e; i++) mixer.mixIn(i, src, gs, weight)
                    continue
                }
                for (let i = 0; i < e - s; i++) {
                    // `math::interpolate` of the two guide values (= `attribute_math::mix2`).
                    mix2(type, smp.factors[i], src, gs + smp.segments[i], src, gs + smp.segments[i] + 1, value, 0)
                    mixer.mixIn(s + i, value, 0, weight)
                }
            }
        }
        mixer.finalize()
    }
    // Attributes of the points become curve attributes (:602).
    const pointAcc = source.accessor
    for (const layer of source.data.attributes.layers()) {
        if (pointAcc.isBuiltin(layer.name) && !acc.isBuiltin(layer.name)) continue
        if (guides.attributes.get(layer.name)) continue
        if (layer.domain !== AttrDomain.Point) throw new Error(`Interpolate Curves: point source attribute '${layer.name}' on another domain is not ported`)
        acc.add(layer.name, AttrDomain.Curve, layer.type as DataType, (layer.data as TypedArray).slice())
    }
    // `store_output_attributes` (:629).
    if (weightId || indexId) {
        if (weightId && !child.attributes.get(weightId)) acc.add(weightId, AttrDomain.Curve, 'float')
        if (indexId && !child.attributes.get(indexId)) acc.add(indexId, AttrDomain.Curve, 'int32')
        const w = weightId ? child.attributes.get(weightId)!.data : undefined
        const idx = indexId ? child.attributes.get(indexId)!.data : undefined
        for (let c = 0; c < numChild; c++) {
            const count = nb.counts[c]
            let closestIndex = 0, closestWeight = 0
            if (count) {
                let maxI = 0
                for (let i = 1; i < count; i++) if (nb.weights[c * maxNeighbors + maxI] < nb.weights[c * maxNeighbors + i]) maxI = i
                closestIndex = nb.indices[c * maxNeighbors + maxI]
                closestWeight = nb.weights[c * maxNeighbors + maxI]
            }
            if (idx) idx[c] = closestIndex
            if (w) w[c] = closestWeight
        }
    }
    child.materials = guides.materials.slice()
    return child
}

registerNodeType({
    idname: 'GeometryNodeInterpolateCurves',
    label: 'Interpolate Curves',
    declare(b) {
        b.input('GEOMETRY', 'Guide Curves')
        b.input('VECTOR', 'Guide Up').hideValue().field()
        b.input('INT', 'Guide Group ID').hideValue().field()
        b.input('GEOMETRY', 'Points')
        b.input('VECTOR', 'Point Up').hideValue().field()
        b.input('INT', 'Point Group ID').hideValue().field()
        b.input('INT', 'Max Neighbors').default(4).min(1)
        b.output('GEOMETRY', 'Curves')
        b.output('INT', 'Closest Index').field()
        b.output('FLOAT', 'Closest Weight').field()
    },
    // `node_geo_exec` (:796).
    execute(p) {
        const guidesGeometry = p.geometry('Guide Curves')
        const pointsGeometry: GeometrySet = p.geometry('Points')
        const guides = guidesGeometry.curves
        if (!guides || guides.curvesNum === 0) return
        const source: PointSource | undefined = pointsGeometry.pointCloud ? {type: 'pointcloud', data: pointsGeometry.pointCloud, accessor: pointsGeometry.attributes('pointcloud')!}
            : pointsGeometry.mesh ? {type: 'mesh', data: pointsGeometry.mesh, accessor: pointsGeometry.attributes('mesh')!} : undefined
        if (!source || pointsGeometry.isEmpty) return
        const maxNeighbors = Math.max(1, p.int('Max Neighbors'))
        const normalize = lookupMultiFunction('normalize(float3)')
        const guidesUp = new FieldOperation(normalize, [p.field('Guide Up')]).output(0)
        const pointsUp = new FieldOperation(normalize, [p.field('Point Up')]).output(0)
        const indexId = p.outputUsed('Closest Index') ? p.anonymousName('Closest Index') : undefined
        const weightId = p.outputUsed('Closest Weight') ? p.anonymousName('Closest Weight') : undefined
        const curves = generateInterpolatedCurves(guides, source, guidesUp, pointsUp, p.field('Guide Group ID'), p.field('Point Group ID'), maxNeighbors, indexId, weightId)
        const out = GeometrySet.fromCurves(curves)
        out.name = guidesGeometry.name
        p.set('Curves', out)
        if (indexId) p.set('Closest Index', GField.fromInput(new AttributeFieldInput(indexId, 'int32')))
        if (weightId) p.set('Closest Weight', GField.fromInput(new AttributeFieldInput(weightId, 'float')))
    },
})
