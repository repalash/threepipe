/**
 * Dual Mesh (`node_geo_dual_mesh.cc`): faces become vertices (at their centers) and manifold vertices become faces
 * (the surrounding faces in order); with Keep Boundaries, boundary vertices become faces closed through the
 * boundary edges' midpoints and the vertex itself.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {faceCenterCalc} from '../../geometry/meshEvaluate'
import {meshSmoothSet, newMesh} from '../../geometry/meshPrimitives'
import {vertToFaceMap} from '../../geometry/meshTopology'
import {registerNodeType} from '../../runtime/registry'

// `EdgeType` (:30) and `VertexType` (:50).
const E_LOOSE = 0, E_BOUNDARY = 1, E_NORMAL = 2, E_NON_MANIFOLD = 3
const V_LOOSE = 0, V_NORMAL = 1, V_BOUNDARY = 2, V_NON_MANIFOLD = 3

/** `calc_boundaries` (:218). */
function calcBoundaries(mesh: MeshData, vt: Int8Array, et: Int8Array): void {
    const ev = mesh.edgeVerts, ce = mesh.cornerEdges, fo = mesh.faceOffsets
    for (let f = 0; f < mesh.facesNum; f++) {
        // `get_edge_type_with_added_neighbor` (:37).
        for (let c = fo[f]; c < fo[f + 1]; c++) et[ce[c]] = Math.min(et[ce[c]] + 1, E_NON_MANIFOLD)
    }
    for (let e = 0; e < mesh.edgesNum; e++) {
        const t = et[e]
        if (t === E_LOOSE) continue
        if (t === E_BOUNDARY) {
            // `get_vertex_type_with_added_neighbor` (:57).
            for (const v of [ev[e * 2], ev[e * 2 + 1]]) vt[v] = Math.min(vt[v] + 1, V_NON_MANIFOLD)
        } else if (t >= E_NON_MANIFOLD) {
            vt[ev[e * 2]] = vt[ev[e * 2 + 1]] = V_NON_MANIFOLD
        }
    }
    for (let e = 0; e < mesh.edgesNum; e++) {
        if (et[e] !== E_NORMAL) continue
        for (const v of [ev[e * 2], ev[e * 2 + 1]]) if (vt[v] === V_LOOSE) vt[v] = V_NORMAL
    }
}

const touches = (ev: Int32Array, e: number, v: number) => ev[e * 2] === v || ev[e * 2 + 1] === v

/**
 * `sort_vertex_faces` (:296): `faces` (the vertex's faces, sorted in place) in adjacency order; fills the shared edges
 * and the vertex's corner in each face. False when the faces do not form a fan.
 */
function sortVertexFaces(mesh: MeshData, vertex: number, boundary: boolean, et: Int8Array, faces: Int32Array, sharedEdges: Int32Array,
    sortedCorners: Int32Array): boolean {
    const ev = mesh.edgeVerts, cv = mesh.cornerVerts, ce = mesh.cornerEdges, fo = mesh.faceOffsets
    const n = faces.length
    if (n <= 2 && (!boundary || n === 0)) return true
    const fc: [number, number][] = []
    for (let i = 0; i < n; i++) {
        const pair: [number, number] = [0, 0]
        let first = false
        for (let c = fo[faces[i]]; c < fo[faces[i] + 1]; c++) {
            if (!touches(ev, ce[c], vertex)) continue
            if (!first) {
                pair[0] = c
                first = true
            } else {
                pair[1] = c
                break
            }
        }
        fc.push(pair)
    }
    const swap = (a: number, b: number) => {
        [faces[a], faces[b]] = [faces[b], faces[a]]
        ;[fc[a], fc[b]] = [fc[b], fc[a]]
    }
    let shared = -1
    if (boundary) {
        for (const strict of [true, false]) {
            for (let i = 0; i < n; i++) {
                const [c1, c2] = fc[i]
                if (et[ce[c1]] === E_BOUNDARY && (!strict || cv[c1] === vertex)) {
                    shared = ce[c2]
                    sortedCorners[0] = fc[i][0]
                    swap(i, 0)
                    break
                }
                if (et[ce[c2]] === E_BOUNDARY && (!strict || cv[c2] === vertex)) {
                    shared = ce[c1]
                    sortedCorners[0] = fc[i][1]
                    swap(i, 0)
                    break
                }
            }
            if (shared !== -1) break
        }
    } else {
        const [c1, c2] = fc[0]
        if (cv[c1] === vertex) {
            shared = ce[c2]
            sortedCorners[0] = fc[0][0]
        } else {
            sortedCorners[0] = fc[0][1]
            shared = ce[c1]
        }
    }
    for (let i = 0; i < n - 1; i++) {
        sharedEdges[i] = shared
        let j = i + 1
        for (; j < n; j++) {
            const [c1, c2] = fc[j]
            if (ce[c1] === shared) {
                sortedCorners[i + 1] = fc[j][0]
                shared = ce[c2]
                break
            }
            if (ce[c2] === shared) {
                sortedCorners[i + 1] = fc[j][1]
                shared = ce[c1]
                break
            }
        }
        if (j === n) return false
        swap(i + 1, j)
    }
    if (!boundary) sharedEdges[sharedEdges.length - 1] = shared
    return true
}

/** `boundary_edge_on_face` (:415). */
function boundaryEdgeOnFace(mesh: MeshData, face: number, vertex: number, et: Int8Array): number | undefined {
    const ce = mesh.cornerEdges, fo = mesh.faceOffsets
    for (let c = fo[face]; c < fo[face + 1]; c++) if (et[ce[c]] === E_BOUNDARY && touches(mesh.edgeVerts, ce[c], vertex)) return ce[c]
    return undefined
}

/** `boundary_edges_on_face` (:432). */
function boundaryEdgesOnFace(mesh: MeshData, face: number, vertex: number, et: Int8Array): [number | undefined, number | undefined] {
    const ce = mesh.cornerEdges, cv = mesh.cornerVerts, fo = mesh.faceOffsets
    let e1: number | undefined, e2: number | undefined
    let done1 = false, needsSwap = false
    for (let c = fo[face]; c < fo[face + 1]; c++) {
        const e = ce[c]
        if (et[e] !== E_BOUNDARY || !touches(mesh.edgeVerts, e, vertex)) continue
        if (done1) {
            if (needsSwap) {
                e2 = e1
                e1 = e
            } else {
                e2 = e
            }
            return [e1, e2]
        }
        e1 = e
        done1 = true
        if (cv[c] === vertex) needsSwap = true
    }
    return [e1, e2]
}

/** `calc_dual_mesh` (:577). */
function calcDualMesh(src: MeshData, keepBoundaries: boolean): MeshData {
    const pos = src.attributes.get('position')!.data as Float32Array
    const ev = src.edgeVerts, fo = src.faceOffsets, cv = src.cornerVerts, ce = src.cornerEdges
    const vt = new Int8Array(src.vertsNum), et = new Int8Array(src.edgesNum)
    calcBoundaries(src, vt, et)
    // `vert_to_face_map()` copied: sorted per vertex below.
    const map = vertToFaceMap(src)
    const vOff = map.offsets, vFaces = map.indices.slice()
    const facesOf = (v: number) => vFaces.subarray(vOff[v], vOff[v + 1])
    const sharedEdgesOf: Int32Array[] = new Array(src.vertsNum)
    const cornersOf: Int32Array[] = new Array(src.vertsNum)
    const bad = (v: number) => vt[v] === V_LOOSE || vt[v] >= V_NON_MANIFOLD || (!keepBoundaries && vt[v] === V_BOUNDARY)
    for (let v = 0; v < src.vertsNum; v++) {
        if (bad(v)) continue
        const faces = facesOf(v)
        const sorted = new Int32Array(faces.length)
        const normal = vt[v] === V_NORMAL
        const shared = new Int32Array(normal ? faces.length : faces.length - 1)
        const ok = sortVertexFaces(src, v, !normal, et, faces, shared, sorted)
        sharedEdgesOf[v] = shared
        if (!ok) {
            vt[v] = V_NON_MANIFOLD
            continue
        }
        cornersOf[v] = sorted
    }

    const positions: number[] = []
    for (let f = 0; f < src.facesNum; f++) positions.push(...faceCenterCalc(pos, cv, fo[f], fo[f + 1]))
    let midpointIndex: Int32Array | undefined
    if (keepBoundaries) {
        midpointIndex = new Int32Array(src.edgesNum)
        for (let e = 0; e < src.edgesNum; e++) {
            if (et[e] !== E_BOUNDARY) continue
            const a = ev[e * 2] * 3, b = ev[e * 2 + 1] * 3
            midpointIndex[e] = positions.length / 3
            // `math::midpoint`: `(a + b) * 0.5`.
            for (let k = 0; k < 3; k++) positions.push(f32(f32(pos[a + k] + pos[b + k]) * 0.5))
        }
    }

    const faceSizes: number[] = [], cornerVerts: number[] = [], cornerEdges: number[] = []
    const newEdges: number[] = [], newToOldEdges: number[] = [], newToOldCorners: number[] = []
    const boundaryVertFace: [number, number][] = []
    const oldToNewEdges = new Int32Array(src.edgesNum).fill(-1)

    // `dissolve_redundant_verts` (:534).
    const needsDissolving = (v: number, f1: number, f2: number) => {
        const fs = facesOf(v)
        return vt[v] !== V_BOUNDARY && fs.length === 2 && fs[0] === f1 && fs[1] === f2
    }
    for (let v = 0; v < src.vertsNum; v++) {
        const fs = facesOf(v)
        if (fs.length !== 2 || vt[v] !== V_NORMAL) continue
        const f1 = fs[0], f2 = fs[1]
        const newEdge = newEdges.length / 2
        let created = false
        for (let c = fo[f1]; c < fo[f1 + 1]; c++) {
            const e = ce[c]
            let mark = false
            for (const end of [ev[e * 2], ev[e * 2 + 1]]) {
                if (needsDissolving(end, f1, f2)) {
                    vt[end] = V_LOOSE
                    mark = true
                }
            }
            if (!mark) continue
            if (!created) {
                newToOldEdges.push(e)
                newEdges.push(f1, f2)
                created = true
            }
            oldToNewEdges[e] = newEdge
        }
    }

    const addEdge = (old: number, a: number, b: number) => {
        newToOldEdges.push(old)
        cornerEdges.push(newEdges.length / 2)
        newEdges.push(a, b)
    }
    for (let v = 0; v < src.vertsNum; v++) {
        if (bad(v)) continue
        const loop = Array.from(facesOf(v))
        const shared = sharedEdgesOf[v], sorted = cornersOf[v]
        if (vt[v] === V_NORMAL) {
            if (loop.length <= 2) continue
            shared.forEach((old, i) => {
                if (oldToNewEdges[old] === -1) {
                    newToOldEdges.push(old)
                    oldToNewEdges[old] = newEdges.length / 2
                    newEdges.push(loop[i], loop[(i + 1) % loop.length])
                }
                cornerEdges.push(oldToNewEdges[old])
            })
            newToOldCorners.push(...sorted)
        } else {
            shared.forEach((old, i) => {
                if (oldToNewEdges[old] === -1) {
                    newToOldEdges.push(old)
                    oldToNewEdges[old] = newEdges.length / 2
                    newEdges.push(loop[i], loop[i + 1])
                }
                cornerEdges.push(oldToNewEdges[old])
            })
            newToOldCorners.push(...sorted)
            let e1: number | undefined, e2: number | undefined
            if (loop.length >= 2) {
                e1 = boundaryEdgeOnFace(src, loop[loop.length - 1], v, et)
                e2 = boundaryEdgeOnFace(src, loop[0], v, et)
            } else {
                [e1, e2] = boundaryEdgesOnFace(src, loop[0], v, et)
            }
            // Blender reads these uninitialised `int`s when no boundary edge is found; a boundary vertex always has two.
            if (e1 === undefined || e2 === undefined) throw new Error('procedural: Dual Mesh: boundary vertex without two boundary edges')
            const lastCenter = loop[loop.length - 1]
            loop.push(midpointIndex![e1])
            newToOldCorners.push(sorted[sorted.length - 1])
            const firstMid = loop[loop.length - 1]
            if (oldToNewEdges[e1] === -1) {
                addEdge(e1, lastCenter, firstMid)
                oldToNewEdges[e1] = newEdges.length / 2 - 1
                boundaryVertFace.push([firstMid, lastCenter])
            } else {
                cornerEdges.push(oldToNewEdges[e1])
            }
            loop.push(positions.length / 3)
            newToOldCorners.push(sorted[0])
            boundaryVertFace.push([loop[loop.length - 1], lastCenter])
            positions.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
            const boundaryVertex = loop[loop.length - 1]
            addEdge(e1, firstMid, boundaryVertex)
            loop.push(midpointIndex![e2])
            newToOldCorners.push(sorted[0])
            const secondMid = loop[loop.length - 1]
            addEdge(e2, boundaryVertex, secondMid)
            if (oldToNewEdges[e2] === -1) {
                addEdge(e2, secondMid, loop[0])
                oldToNewEdges[e2] = newEdges.length / 2 - 1
                boundaryVertFace.push([secondMid, loop[0]])
            } else {
                cornerEdges.push(oldToNewEdges[e2])
            }
        }
        faceSizes.push(loop.length)
        cornerVerts.push(...loop)
    }

    const dst = newMesh(positions.length / 3, newEdges.length / 2, faceSizes.length, cornerVerts.length)
    meshSmoothSet(dst, false)
    // Keys are distinct vertices, so the (unstable) sort is deterministic.
    boundaryVertFace.sort((a, b) => a[0] - b[0])
    transferAttributes(src, dst, vt, keepBoundaries, newToOldEdges, newToOldCorners, boundaryVertFace)
    dst.attributes.get('position')!.data.set(positions)
    dst.edgeVerts.set(newEdges)
    let o = 0
    faceSizes.forEach((s, i) => {
        dst.faceOffsets[i] = o
        o += s
    })
    dst.faceOffsets[faceSizes.length] = o
    dst.cornerVerts.set(cornerVerts)
    dst.cornerEdges.set(cornerEdges)
    return dst
}

/**
 * `transfer_attributes` (:100). Blender adds attributes whose storage is a single value (`CommonVArrayInfo::Single`)
 * with that value everywhere; layers here are always arrays, so they take the gather path, which gives the same
 * values except on boundary-edge midpoints no kept vertex references (both edge ends non-manifold), left at zero.
 */
function transferAttributes(src: MeshData, dst: MeshData, vt: Int8Array, keepBoundaries: boolean, newToOldEdges: number[],
    newToOldCorners: number[], boundaryVertFace: [number, number][]): void {
    const skip = new Set(['position', '.edge_verts', '.corner_vert', '.corner_edge', 'sharp_face'])
    let faceToOldVert: Int32Array | undefined
    const vertMap = () => {
        if (faceToOldVert) return faceToOldVert
        // `ensure_vert_map`: the vertices that became faces, in order (sized to the dual's faces).
        faceToOldVert = new Int32Array(dst.facesNum)
        let out = 0
        for (let v = 0; v < src.vertsNum && out < dst.facesNum; v++) {
            if (vt[v] === V_NORMAL || (keepBoundaries && vt[v] === V_BOUNDARY)) faceToOldVert[out++] = v
        }
        return faceToOldVert
    }
    for (const layer of src.attributes.layers()) {
        if (skip.has(layer.name)) continue
        const outDomain = layer.domain === AttrDomain.Face ? AttrDomain.Point : layer.domain === AttrDomain.Point ? AttrDomain.Face : layer.domain
        if (outDomain !== AttrDomain.Point && outDomain !== AttrDomain.Face && outDomain !== AttrDomain.Edge && outDomain !== AttrDomain.Corner) continue
        const type = layer.type as DataType, c = DATA_TYPES[type].components
        const existing = dst.attributes.get(layer.name)
        if (existing && (existing.domain !== outDomain || existing.type !== type)) continue
        const out = (existing ?? dst.attributes.add({name: layer.name, domain: outDomain, type})).data
        const gather = (map: ArrayLike<number>, at = (i: number) => i) => {
            for (let i = 0; i < map.length; i++) for (let k = 0; k < c; k++) out[at(i) * c + k] = layer.data[map[i] * c + k]
        }
        if (layer.domain === AttrDomain.Point) gather(vertMap())
        else if (layer.domain === AttrDomain.Edge) gather(newToOldEdges)
        else if (layer.domain === AttrDomain.Corner) gather(newToOldCorners)
        else {
            out.set(layer.data.subarray(0, Math.min(layer.data.length, out.length)))
            if (keepBoundaries) gather(boundaryVertFace.map(p => p[1]), i => boundaryVertFace[i][0])
        }
    }
}

registerNodeType({
    idname: 'GeometryNodeDualMesh',
    label: 'Dual Mesh',
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.output('GEOMETRY', 'Dual Mesh')
        b.input('BOOLEAN', 'Keep Boundaries').default(false)
    },
    execute(p) {
        const keep = p.bool('Keep Boundaries')
        p.set('Dual Mesh', foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.mesh
            if (mesh) g.setMesh(calcDualMesh(mesh, keep))
        }, p.options.scene))
    },
})
