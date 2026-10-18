/**
 * `geometry::separate_geometry` (`geometry/intern/separate_geometry.cc:174`): keep the selected elements.
 * Curves (`curves_copy_point_selection` / `curves_copy_curve_selection`) are not ported yet and throw.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField} from '../fields'
import {DATA_TYPES, DataType} from './dataTypes'
import {GeometrySet} from './GeometrySet'
import {PointCloud} from './components'
import {meshCopySelection, meshCopySelectionKeepEdges, meshCopySelectionKeepVerts} from './meshCopySelection'
import {filterInstances} from './realizeInstances'

export type DeleteGeometryMode = 'ALL' | 'EDGE_FACE' | 'ONLY_FACE'

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
    if (geometry.curves && (domain === AttrDomain.Point || domain === AttrDomain.Curve)) {
        throw new Error('procedural: separating curves (curves_copy_point_selection / curves_copy_curve_selection) is not ported yet')
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
