/**
 * Joining meshes together and separating them apart.
 *
 * Ported from `source/blender/geometry/intern/join_geometries.cc` (`join_attributes`,
 * `fill_new_attribute`) for the join, and from Blender's "separate by loose parts" and "separate by
 * selection" for the split (`editmesh_tools.cc` `edbm_separate_exec`, which delegates to
 * `BM_mesh_separate_loose` and to a duplicate-then-delete over the selection).
 *
 * Both matter to kit-bashing. A vehicle assembled from sixty parts wants to be joined into a few
 * before it is exported; a part built as one mesh wants to be pulled apart when a piece of it turns
 * out to belong elsewhere. Blender puts them on `Ctrl+J` and `P` for that reason.
 *
 * The attribute rule is Blender's and is the part worth getting right: the result carries the
 * **union** of the inputs' attribute layers, and a mesh that lacks one contributes the type's
 * default for its elements rather than being skipped. That is `lookup_or_default` in
 * `fill_new_attribute`, and it is why joining a UV-mapped mesh to a bare one does not lose the UVs.
 */

import {AttrDomain, ATTR_TYPE_INFO, AttrName, AttrType} from '../constants'
import {MeshData} from '../MeshData'
import {Mat4, mat4TransformPoint, Vec3} from '../math'
import {AttributeLayer} from '../attributes'

export interface JoinInput {
    mesh: MeshData
    /** Applied to positions as the mesh is copied in, for joining objects in world space. */
    matrix?: Mat4
}

/** Domains in the order the concatenation walks them. */
const DOMAINS: {domain: AttrDomain, size: (m: MeshData) => number}[] = [
    {domain: AttrDomain.Point, size: m => m.vertsNum},
    {domain: AttrDomain.Edge, size: m => m.edgesNum},
    {domain: AttrDomain.Face, size: m => m.facesNum},
    {domain: AttrDomain.Corner, size: m => m.cornersNum},
]

/** Attributes the join rebuilds itself rather than copying, because their values are indices. */
const INDEX_ATTRS: string[] = [AttrName.edgeVerts, AttrName.cornerVert, AttrName.cornerEdge]

/**
 * Concatenate meshes into one, optionally transforming each as it goes.
 *
 * Nothing is welded: coincident vertices from two inputs stay distinct, exactly as Blender's join
 * does. Follow with a weld if that is what you want - keeping the two steps separate is what lets
 * you join first and decide the tolerance afterwards.
 */
export function joinMeshes(inputs: JoinInput[]): MeshData {
    if (!inputs.length) return new MeshData()
    if (inputs.length === 1 && !inputs[0].matrix) return inputs[0].mesh.clone()

    const out = new MeshData()
    const totals = {verts: 0, edges: 0, faces: 0, corners: 0}
    for (const {mesh} of inputs) {
        totals.verts += mesh.vertsNum
        totals.edges += mesh.edgesNum
        totals.faces += mesh.facesNum
        totals.corners += mesh.cornersNum
    }
    out.resize(totals)

    // The union of every input's layers. A built-in keeps its declared domain and type; a custom
    // layer that two inputs declare with different types is a real conflict - say so rather than
    // silently reinterpreting the bytes.
    const union = new Map<string, {domain: AttrDomain, type: AttrType}>()
    for (const {mesh} of inputs) {
        for (const layer of mesh.attributes.layers()) {
            if (INDEX_ATTRS.includes(layer.name) || layer.name === AttrName.position) continue
            const seen = union.get(layer.name)
            if (!seen) {
                union.set(layer.name, {domain: layer.domain, type: layer.type})
            } else if (seen.domain !== layer.domain || seen.type !== layer.type) {
                throw new Error(`mesh-kernel: cannot join, attribute '${layer.name}' is `
                    + `${seen.type} on one mesh and ${layer.type} on another`)
            }
        }
    }
    for (const [name, {domain, type}] of union) out.attributes.ensure(name, domain, type)

    const positions = out.positions
    const edgeVerts = out.edgeVerts
    const cornerVerts = out.cornerVerts
    const cornerEdges = out.cornerEdges
    const faceOffsets = out.faceOffsets

    const offset = {verts: 0, edges: 0, faces: 0, corners: 0}
    for (const {mesh, matrix} of inputs) {
        const srcPos = mesh.positions
        for (let v = 0; v < mesh.vertsNum; v++) {
            const p: Vec3 = [srcPos[v * 3], srcPos[v * 3 + 1], srcPos[v * 3 + 2]]
            const q = matrix ? mat4TransformPoint(matrix, p) : p
            const d = (offset.verts + v) * 3
            positions[d] = q[0]
            positions[d + 1] = q[1]
            positions[d + 2] = q[2]
        }

        const srcEdgeVerts = mesh.edgeVerts
        for (let e = 0; e < mesh.edgesNum; e++) {
            edgeVerts[(offset.edges + e) * 2] = srcEdgeVerts[e * 2] + offset.verts
            edgeVerts[(offset.edges + e) * 2 + 1] = srcEdgeVerts[e * 2 + 1] + offset.verts
        }

        const srcCornerVerts = mesh.cornerVerts
        const srcCornerEdges = mesh.cornerEdges
        for (let c = 0; c < mesh.cornersNum; c++) {
            cornerVerts[offset.corners + c] = srcCornerVerts[c] + offset.verts
            const e = srcCornerEdges[c]
            cornerEdges[offset.corners + c] = e < 0 ? e : e + offset.edges
        }

        for (let f = 0; f < mesh.facesNum; f++) {
            faceOffsets[offset.faces + f] = mesh.faceOffsets[f] + offset.corners
        }

        // Every other layer, defaulting where this input does not have it - `lookup_or_default`.
        for (const [name, {domain, type}] of union) {
            const src = mesh.attributes.get(name)
            if (!src) continue
            const dst = out.attributes.require(name, domain, type)
            const components = ATTR_TYPE_INFO[type].components
            const count = DOMAINS.find(d => d.domain === domain)!.size(mesh)
            const base = domainOffset(offset, domain) * components
            for (let i = 0; i < count * components; i++) dst.data[base + i] = src.data[i]
        }

        offset.verts += mesh.vertsNum
        offset.edges += mesh.edgesNum
        offset.faces += mesh.facesNum
        offset.corners += mesh.cornersNum
    }
    faceOffsets[totals.faces] = totals.corners

    // Material slots concatenate, and `material_index` is remapped to match - otherwise a joined
    // part silently takes the other part's materials.
    remapMaterials(out, inputs)
    return out
}

function domainOffset(offset: {verts: number, edges: number, faces: number, corners: number},
    domain: AttrDomain): number {
    return domain === AttrDomain.Point ? offset.verts
        : domain === AttrDomain.Edge ? offset.edges
            : domain === AttrDomain.Face ? offset.faces : offset.corners
}

function remapMaterials(out: MeshData, inputs: JoinInput[]): void {
    const slots: string[] = []
    const bases: number[] = []
    for (const {mesh} of inputs) {
        bases.push(slots.length)
        for (const name of mesh.materials) {
            const existing = slots.indexOf(name)
            if (existing < 0) slots.push(name)
        }
    }
    out.materials = slots
    if (slots.length < 2) return

    const layer = out.attributes.get(AttrName.materialIndex)
    if (!layer) return
    const data = layer.data as Int32Array
    let faceOffset = 0
    for (let i = 0; i < inputs.length; i++) {
        const {mesh} = inputs[i]
        for (let f = 0; f < mesh.facesNum; f++) {
            const local = data[faceOffset + f]
            const name = mesh.materials[local]
            data[faceOffset + f] = name === undefined ? local + bases[i] : slots.indexOf(name)
        }
        faceOffset += mesh.facesNum
    }
}

/**
 * Split a mesh into its connected components.
 *
 * Blender's `BM_mesh_separate_loose`. Connectivity follows edges *and* face corners, so a face whose
 * edges were never derived still holds its vertices together. Loose vertices come out as
 * single-vertex meshes rather than being dropped, which is what makes the operation reversible by a
 * join.
 */
export function separateLooseParts(mesh: MeshData): MeshData[] {
    const parent = new Int32Array(mesh.vertsNum)
    for (let i = 0; i < parent.length; i++) parent[i] = i

    const find = (i: number): number => {
        let root = i
        while (parent[root] !== root) root = parent[root]
        while (parent[i] !== root) {
            const next = parent[i]
            parent[i] = root
            i = next
        }
        return root
    }
    const union = (a: number, b: number) => {
        const ra = find(a)
        const rb = find(b)
        if (ra !== rb) parent[rb] = ra
    }

    const edgeVerts = mesh.edgeVerts
    for (let e = 0; e < mesh.edgesNum; e++) union(edgeVerts[e * 2], edgeVerts[e * 2 + 1])

    const cornerVerts = mesh.cornerVerts
    for (let f = 0; f < mesh.facesNum; f++) {
        const start = mesh.faceOffsets[f]
        const end = mesh.faceOffsets[f + 1]
        for (let c = start + 1; c < end; c++) union(cornerVerts[start], cornerVerts[c])
    }

    const groups = new Map<number, number>()
    for (let v = 0; v < mesh.vertsNum; v++) {
        const root = find(v)
        if (!groups.has(root)) groups.set(root, groups.size)
    }
    if (groups.size <= 1) return [mesh.clone()]

    const faceGroup = new Int32Array(mesh.facesNum)
    for (let f = 0; f < mesh.facesNum; f++) {
        faceGroup[f] = groups.get(find(cornerVerts[mesh.faceOffsets[f]]))!
    }

    const parts: MeshData[] = []
    for (let g = 0; g < groups.size; g++) {
        const verts: number[] = []
        for (let v = 0; v < mesh.vertsNum; v++) if (groups.get(find(v)) === g) verts.push(v)
        const faces: number[] = []
        for (let f = 0; f < mesh.facesNum; f++) if (faceGroup[f] === g) faces.push(f)
        parts.push(extractSubset(mesh, verts, faces))
    }
    return parts
}

/**
 * Pull the named faces out into a mesh of their own, and return what is left behind.
 *
 * Blender's `P > Selection`: the selection becomes a new object and is deleted from the original,
 * with vertices left unused cleaned up. Vertices shared with faces that stay behind exist in both
 * results, which is what makes the seam visible afterwards - the same as Blender.
 */
export function separateFaces(
    mesh: MeshData, faceIndices: Iterable<number>,
): {separated: MeshData, remaining: MeshData} {
    const taken = new Set<number>()
    for (const f of faceIndices) {
        if (!Number.isInteger(f) || f < 0 || f >= mesh.facesNum) {
            throw new Error(`mesh-kernel: face ${f} is out of range, the mesh has ${mesh.facesNum}`)
        }
        taken.add(f)
    }
    const kept: number[] = []
    for (let f = 0; f < mesh.facesNum; f++) if (!taken.has(f)) kept.push(f)

    return {
        separated: extractSubset(mesh, vertsOfFaces(mesh, [...taken]), [...taken]),
        remaining: extractSubset(mesh, vertsOfFaces(mesh, kept), kept),
    }
}

function vertsOfFaces(mesh: MeshData, faces: number[]): number[] {
    const used = new Set<number>()
    const cornerVerts = mesh.cornerVerts
    for (const f of faces) {
        for (let c = mesh.faceOffsets[f]; c < mesh.faceOffsets[f + 1]; c++) used.add(cornerVerts[c])
    }
    return [...used].sort((a, b) => a - b)
}

/**
 * Build a mesh from a subset of another's vertices and faces, carrying every attribute layer.
 *
 * Edges are re-derived rather than remapped: an edge subset taken from a face subset is exactly what
 * `calculateEdges` produces, and re-deriving avoids carrying an edge that now joins nothing. Edge
 * attributes are therefore not preserved - the same caveat `MeshData.calculateEdges` documents.
 */
export function extractSubset(mesh: MeshData, verts: number[], faces: number[]): MeshData {
    const out = new MeshData()
    const vertMap = new Map<number, number>()
    for (const v of verts) vertMap.set(v, vertMap.size)

    let corners = 0
    for (const f of faces) corners += mesh.faceOffsets[f + 1] - mesh.faceOffsets[f]
    out.resize({verts: verts.length, faces: faces.length, corners})

    const srcPos = mesh.positions
    const dstPos = out.positions
    for (const [src, dst] of vertMap) {
        dstPos[dst * 3] = srcPos[src * 3]
        dstPos[dst * 3 + 1] = srcPos[src * 3 + 1]
        dstPos[dst * 3 + 2] = srcPos[src * 3 + 2]
    }

    const srcCornerVerts = mesh.cornerVerts
    const dstCornerVerts = out.cornerVerts
    const cornerMap: number[] = []
    let corner = 0
    for (let i = 0; i < faces.length; i++) {
        const f = faces[i]
        out.faceOffsets[i] = corner
        for (let c = mesh.faceOffsets[f]; c < mesh.faceOffsets[f + 1]; c++) {
            cornerMap[corner] = c
            dstCornerVerts[corner++] = vertMap.get(srcCornerVerts[c])!
        }
    }
    out.faceOffsets[faces.length] = corner

    copyLayers(mesh, out, AttrDomain.Point, verts)
    copyLayers(mesh, out, AttrDomain.Face, faces)
    copyLayers(mesh, out, AttrDomain.Corner, cornerMap)

    out.materials = [...mesh.materials]
    out.calculateEdges()
    return out
}

/** Copy one domain's non-index layers through an index map. */
function copyLayers(src: MeshData, dst: MeshData, domain: AttrDomain, indices: number[]): void {
    for (const layer of src.attributes.layersOnDomain(domain) as AttributeLayer[]) {
        if (INDEX_ATTRS.includes(layer.name) || layer.name === AttrName.position) continue
        const target = dst.attributes.ensure(layer.name, layer.domain, layer.type)
        const components = ATTR_TYPE_INFO[layer.type].components
        for (let i = 0; i < indices.length; i++) {
            for (let k = 0; k < components; k++) {
                target.data[i * components + k] = layer.data[indices[i] * components + k]
            }
        }
    }
}
