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

function flagFor(elem: {hflag: number}, active: unknown, self: unknown): number {
    let f = 0
    if (elem.hflag & ElemFlag.Select) f |= OverlayFlag.Selected
    if (elem.hflag & ElemFlag.Hidden) f |= OverlayFlag.Hidden
    if (active === self) f |= OverlayFlag.Active
    return f
}

/** Points for every visible vertex. */
export function buildVertexOverlay(bm: BMesh, active?: unknown): VertexOverlayData {
    const elements: BMVert[] = []
    for (const v of bm.verts) if (!(v.hflag & ElemFlag.Hidden)) elements.push(v)

    const position = new Float32Array(elements.length * 3)
    const flag = new Float32Array(elements.length)
    for (let i = 0; i < elements.length; i++) {
        const v = elements[i]
        position[i * 3] = v.x
        position[i * 3 + 1] = v.y
        position[i * 3 + 2] = v.z
        flag[i] = flagFor(v, active, v)
    }
    return {position, flag, elements}
}

/** Line segments for every visible edge. */
export function buildEdgeOverlay(bm: BMesh, active?: unknown): EdgeOverlayData {
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
        const f = flagFor(e, active, e)
        flag[i * 2] = f
        flag[i * 2 + 1] = f
    }
    return {position, flag, elements}
}

/**
 * A translucent overlay for selected faces only.
 *
 * Fan triangulation is adequate here because the overlay is a highlight, not the shaded surface: a
 * concave n-gon's highlight may bulge slightly, and that costs nothing. The real bake ear-clips.
 */
export function buildFaceOverlay(bm: BMesh): FaceOverlayData {
    const elements: BMFace[] = []
    for (const f of bm.faces) {
        if (f.hflag & ElemFlag.Hidden) continue
        if (!(f.hflag & ElemFlag.Select)) continue
        elements.push(f)
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
export function refreshVertexFlags(data: VertexOverlayData, active?: unknown): void {
    for (let i = 0; i < data.elements.length; i++) {
        data.flag[i] = flagFor(data.elements[i], active, data.elements[i])
    }
}

export function refreshEdgeFlags(data: EdgeOverlayData, active?: unknown): void {
    for (let i = 0; i < data.elements.length; i++) {
        const f = flagFor(data.elements[i], active, data.elements[i])
        data.flag[i * 2] = f
        data.flag[i * 2 + 1] = f
    }
}
