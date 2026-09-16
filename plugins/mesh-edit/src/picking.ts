/**
 * Element picking: turning a screen position into the vertex, edge or face under the cursor.
 *
 * Ported in behaviour from `EDBM_unified_findnearest` (`editors/mesh/editmesh_select.cc:1038`). The
 * rules that matter, all of which come from that function:
 *
 * - **Priority is vertex, then edge, then face.** A vertex wins over an edge running through it, and an
 *   edge wins over the face behind it, because points are harder to hit than areas.
 * - **Points and lines get a distance bonus** over faces, so a vertex a few pixels away still wins.
 * - **Repeated clicks in the same place cycle** through overlapping candidates, which is how you reach
 *   an element hidden behind another without moving the camera.
 *
 * This module works in projected screen space and imports no renderer. The caller supplies a
 * world-to-screen projection, which the plugin builds from the camera.
 */

import {BMEdge, BMFace, BMVert, BMesh, ElemFlag, SelectMode, SelectModeMask} from '@threepipe/mesh-kernel'

/** Projects a world position to pixel coordinates, returning null when behind the camera. */
export type ProjectFn = (x: number, y: number, z: number) => {x: number, y: number, depth: number} | null

export interface PickOptions {
    /** Pixel radius to search. Blender's default is derived from the theme's vertex size. */
    maxDistance?: number
    /**
     * Extra pixels of advantage given to vertices and edges over faces. Blender halves the search
     * distance for the face pass instead; the effect is the same and this is easier to reason about.
     */
    pointBias?: number
    /** When true, elements behind other geometry can still be picked. */
    xray?: boolean
}

export interface PickResult {
    vert?: BMVert
    edge?: BMEdge
    face?: BMFace
    /** The element that should be acted on, chosen by the mode and the priority rules. */
    element: BMVert | BMEdge | BMFace | null
    /** Screen distance in pixels to the chosen element. */
    distance: number
}

/** Squared distance from a point to a screen-space segment. */
function distToSegment2(
    px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-12) return (px - ax) ** 2 + (py - ay) ** 2
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const cx = ax + t * dx
    const cy = ay + t * dy
    return (px - cx) ** 2 + (py - cy) ** 2
}

/** Whether a screen point lies inside a projected polygon, by the crossing-number rule. */
function pointInPolygon(px: number, py: number, xs: number[], ys: number[]): boolean {
    let inside = false
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
        const intersects = (ys[i] > py) !== (ys[j] > py)
            && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]
        if (intersects) inside = !inside
    }
    return inside
}

/**
 * State for click cycling. Hold one per viewport and pass it in; the picker uses it to step through
 * overlapping candidates when the cursor has not moved.
 */
export class PickCycleState {
    private _lastX = Number.NaN
    private _lastY = Number.NaN
    private _offset = 0

    /** Returns how far down the candidate list to start, resetting when the cursor moved. */
    offsetFor(x: number, y: number, threshold = 3): number {
        if (Math.abs(x - this._lastX) > threshold || Math.abs(y - this._lastY) > threshold) {
            this._lastX = x
            this._lastY = y
            this._offset = 0
            return 0
        }
        this._offset++
        return this._offset
    }

    reset(): void {
        this._lastX = Number.NaN
        this._lastY = Number.NaN
        this._offset = 0
    }
}

/**
 * Find the nearest element to a screen position.
 *
 * Which domains are searched follows the mesh's select mode, so in face mode a vertex is never
 * returned even if one is closer.
 */
export function pickElement(
    bm: BMesh,
    screenX: number,
    screenY: number,
    project: ProjectFn,
    options: PickOptions = {},
    cycle?: PickCycleState,
): PickResult {
    const maxDistance = options.maxDistance ?? 24
    const pointBias = options.pointBias ?? maxDistance / 2
    const mode: SelectModeMask = bm.selectMode
    const maxSq = maxDistance * maxDistance

    // Project once; every pass reads from this.
    const proj = new Map<BMVert, {x: number, y: number, depth: number} | null>()
    const projectVert = (v: BMVert) => {
        let p = proj.get(v)
        if (p === undefined) {
            p = project(v.x, v.y, v.z)
            proj.set(v, p)
        }
        return p
    }

    type Candidate = {elem: BMVert | BMEdge | BMFace, dist: number, depth: number}
    const verts: Candidate[] = []
    const edges: Candidate[] = []
    const faces: Candidate[] = []

    if (mode & SelectMode.Vertex) {
        for (const v of bm.verts) {
            if (v.hflag & ElemFlag.Hidden) continue
            const p = projectVert(v)
            if (!p) continue
            const d2 = (p.x - screenX) ** 2 + (p.y - screenY) ** 2
            if (d2 <= maxSq) verts.push({elem: v, dist: Math.sqrt(d2), depth: p.depth})
        }
    }

    if (mode & SelectMode.Edge) {
        for (const e of bm.edges) {
            if (e.hflag & ElemFlag.Hidden) continue
            const a = projectVert(e.v1)
            const b = projectVert(e.v2)
            if (!a || !b) continue
            const d2 = distToSegment2(screenX, screenY, a.x, a.y, b.x, b.y)
            if (d2 <= maxSq) edges.push({elem: e, dist: Math.sqrt(d2), depth: (a.depth + b.depth) / 2})
        }
    }

    if (mode & SelectMode.Face) {
        const xs: number[] = []
        const ys: number[] = []
        for (const f of bm.faces) {
            if (f.hflag & ElemFlag.Hidden) continue
            xs.length = 0
            ys.length = 0
            let depth = 0
            let ok = true
            for (const l of f.eachLoop()) {
                const p = projectVert(l.v)
                if (!p) {
                    ok = false
                    break
                }
                xs.push(p.x)
                ys.push(p.y)
                depth += p.depth
            }
            if (!ok || xs.length < 3) continue
            depth /= xs.length
            if (pointInPolygon(screenX, screenY, xs, ys)) {
                faces.push({elem: f, dist: 0, depth})
            } else {
                // Just outside still counts, so clicking a sliver face is possible.
                let best = Infinity
                for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
                    best = Math.min(best, distToSegment2(screenX, screenY, xs[j], ys[j], xs[i], ys[i]))
                }
                if (best <= maxSq) faces.push({elem: f, dist: Math.sqrt(best), depth})
            }
        }
    }

    // Vertex beats edge beats face, with points given a head start in pixels.
    const ranked: Candidate[] = [
        ...verts.map(c => ({...c, dist: Math.max(0, c.dist - pointBias)})),
        ...edges.map(c => ({...c, dist: Math.max(0, c.dist - pointBias / 2)})),
        ...faces,
    ].sort((a, b) => (a.dist - b.dist) || (a.depth - b.depth))

    const nearestVert = verts.sort((a, b) => a.dist - b.dist)[0]?.elem as BMVert | undefined
    const nearestEdge = edges.sort((a, b) => a.dist - b.dist)[0]?.elem as BMEdge | undefined
    const nearestFace = faces.sort((a, b) => (a.dist - b.dist) || (a.depth - b.depth))[0]?.elem as BMFace | undefined

    if (!ranked.length) {
        return {vert: nearestVert, edge: nearestEdge, face: nearestFace, element: null, distance: Infinity}
    }

    const offset = cycle ? cycle.offsetFor(screenX, screenY) % ranked.length : 0
    const chosen = ranked[offset]

    return {
        vert: nearestVert,
        edge: nearestEdge,
        face: nearestFace,
        element: chosen.elem,
        distance: chosen.dist,
    }
}
