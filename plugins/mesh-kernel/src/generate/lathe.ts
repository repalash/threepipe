/**
 * Lathe - revolve a profile around an axis - and the torus built on top of it.
 *
 * There is no new algorithm here, and there should not be. Blender makes a lathed surface by drawing
 * the profile as a wire polyline and spinning it, which is what the Spin tool does interactively and
 * what the Screw modifier does as a modifier; this file is the same composition over {@link spin}.
 * The one thing the spin operator does not do for itself is the axis weld, and that is taken from
 * `mesh_remove_doubles_on_axis` (`source/blender/modifiers/intern/MOD_screw.cc:123`): a profile point
 * within `mergeDistance` of the axis is snapped onto it, and every copy the revolution makes of that
 * point is welded back onto the original. Without it the pole of a cone or a sphere is a ring of
 * coincident vertices joined by zero-area quads.
 *
 * Because the sweep is an extrude, every face is a quad, except at a pole where the weld turns the
 * quad into a triangle. That is the difference from `THREE.LatheGeometry`, which emits triangles
 * everywhere and cannot be edited further.
 *
 * The torus is `add_torus` from `scripts/startup/bl_operators/add_mesh_torus.py` - Blender has no C
 * torus operator, it is a Python add-on - expressed as a closed circular profile revolved a full turn.
 * Parameter names and vertex ordering follow the add-on, and `lathe.test.ts` checks the result against
 * a transcription of `add_torus` point for point.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdges, radialLoops} from '../bmesh/structure'
import {bmToMesh} from '../bmesh/convert'
import {MeshData} from '../MeshData'
import {v3add, v3dot, v3mul, v3normalize, v3sub, Vec3} from '../math'
import {weldVerts} from '../ops/weld'
import {spin} from './spin'

/** A profile point: a 2D `[radial, axial]` pair in the plane of revolution, or an absolute 3D point. */
export type LatheProfilePoint = [number, number] | Vec3

export interface LatheOptions {
    /**
     * The profile, in order. A 2D `[radial, axial]` pair is measured from {@link center}, `radial`
     * along the reference direction perpendicular to the axis and `axial` along the axis itself; a 3D
     * point is taken as it stands.
     *
     * Ordered so that the profile advances along `+axis`, the surface faces away from the axis.
     * Reverse the profile to turn it inside out.
     */
    profile: LatheProfilePoint[]
    /** Axis of revolution. Default `[0, 1, 0]`. */
    axis?: Vec3
    /** A point the axis passes through. Default the origin. */
    center?: Vec3
    /** Number of steps around the axis. Default 32. */
    segments?: number
    /** Sweep in radians. Default a full turn. */
    angle?: number
    /** Join the last profile point back to the first before revolving, which is how a torus is made. */
    closed?: boolean
    /**
     * Fill the two end rings with an n-gon each. Only applies to a full revolution of an open profile,
     * and only to an end that is not already closed off by sitting on the axis.
     */
    capEnds?: boolean
    /**
     * How close to the axis a profile point has to be to count as being on it, and so to have its
     * copies welded rather than left as a ring of doubles. Blender's `merge_threshold` in
     * `mesh_remove_doubles_on_axis`. Default `1e-6`, on the assumption that an authored profile means
     * a radius of exactly zero.
     */
    mergeDistance?: number
}

export interface LatheResult {
    /** Every vertex of the lathed surface, profile point by profile point along each ring. */
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
    /**
     * The surviving vertices of each profile point's ring, in rotation order. A point that sits on the
     * axis has a single-entry column. Indexed the same way as {@link LatheOptions.profile}.
     */
    columns: BMVert[][]
    /** The cap faces, if {@link LatheOptions.capEnds} produced any. */
    caps: BMFace[]
}

/** A full revolution to within the tolerance `edbm_spin_exec` uses before enabling `use_merge`. */
function isFullTurn(angle: number): boolean {
    return Math.abs(Math.abs(angle) - Math.PI * 2) <= 1e-6
}

/**
 * A direction perpendicular to the axis, for 2D profiles to measure their radius along.
 *
 * `+X` unless the axis is nearly `+/-X`, which puts a `[radial, axial]` profile in the XZ plane for a
 * Z axis - the plane Blender's torus add-on builds its cross-section in - and in the XY plane for a
 * Y axis.
 */
function radialReference(axis: Vec3): Vec3 {
    const ref: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    return v3normalize(v3sub(ref, v3mul(axis, v3dot(ref, axis))))
}

/**
 * Cap one end ring with a single n-gon.
 *
 * The winding is read off the surface rather than assumed: the ring's edges each have exactly one face
 * so far, and a face on the other side of an edge has to traverse it the other way round, so the cap
 * runs against whichever direction that face runs. This is the same rule `BM_face_create` relies on
 * every caller to apply, and getting it wrong leaves a cap whose normal points into the solid.
 */
function capRing(bm: BMesh, ring: BMVert[]): BMFace | null {
    if (ring.length < 3) return null

    const e = diskEdgeExists(ring[0], ring[1])
    if (!e) return null
    let forwards = false
    for (const l of radialLoops(e)) {
        // `l.v === ring[0]` means the existing face runs ring[0] -> ring[1], so the cap must not.
        forwards = l.v !== ring[0]
        break
    }

    const verts = forwards ? ring : [...ring].reverse()
    return bm.faceCreate(verts)
}

/**
 * Revolve a profile around an axis, adding the result to `bm`.
 *
 * The profile is built as a wire polyline and handed to {@link spin}, which is how Blender's own Spin
 * tool and Screw modifier produce a lathe.
 */
export function lathe(bm: BMesh, opts: LatheOptions): LatheResult {
    const profile = opts.profile
    if (profile.length < 2) {
        throw new Error(`mesh-kernel: a lathe profile needs at least 2 points, got ${profile.length}`)
    }

    const axis = v3normalize(opts.axis ?? [0, 1, 0])
    if (axis[0] === 0 && axis[1] === 0 && axis[2] === 0) {
        throw new Error('mesh-kernel: the lathe axis cannot be zero length')
    }
    const center = opts.center ?? [0, 0, 0]
    const segments = opts.segments ?? 32
    if (segments < 3) throw new Error(`mesh-kernel: a lathe needs at least 3 segments, got ${segments}`)
    const angle = opts.angle ?? Math.PI * 2
    const closed = opts.closed === true
    const mergeDistance = opts.mergeDistance ?? 1e-6
    const fullTurn = isFullTurn(angle)

    const radial = radialReference(axis)

    // Resolve the profile, and tag the points that sit on the axis. This is the first half of
    // `mesh_remove_doubles_on_axis`: project onto the axis, and if the point is within the threshold
    // of its own projection, snap it exactly onto the axis so its copies really do coincide.
    const mergeDistanceSq = mergeDistance * mergeDistance
    const points: Vec3[] = []
    const onAxis: boolean[] = []
    for (const p of profile) {
        const co: Vec3 = p.length === 2
            ? v3add(center, v3add(v3mul(radial, p[0]), v3mul(axis, p[1])))
            : [p[0], p[1], p[2]]
        const d = v3sub(co, center)
        const axisCo = v3add(center, v3mul(axis, v3dot(d, axis)))
        const off = v3sub(co, axisCo)
        if (v3dot(off, off) <= mergeDistanceSq) {
            points.push(axisCo)
            onAxis.push(true)
        } else {
            points.push(co)
            onAxis.push(false)
        }
    }
    if (onAxis.every(Boolean)) {
        throw new Error('mesh-kernel: every lathe profile point lies on the axis, nothing to revolve')
    }
    for (let i = 1; i < points.length; i++) {
        if (onAxis[i] && onAxis[i - 1]) {
            throw new Error(`mesh-kernel: lathe profile points ${i - 1} and ${i} both lie on the axis`)
        }
    }

    // The profile as a wire polyline. Vertices are created in profile order and edges in profile
    // order, which is what makes the spin lay its rings out predictably.
    const profileVerts = points.map(co => bm.vertCreate(co[0], co[1], co[2]))
    const profileEdges: BMEdge[] = []
    for (let i = 0; i + 1 < profileVerts.length; i++) {
        profileEdges.push(bm.edgeCreate(profileVerts[i], profileVerts[i + 1]))
    }
    if (closed) profileEdges.push(bm.edgeCreate(profileVerts[profileVerts.length - 1], profileVerts[0]))

    const res = spin(bm, {verts: profileVerts, edges: profileEdges}, {
        center,
        axis,
        angle,
        steps: segments,
        useMerge: fullTurn,
        // With the profile advancing along +axis, the unflipped sweep faces the axis. See the header.
        useNormalFlip: true,
    })

    // Group every surviving vertex under the profile point it came from. `originOf` is filled input
    // first and then one ring at a time, and each ring in profile order, so each column comes out in
    // rotation order with ring 0 first.
    const columns: BMVert[][] = profileVerts.map(() => [])
    const columnOf = new Map<BMVert, BMVert[]>()
    for (let i = 0; i < profileVerts.length; i++) columnOf.set(profileVerts[i], columns[i])
    for (const [descendant, origin] of res.originOf) {
        if (!bm.verts.has(descendant)) continue
        columnOf.get(origin)?.push(descendant)
    }

    // Second half of `mesh_remove_doubles_on_axis`: every copy of an on-axis point is a double of the
    // original, so map the whole column onto it and weld once. The quads along that column each lose
    // an edge and become triangles, which is the pole fan of a cone or a sphere.
    //
    // A weld rather than a splice, and rather than a point merge: the two vertices at each end of a
    // pole sweep edge collapse together, which is precisely the case `bmo_weld_verts_exec` handles by
    // collapsing the edge and rebuilding the face one corner shorter. Blender's Screw modifier ends
    // on `geometry::mesh_merge_verts` for the same reason, also with a single map built up front.
    const targetmap = new Map<BMVert, BMVert>()
    for (let i = 0; i < profileVerts.length; i++) {
        if (!onAxis[i]) continue
        const v0 = profileVerts[i]
        for (const v of columns[i]) if (v !== v0) targetmap.set(v, v0)
        columns[i] = [v0]
    }
    if (targetmap.size) weldVerts(bm, targetmap)

    const caps: BMFace[] = []
    if (opts.capEnds && !closed && fullTurn) {
        const first = capRing(bm, columns[0])
        if (first) caps.push(first)
        const last = capRing(bm, columns[columns.length - 1])
        if (last) caps.push(last)
    }

    const verts: BMVert[] = []
    for (const column of columns) for (const v of column) verts.push(v)

    const edges = new Set<BMEdge>()
    const faces = new Set<BMFace>()
    for (const v of verts) {
        for (const e of diskEdges(v)) {
            edges.add(e)
            for (const l of radialLoops(e)) faces.add(l.f)
        }
    }

    return {verts, edges: [...edges], faces: [...faces], columns, caps}
}

/** Revolve a profile into a standalone {@link MeshData}. */
export function primitiveLathe(opts: LatheOptions): MeshData {
    const bm = new BMesh()
    lathe(bm, opts)
    return bmToMesh(bm)
}

export interface TorusOptions {
    /** Blender's `major_radius`: origin to the centre of the cross section. Default 1. */
    majorRadius?: number
    /** Blender's `minor_radius`: radius of the cross section. Default 0.25. */
    minorRadius?: number
    /** Blender's `major_segments`: steps around the main ring. Default 48. */
    majorSegments?: number
    /** Blender's `minor_segments`: steps around the cross section. Default 12. */
    minorSegments?: number
    /**
     * Axis of revolution. Default `[0, 0, 1]`, which is the axis `add_torus` uses - it rotates its
     * cross section about Z - so the default output matches Blender's vertex for vertex.
     */
    axis?: Vec3
    /** A point the axis passes through. Default the origin. */
    center?: Vec3
}

/**
 * A torus, as a circular profile revolved a full turn.
 *
 * Port of `add_torus` (`scripts/startup/bl_operators/add_mesh_torus.py:21`). Blender builds it in
 * Python because it is a composition, not a primitive: the cross section is
 * `(major_rad + cos(a) * minor_rad, 0, sin(a) * minor_rad)` sampled `minor_segments` times, rotated
 * about Z in `major_segments` steps. Written as a lathe that is a closed profile of the same points,
 * and the vertex order - major ring outermost, cross section innermost - falls out of the spin.
 */
export function primitiveTorus(opts: TorusOptions = {}): MeshData {
    const majorRadius = opts.majorRadius ?? 1
    const minorRadius = opts.minorRadius ?? 0.25
    const majorSegments = opts.majorSegments ?? 48
    const minorSegments = opts.minorSegments ?? 12

    const profile: LatheProfilePoint[] = []
    for (let i = 0; i < minorSegments; i++) {
        const a = Math.PI * 2 * i / minorSegments
        profile.push([majorRadius + Math.cos(a) * minorRadius, Math.sin(a) * minorRadius])
    }

    return primitiveLathe({
        profile,
        axis: opts.axis ?? [0, 0, 1],
        center: opts.center,
        segments: majorSegments,
        closed: true,
    })
}
