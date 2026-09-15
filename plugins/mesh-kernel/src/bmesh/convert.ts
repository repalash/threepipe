/**
 * Conversion between {@link MeshData} (arrays) and {@link BMesh} (linked topology).
 *
 * Ports `BM_mesh_bm_from_me` and `BM_mesh_bm_to_me` from
 * `source/blender/bmesh/intern/bmesh_mesh_convert.cc`. This pair is the bridge Blender crosses on
 * entering and leaving edit mode, on every undo push, and on every evaluation.
 *
 * A handful of `MeshData` attributes are not carried as generic layers, because BMesh stores them in
 * element header flags or dedicated fields instead. Blender calls these "stored in BMesh builtin"
 * (`bmesh_mesh_convert.cc:118`); {@link STORED_IN_BMESH_BUILTIN} is the same list. Everything else
 * becomes a `CustomData` layer on the matching domain and round-trips untouched.
 */

import {MeshData, SelectHistoryEntry} from '../MeshData'
import {
    AttrDomain,
    AttrName,
    ATTR_TYPE_INFO,
    AttrType,
    ElemFlag,
} from '../constants'
import {BMesh} from './BMesh'
import {BMEdge, BMFace, BMVert} from './types'
import {BMCustomDataLayout, getComponent, setValue} from './customdata'
import {diskEdgeExists} from './structure'

/**
 * Attributes represented by BMesh header flags or dedicated fields rather than by a layer.
 * Kept identical to Blender's list so a blend round-trip needs no special cases.
 */
export const STORED_IN_BMESH_BUILTIN: ReadonlySet<string> = new Set([
    AttrName.position,
    AttrName.edgeVerts,
    AttrName.cornerVert,
    AttrName.cornerEdge,
    AttrName.selectVert,
    AttrName.selectEdge,
    AttrName.selectFace,
    AttrName.hideVert,
    AttrName.hideEdge,
    AttrName.hideFace,
    AttrName.sharpEdge,
    AttrName.sharpFace,
    AttrName.uvSeam,
    AttrName.materialIndex,
])

function domainOf(domain: AttrDomain): 'vert' | 'edge' | 'loop' | 'face' {
    switch (domain) {
    case AttrDomain.Point: return 'vert'
    case AttrDomain.Edge: return 'edge'
    case AttrDomain.Face: return 'face'
    case AttrDomain.Corner: return 'loop'
    }
}

/** Read a boolean attribute as a predicate, defaulting to false when the layer is absent. */
function boolReader(mesh: MeshData, name: string, domain: AttrDomain): (i: number) => boolean {
    const layer = mesh.attributes.get(name)
    if (!layer || layer.domain !== domain || layer.type !== 'bool') return () => false
    const data = layer.data
    return (i: number) => data[i] !== 0
}

/**
 * Build a BMesh from a MeshData.
 *
 * Port of `BM_mesh_bm_from_me` (`bmesh_mesh_convert.cc:311`). The input is not modified.
 */
export function bmFromMesh(mesh: MeshData): BMesh {
    const problems = mesh.validate()
    if (problems.length) {
        throw new Error(`mesh-kernel: cannot convert an invalid MeshData:\n  ${problems.slice(0, 8).join('\n  ')}`)
    }

    const bm = new BMesh()
    bm.materials = [...mesh.materials]
    bm.selectMode = mesh.select.mode

    // Declare a layer for every generic attribute, so element blocks have a layout to write into.
    for (const layer of mesh.attributes.layers()) {
        if (STORED_IN_BMESH_BUILTIN.has(layer.name)) continue
        bm.addLayer(domainOf(layer.domain), layer.name, layer.type)
    }

    const copyGeneric = (domain: AttrDomain, layout: BMCustomDataLayout, index: number, elem: BMVert | BMEdge | BMFace | {fdata: Float32Array | null, idata: Int32Array | null}) => {
        for (const layer of mesh.attributes.layers()) {
            if (layer.domain !== domain) continue
            if (STORED_IN_BMESH_BUILTIN.has(layer.name)) continue
            const def = layout.get(layer.name)!
            const comps = ATTR_TYPE_INFO[layer.type].components
            const values: number[] = new Array(comps)
            for (let c = 0; c < comps; c++) values[c] = layer.data[index * comps + c]
            setValue(elem as never, layout, def, values)
        }
    }

    // --- vertices ---
    const positions = mesh.positions
    const vertSelected = boolReader(mesh, AttrName.selectVert, AttrDomain.Point)
    const vertHidden = boolReader(mesh, AttrName.hideVert, AttrDomain.Point)
    const verts: BMVert[] = new Array(mesh.vertsNum)
    for (let i = 0; i < mesh.vertsNum; i++) {
        const v = bm.vertCreate(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        v.index = i
        if (vertHidden(i)) v.hflag |= ElemFlag.Hidden
        else if (vertSelected(i)) v.hflag |= ElemFlag.Select
        copyGeneric(AttrDomain.Point, bm.vdata, i, v)
        verts[i] = v
    }

    // --- edges ---
    const edgeVerts = mesh.edgeVerts
    const edgeSelected = boolReader(mesh, AttrName.selectEdge, AttrDomain.Edge)
    const edgeHidden = boolReader(mesh, AttrName.hideEdge, AttrDomain.Edge)
    const edgeSharp = boolReader(mesh, AttrName.sharpEdge, AttrDomain.Edge)
    const edgeSeam = boolReader(mesh, AttrName.uvSeam, AttrDomain.Edge)
    const edges: BMEdge[] = new Array(mesh.edgesNum)
    for (let i = 0; i < mesh.edgesNum; i++) {
        const e = bm.edgeCreate(verts[edgeVerts[i * 2]], verts[edgeVerts[i * 2 + 1]])
        e.index = i
        // Blender stores smoothness, so a sharp edge is the absence of the flag.
        if (edgeSharp(i)) e.hflag &= ~ElemFlag.Smooth
        else e.hflag |= ElemFlag.Smooth
        if (edgeSeam(i)) e.hflag |= ElemFlag.Seam
        if (edgeHidden(i)) e.hflag |= ElemFlag.Hidden
        else if (edgeSelected(i)) e.hflag |= ElemFlag.Select
        copyGeneric(AttrDomain.Edge, bm.edata, i, e)
        edges[i] = e
    }

    // --- faces and their corners ---
    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges
    const faceSelected = boolReader(mesh, AttrName.selectFace, AttrDomain.Face)
    const faceHidden = boolReader(mesh, AttrName.hideFace, AttrDomain.Face)
    const faceSharp = boolReader(mesh, AttrName.sharpFace, AttrDomain.Face)
    const materialLayer = mesh.attributes.get(AttrName.materialIndex)
    const faces: BMFace[] = new Array(mesh.facesNum)

    for (let fi = 0; fi < mesh.facesNum; fi++) {
        const start = mesh.faceOffsets[fi]
        const end = mesh.faceOffsets[fi + 1]
        const size = end - start
        const fverts: BMVert[] = new Array(size)
        const fedges: BMEdge[] = new Array(size)
        for (let k = 0; k < size; k++) {
            fverts[k] = verts[cornerVerts[start + k]]
            fedges[k] = edges[cornerEdges[start + k]]
        }
        const f = bm.faceCreateWithEdges(fverts, fedges)
        f.index = fi
        if (faceSharp(fi)) f.hflag &= ~ElemFlag.Smooth
        else f.hflag |= ElemFlag.Smooth
        if (faceHidden(fi)) f.hflag |= ElemFlag.Hidden
        else if (faceSelected(fi)) f.hflag |= ElemFlag.Select
        if (materialLayer) f.matNr = materialLayer.data[fi]
        copyGeneric(AttrDomain.Face, bm.pdata, fi, f)

        // Corner data, in the same order the loop cycle was built.
        let k = 0
        for (const l of f.eachLoop()) {
            l.index = start + k
            copyGeneric(AttrDomain.Corner, bm.ldata, start + k, l)
            k++
        }
        faces[fi] = f
    }

    // --- selection history and active face ---
    for (const entry of mesh.select.history) {
        const elem = entry.type === 'vert' ? verts[entry.index]
            : entry.type === 'edge' ? edges[entry.index] : faces[entry.index]
        if (elem) bm.selectHistory.push({elem})
    }
    if (mesh.select.activeFace >= 0 && mesh.select.activeFace < faces.length) {
        bm.actFace = faces[mesh.select.activeFace]
    }

    return bm
}

/**
 * Build a MeshData from a BMesh.
 *
 * Port of `BM_mesh_bm_to_me` (`bmesh_mesh_convert.cc:1650`). Like Blender, a flag layer is only
 * written when at least one element needs it, so a mesh with nothing selected carries no
 * `.select_vert` array at all.
 */
export function bmToMesh(bm: BMesh): MeshData {
    const mesh = new MeshData()
    mesh.materials = [...bm.materials]
    mesh.select.mode = bm.selectMode

    // Index every element once; the arrays are written by index below.
    const vertIndex = new Map<BMVert, number>()
    const edgeIndex = new Map<BMEdge, number>()
    const faceIndex = new Map<BMFace, number>()
    let i = 0
    for (const v of bm.verts) vertIndex.set(v, i++)
    i = 0
    for (const e of bm.edges) edgeIndex.set(e, i++)
    i = 0
    for (const f of bm.faces) faceIndex.set(f, i++)

    let cornersNum = 0
    for (const f of bm.faces) cornersNum += f.len

    mesh.resize({
        verts: bm.totvert,
        edges: bm.totedge,
        faces: bm.totface,
        corners: cornersNum,
    })

    // Declare generic layers up front so the arrays exist at full length.
    const declare = (layout: BMCustomDataLayout, domain: AttrDomain) => {
        for (const layer of layout.layers) {
            mesh.attributes.ensure(layer.name, domain, layer.type)
        }
    }
    declare(bm.vdata, AttrDomain.Point)
    declare(bm.edata, AttrDomain.Edge)
    declare(bm.pdata, AttrDomain.Face)
    declare(bm.ldata, AttrDomain.Corner)

    const writeGeneric = (layout: BMCustomDataLayout, index: number, elem: BMVert | BMEdge | BMFace | {fdata: Float32Array | null, idata: Int32Array | null}) => {
        for (const def of layout.layers) {
            const layer = mesh.attributes.get(def.name)!
            for (let c = 0; c < def.components; c++) {
                layer.data[index * def.components + c] = getComponent(elem as never, def, c)
            }
        }
    }

    // Decide which flag layers are needed before allocating any of them.
    let needSelectVert = false, needHideVert = false
    let needSelectEdge = false, needHideEdge = false, needSharpEdge = false, needSeam = false
    let needSelectFace = false, needHideFace = false, needSharpFace = false, needMaterial = false

    for (const v of bm.verts) {
        if (v.hflag & ElemFlag.Select) needSelectVert = true
        if (v.hflag & ElemFlag.Hidden) needHideVert = true
    }
    for (const e of bm.edges) {
        if (e.hflag & ElemFlag.Select) needSelectEdge = true
        if (e.hflag & ElemFlag.Hidden) needHideEdge = true
        if (!(e.hflag & ElemFlag.Smooth)) needSharpEdge = true
        if (e.hflag & ElemFlag.Seam) needSeam = true
    }
    for (const f of bm.faces) {
        if (f.hflag & ElemFlag.Select) needSelectFace = true
        if (f.hflag & ElemFlag.Hidden) needHideFace = true
        if (!(f.hflag & ElemFlag.Smooth)) needSharpFace = true
        if (f.matNr !== 0) needMaterial = true
    }

    const ensureBool = (need: boolean, name: string, domain: AttrDomain) =>
        need ? mesh.attributes.ensure(name, domain, 'bool').data : null

    const selVert = ensureBool(needSelectVert, AttrName.selectVert, AttrDomain.Point)
    const hidVert = ensureBool(needHideVert, AttrName.hideVert, AttrDomain.Point)
    const selEdge = ensureBool(needSelectEdge, AttrName.selectEdge, AttrDomain.Edge)
    const hidEdge = ensureBool(needHideEdge, AttrName.hideEdge, AttrDomain.Edge)
    const shpEdge = ensureBool(needSharpEdge, AttrName.sharpEdge, AttrDomain.Edge)
    const seamEdge = ensureBool(needSeam, AttrName.uvSeam, AttrDomain.Edge)
    const selFace = ensureBool(needSelectFace, AttrName.selectFace, AttrDomain.Face)
    const hidFace = ensureBool(needHideFace, AttrName.hideFace, AttrDomain.Face)
    const shpFace = ensureBool(needSharpFace, AttrName.sharpFace, AttrDomain.Face)
    const matIndex = needMaterial
        ? mesh.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32').data : null

    // --- vertices ---
    const positions = mesh.positions
    for (const [v, vi] of vertIndex) {
        positions[vi * 3] = v.x
        positions[vi * 3 + 1] = v.y
        positions[vi * 3 + 2] = v.z
        if (selVert) selVert[vi] = v.hflag & ElemFlag.Select ? 1 : 0
        if (hidVert) hidVert[vi] = v.hflag & ElemFlag.Hidden ? 1 : 0
        writeGeneric(bm.vdata, vi, v)
    }

    // --- edges ---
    const edgeVerts = mesh.edgeVerts
    for (const [e, ei] of edgeIndex) {
        edgeVerts[ei * 2] = vertIndex.get(e.v1)!
        edgeVerts[ei * 2 + 1] = vertIndex.get(e.v2)!
        if (selEdge) selEdge[ei] = e.hflag & ElemFlag.Select ? 1 : 0
        if (hidEdge) hidEdge[ei] = e.hflag & ElemFlag.Hidden ? 1 : 0
        if (shpEdge) shpEdge[ei] = e.hflag & ElemFlag.Smooth ? 0 : 1
        if (seamEdge) seamEdge[ei] = e.hflag & ElemFlag.Seam ? 1 : 0
        writeGeneric(bm.edata, ei, e)
    }

    // --- faces and corners ---
    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges
    let corner = 0
    for (const [f, fi] of faceIndex) {
        mesh.faceOffsets[fi] = corner
        if (selFace) selFace[fi] = f.hflag & ElemFlag.Select ? 1 : 0
        if (hidFace) hidFace[fi] = f.hflag & ElemFlag.Hidden ? 1 : 0
        if (shpFace) shpFace[fi] = f.hflag & ElemFlag.Smooth ? 0 : 1
        if (matIndex) matIndex[fi] = f.matNr
        writeGeneric(bm.pdata, fi, f)

        for (const l of f.eachLoop()) {
            cornerVerts[corner] = vertIndex.get(l.v)!
            cornerEdges[corner] = edgeIndex.get(l.e!)!
            writeGeneric(bm.ldata, corner, l)
            corner++
        }
    }
    mesh.faceOffsets[bm.totface] = corner

    // --- selection history and active face ---
    const history: SelectHistoryEntry[] = []
    for (const h of bm.selectHistory) {
        if (h.elem instanceof BMVert) {
            const idx = vertIndex.get(h.elem)
            if (idx !== undefined) history.push({type: 'vert', index: idx})
        } else if (h.elem instanceof BMEdge) {
            const idx = edgeIndex.get(h.elem)
            if (idx !== undefined) history.push({type: 'edge', index: idx})
        } else {
            const idx = faceIndex.get(h.elem)
            if (idx !== undefined) history.push({type: 'face', index: idx})
        }
    }
    mesh.select.history = history
    mesh.select.activeFace = bm.actFace ? faceIndex.get(bm.actFace) ?? -1 : -1

    return mesh
}

/**
 * Find the edge between two vertices in a BMesh, or null. Convenience re-export so callers of the
 * conversion do not need to reach into the cycle primitives.
 */
export {diskEdgeExists as bmEdgeExists}

/** Names of attribute types, for error messages and describe output. */
export type {AttrType}
