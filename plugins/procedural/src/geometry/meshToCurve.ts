/**
 * `geometry::mesh_edges_to_curves_convert` / `mesh_faces_to_curves_convert` (`geometry/intern/mesh_to_curve_convert.cc`):
 * poly curves along chains of mesh edges, or one cyclic poly curve per face.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {AttributeAccessor} from './attributeAccessor'
import {CurvesGeometry} from './components'
import {CURVE_TYPE_POLY} from './curvesEval'
import {fillCurveTypes} from './curvesEdit'
import {DATA_TYPES, DataType} from './dataTypes'

/** `filter_builtin_attributes` (:21): attributes built-in on meshes but not on curves are not copied. */
function skippedNames(src: AttributeAccessor, dst: AttributeAccessor, skip: (name: string) => boolean): Set<string> {
    const out = new Set<string>()
    for (const name of src.names()) if ((src.isBuiltin(name) && !dst.isBuiltin(name)) || skip(name)) out.add(name)
    return out
}

/** `bke::gather_attributes` (`attribute_access.cc:736`) of `src` attributes on `srcDomain` to `dst` on `dstDomain`. */
export function gatherAttributes(src: AttributeAccessor, srcDomain: AttrDomain, dst: AttributeAccessor, dstDomain: AttrDomain,
    skip: Set<string>, indices: ArrayLike<number>): void {
    for (const name of src.names()) {
        const meta = src.lookupMeta(name)!
        if (meta.domain !== srcDomain || skip.has(name)) continue
        const varray = src.lookup(name)!
        writeGathered(dst, name, dstDomain, meta.type, (i, k) => varray.get(indices[i], k), indices.length)
    }
}

/** `lookup_or_add_for_write_only_span(name, domain, type)` filled from `get` (skipped when it fails). */
function writeGathered(dst: AttributeAccessor, name: string, domain: AttrDomain, type: DataType, get: (i: number, k: number) => number, size: number): void {
    const c = DATA_TYPES[type].components
    const data = new DATA_TYPES[type].array(size * c)
    for (let i = 0; i < size; i++) for (let k = 0; k < c; k++) data[i * c + k] = get(i, k)
    const meta = dst.lookupMeta(name)
    if (meta) {
        if (meta.domain !== domain || meta.type !== type) return
        dst.layerForWrite(name)!.data.set(data)
        return
    }
    dst.add(name, domain, type, data)
}

/** `create_curve_from_vert_indices` (:33). */
function createCurveFromVertIndices(src: AttributeAccessor, vertIndices: number[], curveOffsets: number[], cyclicStart: number,
    skip: (name: string) => boolean): CurvesGeometry {
    const curves = new CurvesGeometry(vertIndices.length, curveOffsets.length)
    curves.curveOffsets.set(curveOffsets)
    curves.curveOffsets[curveOffsets.length] = vertIndices.length
    fillCurveTypes(curves, CURVE_TYPE_POLY)
    const dst = curves.accessor()
    if (cyclicStart < curveOffsets.length) {
        // `cyclic_for_write().slice(cyclic_curves).fill(true)`.
        const cyclic = new Uint8Array(curveOffsets.length)
        cyclic.fill(1, cyclicStart)
        dst.add('cyclic', AttrDomain.Curve, 'bool', cyclic)
    }
    const skipped = skippedNames(src, dst, skip)
    gatherAttributes(src, AttrDomain.Point, dst, AttrDomain.Point, skipped, vertIndices)
    // Edge, face and corner attributes are read on points and gathered.
    for (const name of src.names()) {
        const meta = src.lookupMeta(name)!
        if (meta.domain === AttrDomain.Point || skipped.has(name)) continue
        const varray = src.lookup(name, AttrDomain.Point)
        if (!varray) continue
        if (varray.isSingle) {
            if (dst.add(name, AttrDomain.Point, meta.type, varray.single)) continue
        }
        writeGathered(dst, name, AttrDomain.Point, meta.type, (i, k) => varray.get(vertIndices[i], k), vertIndices.length)
    }
    return curves
}

/** `edges_to_curve_point_indices` (:113). `edges` holds `[v1, v2]` pairs. */
function edgesToCurvePointIndices(vertsNum: number, edges: Int32Array): {vertIndices: number[], curveOffsets: number[], cyclicStart: number} {
    const edgesNum = edges.length / 2
    // `build_reverse_offsets`: the number of edges at each vertex.
    const offsets = new Int32Array(vertsNum + 1)
    for (let i = 0; i < edges.length; i++) offsets[edges[i]]++
    let acc = 0
    for (let v = 0; v < vertsNum; v++) {
        const n = offsets[v]
        offsets[v] = acc
        acc += n
    }
    offsets[vertsNum] = acc
    const size = (v: number) => offsets[v + 1] - offsets[v]
    const usedSlots = new Int32Array(vertsNum)
    const neighbors = new Int32Array(edgesNum * 2)
    for (let i = 0; i < edgesNum; i++) {
        const v1 = edges[i * 2], v2 = edges[i * 2 + 1]
        neighbors[offsets[v1] + usedSlots[v1]] = v2
        neighbors[offsets[v2] + usedSlots[v2]] = v1
        usedSlots[v1]++
        usedSlots[v2]++
    }
    const vertIndices: number[] = []
    const curveOffsets: number[] = []
    const unusedEdges = usedSlots
    for (let startVert = 0; startVert < vertsNum; startVert++) {
        if (size(startVert) === 2) continue
        if (unusedEdges[startVert] === 0) continue
        for (let ni = offsets[startVert]; ni < offsets[startVert + 1]; ni++) {
            const neighbor = neighbors[ni]
            let currentVert = startVert
            let nextVert = neighbor
            if (unusedEdges[nextVert] === 0) continue
            curveOffsets.push(vertIndices.length)
            vertIndices.push(currentVert)
            while (true) {
                const lastVert = currentVert
                currentVert = nextVert
                vertIndices.push(currentVert)
                unusedEdges[currentVert]--
                unusedEdges[lastVert]--
                if (size(currentVert) !== 2) break
                const o = offsets[currentVert]
                const nextA = neighbors[o], nextB = neighbors[o + 1]
                nextVert = lastVert === nextA ? nextB : nextA
            }
        }
    }
    const cyclicStart = curveOffsets.length
    for (let startVert = 0; startVert < vertsNum; startVert++) {
        if (unusedEdges[startVert] !== 2) continue
        let currentVert = startVert
        let nextVert = neighbors[offsets[currentVert]]
        curveOffsets.push(vertIndices.length)
        vertIndices.push(currentVert)
        while (nextVert !== startVert) {
            const lastVert = currentVert
            currentVert = nextVert
            vertIndices.push(currentVert)
            unusedEdges[currentVert]--
            unusedEdges[lastVert]--
            const o = offsets[currentVert]
            const nextA = neighbors[o], nextB = neighbors[o + 1]
            nextVert = lastVert === nextA ? nextB : nextA
        }
    }
    return {vertIndices, curveOffsets, cyclicStart}
}

/** `mesh_edges_to_curves_convert` (:226). `skip` filters anonymous attributes that are not propagated. */
export function meshEdgesToCurvesConvert(mesh: MeshData, src: AttributeAccessor, selection: number[], skip: (name: string) => boolean): CurvesGeometry {
    const ev = mesh.edgeVerts
    let edges: Int32Array
    if (selection.length === mesh.edgesNum) edges = ev
    else {
        edges = new Int32Array(selection.length * 2)
        selection.forEach((e, i) => { edges[i * 2] = ev[e * 2]; edges[i * 2 + 1] = ev[e * 2 + 1] })
    }
    const out = edgesToCurvePointIndices(mesh.vertsNum, edges)
    return createCurveFromVertIndices(src, out.vertIndices, out.curveOffsets, out.cyclicStart, skip)
}

/** `mesh_faces_to_curves_convert` (:283) with `create_curves_for_faces` (:240) and `create_point_to_vert_map` (:265). */
export function meshFacesToCurvesConvert(mesh: MeshData, src: AttributeAccessor, selection: number[], skip: (name: string) => boolean): CurvesGeometry {
    const fo = mesh.faceOffsets
    const offsets = new Int32Array(selection.length + 1)
    selection.forEach((f, i) => { offsets[i + 1] = offsets[i] + fo[f + 1] - fo[f] })
    const pointsNum = offsets[selection.length]
    const curves = new CurvesGeometry(pointsNum, selection.length)
    curves.curveOffsets.set(offsets)
    const dst = curves.accessor()
    dst.add('cyclic', AttrDomain.Curve, 'bool', [1])
    fillCurveTypes(curves, CURVE_TYPE_POLY)

    // The corners of the selected faces, in order: the point to corner map.
    const pointToCorner = new Int32Array(pointsNum)
    selection.forEach((f, i) => { for (let k = 0; k < fo[f + 1] - fo[f]; k++) pointToCorner[offsets[i] + k] = fo[f] + k })
    const cornerVerts = mesh.cornerVerts
    const pointToVert = pointToCorner.map(c => cornerVerts[c])

    const skipped = skippedNames(src, dst, skip)
    gatherAttributes(src, AttrDomain.Point, dst, AttrDomain.Point, skipped, pointToVert)
    for (const name of src.names()) {
        const meta = src.lookupMeta(name)!
        if (meta.domain !== AttrDomain.Edge || skipped.has(name)) continue
        const varray = src.lookup(name, AttrDomain.Point)!
        writeGathered(dst, name, AttrDomain.Point, meta.type, (i, k) => varray.get(pointToVert[i], k), pointsNum)
    }
    gatherAttributes(src, AttrDomain.Face, dst, AttrDomain.Curve, skipped, selection)
    gatherAttributes(src, AttrDomain.Corner, dst, AttrDomain.Point, skipped, pointToCorner)
    return curves
}
