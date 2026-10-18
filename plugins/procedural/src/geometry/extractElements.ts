/**
 * `geometry/intern/extract_elements.cc` (Blender 5.2.2): one small geometry per selected element - a vertex, edge or
 * face of a mesh, a point of a point cloud, a point or a curve of curves, an instance - with the element's attribute
 * values. The For Each Geometry Element zone's Element output.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import type {AttributeAccessor} from './attributeAccessor'
import {CurvesGeometry, Instances, MeshAccessor, PointCloud} from './components'
import {CURVE_TYPE_POLY} from './curvesEval'
import {fillCurveTypes} from './curvesEdit'
import {DATA_TYPES, DataType} from './dataTypes'
import {gatherAttributes} from './meshToCurve'
import {newMesh} from './meshPrimitives'
import type {GVArray} from './varray'

interface Propagation {
    name: string
    type: DataType
    domain: AttrDomain
    data: GVArray
}

/** `lookup_or_add_for_write_only_span(name, domain, type)` filled by `fill(out, components)`; skipped when it fails. */
function writeOnly(dst: AttributeAccessor, name: string, domain: AttrDomain, type: DataType, fill: (out: number[], c: number) => void): void {
    const c = DATA_TYPES[type].components
    const size = dst.domainSize(domain)
    const values = new Array<number>(size * c).fill(0)
    fill(values, c)
    const meta = dst.lookupMeta(name)
    if (meta) {
        if (meta.domain !== domain || meta.type !== type) return
        dst.layerForWrite(name)!.data.set(values)
        return
    }
    const data = new DATA_TYPES[type].array(size * c)
    data.set(values)
    dst.add(name, domain, type, data)
}

const copyElement = (src: GVArray, i: number, out: number[], o: number, c: number) => {
    for (let k = 0; k < c; k++) out[o * c + k] = src.get(i, k)
}

/** `BKE_mesh_new_nomain` + `BKE_mesh_copy_parameters_for_eval` (material slots). */
function elementMesh(src: MeshData, verts: number, edges: number, faces: number, corners: number): MeshData {
    const m = newMesh(verts, edges, faces, corners)
    m.materials = src.materials.slice()
    return m
}

const elementAccessor = (mesh: MeshData): AttributeAccessor => new MeshAccessor(mesh)

/** `extract_mesh_vertices` (:22): every attribute read on the points. */
export function extractMeshVertices(mesh: MeshData, src: AttributeAccessor, mask: number[]): MeshData[] {
    const props: Propagation[] = []
    for (const name of src.names()) {
        const data = src.lookup(name, AttrDomain.Point)
        if (data) props.push({name, type: src.lookupMeta(name)!.type, domain: AttrDomain.Point, data})
    }
    return mask.map(v => {
        const element = elementMesh(mesh, 1, 0, 0, 0)
        const dst = elementAccessor(element)
        for (const p of props) writeOnly(dst, p.name, AttrDomain.Point, p.type, (out, c) => copyElement(p.data, v, out, 0, c))
        return element
    })
}

/** `extract_mesh_edges` (:59): point and edge attributes as they are, corner ones on points, face ones on edges. */
export function extractMeshEdges(mesh: MeshData, src: AttributeAccessor, mask: number[]): MeshData[] {
    const props: Propagation[] = []
    for (const name of src.names()) {
        if (name === '.edge_verts') continue
        const meta = src.lookupMeta(name)!
        const raw = src.lookup(name)!
        if (meta.domain === AttrDomain.Point || meta.domain === AttrDomain.Edge) props.push({name, type: meta.type, domain: meta.domain, data: raw})
        else if (meta.domain === AttrDomain.Corner) {
            const a = src.adaptDomain(raw, AttrDomain.Corner, AttrDomain.Point)
            if (a) props.push({name, type: meta.type, domain: AttrDomain.Point, data: a})
        } else if (meta.domain === AttrDomain.Face) {
            const a = src.adaptDomain(raw, AttrDomain.Face, AttrDomain.Edge)
            if (a) props.push({name, type: meta.type, domain: AttrDomain.Edge, data: a})
        }
    }
    const ev = mesh.edgeVerts
    return mask.map(e => {
        const element = elementMesh(mesh, 2, 1, 0, 0)
        element.edgeVerts[0] = 0
        element.edgeVerts[1] = 1
        const dst = elementAccessor(element)
        for (const p of props) {
            writeOnly(dst, p.name, p.domain, p.type, (out, c) => {
                if (p.domain === AttrDomain.Point) {
                    copyElement(p.data, ev[e * 2], out, 0, c)
                    copyElement(p.data, ev[e * 2 + 1], out, 1, c)
                } else {
                    copyElement(p.data, e, out, 0, c)
                }
            })
        }
        return element
    })
}

/** `extract_mesh_faces` (:116): a face with its own vertices and edges, attributes on every domain. */
export function extractMeshFaces(mesh: MeshData, src: AttributeAccessor, mask: number[]): MeshData[] {
    const props: Propagation[] = []
    for (const name of src.names()) {
        if (name === '.edge_verts' || name === '.corner_edge' || name === '.corner_vert') continue
        const meta = src.lookupMeta(name)!
        props.push({name, type: meta.type, domain: meta.domain, data: src.lookup(name)!})
    }
    const fo = mesh.faceOffsets, cv = mesh.cornerVerts, ce = mesh.cornerEdges
    return mask.map(f => {
        const start = fo[f], n = fo[f + 1] - start
        const element = elementMesh(mesh, n, n, 1, n)
        for (let i = 0; i < n; i++) {
            element.edgeVerts[i * 2] = i
            element.edgeVerts[i * 2 + 1] = i + 1
            element.cornerVerts[i] = i
            element.cornerEdges[i] = i
        }
        element.edgeVerts[n * 2 - 1] = 0
        element.faceOffsets[0] = 0
        element.faceOffsets[1] = n
        const dst = elementAccessor(element)
        for (const p of props) {
            writeOnly(dst, p.name, p.domain, p.type, (out, c) => {
                if (p.domain === AttrDomain.Point) for (let i = 0; i < n; i++) copyElement(p.data, cv[start + i], out, i, c)
                else if (p.domain === AttrDomain.Edge) for (let i = 0; i < n; i++) copyElement(p.data, ce[start + i], out, i, c)
                else if (p.domain === AttrDomain.Corner) for (let i = 0; i < n; i++) copyElement(p.data, start + i, out, i, c)
                else if (p.domain === AttrDomain.Face) copyElement(p.data, f, out, 0, c)
            })
        }
        return element
    })
}

/** `extract_pointcloud_points` (:212): material slots kept, point attributes gathered. */
export function extractPointcloudPoints(pc: PointCloud, mask: number[]): PointCloud[] {
    const src = pc.accessor()
    return mask.map(i => {
        const element = new PointCloud(1)
        element.materials = pc.materials.slice()
        gatherAttributes(src, AttrDomain.Point, element.accessor(), AttrDomain.Point, new Set(), [i])
        return element
    })
}

/** `curves_copy_parameters`: material slots. */
function copyCurvesParameters(src: CurvesGeometry, dst: CurvesGeometry): void {
    dst.materials = src.materials.slice()
}

/** `extract_curves_points` (:234): a one-point poly curve; the source curve's attributes give the type. */
export function extractCurvesPoints(curves: CurvesGeometry, mask: number[]): CurvesGeometry[] {
    const src = curves.accessor()
    const pointToCurve = new Int32Array(curves.pointsNum)
    for (let c = 0; c < curves.curvesNum; c++) for (let p = curves.curveOffsets[c]; p < curves.curveOffsets[c + 1]; p++) pointToCurve[p] = c
    return mask.map(p => {
        // `curves_new_nomain_single(1, CURVE_TYPE_POLY)`.
        const element = new CurvesGeometry(1, 1)
        element.curveOffsets[1] = 1
        fillCurveTypes(element, CURVE_TYPE_POLY)
        copyCurvesParameters(curves, element)
        const dst = element.accessor()
        gatherAttributes(src, AttrDomain.Point, dst, AttrDomain.Point, new Set(), [p])
        gatherAttributes(src, AttrDomain.Curve, dst, AttrDomain.Curve, new Set(), [pointToCurve[p]])
        return element
    })
}

/** `extract_curves` (:265). */
export function extractCurves(curves: CurvesGeometry, mask: number[]): CurvesGeometry[] {
    const src = curves.accessor()
    return mask.map(c => {
        const [s, e] = curves.pointsRange(c)
        const element = new CurvesGeometry(e - s, 1)
        element.curveOffsets[1] = e - s
        copyCurvesParameters(curves, element)
        const dst = element.accessor()
        gatherAttributes(src, AttrDomain.Point, dst, AttrDomain.Point, new Set(), Array.from({length: e - s}, (_, k) => s + k))
        gatherAttributes(src, AttrDomain.Curve, dst, AttrDomain.Curve, new Set(), [c])
        return element
    })
}

/** `extract_instances` (:295): the reference and transform, then the other instance attributes. */
export function extractInstances(inst: Instances, mask: number[]): Instances[] {
    const src = inst.accessor()
    const skip = new Set(['.reference_index', 'instance_transform'])
    return mask.map(i => {
        const element = new Instances(1)
        // `add_new_reference`: always a new reference.
        element.references.push(inst.references[inst.referenceHandles[i]])
        element.referenceHandles[0] = 0
        element.transforms.set(inst.transforms.subarray(i * 16, i * 16 + 16))
        gatherAttributes(src, AttrDomain.Instance, element.accessor(), AttrDomain.Instance, skip, [i])
        return element
    })
}
