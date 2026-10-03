/**
 * Which vertex, edge or face a click means, decided from the selection buffer.
 *
 * Port of `unified_findnearest` (`editors/mesh/editmesh_select.cc:1038`) and the selection-buffer paths
 * of `EDBM_vert/edge/face_find_nearest_ex` (`:441`, `:669`, `:881`) - Blender's behaviour when X-ray is
 * off. The rules, all from that code:
 *
 * - Search within `ED_view3d_select_dist_px()` = 75 px (`space_view3d/view3d_select.cc:107`), measured
 *   as Manhattan distance in the buffer.
 * - Faces are looked up first and only at the exact pixel under the cursor. If one is found and edges or
 *   vertices are also selectable, the search distance shrinks to the distance to that face's centre,
 *   capped at half the initial distance - "since edges select lines, we give dots advantage of ~20 pix".
 * - Edges next, nearest within the current distance; again the distance shrinks to the edge centre.
 * - Vertices last, nearest within what is left.
 * - A vertex beats an edge beats a face. If nothing qualified, the edge or face that was under the
 *   cursor in the buffer is used anyway, because "it makes sense to select this".
 *
 * The buffer itself is behind {@link SelectSampler}, so this file has no renderer in it and runs in
 * Node against a fake. Only visible elements are in the buffer, so occlusion comes for free.
 */

import {BMEdge, BMFace, BMVert, BMesh, SelectMode} from '@threepipe/mesh-kernel'
import type {ProjectFn} from '../picking'

export type SelectDomain = 'vert' | 'edge' | 'face'

/**
 * Reads the selection buffer for one domain. Implemented on the GPU by `SelectBuffer`.
 * Indices are 0-based positions in the domain's element list.
 */
export interface SelectSampler {
    /** The element nearest the point within `dist` Manhattan pixels, and its distance. */
    findNearest(domain: SelectDomain, x: number, y: number, dist: number): {index: number, dist: number} | null
    /** The element at exactly this pixel. */
    samplePoint(domain: SelectDomain, x: number, y: number): number | null
}

/** Blender's `ED_view3d_select_dist_px()` at a pixel size of 1. */
export const SELECT_DIST_PX = 75

export interface NearestResult {
    vert: BMVert | null
    edge: BMEdge | null
    face: BMFace | null
    /** Whichever one of the three is set. */
    element: BMVert | BMEdge | BMFace | null
}

/** Element lists the sampler's indices refer to, in buffer order. */
export interface SelectElements {
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
    return Math.abs(ax - bx) + Math.abs(ay - by)
}

/**
 * Distance from the cursor to a face's centre, as `find_nearest_face_center__doZBuf` measures it:
 * the projected mean of the face's corners.
 */
function faceCenterDist(face: BMFace, x: number, y: number, project: ProjectFn): number {
    let cx = 0, cy = 0, cz = 0, n = 0
    for (const l of face.eachLoop()) {
        cx += l.v.x
        cy += l.v.y
        cz += l.v.z
        n++
    }
    const p = n ? project(cx / n, cy / n, cz / n) : null
    return p ? manhattan(p.x, p.y, x, y) : Infinity
}

/** `find_nearest_edge_center__doZBuf`: the projected midpoint of the edge. */
function edgeCenterDist(edge: BMEdge, x: number, y: number, project: ProjectFn): number {
    const p = project((edge.v1.x + edge.v2.x) / 2, (edge.v1.y + edge.v2.y) / 2, (edge.v1.z + edge.v2.z) / 2)
    return p ? manhattan(p.x, p.y, x, y) : Infinity
}

export function unifiedFindNearest(
    bm: BMesh,
    elements: SelectElements,
    sampler: SelectSampler,
    x: number,
    y: number,
    project: ProjectFn,
    distInit = SELECT_DIST_PX,
): NearestResult {
    const mode = bm.selectMode
    const distMargin = distInit / 2
    let dist = distInit

    let hitV: BMVert | null = null
    let hitE: BMEdge | null = null
    let hitF: BMFace | null = null
    let hitEZbuf: BMEdge | null = null
    let hitFZbuf: BMFace | null = null

    if (dist > 0 && (mode & SelectMode.Face)) {
        // `use_zbuf_single_px`: the face must be under the cursor, at distance 0.
        const index = sampler.samplePoint('face', x, y)
        const face = index !== null ? elements.faces[index] ?? null : null
        hitFZbuf = face
        if (face) {
            const wantCenter = (mode & (SelectMode.Edge | SelectMode.Vertex)) !== 0
            if (0 < dist) {
                hitF = face
                dist = 0
                if (wantCenter) dist = Math.min(distMargin, faceCenterDist(face, x, y, project))
            }
        }
    }

    if (dist > 0 && (mode & SelectMode.Edge)) {
        const found = sampler.findNearest('edge', x, y, Math.ceil(dist))
        const edge = found ? elements.edges[found.index] ?? null : null
        hitEZbuf = edge
        if (edge && found!.dist < dist) {
            hitE = edge
            dist = found!.dist
            if (mode & SelectMode.Vertex) dist = Math.min(distMargin, edgeCenterDist(edge, x, y, project))
        }
    }

    if (dist > 0 && (mode & SelectMode.Vertex)) {
        const found = sampler.findNearest('vert', x, y, Math.ceil(dist))
        const vert = found ? elements.verts[found.index] ?? null : null
        if (vert && found!.dist < dist) {
            hitV = vert
            dist = found!.dist
        }
    }

    // Only one of the three is returned.
    if (hitV) {
        hitE = null
        hitF = null
    } else if (hitE) {
        hitF = null
    }

    // "There may be a face under the cursor, who's center if too far away use this if all else fails,
    // it makes sense to select this."
    if (!hitV && !hitE && !hitF) {
        if (hitEZbuf) hitE = hitEZbuf
        else if (hitFZbuf) hitF = hitFZbuf
    }

    return {vert: hitV, edge: hitE, face: hitF, element: hitV ?? hitE ?? hitF}
}
