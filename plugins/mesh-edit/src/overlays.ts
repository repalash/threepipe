/**
 * Edit-mode overlay buffers: the points, lines and face highlights drawn on top of the mesh.
 *
 * Modelled on Blender's draw path (`draw/intern/mesh_extractors/extract_mesh_vbo_edit_data.cc`): every
 * element carries a flag byte, and selection colouring is a shader read of that flag rather than a
 * geometry rebuild. Here the flags live in a vertex attribute for the same reason, so changing what is
 * selected updates one small array instead of retessellating anything.
 *
 * These functions emit plain arrays. The plugin turns them into geometry, keeping this file testable
 * and free of renderer imports.
 */

import {BMesh, BMEdge, BMFace, BMVert, ElemFlag} from '@threepipe/mesh-kernel'

/** Bit flags written into the overlay `aFlag` attribute, read by the overlay materials. */
export const OverlayFlag = {
    Selected: 1,
    Active: 2,
    Hidden: 4,
    /** Under the cursor: what a click would select. */
    Preselect: 8,
} as const

export interface VertexOverlayData {
    position: Float32Array
    flag: Float32Array
    /** Element for each drawn point, so a hit index maps back to topology. */
    elements: BMVert[]
}

export interface EdgeOverlayData {
    /** Line segment endpoints, two vertices per edge. */
    position: Float32Array
    flag: Float32Array
    elements: BMEdge[]
}

export interface FaceOverlayData {
    /** Triangulated selected faces only; unselected faces are not drawn. */
    position: Float32Array
    index: Uint32Array
    elements: BMFace[]
}

function flagFor(elem: {hflag: number}, active: unknown, self: unknown, preselect?: unknown): number {
    let f = 0
    if (elem.hflag & ElemFlag.Select) f |= OverlayFlag.Selected
    if (elem.hflag & ElemFlag.Hidden) f |= OverlayFlag.Hidden
    if (active === self) f |= OverlayFlag.Active
    if (preselect !== undefined && preselect === self) f |= OverlayFlag.Preselect
    return f
}

/** Points for every visible vertex. */
export function buildVertexOverlay(bm: BMesh, active?: unknown, preselect?: unknown): VertexOverlayData {
    const elements: BMVert[] = []
    for (const v of bm.verts) if (!(v.hflag & ElemFlag.Hidden)) elements.push(v)

    const position = new Float32Array(elements.length * 3)
    const flag = new Float32Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const v = elements[i]
        position[i * 3] = v.x
        position[i * 3 + 1] = v.y
        position[i * 3 + 2] = v.z
        flag[i] = flagFor(v, active, v, preselect)
    }
    return {position, flag, elements}
}

/**
 * Line segments for every visible edge, with a flag per end.
 *
 * In vertex mode the ends take their selection from their vertices, so an edge with one selected
 * vertex fades from orange to black along its length - Blender's `EDIT_MESH_edge_vertex_color`
 * (`overlay_edit_mesh_common_lib.glsl:33`), which colours an edge end by `VERT_SELECTED`. In edge
 * and face mode the edge's own flag is used for both ends (`select_override`).
 */
export function buildEdgeOverlay(bm: BMesh, active?: unknown, preselect?: unknown, vertexMode = false): EdgeOverlayData {
    const elements: BMEdge[] = []
    for (const e of bm.edges) if (!(e.hflag & ElemFlag.Hidden)) elements.push(e)

    const position = new Float32Array(elements.length * 6)
    const flag = new Float32Array(elements.length * 2)
    for (let i = 0; i < elements.length; i++) {
        const e = elements[i]
        position[i * 6] = e.v1.x
        position[i * 6 + 1] = e.v1.y
        position[i * 6 + 2] = e.v1.z
        position[i * 6 + 3] = e.v2.x
        position[i * 6 + 4] = e.v2.y
        position[i * 6 + 5] = e.v2.z
        const f = flagFor(e, active, e, preselect)
        if (vertexMode) {
            const base = f & ~OverlayFlag.Selected
            flag[i * 2] = base | (e.v1.hflag & ElemFlag.Select ? OverlayFlag.Selected : 0)
            flag[i * 2 + 1] = base | (e.v2.hflag & ElemFlag.Select ? OverlayFlag.Selected : 0)
        } else {
            flag[i * 2] = f
            flag[i * 2 + 1] = f
        }
    }
    return {position, flag, elements}
}

export interface FaceDotOverlayData {
    /** One point per visible face, at its median centre (`BM_face_calc_center_median`). */
    position: Float32Array
    flag: Float32Array
    elements: BMFace[]
}

/**
 * Face dots: Blender's facedot overlay (`extract_mesh_vbo_fdots_pos.cc:69`), one point at the
 * median of each visible face's corners, flagged like the face.
 */
export function buildFaceDotOverlay(bm: BMesh, active?: unknown, preselect?: unknown): FaceDotOverlayData {
    const elements: BMFace[] = []
    for (const f of bm.faces) if (!(f.hflag & ElemFlag.Hidden)) elements.push(f)

    const position = new Float32Array(elements.length * 3)
    const flag = new Float32Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const f = elements[i]
        let x = 0, y = 0, z = 0, n = 0
        for (const l of f.eachLoop()) {
            x += l.v.x
            y += l.v.y
            z += l.v.z
            n++
        }
        position[i * 3] = x / n
        position[i * 3 + 1] = y / n
        position[i * 3 + 2] = z / n
        flag[i] = flagFor(f, active, f, preselect)
    }
    return {position, flag, elements}
}

/**
 * A translucent overlay for selected faces only.
 *
 * Fan triangulation is adequate here because the overlay is a highlight, not the shaded surface: a
 * concave n-gon's highlight may bulge slightly, and that costs nothing. The real bake ear-clips.
 */
export function buildFaceOverlay(bm: BMesh, only?: BMFace): FaceOverlayData {
    const elements: BMFace[] = []
    if (only) {
        if (!(only.hflag & ElemFlag.Hidden)) elements.push(only)
    } else {
        for (const f of bm.faces) {
            if (f.hflag & ElemFlag.Hidden) continue
            if (!(f.hflag & ElemFlag.Select)) continue
            elements.push(f)
        }
    }

    let vertCount = 0
    let triCount = 0
    for (const f of elements) {
        vertCount += f.len
        triCount += Math.max(0, f.len - 2)
    }

    const position = new Float32Array(vertCount * 3)
    const index = new Uint32Array(triCount * 3)
    let vi = 0
    let ii = 0
    for (const f of elements) {
        const base = vi
        for (const l of f.eachLoop()) {
            position[vi * 3] = l.v.x
            position[vi * 3 + 1] = l.v.y
            position[vi * 3 + 2] = l.v.z
            vi++
        }
        for (let k = 1; k + 1 < f.len; k++) {
            index[ii++] = base
            index[ii++] = base + k
            index[ii++] = base + k + 1
        }
    }
    return {position, index, elements}
}

/** Rewrite only the flag arrays, for when selection changed but topology did not. */
export function refreshVertexFlags(data: VertexOverlayData, active?: unknown, preselect?: unknown): void {
    for (let i = 0; i < data.elements.length; i++) {
        data.flag[i] = flagFor(data.elements[i], active, data.elements[i], preselect)
    }
}

export function refreshEdgeFlags(data: EdgeOverlayData, active?: unknown, preselect?: unknown, vertexMode = false): void {
    for (let i = 0; i < data.elements.length; i++) {
        const e = data.elements[i]
        const f = flagFor(e, active, e, preselect)
        if (vertexMode) {
            const base = f & ~OverlayFlag.Selected
            data.flag[i * 2] = base | (e.v1.hflag & ElemFlag.Select ? OverlayFlag.Selected : 0)
            data.flag[i * 2 + 1] = base | (e.v2.hflag & ElemFlag.Select ? OverlayFlag.Selected : 0)
        } else {
            data.flag[i * 2] = f
            data.flag[i * 2 + 1] = f
        }
    }
}

export function refreshFaceDotFlags(data: FaceDotOverlayData, active?: unknown, preselect?: unknown): void {
    for (let i = 0; i < data.elements.length; i++) {
        data.flag[i] = flagFor(data.elements[i], active, data.elements[i], preselect)
    }
}

/** Rewrite the positions in place after vertices moved; the element lists are unchanged. */
export function refreshVertexPositions(data: VertexOverlayData): void {
    for (let i = 0; i < data.elements.length; i++) {
        const v = data.elements[i]
        data.position[i * 3] = v.x
        data.position[i * 3 + 1] = v.y
        data.position[i * 3 + 2] = v.z
    }
}

export function refreshEdgePositions(data: EdgeOverlayData): void {
    for (let i = 0; i < data.elements.length; i++) {
        const e = data.elements[i]
        data.position[i * 6] = e.v1.x
        data.position[i * 6 + 1] = e.v1.y
        data.position[i * 6 + 2] = e.v1.z
        data.position[i * 6 + 3] = e.v2.x
        data.position[i * 6 + 4] = e.v2.y
        data.position[i * 6 + 5] = e.v2.z
    }
}

export function refreshFaceDotPositions(data: FaceDotOverlayData): void {
    for (let i = 0; i < data.elements.length; i++) {
        const f = data.elements[i]
        let x = 0, y = 0, z = 0, n = 0
        for (const l of f.eachLoop()) {
            x += l.v.x
            y += l.v.y
            z += l.v.z
            n++
        }
        data.position[i * 3] = x / n
        data.position[i * 3 + 1] = y / n
        data.position[i * 3 + 2] = z / n
    }
}
