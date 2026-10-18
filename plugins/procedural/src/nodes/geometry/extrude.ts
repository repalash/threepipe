/**
 * Extrude Mesh (`node_geo_extrude_mesh.cc`): vertices (`extrude_mesh_vertices` :390), edges (`extrude_mesh_edges`
 * :567), face regions (`extrude_mesh_face_regions` :850) and individual faces (`extrude_individual_mesh_faces`
 * :1230), on the mesh arrays exactly as Blender appends the new elements.
 */

import {AttrDomain, AttributeLayer, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {FieldContext, FieldEvaluation, FieldOperation, GField, lookupMultiFunction} from '../../fields'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {createPropagationMixer, mix2} from '../../geometry/mixers'
import {AttributeFieldInput} from '../../fields/inputs'
import {
    buildEdgeToFaceMap, buildVertToEdgeMap, expandMesh, gatherInLayer, mixGroupsInLayer, range, saveSelectionAsAttribute,
    tagMeshChanged, transferLayers,
} from '../../geometry/meshEditUtils'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

interface AttributeOutputs {
    topId?: string
    sideId?: string
}

/** Selected indices of `selection` evaluated on `domain` (`get_evaluated_selection_as_mask`) and the other fields. */
function evaluateWithSelection(mesh: MeshData, domain: AttrDomain, selection: GField, fields: GField[]): {selection: number[], values: GVArray[]} {
    const size = new FieldContext('mesh', mesh, domain).size
    const e = new FieldEvaluation(new FieldContext('mesh', mesh, domain), size)
    const sel = e.evaluate(selection)
    const indices: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i)) indices.push(i)
    return {selection: indices, values: fields.map(f => e.evaluate(f))}
}

const addPos = (positions: Float32Array, dst: number, src: number, off: ArrayLike<number>, o: number) => {
    for (let k = 0; k < 3; k++) positions[dst * 3 + k] = f32(positions[src * 3 + k] + off[o + k])
}

/** A `DefaultPropagationMixer<float3>` over the vertices (the face/edge offsets moved to the vertex domain). */
function mixVertOffsets(vertsNum: number, mixIn: (mix: (vert: number, offset: ArrayLike<number>, o: number) => void) => void): Float32Array {
    const out = new Float32Array(vertsNum * 3)
    const mixer = createPropagationMixer('float3', out)
    mixIn((vert, offset, o) => mixer.mixIn(vert, offset, o / 3))
    mixer.finalize()
    return out
}

// region vertices

/** `extrude_mesh_vertices` (:390). */
function extrudeMeshVertices(mesh: MeshData, selectionField: GField, offsetField: GField, outputs: AttributeOutputs): void {
    const origVertSize = mesh.vertsNum
    const origEdgeSize = mesh.edgesNum
    const {selection, values: [offsetsVA]} = evaluateWithSelection(mesh, AttrDomain.Point, selectionField, [offsetField])
    if (!selection.length) return
    const offsets = offsetsVA.materialize()

    const names = transferLayers(mesh, ['position', '.edge_verts'])
    const vertToEdge = names[AttrDomain.Edge].length ? buildVertToEdgeMap(mesh.edgeVerts, origVertSize) : undefined

    expandMesh(mesh, selection.length, selection.length, 0, 0)
    const n = selection.length
    const edges = mesh.edgeVerts
    selection.forEach((index, i) => {
        edges[(origEdgeSize + i) * 2] = index
        edges[(origEdgeSize + i) * 2 + 1] = origVertSize + i
    })
    // New vertices copy the attribute values from their source vertex.
    for (const layer of names[AttrDomain.Point]) gatherInLayer(liveLayer(mesh, layer), selection, origVertSize)
    // New edge values are mixed from all the edges connected to the source vertex.
    for (const layer of names[AttrDomain.Edge]) mixGroupsInLayer(liveLayer(mesh, layer), vertToEdge!, selection, origEdgeSize)

    const positions = mesh.positions
    selection.forEach((index, i) => addPos(positions, origVertSize + i, index, offsets, index * 3))

    if (outputs.topId) saveSelectionAsAttribute(mesh, outputs.topId, AttrDomain.Point, range(origVertSize, n))
    if (outputs.sideId) saveSelectionAsAttribute(mesh, outputs.sideId, AttrDomain.Edge, range(origEdgeSize, n))
    tagMeshChanged(mesh)
}

/** The layer object after a resize (layers keep their identity; their arrays are replaced). */
function liveLayer(mesh: MeshData, layer: AttributeLayer): AttributeLayer {
    return mesh.attributes.get(layer.name)!
}

// endregion

/** `fill_quad_consistent_direction` (:484). */
function fillQuadConsistentDirection(
    otherFaceVerts: ArrayLike<number>, otherFaceEdges: ArrayLike<number>,
    cornerVerts: Int32Array, cornerEdges: Int32Array, at: number,
    vertConnected1: number, vertConnected2: number, vertAcross1: number, vertAcross2: number,
    edgeConnected: number, connecting1: number, edgeAcross: number, connecting2: number,
): void {
    // Find the loop on the face connected to the new quad that uses the duplicate edge.
    let startWithConnectingEdge = true
    for (let i = 0; i < otherFaceEdges.length; i++) {
        if (otherFaceEdges[i] === edgeConnected) {
            startWithConnectingEdge = otherFaceVerts[i] === vertConnected1
            break
        }
    }
    const v = startWithConnectingEdge
        ? [vertConnected1, vertAcross1, vertAcross2, vertConnected2]
        : [vertConnected1, vertConnected2, vertAcross2, vertAcross1]
    const e = startWithConnectingEdge
        ? [connecting1, edgeAcross, connecting2, edgeConnected]
        : [edgeConnected, connecting2, edgeAcross, connecting1]
    for (let k = 0; k < 4; k++) {
        cornerVerts[at + k] = v[k]
        cornerEdges[at + k] = e[k]
    }
}

/** `offset_indices::fill_constant_group_size(4, start, offsets)` for the new faces. */
function fillQuadOffsets(mesh: MeshData, firstFace: number, count: number, cornerStart: number): void {
    for (let i = 0; i < count; i++) mesh.faceOffsets[firstFace + i] = cornerStart + 4 * i
}

/** Zeros: `T()` / `T{}` value-initialisation (a zero quaternion and matrix, not the CPPType default). */
function fillValueInitialized(layer: AttributeLayer, start: number, count: number): void {
    const c = DATA_TYPES[layer.type as DataType].components
    layer.data.fill(0, start * c, (start + count) * c)
}

// region edges

/** `extrude_mesh_edges` (:567). */
function extrudeMeshEdges(mesh: MeshData, selectionField: GField, offsetField: GField, outputs: AttributeOutputs): void {
    const origVertSize = mesh.vertsNum
    const origEdges = mesh.edgeVerts
    const origFacesNum = mesh.facesNum
    const origLoopSize = mesh.cornersNum
    const origEdgesNum = mesh.edgesNum

    const {selection: edgeSelection, values: [edgeOffsets]} = evaluateWithSelection(mesh, AttrDomain.Edge, selectionField, [offsetField])
    if (!edgeSelection.length) return

    // Offsets moved to the vertex domain before the arrays are reallocated (:589).
    const vertOffsets = edgeOffsets.isSingle ? undefined : mixVertOffsets(origVertSize, mix => {
        for (const e of edgeSelection) {
            const off = [edgeOffsets.get(e, 0), edgeOffsets.get(e, 1), edgeOffsets.get(e, 2)]
            mix(origEdges[e * 2], off, 0)
            mix(origEdges[e * 2 + 1], off, 0)
        }
    })

    // `vert_selection_from_edge`.
    const vertSel = new Uint8Array(origVertSize)
    for (const e of edgeSelection) vertSel[origEdges[e * 2]] = vertSel[origEdges[e * 2 + 1]] = 1
    const newVerts: number[] = []
    for (let v = 0; v < origVertSize; v++) if (vertSel[v]) newVerts.push(v)

    const newVertStart = origVertSize
    const connectStart = origEdgesNum
    const duplicateStart = connectStart + newVerts.length
    const newFaceStart = origFacesNum
    const newLoopStart = origLoopSize
    const nSel = edgeSelection.length

    const edgeToFace = buildEdgeToFaceMap(mesh.faceOffsets, mesh.cornerEdges, origEdgesNum, origFacesNum)
    // `is_empty_domain(attributes, {".edge_verts"}, Edge)` (:620).
    const edgeHasData = mesh.attributes.layersOnDomain(AttrDomain.Edge).some(l => l.name !== '.edge_verts')
    const vertToSelectedEdge = edgeHasData ? buildVertToEdgeMap(origEdges, origVertSize, edgeSelection) : undefined

    expandMesh(mesh, newVerts.length, newVerts.length + nSel, nSel, nSel * 4)
    const names = transferLayers(mesh, ['position', '.edge_verts', '.corner_vert', '.corner_edge'])

    const edges = mesh.edgeVerts
    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges
    fillQuadOffsets(mesh, newFaceStart, nSel, origLoopSize)
    const fo = mesh.faceOffsets

    newVerts.forEach((src, dst) => {
        edges[(connectStart + dst) * 2] = src
        edges[(connectStart + dst) * 2 + 1] = newVertStart + dst
    })
    const vertToNewVert = new Int32Array(origVertSize)
    newVerts.forEach((v, i) => { vertToNewVert[v] = i })
    for (let i = 0; i < nSel; i++) {
        const e = edgeSelection[i]
        edges[(duplicateStart + i) * 2] = newVertStart + vertToNewVert[edges[e * 2]]
        edges[(duplicateStart + i) * 2 + 1] = newVertStart + vertToNewVert[edges[e * 2 + 1]]
    }

    edgeSelection.forEach((origEdgeIndex, i) => {
        const newVert1 = edges[(duplicateStart + i) * 2]
        const newVert2 = edges[(duplicateStart + i) * 2 + 1]
        const extrude1 = newVert1 - origVertSize
        const extrude2 = newVert2 - origVertSize
        const connected = edgeToFace.offsets[origEdgeIndex + 1] - edgeToFace.offsets[origEdgeIndex]
        // With exactly one connected face its winding keeps the new face consistent (:681).
        let faceVerts: ArrayLike<number> = []
        let faceEdges: ArrayLike<number> = []
        if (connected === 1) {
            const f = edgeToFace.indices[edgeToFace.offsets[origEdgeIndex]]
            faceVerts = cornerVerts.subarray(fo[f], fo[f + 1])
            faceEdges = cornerEdges.subarray(fo[f], fo[f + 1])
        }
        fillQuadConsistentDirection(faceVerts, faceEdges, cornerVerts, cornerEdges, newLoopStart + 4 * i,
            edges[origEdgeIndex * 2], edges[origEdgeIndex * 2 + 1], newVert1, newVert2,
            origEdgeIndex, connectStart + extrude1, duplicateStart + i, connectStart + extrude2)
    })

    for (const layer of names[AttrDomain.Point]) gatherInLayer(liveLayer(mesh, layer), newVerts, newVertStart)
    for (const layer of names[AttrDomain.Edge]) gatherInLayer(liveLayer(mesh, layer), edgeSelection, duplicateStart)
    for (const layer of names[AttrDomain.Edge]) mixGroupsInLayer(liveLayer(mesh, layer), vertToSelectedEdge!, newVerts, connectStart)
    for (const layer of names[AttrDomain.Face]) mixGroupsInLayer(liveLayer(mesh, layer), edgeToFace, edgeSelection, newFaceStart)

    // New corners average the corners of the connected faces at each end of the original edge (:721).
    for (const l of names[AttrDomain.Corner]) {
        const layer = liveLayer(mesh, l)
        const type = layer.type as DataType
        const c = DATA_TYPES[type].components
        const data = layer.data
        edgeSelection.forEach((origEdgeIndex, i) => {
            const fStart = edgeToFace.offsets[origEdgeIndex], fEnd = edgeToFace.offsets[origEdgeIndex + 1]
            const at = newLoopStart + 4 * i
            if (fStart === fEnd) {
                fillValueInitialized(layer, at, 4)
                return
            }
            const side = new DATA_TYPES[type].array(2 * c)
            const mixer = createPropagationMixer(type, side)
            const newVert1 = edges[(duplicateStart + i) * 2], newVert2 = edges[(duplicateStart + i) * 2 + 1]
            const origVert1 = edges[origEdgeIndex * 2], origVert2 = edges[origEdgeIndex * 2 + 1]
            for (let j = fStart; j < fEnd; j++) {
                const f = edgeToFace.indices[j]
                for (let loop = fo[f]; loop < fo[f + 1]; loop++) {
                    if (cornerVerts[loop] === origVert1) mixer.mixIn(0, data, loop)
                    if (cornerVerts[loop] === origVert2) mixer.mixIn(1, data, loop)
                }
            }
            mixer.finalize()
            for (let k = at; k < at + 4; k++) {
                const v = cornerVerts[k]
                if (v === newVert1 || v === origVert1) for (let q = 0; q < c; q++) data[k * c + q] = side[q]
                else if (v === newVert2 || v === origVert2) for (let q = 0; q < c; q++) data[k * c + q] = side[c + q]
            }
        })
    }

    const positions = mesh.positions
    if (edgeOffsets.isSingle) {
        const off = edgeOffsets.single
        newVerts.forEach((src, dst) => addPos(positions, newVertStart + dst, src, off, 0))
    } else {
        newVerts.forEach((src, dst) => addPos(positions, newVertStart + dst, src, vertOffsets!, src * 3))
    }

    if (outputs.topId) saveSelectionAsAttribute(mesh, outputs.topId, AttrDomain.Edge, range(duplicateStart, nSel))
    if (outputs.sideId) saveSelectionAsAttribute(mesh, outputs.sideId, AttrDomain.Face, range(newFaceStart, nSel))
    tagMeshChanged(mesh)
}

// endregion

/** An insertion-ordered set with indices (`VectorSet<int>`). */
class VectorSet {
    readonly items: number[] = []
    private readonly index = new Map<number, number>()

    add(v: number): void {
        if (!this.index.has(v)) {
            this.index.set(v, this.items.length)
            this.items.push(v)
        }
    }

    indexOf(v: number): number {
        return this.index.get(v) ?? -1
    }

    get size(): number {
        return this.items.length
    }
}

// region face regions

/** `extrude_mesh_face_regions` (:850). */
function extrudeMeshFaceRegions(mesh: MeshData, selectionField: GField, offsetField: GField, outputs: AttributeOutputs): void {
    const origVertSize = mesh.vertsNum
    const origEdges = mesh.edgeVerts
    const origEdgesNum = mesh.edgesNum
    const origFacesNum = mesh.facesNum
    const origFo = mesh.faceOffsets
    const origCornerVerts = mesh.cornerVerts
    const origLoopSize = mesh.cornersNum

    const {selection: faceSelection, values: [faceOffsets]} = evaluateWithSelection(mesh, AttrDomain.Face, selectionField, [offsetField])
    if (!faceSelection.length) return
    const faceSelected = new Uint8Array(origFacesNum)
    for (const f of faceSelection) faceSelected[f] = 1

    // Offsets mixed from the faces to their vertices (:877).
    const vertOffsets = faceOffsets.isSingle ? undefined : mixVertOffsets(origVertSize, mix => {
        for (const f of faceSelection) {
            const off = [faceOffsets.get(f, 0), faceOffsets.get(f, 1), faceOffsets.get(f, 2)]
            for (let c = origFo[f]; c < origFo[f + 1]; c++) mix(origCornerVerts[c], off, 0)
        }
    })

    const edgeToFace = buildEdgeToFaceMap(origFo, mesh.cornerEdges, origEdgesNum, origFacesNum)

    // `vert_selection_from_face`: every vertex of a selected face, ascending.
    const vertSel = new Uint8Array(origVertSize)
    for (const f of faceSelection) for (let c = origFo[f]; c < origFo[f + 1]; c++) vertSel[origCornerVerts[c]] = 1
    const allSelectedVerts: number[] = []
    for (let v = 0; v < origVertSize; v++) if (vertSel[v]) allSelectedVerts.push(v)

    const newInnerEdgeIndices = new VectorSet()
    const innerEdgeIndices: number[] = []
    const edgeExtrudedFaceIndices: number[] = []
    const boundaryEdgeIndices = new VectorSet()
    for (let e = 0; e < origEdgesNum; e++) {
        let selectedFace = -1
        let deselected = 0
        let selected = 0
        for (let j = edgeToFace.offsets[e]; j < edgeToFace.offsets[e + 1]; j++) {
            const f = edgeToFace.indices[j]
            if (faceSelected[f]) {
                selected++
                selectedFace = f
            } else {
                deselected++
            }
        }
        if (selected === 1) {
            boundaryEdgeIndices.add(e)
            edgeExtrudedFaceIndices.push(selectedFace)
        } else if (selected > 1) {
            if (deselected > 0) newInnerEdgeIndices.add(e)
            else innerEdgeIndices.push(e)
        }
    }

    // `vert_indices_from_edges` (:832), then the ends of the new inner edges.
    const newVertIndices = new VectorSet()
    for (const e of boundaryEdgeIndices.items) {
        newVertIndices.add(origEdges[e * 2])
        newVertIndices.add(origEdges[e * 2 + 1])
    }
    const extrudedVertSize = newVertIndices.size
    for (const e of newInnerEdgeIndices.items) {
        newVertIndices.add(origEdges[e * 2])
        newVertIndices.add(origEdges[e * 2 + 1])
    }

    const newVertStart = origVertSize
    const connectStart = origEdgesNum
    const boundaryStart = connectStart + extrudedVertSize
    const newInnerStart = boundaryStart + boundaryEdgeIndices.size
    const sideFaceStart = origFacesNum
    const sideLoopStart = origLoopSize
    const nBoundary = boundaryEdgeIndices.size

    expandMesh(mesh, newVertIndices.size, extrudedVertSize + nBoundary + newInnerEdgeIndices.size, nBoundary, nBoundary * 4)
    const names = transferLayers(mesh, ['.corner_vert', '.corner_edge', '.edge_verts'])

    const edges = mesh.edgeVerts
    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges
    if (nBoundary) fillQuadOffsets(mesh, sideFaceStart, nBoundary, origLoopSize)
    const fo = mesh.faceOffsets

    for (let i = 0; i < extrudedVertSize; i++) {
        edges[(connectStart + i) * 2] = newVertIndices.items[i]
        edges[(connectStart + i) * 2 + 1] = newVertStart + i
    }
    boundaryEdgeIndices.items.forEach((e, i) => {
        edges[(boundaryStart + i) * 2] = newVertStart + newVertIndices.indexOf(edges[e * 2])
        edges[(boundaryStart + i) * 2 + 1] = newVertStart + newVertIndices.indexOf(edges[e * 2 + 1])
    })
    newInnerEdgeIndices.items.forEach((e, i) => {
        edges[(newInnerStart + i) * 2] = newVertStart + newVertIndices.indexOf(edges[e * 2])
        edges[(newInnerStart + i) * 2 + 1] = newVertStart + newVertIndices.indexOf(edges[e * 2 + 1])
    })
    // Original edges inside face regions move to the new vertices where those exist (:1003).
    for (const e of innerEdgeIndices) {
        const a = newVertIndices.indexOf(edges[e * 2]), b = newVertIndices.indexOf(edges[e * 2 + 1])
        if (a !== -1) edges[e * 2] = newVertStart + a
        if (b !== -1) edges[e * 2 + 1] = newVertStart + b
    }
    // Selected faces use the new vertices and the duplicated edges (:1016).
    for (const f of faceSelection) {
        for (let c = fo[f]; c < fo[f + 1]; c++) {
            const v = newVertIndices.indexOf(cornerVerts[c])
            if (v !== -1) cornerVerts[c] = newVertStart + v
            const b = boundaryEdgeIndices.indexOf(cornerEdges[c])
            if (b !== -1) {
                cornerEdges[c] = boundaryStart + b
                continue
            }
            const inner = newInnerEdgeIndices.indexOf(cornerEdges[c])
            if (inner !== -1) cornerEdges[c] = newInnerStart + inner
        }
    }
    // Side faces (:1036).
    boundaryEdgeIndices.items.forEach((origEdge, i) => {
        const newVert1 = edges[(boundaryStart + i) * 2], newVert2 = edges[(boundaryStart + i) * 2 + 1]
        const extrude1 = newVert1 - origVertSize, extrude2 = newVert2 - origVertSize
        const f = edgeExtrudedFaceIndices[i]
        fillQuadConsistentDirection(cornerVerts.subarray(fo[f], fo[f + 1]), cornerEdges.subarray(fo[f], fo[f + 1]),
            cornerVerts, cornerEdges, sideLoopStart + 4 * i,
            newVert1, newVert2, newVertIndices.items[extrude1], newVertIndices.items[extrude2],
            boundaryStart + i, connectStart + extrude1, origEdge, connectStart + extrude2)
    })

    for (const layer of names[AttrDomain.Point]) gatherInLayer(liveLayer(mesh, layer), newVertIndices.items, newVertStart)
    for (const layer of names[AttrDomain.Face]) gatherInLayer(liveLayer(mesh, layer), edgeExtrudedFaceIndices, sideFaceStart)

    if (names[AttrDomain.Edge].length) {
        // The boundary edge map is built on the edges after the inner edges were reconnected (:1089).
        const vertToBoundaryEdge = buildVertToEdgeMap(edges, mesh.vertsNum, boundaryEdgeIndices.items)
        for (const l of names[AttrDomain.Edge]) {
            const layer = liveLayer(mesh, l)
            gatherInLayer(layer, boundaryEdgeIndices.items, boundaryStart)
            gatherInLayer(layer, newInnerEdgeIndices.items, newInnerStart)
            mixGroupsInLayer(layer, vertToBoundaryEdge, newVertIndices.items, connectStart, extrudedVertSize)
        }
    }

    if (names[AttrDomain.Corner].length) {
        // Corners of the side faces copy the matching corner of the extruded face (:1118).
        const origCorners = new Int32Array(nBoundary * 4)
        boundaryEdgeIndices.items.forEach((_, i) => {
            const newVert1 = edges[(boundaryStart + i) * 2], newVert2 = edges[(boundaryStart + i) * 2 + 1]
            const origVert1 = newVertIndices.items[newVert1 - origVertSize], origVert2 = newVertIndices.items[newVert2 - origVertSize]
            let corner1 = 0, corner2 = 0
            const f = edgeExtrudedFaceIndices[i]
            for (let c = fo[f]; c < fo[f + 1]; c++) {
                if (cornerVerts[c] === newVert1) corner1 = c
                if (cornerVerts[c] === newVert2) corner2 = c
            }
            for (let k = 4 * i; k < 4 * i + 4; k++) {
                const v = cornerVerts[sideLoopStart + k]
                if (v === newVert1 || v === origVert1) origCorners[k] = corner1
                else if (v === newVert2 || v === origVert2) origCorners[k] = corner2
            }
        })
        for (const layer of names[AttrDomain.Corner]) gatherInLayer(liveLayer(mesh, layer), origCorners, sideLoopStart)
    }

    // Translate: duplicated vertices move, vertices reused inside a region move in place (:1164).
    const positions = mesh.positions
    for (const v of allSelectedVerts) {
        const iNew = newVertIndices.indexOf(v)
        const target = iNew === -1 ? v : newVertStart + iNew
        const off = faceOffsets.isSingle ? faceOffsets.single : vertOffsets!
        addPos(positions, target, target, off, faceOffsets.isSingle ? 0 : v * 3)
    }

    if (outputs.topId) saveSelectionAsAttribute(mesh, outputs.topId, AttrDomain.Face, faceSelection)
    if (outputs.sideId) saveSelectionAsAttribute(mesh, outputs.sideId, AttrDomain.Face, range(sideFaceStart, nBoundary))
    tagMeshChanged(mesh)
}

// endregion

// region individual faces

/** `extrude_individual_mesh_faces` (:1230). */
function extrudeIndividualMeshFaces(mesh: MeshData, selectionField: GField, offsetField: GField, outputs: AttributeOutputs): void {
    const origVertSize = mesh.vertsNum
    const origEdgeSize = mesh.edgesNum
    const origFacesNum = mesh.facesNum
    const origLoopSize = mesh.cornersNum
    const origFo = mesh.faceOffsets.slice()

    const {selection: faceSelection, values: [offsetsVA]} = evaluateWithSelection(mesh, AttrDomain.Face, selectionField, [offsetField])
    if (!faceSelection.length) return
    const faceOffset = offsetsVA.materialize()

    // `gather_selected_offsets`: a group of new elements per corner of each selected face.
    const groupStart = new Int32Array(faceSelection.length + 1)
    faceSelection.forEach((f, i) => { groupStart[i + 1] = groupStart[i] + origFo[f + 1] - origFo[f] })
    const extrudeCornerSize = groupStart[faceSelection.length]

    const newVertStart = origVertSize
    const connectStart = origEdgeSize
    const duplicateStart = connectStart + extrudeCornerSize
    const sideFaceStart = origFacesNum
    const sideLoopStart = origLoopSize

    expandMesh(mesh, extrudeCornerSize, 2 * extrudeCornerSize, extrudeCornerSize, extrudeCornerSize * 4)
    const names = transferLayers(mesh, ['position', '.edge_verts', '.corner_vert', '.corner_edge'])

    const edges = mesh.edgeVerts
    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges
    fillQuadOffsets(mesh, sideFaceStart, extrudeCornerSize, origLoopSize)
    const fo = mesh.faceOffsets

    const newVertIndices = new Int32Array(extrudeCornerSize)
    const duplicateEdgeIndices = new Int32Array(extrudeCornerSize)
    faceSelection.forEach((f, s) => {
        const ex = groupStart[s]
        const start = fo[f], size = fo[f + 1] - fo[f]
        for (let i = 0; i < size; i++) {
            newVertIndices[ex + i] = cornerVerts[start + i]
            duplicateEdgeIndices[ex + i] = cornerEdges[start + i]
            cornerVerts[start + i] = newVertStart + ex + i
            cornerEdges[start + i] = duplicateStart + ex + i
        }
        for (let i = 0; i < size; i++) {
            const iNext = i === size - 1 ? 0 : i + 1
            const iEx = ex + i, iExNext = ex + iNext
            const newVert = newVertStart + iEx, newVertNext = newVertStart + iExNext
            const origEdge = duplicateEdgeIndices[iEx]
            const origVert = newVertIndices[iEx], origVertNext = newVertIndices[iExNext]
            edges[(duplicateStart + iEx) * 2] = newVert
            edges[(duplicateStart + iEx) * 2 + 1] = newVertNext
            const at = sideLoopStart + iEx * 4
            cornerVerts[at] = newVertNext
            cornerEdges[at] = duplicateStart + iEx
            cornerVerts[at + 1] = newVert
            cornerEdges[at + 1] = connectStart + iEx
            cornerVerts[at + 2] = origVert
            cornerEdges[at + 2] = origEdge
            cornerVerts[at + 3] = origVertNext
            cornerEdges[at + 3] = connectStart + iExNext
            edges[(connectStart + iEx) * 2] = origVert
            edges[(connectStart + iEx) * 2 + 1] = newVert
        }
    })

    for (const layer of names[AttrDomain.Point]) gatherInLayer(liveLayer(mesh, layer), newVertIndices, newVertStart)
    for (const layer of names[AttrDomain.Edge]) gatherInLayer(liveLayer(mesh, layer), duplicateEdgeIndices, duplicateStart)

    if (names[AttrDomain.Edge].length) {
        // Extruded edges mix the two neighbouring original edges of the face (:1347): `mix2(0.5f, ...)`, "or" for booleans.
        const neighbors = new Int32Array(extrudeCornerSize * 2)
        faceSelection.forEach((f, s) => {
            const ex = groupStart[s], size = fo[f + 1] - fo[f]
            for (let i = 0; i < size; i++) {
                const iPrev = i === 0 ? size - 1 : i - 1
                neighbors[(ex + i) * 2] = duplicateEdgeIndices[ex + i]
                neighbors[(ex + i) * 2 + 1] = duplicateEdgeIndices[ex + iPrev]
            }
        })
        for (const l of names[AttrDomain.Edge]) {
            const layer = liveLayer(mesh, l)
            const type = layer.type as DataType
            const data = layer.data
            for (let i = 0; i < extrudeCornerSize; i++) {
                const a = neighbors[i * 2], b = neighbors[i * 2 + 1]
                if (type === 'bool') data[connectStart + i] = data[a] || data[b] ? 1 : 0
                else mix2(type, 0.5, data, a, data, b, data, connectStart + i)
            }
        }
    }

    // Each side face gets the values of its extruded face (`gather_to_groups`, :1385).
    for (const l of names[AttrDomain.Face]) {
        const layer = liveLayer(mesh, l)
        const c = DATA_TYPES[layer.type as DataType].components
        faceSelection.forEach((f, s) => {
            for (let i = groupStart[s]; i < groupStart[s + 1]; i++) {
                for (let k = 0; k < c; k++) layer.data[(sideFaceStart + i) * c + k] = layer.data[f * c + k]
            }
        })
    }

    if (names[AttrDomain.Corner].length) {
        // :1393: the side face's corners take the matching corners of the extruded face.
        const origCorners = new Int32Array(extrudeCornerSize * 4)
        faceSelection.forEach((f, s) => {
            const ex = groupStart[s]
            const start = fo[f], end = fo[f + 1]
            for (let i = 0; i < end - start; i++) {
                const corner = start + i
                const next = corner === end - 1 ? start : corner + 1
                const side = (ex + i) * 4
                origCorners[side] = next
                origCorners[side + 1] = corner
                origCorners[side + 2] = corner
                origCorners[side + 3] = next
            }
        })
        for (const layer of names[AttrDomain.Corner]) gatherInLayer(liveLayer(mesh, layer), origCorners, sideLoopStart)
    }

    const positions = mesh.positions
    faceSelection.forEach((f, s) => {
        for (let i = groupStart[s]; i < groupStart[s + 1]; i++) addPos(positions, newVertStart + i, newVertIndices[i], faceOffset, f * 3)
    })

    if (outputs.topId) saveSelectionAsAttribute(mesh, outputs.topId, AttrDomain.Face, faceSelection)
    if (outputs.sideId) saveSelectionAsAttribute(mesh, outputs.sideId, AttrDomain.Face, range(sideFaceStart, extrudeCornerSize))
    tagMeshChanged(mesh)
}

// endregion

registerNodeType({
    idname: 'GeometryNodeExtrudeMesh',
    label: 'Extrude Mesh',
    // `node_init` (:78).
    properties: {mode: 'FACES'},
    // `node_rna` (:1535).
    enums: {mode: ['VERTICES', 'EDGES', 'FACES']},
    // `node_declare` (:38).
    declare(b, node) {
        b.input('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Offset').subtype('TRANSLATION').implicit('NORMAL').field()
        b.input('FLOAT', 'Offset Scale').default(1).field()
        b.input('BOOLEAN', 'Individual').default(true).available(node.prop<string>('mode') === 'FACES')
        b.output('GEOMETRY', 'Mesh')
        b.output('BOOLEAN', 'Top').field()
        b.output('BOOLEAN', 'Side').field()
    },
    // `node_geo_exec` (:1480).
    execute(p) {
        const mode = p.node.prop<string>('mode')
        const selection = p.field('Selection')
        // :1490: `float3 * float` of the offset and the scale.
        const finalOffset = new FieldOperation(lookupMultiFunction('float3 * float'), [p.field('Offset'), p.field('Offset Scale')]).output(0)
        const outputs: AttributeOutputs = {
            topId: p.outputUsed('Top') ? p.anonymousName('Top') : undefined,
            sideId: p.outputUsed('Side') ? p.anonymousName('Side') : undefined,
        }
        const individual = mode === 'FACES' && p.bool('Individual')
        const out = foreachRealGeometry(p.geometry('Mesh'), g => {
            if (!g.mesh) return
            const mesh = g.meshForWrite()!
            if (mode === 'VERTICES') extrudeMeshVertices(mesh, selection, finalOffset, outputs)
            else if (mode === 'EDGES') extrudeMeshEdges(mesh, selection, finalOffset, outputs)
            else if (individual) extrudeIndividualMeshFaces(mesh, selection, finalOffset, outputs)
            else extrudeMeshFaceRegions(mesh, selection, finalOffset, outputs)
        }, p.options.scene)
        p.set('Mesh', out)
        if (outputs.topId) p.set('Top', GField.fromInput(new AttributeFieldInput(outputs.topId, 'bool')))
        if (outputs.sideId) p.set('Side', GField.fromInput(new AttributeFieldInput(outputs.sideId, 'bool')))
    },
})
