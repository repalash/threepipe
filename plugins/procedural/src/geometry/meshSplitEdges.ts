/**
 * `geometry::split_edges` (`geometry/intern/mesh_split_edges.cc`), in place on a mesh: every selected edge is
 * duplicated per connected face fan, vertices are duplicated per group of corners still connected through
 * unselected edges, and the original elements are reused first, exactly as Blender numbers them.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {buildVertToCornerMap, buildVertToEdgeMap, gatherInLayer, tagMeshChanged} from './meshEditUtils'
import {cornerToFaceMap, GroupedIndices, looseEdges} from './meshTopology'

const groupOf = (g: GroupedIndices, i: number) => g.indices.subarray(g.offsets[i], g.offsets[i + 1])

/** `face_corner_next` / `face_corner_prev`. */
const cornerNext = (fo: Int32Array, face: number, corner: number) => (corner === fo[face + 1] - 1 ? fo[face] : corner + 1)
const cornerPrev = (fo: Int32Array, face: number, corner: number) => (corner === fo[face] ? fo[face + 1] - 1 : corner - 1)

/** `corner_on_edge_connected_to_vert` (:126). */
function cornerOnEdgeConnectedToVert(cornerVerts: Int32Array, fo: Int32Array, corner: number, face: number, vert: number): number {
    if (cornerVerts[corner] === vert) return corner
    return cornerNext(fo, face, corner)
}

/** `calc_corner_groups_for_vertex` (:148): corners around `vert` connected across unselected edges. */
function cornerGroupsForVertex(
    fo: Int32Array, cornerVerts: Int32Array, cornerEdges: Int32Array, edgeToCorner: GroupedIndices, cornerToFace: Int32Array,
    splitEdges: Uint8Array, connected: Int32Array, vert: number,
): number[][] {
    const groups: number[][] = []
    const used = new Uint8Array(connected.length)
    for (const start of connected) {
        const group: number[] = []
        const stack = [start]
        while (stack.length) {
            const corner = stack.pop()!
            const i = connected.indexOf(corner)
            if (used[i]) continue
            used[i] = 1
            group.push(corner)
            const face = cornerToFace[corner]
            const prev = cornerPrev(fo, face, corner)
            for (const edge of [cornerEdges[corner], cornerEdges[prev]]) {
                if (splitEdges[edge]) continue
                for (const other of groupOf(edgeToCorner, edge)) {
                    const otherFace = cornerToFace[other]
                    if (otherFace === face) continue
                    stack.push(cornerOnEdgeConnectedToVert(cornerVerts, fo, other, otherFace, vert))
                }
            }
        }
        if (group.length) groups.push(group)
    }
    return groups
}

/** `calc_vert_loose_edges` (:244). */
function vertLooseEdges(vertToEdge: GroupedIndices, loose: Uint8Array, split: Uint8Array, vert: number): {selected: number[], unselected: number[]} {
    const info = {selected: [] as number[], unselected: [] as number[]}
    for (const e of groupOf(vertToEdge, vert)) {
        if (!loose[e]) continue
        if (split[e]) info.selected.push(e)
        else info.unselected.push(e)
    }
    return info
}

/** `OrderedEdge` of the corner's edge (`edge_from_corner` :343). */
function edgeFromCorner(fo: Int32Array, cornerVerts: Int32Array, cornerToFace: Int32Array, corner: number): [number, number] {
    const a = cornerVerts[corner], b = cornerVerts[cornerNext(fo, cornerToFace[corner], corner)]
    return a < b ? [a, b] : [b, a]
}

/** `split_edges` (:552). `selectedEdges` ascending. */
export function splitEdges(mesh: MeshData, selectedEdges: number[]): void {
    const origVertsNum = mesh.vertsNum
    const origEdges = mesh.edgeVerts
    const origEdgesNum = mesh.edgesNum
    const fo = mesh.faceOffsets
    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges

    const split = new Uint8Array(origEdgesNum)
    for (const e of selectedEdges) split[e] = 1
    // `vert_selection_from_edge`.
    const vsel = new Uint8Array(origVertsNum)
    for (const e of selectedEdges) vsel[origEdges[e * 2]] = vsel[origEdges[e * 2 + 1]] = 1
    const affected: number[] = []
    for (let v = 0; v < origVertsNum; v++) if (vsel[v]) affected.push(v)
    const looseInfo = looseEdges(mesh)
    const hasLoose = looseInfo.count > 0
    const loose = looseInfo.mask

    const vertToCorner = buildVertToCornerMap(cornerVerts, origVertsNum)
    // `build_edge_to_corner_map` (`mesh_mapping.cc:357`).
    const edgeToCorner = buildVertToCornerMap(cornerEdges, origEdgesNum)
    const vertToEdge = hasLoose ? buildVertToEdgeMap(origEdges, origVertsNum) : undefined
    const cornerToFace = cornerToFaceMap(mesh)

    const cornerGroups = affected.map(v =>
        cornerGroupsForVertex(fo, cornerVerts, cornerEdges, edgeToCorner, cornerToFace, split, groupOf(vertToCorner, v), v))

    // `calc_vert_ranges_per_old_vert` (:274): the original vertex is reused for one group.
    const newVertOffsets = new Int32Array(affected.length + 1)
    affected.forEach((v, i) => {
        let num = -1 + cornerGroups[i].length
        if (hasLoose) {
            const info = vertLooseEdges(vertToEdge!, loose, split, v)
            num += info.selected.length
            if (!cornerGroups[i].length) num += info.unselected.length > 0 ? 1 : 0
        }
        newVertOffsets[i + 1] = newVertOffsets[i] + num
    })

    // `update_corner_verts` (:318): every group but the last gets a new vertex.
    affected.forEach((_, i) => {
        const groups = cornerGroups[i]
        for (let g = 0; g < groups.length - 1; g++) {
            const newVert = origVertsNum + newVertOffsets[i] + g
            for (const c of groups[g]) cornerVerts[c] = newVert
        }
    })

    // `calc_new_edges` (:360).
    const edges = origEdges
    const counts = selectedEdges.map(e => Math.max(edgeToCorner.offsets[e + 1] - edgeToCorner.offsets[e] - 1, 0))
    const offsets = [0]
    for (const c of counts) offsets.push(offsets[offsets.length - 1] + c)
    const newEdges: [number, number][] = new Array(offsets[offsets.length - 1])
    const mergedCounts = new Array<number>(selectedEdges.length).fill(0)
    let foundDuplicate = false
    const isReused = new Uint8Array(cornerVerts.length)
    selectedEdges.forEach((edge, mask) => {
        const corners = groupOf(edgeToCorner, edge)
        if (!corners.length) return
        const start = offsets[mask]
        const dedup: [number, number][] = []
        for (const corner of corners) {
            const e = edgeFromCorner(fo, cornerVerts, cornerToFace, corner)
            let index = dedup.findIndex(d => d[0] === e[0] && d[1] === e[1])
            if (index !== -1) foundDuplicate = true
            else index = dedup.push(e) - 1
            if (index === 0) isReused[corner] = 1
            else cornerEdges[corner] = origEdgesNum + start + index - 1
        }
        edges[edge * 2] = dedup[0][0]
        edges[edge * 2 + 1] = dedup[0][1]
        for (let k = 1; k < dedup.length; k++) newEdges[start + k - 1] = dedup[k]
        mergedCounts[mask] = dedup.length - 1
    })
    let finalNewEdges = newEdges
    let finalCounts = counts
    if (foundDuplicate) {
        // Remove the holes left by merged duplicates (:425).
        const merged = [0]
        for (const c of mergedCounts) merged.push(merged[merged.length - 1] + c)
        selectedEdges.forEach((edge, mask) => {
            const diff = offsets[mask] - merged[mask]
            for (const corner of groupOf(edgeToCorner, edge)) if (!isReused[corner]) cornerEdges[corner] -= diff
        })
        finalNewEdges = []
        selectedEdges.forEach((_, i) => {
            for (let k = 0; k < mergedCounts[i]; k++) finalNewEdges.push(newEdges[offsets[i] + k])
        })
        finalCounts = mergedCounts
    }

    // `update_unselected_edges` (:452): edges with corners take their first corner's ordered vertices.
    for (let edge = 0; edge < origEdgesNum; edge++) {
        if (split[edge]) continue
        const corners = groupOf(edgeToCorner, edge)
        if (!corners.length) continue
        const e = edgeFromCorner(fo, cornerVerts, cornerToFace, corners[0])
        edges[edge * 2] = e[0]
        edges[edge * 2 + 1] = e[1]
    }

    // `reassign_loose_edge_verts` (:483).
    if (hasLoose) {
        const swap = (e: number, oldVert: number, newVert: number) => {
            if (edges[e * 2] === oldVert) edges[e * 2] = newVert
            else if (edges[e * 2 + 1] === oldVert) edges[e * 2 + 1] = newVert
        }
        affected.forEach((vert, mask) => {
            const size = newVertOffsets[mask + 1] - newVertOffsets[mask]
            let i = Math.max(cornerGroups[mask].length - 1, 0)
            if (i === size) return
            const info = vertLooseEdges(vertToEdge!, loose, split, vert)
            for (const e of info.selected) {
                swap(e, vert, origVertsNum + newVertOffsets[mask] + i)
                i++
                if (i === size) return
            }
            const newVert = origVertsNum + newVertOffsets[mask] + i
            for (const e of info.unselected) swap(e, vert, newVert)
        })
    }

    // `offsets_to_map` (:528) + `propagate_edge_attributes` (:84).
    const edgeMap: number[] = []
    selectedEdges.forEach((e, i) => { for (let k = 0; k < finalCounts[i]; k++) edgeMap.push(e) })
    mesh.resizeDomain(AttrDomain.Edge, origEdgesNum + edgeMap.length)
    for (const layer of mesh.attributes.layersOnDomain(AttrDomain.Edge)) {
        if (layer.name === '.edge_verts') continue
        gatherInLayer(layer, edgeMap, origEdgesNum)
    }
    const ev = mesh.edgeVerts
    finalNewEdges.forEach((e, i) => {
        ev[(origEdgesNum + i) * 2] = e[0]
        ev[(origEdgesNum + i) * 2 + 1] = e[1]
    })

    // `propagate_vert_attributes` (:26).
    const vertMap: number[] = []
    affected.forEach((v, i) => { for (let k = newVertOffsets[i]; k < newVertOffsets[i + 1]; k++) vertMap.push(v) })
    mesh.resizeDomain(AttrDomain.Point, origVertsNum + vertMap.length)
    for (const layer of mesh.attributes.layersOnDomain(AttrDomain.Point)) gatherInLayer(layer, vertMap, origVertsNum)
    tagMeshChanged(mesh)
}
