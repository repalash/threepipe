/**
 * Snapping to geometry, ported from `editors/transform/transform_snap_object.cc`.
 *
 * `snap_object_project_view3d_ex` is the entry point: cast the cursor's ray for faces (and for
 * occlusion), then search the projected vertices and edges within `distPx` of the cursor, with an
 * occlusion plane through the face hit so what is behind the surface is not a candidate; convert an
 * edge hit to its midpoint when that mode is on; fall back to the grid.
 *
 * Targets are world-space triangle meshes with their real edges, so an edit mesh and any other
 * scene geometry go through the same search. Everything is plain arrays and runs in Node.
 */

import {
    closestRayToSegmentV3,
    copyV3,
    crossV3,
    dotV3,
    FLT_EPSILON,
    isectPointPlanesV3Negated,
    isectRayLineV3,
    isectRayPlaneV3Factor,
    midV3,
    normalizeV3,
    planeFromPointNormalV3,
    subV3,
    Vec2,
    Vec3,
    Vec4,
} from '../transform/math'
import type {SnapTargetType} from '../transform/types'
import type {TransformView} from '../transform/view'

/** `SNAP_MIN_DISTANCE` (`transform_snap.hh`): the search radius in pixels. */
export const SNAP_MIN_DISTANCE = 30

/** One snappable mesh, in world space. */
export interface SnapTargetMesh {
    /** xyz per vertex. */
    positions: Float32Array
    /** Vertex index pairs. */
    edges: Uint32Array
    /** Vertex index triples. */
    tris: Uint32Array
    /** The face each triangle belongs to, for `snap_polygon`; -1 when unknown. */
    triFace: Int32Array
    /** Per face: its vertex indices, in order. */
    faceVerts: Uint32Array[]
    /** Per face: its edge indices. */
    faceEdges: Uint32Array[]
    /** 1 where the element may be snapped to; the edited selection is excluded. */
    vertOk: Uint8Array
    edgeOk: Uint8Array
    triOk: Uint8Array
    /** Something the caller can identify the target by. */
    id?: unknown
}

export interface SnapResult {
    /** The snapped point, world space. */
    loc: Vec3
    /** The element's normal, or the edge direction for edges (`nearest_point.no`). */
    no: Vec3
    type: SnapTargetType
    /** Pixels from the cursor. */
    distPx: number
    target: SnapTargetMesh | null
    /** The vertex, edge or triangle index in the target. */
    index: number
}

export interface SnapProjectOptions {
    /** Hide what is behind the surface under the cursor, as without X-ray. */
    occlusion: boolean
    /** Faces facing away from the view are not snapped to. */
    backfaceCulling?: boolean
    /** The snap source's start position, for grid snapping relative to it. */
    initCo?: Vec3 | null
    /** The snap source's current position, for the view-aligned grid plane. */
    currCo?: Vec3 | null
    /** The grid step; 0 falls back to the view's grid scale. */
    gridSize?: number
}

interface Nearest {
    co: Vec3
    no: Vec3
    distSq: number
    index: number
    target: SnapTargetMesh | null
}

/** `occlusion_plane_create` (`transform_snap_object.cc:47`). */
export function occlusionPlaneCreate(rayStart: Vec3, rayDir: Vec3, rayCo: Vec3, rayNo: Vec3): Vec4 {
    let plane = planeFromPointNormalV3(rayCo, rayNo)
    if (dotV3(rayDir, [plane[0], plane[1], plane[2]]) > 0) {
        // The plane is facing the wrong direction.
        plane = [-plane[0], -plane[1], -plane[2], -plane[3]]
    }
    // A small offset to simulate a kind of volume for edges and vertices, scaled by the view depth.
    const depth = dotV3(subV3(rayCo, rayStart), rayDir)
    plane[3] += Math.max(depth * 1e-5, FLT_EPSILON)
    return plane
}

/** The projected search state, Blender's `SnapData` with `DistProjectedAABBPrecalc`. */
class SnapData {
    clipPlanes: Vec4[] = []
    nearest: Nearest

    constructor(readonly view: TransformView, readonly mval: Vec2, distPxSq: number) {
        this.nearest = {co: [0, 0, 0], no: [0, 0, 1], distSq: distPxSq, index: -2, target: null}
    }

    /** `test_projected_vert_dist` (`transform_snap_object.cc:72`). */
    testProjectedVertDist(co: Vec3): boolean {
        if (!isectPointPlanesV3Negated(this.clipPlanes, co)) return false
        const p = this.view.projectFloatView(co)
        if (!p) return false
        const dx = p[0] - this.mval[0]
        const dy = p[1] - this.mval[1]
        const distSq = dx * dx + dy * dy
        if (distSq < this.nearest.distSq) {
            this.nearest.co = copyV3(co)
            this.nearest.distSq = distSq
            return true
        }
        return false
    }

    /** `SnapData::snap_point` (`:193`). */
    snapPoint(co: Vec3, index: number, target: SnapTargetMesh | null): boolean {
        if (this.testProjectedVertDist(co)) {
            this.nearest.index = index
            this.nearest.target = target
            return true
        }
        return false
    }

    /** `test_projected_edge_dist` + `SnapData::snap_edge` (`:102`, `:208`). */
    snapEdge(rayOrigin: Vec3, rayDir: Vec3, va: Vec3, vb: Vec3, index: number, target: SnapTargetMesh | null): boolean {
        const near = closestRayToSegmentV3(rayOrigin, rayDir, va, vb).point
        if (this.testProjectedVertDist(near)) {
            this.nearest.index = index
            this.nearest.target = target
            this.nearest.no = subV3(vb, va)
            return true
        }
        return false
    }
}

function vertAt(m: SnapTargetMesh, i: number): Vec3 {
    return [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
}

/** Möller-Trumbore, as `isect_ray_tri_v3` is used by the BVH raycast. */
function isectRayTri(orig: Vec3, dir: Vec3, v0: Vec3, v1: Vec3, v2: Vec3): number | null {
    const e1 = subV3(v1, v0)
    const e2 = subV3(v2, v0)
    const p = crossV3(dir, e2)
    const a = dotV3(e1, p)
    if (a > -1e-12 && a < 1e-12) return null
    const f = 1 / a
    const s = subV3(orig, v0)
    const u = f * dotV3(s, p)
    if (u < 0 || u > 1) return null
    const q = crossV3(s, e1)
    const v = f * dotV3(dir, q)
    if (v < 0 || u + v > 1) return null
    const t = f * dotV3(e2, q)
    return t > 0 ? t : null
}

export class SnapContext {
    targets: SnapTargetMesh[] = []

    /** `raycastObjects`: the closest triangle hit along the ray. */
    raycast(origin: Vec3, dir: Vec3, backfaceCulling: boolean): {loc: Vec3, no: Vec3, dist: number, tri: number, target: SnapTargetMesh} | null {
        let best: {loc: Vec3, no: Vec3, dist: number, tri: number, target: SnapTargetMesh} | null = null
        for (const m of this.targets) {
            const n = m.tris.length / 3
            for (let i = 0; i < n; i++) {
                if (!m.triOk[i]) continue
                const v0 = vertAt(m, m.tris[i * 3])
                const v1 = vertAt(m, m.tris[i * 3 + 1])
                const v2 = vertAt(m, m.tris[i * 3 + 2])
                const no = crossV3(subV3(v1, v0), subV3(v2, v0))
                if (normalizeV3(no) === 0) continue
                // `raycast_tri_backface_culling_test` (`:605`).
                if (backfaceCulling && dotV3(no, dir) > 0) continue
                const t = isectRayTri(origin, dir, v0, v1, v2)
                if (t === null || best && t >= best.dist) continue
                best = {loc: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t], no, dist: t, tri: i, target: m}
            }
        }
        return best
    }

    /**
     * `snap_object_project_view3d_ex` (`transform_snap_object.cc:1367`).
     * `mval` is in region pixels (y up).
     */
    project(view: TransformView, mval: Vec2, snapTo: Set<SnapTargetType>, distPx: number, opts: SnapProjectOptions): SnapResult | null {
        const wantFace = snapTo.has('face')
        const wantVert = snapTo.has('vertex')
        const wantEdge = snapTo.has('edge')
        const wantMid = snapTo.has('edgeMidpoint')
        const wantGrid = snapTo.has('grid')
        const useOcclusionPlane = opts.occlusion && (wantVert || wantEdge || wantMid || wantFace || wantGrid)
        const backface = !!opts.backfaceCulling

        const {origin: rayStart, direction: rayDir} = view.winToRay(mval)
        const distPxSq = distPx * distPx

        let result: SnapResult | null = null
        let hit: ReturnType<SnapContext['raycast']> = null

        if (useOcclusionPlane || wantFace) {
            hit = this.raycast(rayStart, rayDir, backface)
            if (hit && wantFace) {
                const p = view.projectFloatView(hit.loc)
                const d = p ? Math.hypot(p[0] - mval[0], p[1] - mval[1]) : 0
                result = {loc: hit.loc, no: hit.no, type: 'face', distPx: d, target: hit.target, index: hit.tri}
            }
        }

        if (wantVert || wantEdge || wantMid) {
            const data = new SnapData(view, mval, distPxSq)
            let elem: SnapTargetType | null = null

            if (useOcclusionPlane && hit) {
                // First snap to the polygon under the cursor, before the plane that would hide its
                // own edges and vertices is added (`snap_polygon`).
                const m = hit.target
                const face = m.triFace[hit.tri]
                if (face >= 0) {
                    if (wantVert) {
                        for (const vi of m.faceVerts[face]) {
                            if (m.vertOk[vi] && data.snapPoint(vertAt(m, vi), vi, m)) elem = 'vertex'
                        }
                    }
                    if (wantEdge || wantMid) {
                        for (const ei of m.faceEdges[face]) {
                            if (m.edgeOk[ei] && data.snapEdge(rayStart, rayDir, vertAt(m, m.edges[ei * 2]), vertAt(m, m.edges[ei * 2 + 1]), ei, m)) elem = 'edge'
                        }
                    }
                }
                data.clipPlanes.push(occlusionPlaneCreate(rayStart, rayDir, hit.loc, hit.no))
            }

            // `snapObjectsRay`: every target, verts then edges ('snap to edge' stands in for midpoints).
            for (const m of this.targets) {
                if (wantVert) {
                    const n = m.positions.length / 3
                    for (let i = 0; i < n; i++) {
                        if (m.vertOk[i] && data.snapPoint(vertAt(m, i), i, m)) elem = 'vertex'
                    }
                }
                if (wantEdge || wantMid) {
                    const n = m.edges.length / 2
                    for (let i = 0; i < n; i++) {
                        if (m.edgeOk[i] && data.snapEdge(rayStart, rayDir, vertAt(m, m.edges[i * 2]), vertAt(m, m.edges[i * 2 + 1]), i, m)) elem = 'edge'
                    }
                }
            }

            if (elem === 'edge' && wantMid) {
                elem = this._snapEdgePoints(data, rayStart, rayDir, distPxSq, wantEdge, wantMid)
            }
            if (elem === 'edge' && !wantEdge) elem = null

            if (elem) {
                const n = data.nearest
                let no = copyV3(n.no)
                if (elem === 'vertex' && n.target) no = this._vertexNormal(n.target, n.index)
                result = {loc: copyV3(n.co), no, type: elem, distPx: Math.sqrt(n.distSq), target: n.target, index: n.index}
            }
        }

        if (!result && wantGrid) {
            const grid = this._snapGrid(view, mval, rayStart, rayDir, opts)
            if (grid) result = grid
        }
        return result
    }

    /** `SnapData::snap_edge_points_impl` (`transform_snap_object.cc:225`): refine an edge hit to its midpoint. */
    private _snapEdgePoints(data: SnapData, rayStart: Vec3, rayDir: Vec3, distPxSqOrig: number, wantEdge: boolean, wantMid: boolean): SnapTargetType | null {
        const n = data.nearest
        const m = n.target
        if (!m) return 'edge'
        const ei = n.index
        const va = vertAt(m, m.edges[ei * 2])
        const vb = vertAt(m, m.edges[ei * 2 + 1])
        const lambda = isectRayLineV3(rayStart, rayDir, va, vb)
        let elem: SnapTargetType = 'edge'
        if (lambda !== null) {
            data.nearest.distSq = distPxSqOrig
            const eModeLen = (wantEdge ? 1 : 0) + (wantMid ? 1 : 0)
            let range = 1 / (2 * eModeLen - 1)
            if (wantMid) {
                range *= eModeLen - 1
                if (range < lambda && lambda < 1 - range) {
                    const vmid = midV3(va, vb)
                    if (data.snapPoint(vmid, ei, m)) {
                        data.nearest.no = subV3(vb, va)
                        elem = 'edgeMidpoint'
                    }
                }
            }
        }
        return elem
    }

    /** The averaged normal of the triangles around a vertex, Blender's `copy_vert_no`. */
    private _vertexNormal(m: SnapTargetMesh, vi: number): Vec3 {
        const n: Vec3 = [0, 0, 0]
        const count = m.tris.length / 3
        for (let i = 0; i < count; i++) {
            if (m.tris[i * 3] !== vi && m.tris[i * 3 + 1] !== vi && m.tris[i * 3 + 2] !== vi) continue
            const v0 = vertAt(m, m.tris[i * 3])
            const v1 = vertAt(m, m.tris[i * 3 + 1])
            const v2 = vertAt(m, m.tris[i * 3 + 2])
            const fn = crossV3(subV3(v1, v0), subV3(v2, v0))
            n[0] += fn[0]
            n[1] += fn[1]
            n[2] += fn[2]
        }
        if (normalizeV3(n) === 0) return [0, 0, 1]
        return n
    }

    /** `snap_grid` (`transform_snap_object.cc:1032`). */
    private _snapGrid(view: TransformView, mval: Vec2, rayStart: Vec3, rayDir: Vec3, opts: SnapProjectOptions): SnapResult | null {
        const data = new SnapData(view, mval, Infinity)
        const gridDist = opts.gridSize && opts.gridSize > 0 ? opts.gridSize : gridViewScale(view)
        const round = (v: Vec3): Vec3 => [
            Math.round(v[0] / gridDist) * gridDist,
            Math.round(v[1] / gridDist) * gridDist,
            Math.round(v[2] / gridDist) * gridDist,
        ]

        if (opts.initCo) {
            const co = round(opts.initCo)
            if (data.snapPoint(co, -1, null)) {
                return {loc: co, no: [0, 0, 1], type: 'grid', distPx: Math.sqrt(data.nearest.distSq), target: null, index: -1}
            }
            return null
        }

        // The grid planes: the ground plane, the two vertical planes, and the view plane through
        // the current position (`snap_object_context_runtime_init`, `:1215`).
        const planes: Vec4[] = [[0, 0, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
        if (Math.abs(rayDir[0]) < Math.abs(rayDir[1])) {
            planes[1] = [0, 1, 0, 0]
            planes[2] = [1, 0, 0, 0]
        } else {
            planes[1] = [1, 0, 0, 0]
            planes[2] = [0, 1, 0, 0]
        }
        const curr = opts.currCo ?? [0, 0, 0]
        planes[3] = planeFromPointNormalV3(curr, view.viewinvCol(2))

        for (const plane of planes) {
            const no: Vec3 = [plane[0], plane[1], plane[2]]
            // `isect_ray_plane_v3` with the plane equation: `-plane[3]` is a point's offset.
            const lambda = isectRayPlaneV3Factor(rayStart, rayDir, [no[0] * -plane[3], no[1] * -plane[3], no[2] * -plane[3]], no)
            if (lambda === null || lambda <= 0) continue
            let co = round([rayStart[0] + rayDir[0] * lambda, rayStart[1] + rayDir[1] * lambda, rayStart[2] + rayDir[2] * lambda])
            if (data.snapPoint(co, -1, null)) {
                if (!view.isPersp && view.isAxisAlignedOrtho) {
                    // Project in the current position's plane.
                    co = [co[0] + curr[0] * no[0], co[1] + curr[1] * no[1], co[2] + curr[2] * no[2]]
                }
                return {loc: co, no, type: 'grid', distPx: Math.sqrt(data.nearest.distSq), target: null, index: -1}
            }
        }
        return null
    }
}

/** The metric grid steps `view3d_grid_steps` gives. */
const GRID_STEPS = [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000]

/**
 * `ED_view3d_grid_view_scale` (`view3d_draw.cc:800`): the grid step, which shrinks with zoom in an
 * axis-aligned orthographic view and is the unit scale (1) otherwise.
 */
export function gridViewScale(view: TransformView): number {
    if (!view.isPersp && view.isAxisAlignedOrtho) {
        // Decrease the distance between grid snap points depending on zoom.
        const dist = 12 / (view.winx * view.winmat[0])
        let gridScale = GRID_STEPS[0]
        for (let i = 0; i < GRID_STEPS.length; i++) {
            gridScale = GRID_STEPS[i]
            if (gridScale > dist || i === GRID_STEPS.length - 1) break
        }
        return gridScale
    }
    return 1
}
