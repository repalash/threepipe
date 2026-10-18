/**
 * Duplicate Elements (`node_geo_duplicate_elements.cc`): points of meshes / point clouds / curves (:1003), edges
 * (:671), faces (:449), curves (:338) and instances (:1137). Grease pencil layers have no component here and throw.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {hash2} from '../../blender/noise'
import {elementwise, FieldContext, FieldEvaluation, FieldOperation, GField} from '../../fields'
import {AttributeFieldInput} from '../../fields/inputs'
import {AttributeAccessor} from '../../geometry/attributeAccessor'
import {CurvesGeometry, Instances, PointCloud} from '../../geometry/components'
import {DATA_TYPES} from '../../geometry/dataTypes'
import {ComponentType, COMPONENT_ORDER, GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {newMesh} from '../../geometry/meshPrimitives'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/** `max(int, int)` (`multi_function_common.cc:583`). */
const maxIntInt = elementwise('max(int, int)', ['int32', 'int32'], ['int32'], ([a, b], [o]) => { o[0] = a[0] > b[0] ? a[0] : b[0] })

/** Offsets of each selected element's duplicates (`accumulate_counts_to_offsets` :79). */
function countsToOffsets(selection: number[], counts: GVArray): Int32Array {
    const out = new Int32Array(selection.length + 1)
    if (counts.isSingle) {
        // `fill_constant_group_size(count, 0, offsets)`.
        for (let i = 0; i <= selection.length; i++) out[i] = counts.single[0] * i
    } else {
        selection.forEach((e, i) => { out[i + 1] = out[i] + counts.get(e) })
    }
    return out
}

function evaluate(type: ComponentType, component: object, domain: AttrDomain, size: number, selection: GField, count: GField): {selection: number[], counts: GVArray} {
    const e = new FieldEvaluation(new FieldContext(type, component as never, domain), size)
    const sel = e.evaluate(selection)
    const indices: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i)) indices.push(i)
    return {selection: indices, counts: e.evaluate(count)}
}

/**
 * `gather_attributes_to_groups` (`attribute_access.cc:820`) / `retrieve_attributes_for_transfer` (:643) +
 * `gather_to_groups`: every attribute of `domain` (minus `skip`), each selected element repeated over its group.
 */
function gatherToGroups(src: AttributeAccessor, dst: AttributeAccessor, domain: AttrDomain, skip: readonly string[], offsets: Int32Array, selection: number[]): void {
    for (const name of src.names()) {
        if (skip.includes(name)) continue
        const meta = src.lookupMeta(name)!
        if (meta.domain !== domain) continue
        const layer = src.storage.get(name)!
        if (!dst.contains(name) && !dst.add(name, domain, meta.type)) continue
        const out = dst.storage.get(name)!
        const c = DATA_TYPES[meta.type].components
        selection.forEach((e, i) => {
            for (let d = offsets[i]; d < offsets[i + 1]; d++) for (let k = 0; k < c; k++) out.data[d * c + k] = layer.data[e * c + k]
        })
    }
}

/** `bke::attribute_math::gather(src, map, dst)` for every attribute of `domain` into a new geometry. */
function gatherMapped(src: AttributeAccessor, dst: AttributeAccessor, domain: AttrDomain, skip: readonly string[], map: ArrayLike<number>): void {
    for (const name of src.names()) {
        if (skip.includes(name)) continue
        const meta = src.lookupMeta(name)!
        if (meta.domain !== domain) continue
        const layer = src.storage.get(name)!
        if (!dst.contains(name) && !dst.add(name, domain, meta.type)) continue
        const out = dst.storage.get(name)!
        const c = DATA_TYPES[meta.type].components
        for (let d = 0; d < map.length; d++) for (let k = 0; k < c; k++) out.data[d * c + k] = layer.data[map[d] * c + k]
    }
}

/** The `id` attribute as ints when it is on `domains` (`copy_stable_id_*`). */
function sourceIds(src: AttributeAccessor, domains: AttrDomain[]): Int32Array | undefined {
    const meta = src.lookupMeta('id')
    if (!meta || !domains.includes(meta.domain) || meta.type !== 'int32') return undefined
    return src.storage.get('id')!.data as Int32Array
}

function addIntAttribute(dst: AttributeAccessor, name: string, domain: AttrDomain): Int32Array {
    if (!dst.contains(name)) dst.add(name, domain, 'int32')
    return dst.storage.get(name)!.data as Int32Array
}

/** `create_duplicate_index_attribute` (:124). */
function createDuplicateIndex(dst: AttributeAccessor, domain: AttrDomain, name: string, offsets: Int32Array, selectionSize: number): void {
    const data = addIntAttribute(dst, name, domain)
    for (let i = 0; i < selectionSize; i++) for (let d = offsets[i]; d < offsets[i + 1]; d++) data[d] = d - offsets[i]
}

/**
 * `copy_stable_id_point` (:141) with `threaded_id_offset_copy` (:100). Blender reads `src[i]` with `i` the index in the
 * selection, not the selected element (the ids of partial selections come from the first elements); ported as is.
 */
function copyStableIdPoint(offsets: Int32Array, src: AttributeAccessor, dst: AttributeAccessor): void {
    const ids = sourceIds(src, [AttrDomain.Point, AttrDomain.Instance])
    if (!ids) return
    const out = addIntAttribute(dst, 'id', AttrDomain.Point)
    for (let i = 0; i < offsets.length - 1; i++) {
        if (offsets[i + 1] === offsets[i]) continue
        out[offsets[i]] = ids[i]
        for (let k = 1; k < offsets[i + 1] - offsets[i]; k++) out[offsets[i] + k] = hash2(ids[i], k)
    }
}

// region points

/** `duplicate_points_mesh` (:932). */
function duplicatePointsMesh(g: GeometrySet, count: GField, selectionField: GField, indexId: string | undefined): void {
    const mesh = g.mesh!
    const {selection, counts} = evaluate('mesh', mesh, AttrDomain.Point, mesh.vertsNum, selectionField, count)
    const offsets = countsToOffsets(selection, counts)
    const out = newMesh(offsets[selection.length], 0, 0, 0)
    const src = g.attributes('mesh')!
    const dstAcc = GeometrySet.fromMesh(out).attributes('mesh')!
    gatherToGroups(src, dstAcc, AttrDomain.Point, ['id'], offsets, selection)
    copyStableIdPoint(offsets, src, dstAcc)
    if (indexId) createDuplicateIndex(dstAcc, AttrDomain.Point, indexId, offsets, selection.length)
    g.setMesh(out)
}

/** `duplicate_points_pointcloud` (:970). */
function duplicatePointsPointCloud(g: GeometrySet, count: GField, selectionField: GField, indexId: string | undefined): void {
    const pc = g.pointCloud!
    const {selection, counts} = evaluate('pointcloud', pc, AttrDomain.Point, pc.pointsNum, selectionField, count)
    const offsets = countsToOffsets(selection, counts)
    const out = new PointCloud(offsets[selection.length])
    const src = pc.accessor(), dstAcc = out.accessor()
    gatherToGroups(src, dstAcc, AttrDomain.Point, ['id'], offsets, selection)
    copyStableIdPoint(offsets, src, dstAcc)
    if (indexId) createDuplicateIndex(dstAcc, AttrDomain.Point, indexId, offsets, selection.length)
    g.setPointCloud(out)
}

/** `duplicate_points_CurvesGeometry` (:771) + `duplicate_points_curve` (:846): one single-point curve per duplicate. */
function duplicatePointsCurves(g: GeometrySet, count: GField, selectionField: GField, indexId: string | undefined): void {
    const src = g.curves!
    let out: CurvesGeometry
    // `CurvesGeometry::is_empty()` (`BKE_curves.hh:1013`): no curves.
    if (src.curvesNum === 0) {
        out = new CurvesGeometry(0, 0)
    } else {
        const {selection, counts} = evaluate('curves', src, AttrDomain.Point, src.pointsNum, selectionField, count)
        const offsets = countsToOffsets(selection, counts)
        const n = offsets[selection.length]
        out = new CurvesGeometry(n, n)
        for (let i = 0; i <= n; i++) out.curveOffsets[i] = i
        const sa = src.accessor(), da = out.accessor()
        gatherToGroups(sa, da, AttrDomain.Point, [], offsets, selection)
        // Curve attributes: the value of the point's curve (:810).
        const pointToCurve = new Int32Array(src.pointsNum)
        for (let c = 0; c < src.curvesNum; c++) pointToCurve.fill(c, src.curveOffsets[c], src.curveOffsets[c + 1])
        const map: number[] = []
        selection.forEach((e, i) => { for (let d = offsets[i]; d < offsets[i + 1]; d++) map.push(pointToCurve[e]) })
        gatherMapped(sa, da, AttrDomain.Curve, ['id'], map)
        copyStableIdPoint(offsets, sa, da)
        if (indexId) createDuplicateIndex(da, AttrDomain.Point, indexId, offsets, selection.length)
    }
    // `curves_copy_parameters` (`curves.cc:316`).
    out.materials = src.materials.slice()
    g.setCurves(out)
}

/**
 * `duplicate_points` (:1003): every real component, in component order (`gather_component_types(true, true)`: a
 * component is empty only without a data-block, `geometry_component_mesh.cc:89`).
 */
function duplicatePoints(g: GeometrySet, count: GField, selection: GField, indexId: string | undefined): void {
    const types = COMPONENT_ORDER.filter(t => t !== 'instances' && g.has(t))
    for (const t of types) {
        if (t === 'pointcloud') duplicatePointsPointCloud(g, count, selection, indexId)
        else if (t === 'mesh') duplicatePointsMesh(g, count, selection, indexId)
        else if (t === 'curves') duplicatePointsCurves(g, count, selection, indexId)
    }
    for (const t of COMPONENT_ORDER) if (!types.includes(t)) g.remove(t)
}

// endregion

// region edges and faces

/** `duplicate_edges` (:671). */
function duplicateEdges(g: GeometrySet, count: GField, selectionField: GField, indexId: string | undefined): void {
    if (!g.mesh) {
        clear(g)
        return
    }
    const mesh = g.mesh
    const edges = mesh.edgeVerts
    const {selection, counts} = evaluate('mesh', mesh, AttrDomain.Edge, mesh.edgesNum, selectionField, count)
    const offsets = countsToOffsets(selection, counts)
    const n = offsets[selection.length]
    const out = newMesh(n * 2, n, 0, 0)
    const ne = out.edgeVerts
    const vertOrig = new Int32Array(n * 2)
    selection.forEach((e, i) => {
        for (let d = offsets[i]; d < offsets[i + 1]; d++) {
            vertOrig[d * 2] = edges[e * 2]
            vertOrig[d * 2 + 1] = edges[e * 2 + 1]
            ne[d * 2] = d * 2
            ne[d * 2 + 1] = d * 2 + 1
        }
    })
    const src = g.attributes('mesh')!
    const dst = GeometrySet.fromMesh(out).attributes('mesh')!
    // `copy_edge_attributes_without_id` (:600).
    gatherToGroups(src, dst, AttrDomain.Edge, ['id', '.edge_verts'], offsets, selection)
    gatherMapped(src, dst, AttrDomain.Point, ['id'], vertOrig)
    // `copy_stable_id_edges` (:631).
    const ids = sourceIds(src, [AttrDomain.Point])
    if (ids) {
        const o = addIntAttribute(dst, 'id', AttrDomain.Point)
        selection.forEach((e, i) => {
            const start = offsets[i], size = offsets[i + 1] - start
            if (!size) return
            const a = edges[e * 2], b = edges[e * 2 + 1]
            o[start * 2] = ids[a]
            o[start * 2 + 1] = ids[b]
            for (let k = 1; k < size; k++) {
                o[(start + k) * 2] = hash2(ids[a], k)
                o[(start + k) * 2 + 1] = hash2(ids[b], k)
            }
        })
    }
    if (indexId) createDuplicateIndex(dst, AttrDomain.Edge, indexId, offsets, selection.length)
    g.setMesh(out)
}

/** `duplicate_faces` (:449). */
function duplicateFaces(g: GeometrySet, count: GField, selectionField: GField, indexId: string | undefined): void {
    if (!g.mesh) {
        clear(g)
        return
    }
    for (const t of ['pointcloud', 'curves', 'instances'] as ComponentType[]) g.remove(t)
    const mesh = g.mesh
    const fo = mesh.faceOffsets, cv = mesh.cornerVerts, ce = mesh.cornerEdges
    const {selection, counts} = evaluate('mesh', mesh, AttrDomain.Face, mesh.facesNum, selectionField, count)
    const offsets = new Int32Array(selection.length + 1)
    let totalFaces = 0, totalLoops = 0
    selection.forEach((f, i) => {
        const c = counts.get(f)
        offsets[i] = totalFaces
        totalFaces += c
        totalLoops += c * (fo[f + 1] - fo[f])
    })
    offsets[selection.length] = totalFaces
    const out = newMesh(totalLoops, totalLoops, totalFaces, totalLoops)
    const ne = out.edgeVerts, nfo = out.faceOffsets
    const vertMap = new Int32Array(totalLoops), edgeMap = new Int32Array(totalLoops), loopMap = new Int32Array(totalLoops)
    let faceIndex = 0, loop = 0
    selection.forEach((f, i) => {
        for (let d = offsets[i]; d < offsets[i + 1]; d++) {
            nfo[faceIndex] = loop
            for (let c = fo[f]; c < fo[f + 1]; c++) {
                loopMap[loop] = c
                vertMap[loop] = cv[c]
                edgeMap[loop] = ce[c]
                ne[loop * 2] = loop
                ne[loop * 2 + 1] = c !== fo[f + 1] - 1 ? loop + 1 : nfo[faceIndex]
                loop++
            }
            faceIndex++
        }
    })
    nfo[totalFaces] = totalLoops
    const ocv = out.cornerVerts, oce = out.cornerEdges
    for (let i = 0; i < totalLoops; i++) ocv[i] = oce[i] = i
    const src = g.attributes('mesh')!
    const dst = GeometrySet.fromMesh(out).attributes('mesh')!
    // `copy_face_attributes_without_id` (:383).
    const skip = ['id', '.corner_vert', '.corner_edge', '.edge_verts']
    gatherMapped(src, dst, AttrDomain.Point, skip, vertMap)
    gatherMapped(src, dst, AttrDomain.Edge, skip, edgeMap)
    gatherToGroups(src, dst, AttrDomain.Face, skip, offsets, selection)
    gatherMapped(src, dst, AttrDomain.Corner, skip, loopMap)
    // `copy_stable_id_faces` (:409): Blender takes the size of face `i_face` (the selection index, not the selected
    // face), ported as is; past the new vertices that would write out of bounds in C++ (undefined behaviour).
    const ids = sourceIds(src, [AttrDomain.Point])
    if (ids) {
        const o = addIntAttribute(dst, 'id', AttrDomain.Point)
        let li = 0
        for (let i = 0; i < selection.length; i++) {
            const size = offsets[i + 1] - offsets[i]
            if (!size) continue
            const sourceSize = fo[i + 1] - fo[i]
            for (let d = 0; d < size; d++) {
                for (let k = 0; k < sourceSize; k++) {
                    if (li >= totalLoops) throw new Error('Duplicate Elements: copy_stable_id_faces writes past the new vertices for this selection (undefined behaviour in Blender 5.2.2, node_geo_duplicate_elements.cc:436)')
                    o[li] = d === 0 ? ids[vertMap[li]] : hash2(ids[vertMap[li]], d)
                    li++
                }
            }
        }
    }
    if (indexId) createDuplicateIndex(dst, AttrDomain.Face, indexId, offsets, selection.length)
    g.setMesh(out)
}

// endregion

/** `duplicate_curves_CurveGeometry` (:257) + `duplicate_curves` (:338). */
function duplicateCurves(g: GeometrySet, count: GField, selectionField: GField, indexId: string | undefined): void {
    for (const t of ['mesh', 'pointcloud', 'instances'] as ComponentType[]) g.remove(t)
    const curves = g.curves
    if (!curves) return
    const {selection, counts} = evaluate('curves', curves, AttrDomain.Curve, curves.curvesNum, selectionField, count)
    const curveOffsets = new Int32Array(selection.length + 1)
    const pointOffsets = new Int32Array(selection.length + 1)
    let dc = 0, dp = 0
    selection.forEach((c, i) => {
        const n = counts.get(c)
        curveOffsets[i] = dc
        pointOffsets[i] = dp
        dc += n
        dp += n * (curves.curveOffsets[c + 1] - curves.curveOffsets[c])
    })
    let out: CurvesGeometry
    if (dp === 0) {
        out = new CurvesGeometry(0, 0)
    } else {
        curveOffsets[selection.length] = dc
        pointOffsets[selection.length] = dp
        out = new CurvesGeometry(dp, dc)
        selection.forEach((c, i) => {
            const size = curves.curveOffsets[c + 1] - curves.curveOffsets[c]
            for (let d = 0; d < curveOffsets[i + 1] - curveOffsets[i]; d++) out.curveOffsets[curveOffsets[i] + d] = pointOffsets[i] + size * d
        })
        out.curveOffsets[dc] = dp
        const sa = curves.accessor(), da = out.accessor()
        // `copy_curve_attributes_without_id` (:175).
        gatherToGroups(sa, da, AttrDomain.Curve, ['id'], curveOffsets, selection)
        const pointMap: number[] = []
        selection.forEach((c, i) => {
            for (let d = curveOffsets[i]; d < curveOffsets[i + 1]; d++) {
                for (let p = curves.curveOffsets[c]; p < curves.curveOffsets[c + 1]; p++) pointMap.push(p)
            }
        })
        gatherMapped(sa, da, AttrDomain.Point, ['id'], pointMap)
        // `copy_stable_id_curves` (:218).
        const ids = sourceIds(sa, [AttrDomain.Point])
        if (ids) {
            const o = addIntAttribute(da, 'id', AttrDomain.Point)
            selection.forEach((c, i) => {
                const start = curves.curveOffsets[c], size = curves.curveOffsets[c + 1] - start
                for (let d = curveOffsets[i]; d < curveOffsets[i + 1]; d++) {
                    const k = d - curveOffsets[i]
                    const dst = out.curveOffsets[d]
                    for (let p = 0; p < size; p++) o[dst + p] = k === 0 ? ids[start + p] : hash2(ids[start + p], k)
                }
            })
        }
        if (indexId) createDuplicateIndex(da, AttrDomain.Curve, indexId, curveOffsets, selection.length)
    }
    out.materials = curves.materials.slice()
    g.setCurves(out)
}

/** `duplicate_instances` (:1137). */
function duplicateInstances(g: GeometrySet, count: GField, selectionField: GField, indexId: string | undefined): GeometrySet {
    const src = g.instances
    if (!src || src.instancesNum < 1) return new GeometrySet()
    const {selection, counts} = evaluate('instances', src, AttrDomain.Instance, src.instancesNum, selectionField, count)
    const offsets = countsToOffsets(selection, counts)
    const n = offsets[selection.length]
    if (n === 0) return new GeometrySet()
    const dst = new Instances(n)
    const handles = dst.referenceHandles
    selection.forEach((e, i) => {
        if (offsets[i + 1] === offsets[i]) return
        const h = dst.addReference(src.references[src.referenceHandles[e]])
        handles.fill(h, offsets[i], offsets[i + 1])
    })
    const da = dst.accessor()
    gatherToGroups(src.accessor(), da, AttrDomain.Instance, ['id', '.reference_index'], offsets, selection)
    if (indexId) createDuplicateIndex(da, AttrDomain.Instance, indexId, offsets, selection.length)
    return GeometrySet.fromInstances(dst)
}

function clear(g: GeometrySet): void {
    for (const t of COMPONENT_ORDER) g.remove(t)
}

registerNodeType({
    idname: 'GeometryNodeDuplicateElements',
    label: 'Duplicate Elements',
    // `node_init` (:59).
    properties: {domain: 'POINT'},
    // `node_rna` (:1265).
    enums: {domain: ['POINT', 'EDGE', 'FACE', 'SPLINE', 'LAYER', 'INSTANCE']},
    // `node_declare` (:35).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'Amount').default(1).min(0).field()
        b.output('GEOMETRY', 'Geometry')
        b.output('INT', 'Duplicate Index').field()
    },
    // `node_geo_exec` (:1201).
    execute(p) {
        const domain = p.node.prop<string>('domain')
        if (domain === 'LAYER') throw new Error('Duplicate Elements: the grease pencil layer domain is not supported (no grease pencil component)')
        const count = new FieldOperation(maxIntInt, [GField.constant('int32', [0]), p.field('Amount')]).output(0)
        const selection = p.field('Selection')
        const indexId = p.outputUsed('Duplicate Index') ? p.anonymousName('Duplicate Index') : undefined
        let geometry = p.geometry('Geometry')
        if (domain === 'INSTANCE') {
            geometry = duplicateInstances(geometry, count, selection, indexId)
        } else {
            geometry = foreachRealGeometry(geometry, g => {
                if (domain === 'SPLINE') duplicateCurves(g, count, selection, indexId)
                else if (domain === 'FACE') duplicateFaces(g, count, selection, indexId)
                else if (domain === 'EDGE') duplicateEdges(g, count, selection, indexId)
                else duplicatePoints(g, count, selection, indexId)
            }, p.options.scene)
        }
        if (geometry.isEmpty) return
        p.set('Geometry', geometry)
        if (indexId) p.set('Duplicate Index', GField.fromInput(new AttributeFieldInput(indexId, 'int32')))
    },
})
