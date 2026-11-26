/**
 * Spin - sweep geometry around an axis.
 *
 * Port of `bmo_spin_exec` (`source/blender/bmesh/operators/bmo_dupe.cc:547`), with the sanity checks
 * `edbm_spin_exec` (`source/blender/editors/mesh/editmesh_extrude_spin.cc:39`) applies to `use_merge`
 * before it calls the operator.
 *
 * Blender's spin owns almost no topology code. It runs `extrude_face_region` (or `duplicate`) once per
 * step, rotates the result about the axis, and optionally splices the final ring back onto the first.
 * That structure is reproduced exactly here: the work is done by {@link extrudeFaceRegion},
 * {@link extrudeEdgeOnly}, {@link duplicateGeometry} and {@link vertSplice}, and this file only
 * sequences them. It is the reason a spin inherits the extrude's n-gon handling and its winding rules
 * for free, and the reason a revolve comes out as quads rather than as triangles.
 *
 * Two details in the original are easy to miss and both matter:
 *
 * - **Each step's rotation is absolute, not incremental.** Blender builds `rmat` for the total angle
 *   `angle * (a + 1) / steps` and, from the second step on, first resets every new vertex to the
 *   un-rotated position of the input vertex it descends from. Chaining `steps` small rotations instead
 *   accumulates floating-point error around the ring (Blender bug #148890), and a 360 degree sweep no
 *   longer closes cleanly.
 * - **Every duplicate remembers which input vertex it came from.** Blender stores that index inside
 *   `v->no[0]` - its own comment calls this "Evil!" - because the duplicate operator copies the normal
 *   along with everything else, so the link propagates for free. {@link SpinResult.originOf} is the
 *   same map without the trick, and both the position reset and the `use_merge` splice need it.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges} from '../bmesh/structure'
import {edgeFindDouble, edgeSplice, faceFindDouble, vertSplice} from '../bmesh/splice'
import {Mat4, mat4RotationAxis, mat4TransformDir, v3normalize, Vec3} from '../math'
import {duplicateGeometry} from '../ops/duplicate'
import {extrudeEdgeOnly, extrudeFaceRegion, translateVerts} from '../ops/extrude'

export interface SpinOptions {
    /** Point the axis passes through. Blender's `cent`. */
    center?: Vec3
    /** Direction to rotate about; normalised internally. Blender's `axis`. */
    axis?: Vec3
    /**
     * Translation applied per step, turning the sweep into a screw or a helix. Blender's `dvec`.
     * The offset itself is rotated with the geometry, and scaled by the step number.
     */
    dvec?: Vec3
    /** Total sweep in radians. Blender's `angle`. */
    angle?: number
    /** Number of steps. Blender's `steps`. A full turn needs at least 3 for `useMerge` to apply. */
    steps?: number
    /**
     * Splice the last ring back onto the first instead of leaving a duplicate seam. Blender's
     * `use_merge`, and like Blender it is ignored below 3 steps and in duplicate mode. The caller is
     * responsible for only asking for it on a full revolution - `edbm_spin_exec` checks
     * `fabsf(fabsf(angle) - 2*PI) <= 1e-6` before passing it on.
     */
    useMerge?: boolean
    /** Copy the input each step rather than extruding it, leaving separate islands. Blender's `use_duplicate`. */
    useDuplicate?: boolean
    /** Wind the swept faces the other way round. Blender's `use_normal_flip`. */
    useNormalFlip?: boolean
}

export interface SpinInput {
    verts?: Iterable<BMVert>
    edges?: Iterable<BMEdge>
    faces?: Iterable<BMFace>
}

export interface SpinResult {
    /**
     * The last step's geometry - Blender's `geom_last.out` slot. Seeded with the input, so a zero-step
     * spin returns exactly what it was given.
     */
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
    /** Every vertex the spin created and left alive, in creation order. */
    newVerts: BMVert[]
    /** Every edge the spin created and left alive. */
    newEdges: BMEdge[]
    /** Every face the spin created and left alive, in creation order. */
    newFaces: BMFace[]
    /**
     * Each vertex the spin produced mapped back to the input vertex it descends from, plus the input
     * vertices mapped to themselves. Blender's `v->no[0]` index trick. Generators built on the spin
     * need it to find all the copies of one profile point - the lathe welds the copies of a point that
     * sits on the axis, exactly as the Screw modifier's `mesh_remove_doubles_on_axis` does.
     */
    originOf: Map<BMVert, BMVert>
}

/**
 * One step's output.
 *
 * `verts`, `edges` and `faces` are Blender's `geom.out`, which the extrude operator copies straight
 * out of the duplicate it runs internally - *before* it stitches the sides on. So the side faces are
 * deliberately not in there: a wire ring extruded once becomes a ribbon, and the next step has to
 * sweep the new rim edges, not the ribbon's faces. `created` carries everything the step made, for
 * the caller's bookkeeping only.
 */
interface StepGeom {
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
    created: BMFace[]
    vertMap: Map<BMVert, BMVert>
}

/**
 * `bmo_rotate_exec`: shift to the centre, apply the rotation, shift back.
 * The matrix has no translation of its own, so transforming as a direction is the 3x3 multiply.
 */
function rotateVerts(verts: Iterable<BMVert>, center: Vec3, rmat: Mat4): void {
    for (const v of verts) {
        const p = mat4TransformDir(rmat, [v.x - center[0], v.y - center[1], v.z - center[2]])
        v.setCo(p[0] + center[0], p[1] + center[1], p[2] + center[2])
    }
}

/** `BM_vert_is_wire_endpoint` (`bmesh_query.cc`): one wire edge and nothing else. */
function vertIsWireEndpoint(v: BMVert): boolean {
    const e = v.e
    if (e && e.l === null) return e.diskNext(v) === e
    return false
}

/**
 * One extrude step, dispatching the way `bmo_extrude_face_region_exec` does internally.
 *
 * Blender has a single operator that copes with faces, wire edges and loose vertices at once; the
 * kernel splits the first two into {@link extrudeFaceRegion} and {@link extrudeEdgeOnly}, and has no
 * path for the third. The loose-vertex case is the `isovert_map.out` block at the end of
 * `bmo_extrude_face_region_exec` (`bmo_extrude.cc:594`): a vertex with no input edge or face is
 * duplicated and joined to its copy by a wire edge, which is how spinning a single vertex draws a
 * circle. Reproduced here because the extrude ops do not cover it.
 */
function spinExtrudeStep(bm: BMesh, geom: StepGeom, options: {
    keepOriginal: boolean, useNormalFlip: boolean, useNormalFromAdjacent: boolean,
}): StepGeom {
    const vertMap = new Map<BMVert, BMVert>()
    const verts: BMVert[] = []
    const edges: BMEdge[] = []
    const faces: BMFace[] = []
    const created: BMFace[] = []

    if (geom.faces.length) {
        const res = extrudeFaceRegion(bm, geom.faces, {
            keepOriginal: options.keepOriginal,
            useNormalFlip: options.useNormalFlip,
            // `skip_input_flip=%b ... true` (`bmo_dupe.cc:638`). Spin is the only caller that passes
            // it, and it always passes true: the seed profile is the user's own geometry, not one
            // side of a new solid, so a spin never reverses it even when it survives the step.
            skipInputFlip: true,
            selectResult: false,
        })
        if (res) {
            for (const [src, dst] of res.vertMap) vertMap.set(src, dst)
            verts.push(...res.verts)
            faces.push(...res.faces)
            created.push(...res.faces, ...res.sideFaces)
            // `geom.out` of the underlying duplicate is its verts, edges and faces; the edges of the
            // duplicated region are exactly the edges of the duplicated faces.
            const seen = new Set<BMEdge>()
            for (const f of res.faces) {
                for (const l of f.eachLoop()) if (l.e && !seen.has(l.e)) seen.add(l.e)
            }
            edges.push(...seen)
        }
    } else if (geom.edges.length) {
        const res = extrudeEdgeOnly(bm, geom.edges, {
            useNormalFlip: options.useNormalFlip,
            useNormalFromAdjacent: options.useNormalFromAdjacent,
            selectResult: false,
        })
        if (res) {
            for (const [src, dst] of res.vertMap) vertMap.set(src, dst)
            verts.push(...res.verts)
            // The side faces are not part of `geom.out`; only the duplicated wire is.
            created.push(...res.sideFaces)
            // The duplicate of each input edge, in input order, which is what the next step sweeps.
            for (const e of geom.edges) {
                const ne = res.edgeMap.get(e)
                if (ne) edges.push(ne)
            }
        }
    }

    // Loose vertices - the `isovert_map.out` pass.
    for (const v of geom.verts) {
        if (vertMap.has(v)) continue
        const v2 = bm.vertCreate(v.x, v.y, v.z, v)
        vertMap.set(v, v2)
        verts.push(v2)
        // "not essential, but ensures face normals from extruded edges are contiguous"
        let a = v
        let b = v2
        if (vertIsWireEndpoint(v) && v.e!.v1 === v) {
            a = v2
            b = v
        }
        bm.edgeCreate(a, b, undefined, {noDouble: true})
    }

    return {verts, edges, faces, created, vertMap}
}

/**
 * Extrude or duplicate geometry `steps` times, rotating by `angle / steps` about `(center, axis)` at
 * each step and optionally translating by `dvec`.
 *
 * Port of `bmo_spin_exec`. Selection is left alone, because Blender's operator works in operator flag
 * layers rather than in element header flags; the caller selects the result if it wants to.
 */
export function spin(bm: BMesh, input: SpinInput, opts: SpinOptions = {}): SpinResult {
    const center = opts.center ?? [0, 0, 0]
    const axis = v3normalize(opts.axis ?? [0, 0, 1])
    const dvec = opts.dvec ?? [0, 0, 0]
    const useDvec = dvec[0] !== 0 || dvec[1] !== 0 || dvec[2] !== 0
    const steps = opts.steps ?? 12
    const angleTotal = opts.angle ?? Math.PI * 2
    const useDuplicate = opts.useDuplicate === true
    const useNormalFlip = opts.useNormalFlip === true
    // "Caller needs to perform other sanity checks (such as the spin being 360d)."
    const useMerge = opts.useMerge === true && steps >= 3 && !useDuplicate

    // Pull in everything the listed faces and edges depend on, as the duplicate operator does, so the
    // first step's input is closed under its own topology.
    const inFaces = new Set(input.faces ?? [])
    const inEdges = new Set(input.edges ?? [])
    const inVerts = new Set(input.verts ?? [])
    for (const f of inFaces) {
        for (const l of f.eachLoop()) {
            inVerts.add(l.v)
            if (l.e) inEdges.add(l.e)
        }
    }
    for (const e of inEdges) {
        inVerts.add(e.v1)
        inVerts.add(e.v2)
    }

    // Blender's `vtable` and `vtable_coords`, both indexed by the "evil" origin index.
    const originOf = new Map<BMVert, BMVert>()
    const originCo = new Map<BMVert, Vec3>()
    for (const v of inVerts) {
        originOf.set(v, v)
        originCo.set(v, [v.x, v.y, v.z])
    }

    const newVerts: BMVert[] = []
    const newFaces: BMFace[] = []
    // Edges are created implicitly by `faceCreate`, so rather than guess which ones a step made, the
    // set that existed beforehand is recorded once and the result is read off the new geometry below.
    const edgesBefore = new Set(bm.edges)

    // `BMO_slot_copy(op, slots_in, "geom", op, slots_out, "geom_last.out")`.
    let geomLast: StepGeom = {
        verts: [...inVerts], edges: [...inEdges], faces: [...inFaces], created: [], vertMap: new Map(),
    }

    for (let a = 0; a < steps; a++) {
        // "Calculate rotation matrix for this step independently to avoid floating-point error
        // accumulation."
        const stepAngle = angleTotal * ((a + 1) / steps)
        const rmat = mat4RotationAxis(axis, stepAngle)

        if (useDuplicate) {
            // Duplicate mode copies the *original* geometry every step and rotates it by the total
            // angle, so the copies are independent islands rather than a connected sweep.
            const dup = duplicateGeometry(bm, {verts: inVerts, edges: inEdges, faces: inFaces}, false)
            for (const [src, dst] of dup.vertMap) originOf.set(dst, originOf.get(src)!)
            rotateVerts(dup.verts, center, rmat)
            newVerts.push(...dup.verts)
            newFaces.push(...dup.faces)
            geomLast = {
                verts: dup.verts, edges: dup.edges, faces: dup.faces,
                created: dup.faces, vertMap: dup.vertMap,
            }
        } else {
            const ext = spinExtrudeStep(bm, geomLast, {
                keepOriginal: useMerge,
                useNormalFlip: useNormalFlip && a === 0,
                useNormalFromAdjacent: a !== 0,
            })
            for (const [src, dst] of ext.vertMap) originOf.set(dst, originOf.get(src)!)
            newVerts.push(...ext.verts)
            newFaces.push(...ext.created)

            if (!(useMerge && a === steps - 1)) {
                if (a !== 0) {
                    // "Reset each new vert's location to its un-rotated origin so the rotate below
                    // runs as a single fresh rotation from the original position."
                    for (const v of ext.verts) {
                        const co = originCo.get(originOf.get(v)!)!
                        v.setCo(co[0], co[1], co[2])
                    }
                }
                rotateVerts(ext.verts, center, rmat)
                geomLast = ext
            } else {
                // Merge first/last vertices and edges. The new ring is vertex for vertex a copy of the
                // input, so the weld is a splice rather than a point merge: no face is rebuilt and no
                // attribute is interpolated, the faces simply end up naming the original vertices.
                for (const v of ext.verts) vertSplice(bm, originOf.get(v)!, v)
                // The splice leaves the new ring's own edges lying on top of the input's; drop them.
                for (const e of ext.edges) {
                    if (!bm.edges.has(e)) continue
                    const double = edgeFindDouble(e)
                    if (double) edgeSplice(bm, double, e)
                }
                // "Full copies of faces may cause overlap."
                for (const f of ext.faces) {
                    if (!bm.faces.has(f)) continue
                    if (faceFindDouble(f)) bm.faceKill(f)
                }
            }
        }

        if (useDvec) {
            const d = mat4TransformDir(rmat, dvec)
            const k = a + 1
            translateVerts(geomLast.verts, d[0] * k, d[1] * k, d[2] * k)
        }
    }

    const liveVerts = newVerts.filter(v => bm.verts.has(v))
    const liveFaces = newFaces.filter(f => bm.faces.has(f))

    // Everything reachable from the new geometry that was not there before the spin.
    const newEdges: BMEdge[] = []
    const seenEdge = new Set<BMEdge>()
    const noteEdge = (e: BMEdge) => {
        if (edgesBefore.has(e) || seenEdge.has(e)) return
        seenEdge.add(e)
        newEdges.push(e)
    }
    for (const f of liveFaces) for (const l of f.eachLoop()) if (l.e) noteEdge(l.e)
    for (const v of liveVerts) for (const e of diskEdges(v)) noteEdge(e)

    return {
        verts: geomLast.verts.filter(v => bm.verts.has(v)),
        edges: geomLast.edges.filter(e => bm.edges.has(e)),
        faces: geomLast.faces.filter(f => bm.faces.has(f)),
        newVerts: liveVerts,
        newEdges,
        newFaces: liveFaces,
        originOf,
    }
}
