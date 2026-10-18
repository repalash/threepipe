/**
 * `geometry::separate_geometry` (`geometry/intern/separate_geometry.cc:174`): keep the selected elements.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField} from '../fields'
import {DATA_TYPES, DataType} from './dataTypes'
import {GeometrySet} from './GeometrySet'
import {CurvesGeometry, PointCloud} from './components'
import {removeAttributesBasedOnTypes} from './trimCurves'
import {meshCopySelection, meshCopySelectionKeepEdges, meshCopySelectionKeepVerts} from './meshCopySelection'
import {filterInstances} from './realizeInstances'

export type DeleteGeometryMode = 'ALL' | 'EDGE_FACE' | 'ONLY_FACE'

/** Copy the `indices` elements of every `domain` layer of `src` into `dst` (`gather_attributes`). */
function gatherLayers(src: CurvesGeometry, dst: CurvesGeometry, domain: AttrDomain, indices: ArrayLike<number>): void {
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== domain) continue
        const c = DATA_TYPES[layer.type as DataType].components
        const out = dst.attributes.get(layer.name) ?? dst.attributes.add({name: layer.name, domain, type: layer.type})
        for (let d = 0; d < indices.length; d++) {
            const s = indices[d]
            for (let k = 0; k < c; k++) out.data[d * c + k] = layer.data[s * c + k]
        }
    }
}

/** `bke::curves_copy_point_selection` (`curves_geometry.cc:1497`): the selected points, the curves that keep any. */
export function curvesCopyPointSelection(src: CurvesGeometry, points: number[]): CurvesGeometry {
    const counts = new Int32Array(src.curvesNum)
    const pointToCurve = new Int32Array(src.pointsNum)
    for (let c = 0; c < src.curvesNum; c++) pointToCurve.fill(c, src.curveOffsets[c], src.curveOffsets[c + 1])
    for (const p of points) counts[pointToCurve[p]]++
    const curves: number[] = []
    for (let c = 0; c < src.curvesNum; c++) if (counts[c] > 0) curves.push(c)
    const dst = new CurvesGeometry(points.length, curves.length)
    curves.forEach((c, i) => { dst.curveOffsets[i + 1] = dst.curveOffsets[i] + counts[c] })
    gatherLayers(src, dst, AttrDomain.Point, points)
    gatherLayers(src, dst, AttrDomain.Curve, curves)
    // :1554: the type counts stay when every curve is kept, else attributes of absent types go.
    if (dst.curvesNum !== src.curvesNum) removeAttributesBasedOnTypes(dst)
    return dst
}

/** `bke::curves_copy_curve_selection` (`curves_geometry.cc:1593`): the selected curves with all their points. */
export function curvesCopyCurveSelection(src: CurvesGeometry, curves: number[]): CurvesGeometry {
    const points: number[] = []
    const dst = new CurvesGeometry(0, curves.length)
    curves.forEach((c, i) => {
        const [s, e] = src.pointsRange(c)
        for (let p = s; p < e; p++) points.push(p)
        dst.curveOffsets[i + 1] = dst.curveOffsets[i] + (e - s)
    })
    dst.attributes.resizeDomain(AttrDomain.Point, points.length)
    // `gather_attributes_group_to_group` on points is the same element copy, curve by curve.
    gatherLayers(src, dst, AttrDomain.Point, points)
    gatherLayers(src, dst, AttrDomain.Curve, curves)
    removeAttributesBasedOnTypes(dst)
    return dst
}

/** `separate_curves_selection` (:24). Undefined: unchanged. */
function separateCurves(src: CurvesGeometry, domain: AttrDomain, selection: GField): CurvesGeometry | undefined {
    const size = domain === AttrDomain.Point ? src.pointsNum : src.curvesNum
    const sel = new FieldEvaluation(new FieldContext('curves', src, domain), size).evaluate(selection)
    const keep: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i, 0)) keep.push(i)
    if (keep.length === size) return undefined
    if (!keep.length) return new CurvesGeometry()
    return domain === AttrDomain.Point ? curvesCopyPointSelection(src, keep) : curvesCopyCurveSelection(src, keep)
}

/** `separate_pointcloud_selection` (:54). Undefined: unchanged; null: no point cloud. */
function separatePointCloud(src: PointCloud, selection: GField): PointCloud | null | undefined {
    const n = src.pointsNum
    const sel = new FieldEvaluation(new FieldContext('pointcloud', src, AttrDomain.Point), n).evaluate(selection)
    const keep: number[] = []
    for (let i = 0; i < n; i++) if (sel.get(i, 0)) keep.push(i)
    if (keep.length === n) return undefined
    if (!keep.length) return null
    const dst = new PointCloud(keep.length)
    for (const layer of src.attributes.layers()) {
        const c = DATA_TYPES[layer.type as DataType].components
        const out = dst.attributes.get(layer.name) ?? dst.attributes.add({name: layer.name, domain: AttrDomain.Point, type: layer.type})
        keep.forEach((s, d) => { for (let k = 0; k < c; k++) out.data[d * c + k] = layer.data[s * c + k] })
    }
    return dst
}

/**
 * `separate_geometry(geometry, domain, mode, selection)`: edits `geometry` (a writable copy). Returns
 * `r_is_error`: no component had the domain while there is realized data.
 */
export function separateGeometry(geometry: GeometrySet, domain: AttrDomain, mode: DeleteGeometryMode, selection: GField): boolean {
    let someValidDomain = false
    if (geometry.pointCloud && domain === AttrDomain.Point) {
        const dst = separatePointCloud(geometry.pointCloud, selection)
        if (dst !== undefined) geometry.setPointCloud(dst ?? undefined)
        someValidDomain = true
    }
    const mesh = geometry.mesh
    if (mesh && (domain === AttrDomain.Point || domain === AttrDomain.Edge || domain === AttrDomain.Face)) {
        // `separate_mesh_selection` (:103).
        const sel = new FieldEvaluation(new FieldContext('mesh', mesh, domain), mesh.attributes.domainSizes[domain]).evaluate(selection)
        const dst = mode === 'ALL' ? meshCopySelection(mesh, sel, domain)
            : mode === 'EDGE_FACE' ? meshCopySelectionKeepVerts(mesh, sel, domain)
                : meshCopySelectionKeepEdges(mesh, sel, domain)
        if (dst !== undefined) geometry.setMesh(dst ?? undefined)
        someValidDomain = true
    }
    const curves = geometry.curves
    if (curves && (domain === AttrDomain.Point || domain === AttrDomain.Curve)) {
        // :203-219: an empty result removes the component; otherwise `curves_copy_parameters` (materials).
        const dst = separateCurves(curves, domain, selection)
        if (dst) {
            if (dst.curvesNum === 0) geometry.remove('curves')
            else {
                dst.materials = curves.materials.slice()
                geometry.setCurves(dst)
            }
        }
        someValidDomain = true
    }
    if (geometry.instances && domain === AttrDomain.Instance) {
        // `delete_selected_instances` (:80).
        const inst = geometry.instances
        const n = inst.instancesNum
        const sel = new FieldEvaluation(new FieldContext('instances', inst, AttrDomain.Instance), n).evaluate(selection)
        const mask = new Uint8Array(n)
        let any = false
        for (let i = 0; i < n; i++) if ((mask[i] = sel.get(i, 0) ? 1 : 0)) any = true
        if (!any) geometry.remove('instances')
        else geometry.setInstances(filterInstances(inst, mask, true))
        someValidDomain = true
    }
    return !someValidDomain && !!(geometry.mesh || geometry.pointCloud || geometry.curves)
}
