/**
 * Mesh / curve conversion nodes: Mesh to Curve (`node_geo_mesh_to_curve.cc`), Curve to Mesh (`node_geo_curve_to_mesh.cc`)
 * and Curve to Points (`node_geo_curve_to_points.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation} from '../../fields'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {curveToMeshSweep, curveToWireMesh} from '../../geometry/curveToMesh'
import {meshEdgesToCurvesConvert, meshFacesToCurvesConvert} from '../../geometry/meshToCurve'
import {registerNodeType} from '../../runtime/registry'
import {AttributeFieldInput, GField} from '../../fields'
import {CurvesGeometry, PointCloud} from '../../geometry/components'
import {CURVE_TYPE_POLY, CurvesEvaluator} from '../../geometry/curvesEval'
import {DATA_TYPES, DataType, TypedArray} from '../../geometry/dataTypes'
import {countFromLength, resampleToEvaluated, resampleToUniform, ResampleOutputIds} from '../../geometry/resampleCurves'
import {GVArray} from '../../geometry/varray'
import {cross3, normalize3} from '../../blender/math/vec'
import {mat3ToQuat} from '../../blender/math/matrix'

/** `geometry_set.keep_only({Edit})`: the real components go. */
function clearReal(g: GeometrySet): void {
    for (const t of ['mesh', 'pointcloud', 'curves', 'instances'] as const) g.remove(t)
}

registerNodeType({
    idname: 'GeometryNodeMeshToCurve',
    label: 'Mesh to Curve',
    properties: {mode: 'EDGES'},
    enums: {mode: ['EDGES', 'FACES']},
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.output('GEOMETRY', 'Curve')
    },
    // `node_geo_exec` (:43).
    execute(p) {
        const faces = p.node.prop<string>('mode') === 'FACES'
        const selection = p.field('Selection')
        p.set('Curve', foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.mesh
            if (!mesh) return clearReal(g)
            const domain = faces ? AttrDomain.Face : AttrDomain.Edge
            const size = faces ? mesh.facesNum : mesh.edgesNum
            const sel = new FieldEvaluation(new FieldContext('mesh', mesh, domain), size).evaluate(selection)
            const indices: number[] = []
            for (let i = 0; i < size; i++) if (sel.get(i, 0)) indices.push(i)
            if (indices.length === 0) return clearReal(g)
            const src = g.attributes('mesh')!
            const curves = faces ? meshFacesToCurvesConvert(mesh, src, indices, () => false) : meshEdgesToCurvesConvert(mesh, src, indices, () => false)
            // `replace_curves`, then `keep_only({Curve, Edit})`.
            clearReal(g)
            g.setCurves(curves)
        }, p.options.scene))
    },
})

registerNodeType({
    idname: 'GeometryNodeCurveToMesh',
    label: 'Curve to Mesh',
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.input('GEOMETRY', 'Profile Curve')
        b.input('FLOAT', 'Scale').default(1).min(0).field()
        b.input('BOOLEAN', 'Fill Caps').default(false)
        b.output('GEOMETRY', 'Mesh')
    },
    // `node_geo_exec` (:130).
    execute(p) {
        const profileSet = p.geometry('Profile Curve')
        const scale = p.field('Scale')
        const fillCaps = p.bool('Fill Caps')
        p.set('Mesh', foreachRealGeometry(p.geometry('Curve'), g => {
            const curves = g.curves
            if (curves) {
                // `curve_to_mesh` (:43): the sweep with a profile, else the wire mesh.
                const profile = profileSet.curves
                let mesh
                if (profile) {
                    const scales = new FieldEvaluation(new FieldContext('curves', curves, AttrDomain.Point), curves.pointsNum).evaluate(scale)
                    mesh = curveToMeshSweep(curves, profile, scales, fillCaps)
                } else {
                    mesh = curveToWireMesh(curves)
                }
                // `mesh->mat = MEM_dupalloc(curves.mat)`.
                if (mesh) mesh.materials = curves.materials.slice()
                g.setMesh(mesh)
            }
            // `keep_only({Mesh, Instance, Edit})`.
            g.remove('pointcloud')
            g.remove('curves')
        }, p.options.scene))
    },
})

// region Curve to Points (`node_geo_curve_to_points.cc`)

/** `fill_rotation_attribute` (:67): the rotation of the frame (normal, binormal, tangent). */
function fillRotationAttribute(tangents: ArrayLike<number>, normals: ArrayLike<number>, rotations: TypedArray): void {
    for (let i = 0; i < rotations.length / 4; i++) {
        const t = [tangents[i * 3], tangents[i * 3 + 1], tangents[i * 3 + 2]]
        const binormal = normalize3(cross3(t, [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]))
        const normal = cross3(binormal, t)
        rotations.set(mat3ToQuat([...normal, ...binormal, ...t]), i * 4)
    }
}

/** `curves_to_points` (:100). */
function curvesToPoints(curves: CurvesGeometry, ids: ResampleOutputIds, rotationId: string | undefined): PointCloud {
    const pc = new PointCloud(curves.pointsNum)
    const acc = pc.accessor()
    const curvesAcc = curves.accessor()
    const process = (name: string) => name === ids.tangent || name === ids.normal || name === rotationId
    // `bke::copy_attributes(curves, Point, Point, filter, ...)`: built-ins of curves that are not built-ins of point clouds are skipped.
    for (const layer of curves.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point) continue
        if (!process(layer.name) && curvesAcc.isBuiltin(layer.name) && !acc.isBuiltin(layer.name)) continue
        const existing = pc.attributes.get(layer.name)
        if (existing) existing.data.set(layer.data)
        else acc.add(layer.name, AttrDomain.Point, layer.type as DataType, layer.data.slice() as TypedArray)
    }
    // `copy_curve_domain_attributes` (:81): non-built-in curve attributes adapted to the points.
    for (const layer of curves.attributes.layers()) {
        if (layer.domain !== AttrDomain.Curve || curvesAcc.isBuiltin(layer.name)) continue
        const type = layer.type as DataType
        const values = curvesAcc.adaptDomain(GVArray.fromArray(type, layer.data as TypedArray), AttrDomain.Curve, AttrDomain.Point)
        acc.add(layer.name, AttrDomain.Point, type, values ? values.materialize() as TypedArray : new DATA_TYPES[type].array(0))
    }
    if (rotationId && curves.pointsNum) {
        const tangents = curves.attributes.get(ids.tangent!)!.data
        const normals = curves.attributes.get(ids.normal!)!.data
        if (!pc.attributes.get(rotationId)) acc.add(rotationId, AttrDomain.Point, 'quaternion')
        fillRotationAttribute(tangents, normals, pc.attributes.get(rotationId)!.data as TypedArray)
    } else if (rotationId && !pc.attributes.get(rotationId)) {
        acc.add(rotationId, AttrDomain.Point, 'quaternion')
    }
    return pc
}

registerNodeType({
    idname: 'GeometryNodeCurveToPoints',
    label: 'Curve to Points',
    // `node_init` (:62): COUNT.
    properties: {mode: 'COUNT'},
    enums: {mode: ['EVALUATED', 'COUNT', 'LENGTH']},
    declare(b, node) {
        const mode = node.prop<string>('mode')
        b.input('GEOMETRY', 'Curve')
        b.input('INT', 'Count').default(10).min(2).max(100000).field().available(mode === 'COUNT')
        b.input('FLOAT', 'Length').default(0.1).min(0.001).subtype('DISTANCE').field().available(mode === 'LENGTH')
        b.output('GEOMETRY', 'Points')
        b.output('VECTOR', 'Tangent').field()
        b.output('VECTOR', 'Normal').field()
        b.output('ROTATION', 'Rotation').field()
    },
    // `node_geo_exec` (:181).
    execute(p) {
        const mode = p.node.prop<string>('mode')
        const rotationId = p.outputUsed('Rotation') ? p.anonymousName('Rotation') : undefined
        const need = !!rotationId
        const ids: ResampleOutputIds = {
            tangent: need || p.outputUsed('Tangent') ? p.anonymousName('Tangent') : undefined,
            normal: need || p.outputUsed('Normal') ? p.anonymousName('Normal') : undefined,
        }
        const countField = mode === 'COUNT' ? p.field('Count') : undefined
        const lengthField = mode === 'LENGTH' ? p.field('Length') : undefined
        const out = foreachRealGeometry(p.geometry('Curve'), g => {
            const src = g.curves
            if (src) {
                let dst: CurvesGeometry
                if (src.curvesNum === 0) {
                    dst = new CurvesGeometry(0, 0)
                } else {
                    const e = new FieldEvaluation(new FieldContext('curves', src, AttrDomain.Curve), src.curvesNum)
                    const all = new Uint8Array(src.curvesNum).fill(1)
                    if (mode === 'EVALUATED') {
                        dst = resampleToEvaluated(src, all, ids)
                    } else {
                        const counts = new Int32Array(src.curvesNum)
                        if (countField) {
                            const c = e.evaluate(countField)
                            for (let i = 0; i < src.curvesNum; i++) counts[i] = Math.max(1, c.get(i, 0))
                        } else {
                            const l = e.evaluate(lengthField!)
                            const ev = new CurvesEvaluator(src)
                            for (let i = 0; i < src.curvesNum; i++) counts[i] = countFromLength(ev.lengthTotal(i), l.get(i, 0), false)
                        }
                        dst = resampleToUniform(src, all, counts, ids)
                    }
                }
                g.setPointCloud(curvesToPoints(dst, ids, rotationId))
            }
            // `keep_only({PointCloud, Instance, Edit})`.
            g.remove('mesh')
            g.remove('curves')
        }, p.options.scene)
        p.set('Points', out)
        if (ids.tangent && p.outputUsed('Tangent')) p.set('Tangent', GField.fromInput(new AttributeFieldInput(ids.tangent, 'float3')))
        if (ids.normal && p.outputUsed('Normal')) p.set('Normal', GField.fromInput(new AttributeFieldInput(ids.normal, 'float3')))
        if (rotationId) p.set('Rotation', GField.fromInput(new AttributeFieldInput(rotationId, 'quaternion')))
    },
})

// endregion

// region Points to Curves (`node_geo_points_to_curves.cc`)

/** `grouped_sort` (:31) of one group: by weight, ties by index. */
function sortByWeight(indices: number[], weights: ArrayLike<number>): void {
    indices.sort((a, b) => {
        const wa = weights[a], wb = weights[b]
        if (wa === wb) return a - b
        return wa < wb ? -1 : 1
    })
}

/** `bke::gather_attributes(points, Point, Point, filter, indices, curves)`. */
function gatherPointAttributes(pc: PointCloud, curves: CurvesGeometry, indices: ArrayLike<number> | undefined): void {
    const acc = curves.accessor()
    for (const layer of pc.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point) continue
        const type = layer.type as DataType
        const c = DATA_TYPES[type].components
        const existing = curves.attributes.get(layer.name)
        if (existing && (existing.type !== type || existing.domain !== AttrDomain.Point)) continue
        if (!existing && !acc.add(layer.name, AttrDomain.Point, type)) continue
        const dst = curves.attributes.get(layer.name)!.data
        if (!indices) dst.set(layer.data)
        else for (let i = 0; i < indices.length; i++) for (let k = 0; k < c; k++) dst[i * c + k] = layer.data[indices[i] * c + k]
    }
}

/** `curve_from_points` (:73): one poly curve, sorted by weight unless the weight is single. */
function curveFromPoints(pc: PointCloud, weights: GVArray): CurvesGeometry {
    const n = weights.size
    const curves = curvesNewSinglePoly(n)
    if (weights.isSingle) {
        gatherPointAttributes(pc, curves, undefined)
        return curves
    }
    const indices = Array.from({length: n}, (_, i) => i)
    sortByWeight(indices, weights.materialize())
    gatherPointAttributes(pc, curves, indices)
    return curves
}

function curvesNewSinglePoly(n: number): CurvesGeometry {
    const curves = new CurvesGeometry(n, 1)
    curves.curveOffsets[1] = n
    curves.accessor().add('curve_type', AttrDomain.Curve, 'int8', [CURVE_TYPE_POLY])
    return curves
}

/** `curves_from_points` (:99). */
function curvesFromPoints(pc: PointCloud, groupIdField: GField, weightField: GField): CurvesGeometry | undefined {
    const n = pc.pointsNum
    if (n === 0) return undefined
    const e = new FieldEvaluation(new FieldContext('pointcloud', pc, AttrDomain.Point), n)
    const groupIds = e.evaluate(groupIdField)
    const weights = e.evaluate(weightField)
    if (groupIds.isSingle) return curveFromPoints(pc, weights)
    // `identifiers_to_indices` (:62): `VectorSet` order of first appearance.
    const ids = groupIds.materialize()
    const seen = new Map<number, number>()
    const groups = new Int32Array(n)
    for (let i = 0; i < n; i++) {
        let g = seen.get(ids[i])
        if (g === undefined) seen.set(ids[i], g = seen.size)
        groups[i] = g
    }
    const total = seen.size
    if (total === 1) return curveFromPoints(pc, weights)
    const curves = new CurvesGeometry(n, total)
    curves.accessor().add('curve_type', AttrDomain.Curve, 'int8', [CURVE_TYPE_POLY])
    // `build_reverse_offsets` + `reverse_indices_in_groups`: each group's points in index order.
    const members: number[][] = Array.from({length: total}, () => [])
    for (let i = 0; i < n; i++) members[groups[i]].push(i)
    if (!weights.isSingle) {
        const w = weights.materialize()
        for (const m of members) sortByWeight(m, w)
    }
    let offset = 0
    members.forEach((m, g) => {
        curves.curveOffsets[g] = offset
        offset += m.length
    })
    curves.curveOffsets[total] = offset
    gatherPointAttributes(pc, curves, members.flat())
    return curves
}

registerNodeType({
    idname: 'GeometryNodePointsToCurves',
    label: 'Points to Curves',
    declare(b) {
        b.input('GEOMETRY', 'Points')
        b.input('INT', 'Curve Group ID').hideValue().field()
        b.input('FLOAT', 'Weight').hideValue().field()
        b.output('GEOMETRY', 'Curves')
    },
    // `node_geo_exec` (:156).
    execute(p) {
        const groupId = p.field('Curve Group ID'), weight = p.field('Weight')
        p.set('Curves', foreachRealGeometry(p.geometry('Points'), g => {
            g.remove('curves')
            const pc = g.pointCloud
            if (pc) {
                const curves = curvesFromPoints(pc, groupId, weight)
                if (curves) g.setCurves(curves)
            }
            // `keep_only({Curve, Edit})`.
            g.remove('mesh')
            g.remove('pointcloud')
            g.remove('instances')
        }, p.options.scene))
    },
})

// endregion
