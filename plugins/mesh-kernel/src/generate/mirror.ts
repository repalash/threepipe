/**
 * Mirror: duplicate geometry, reflect the copy, and weld it back along the mirror plane.
 *
 * Ported from `source/blender/bmesh/operators/bmo_mirror.cc` (`bmo_mirror_exec`). That operator is
 * four steps and this file is the same four: duplicate, scale the copy by -1 on the axis inside the
 * given space, flip the copy's UVs, and weld the copy's vertices back onto the originals that lie on
 * the plane. Blender's version reaches the last step through `weld_verts`, which is exactly what
 * {@link weldVerts} is, so the weld is shared rather than reimplemented.
 *
 * One thing `bmo_mirror.cc` does *not* do, and which this does: reverse the winding of the mirrored
 * faces. A reflection has a negative determinant, so a copy with the original winding faces inwards -
 * every mirrored face is inside out. Blender's edit-mode operator leaves that to the user's normal
 * recalculation; the mirror *modifier* does it properly, with
 * `bke::mesh_flip_faces(*result, result_faces.index_range().drop_front(src_faces.size()))`
 * (`blenkernel/intern/mesh_mirror.cc:326`). `mesh_flip_faces` keeps corner 0 in place and reverses
 * the rest, i.e. `(v0, v1, ... vn-1)` becomes `(v0, vn-1, ... v1)`, which is what is ported here.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {duplicateGeometry} from '../ops/duplicate'
import {weldVerts} from '../ops/weld'
import {copyElemAttrs, getComponent, setComponent} from '../bmesh/customdata'
import {Mat4, Vec3, mat4Identity, mat4Invert, mat4Multiply, mat4Scale, mat4TransformPoint} from '../math'
// The same "verts, edges, faces" selection shape every generator takes; declared once, in `array.ts`.
import type {ArrayInput as GeometryInput} from './array'

export interface MirrorOptions {
    /**
     * The space the mirror happens in. Blender's `mat` slot: coordinates are taken into this space,
     * negated on the axis, and taken back out. Defaults to the identity, i.e. mirroring about the
     * axis plane through the origin.
     */
    matrix?: Mat4
    /** Which axis is negated. Blender's `axis`, an index into the mirror space. Default `x`. */
    axis?: 'x' | 'y' | 'z'
    /**
     * Vertices this close to the mirror plane are welded to their reflection rather than duplicated.
     * Blender's `merge_dist`, default 0 - which still welds anything exactly on the plane, because
     * the test is `<=`.
     */
    mergeDistance?: number
    /** Flip the U of every `float2` corner layer on the mirrored faces. Blender's `mirror_u`. */
    mirrorU?: boolean
    /** Flip the V likewise. Blender's `mirror_v`. */
    mirrorV?: boolean
    /**
     * Flip within the UDIM tile rather than within `[0, 1]`. Blender's `mirror_udim`, which changes
     * `1 - u` into `ceil(u) - (u mod 1)`.
     */
    mirrorUdim?: boolean
    /**
     * Blender's `use_shapekey`, which makes the underlying `transform` operator move the active shape
     * key's coordinates alongside the vertex ones. **Not implemented**: the kernel has no shape keys.
     * Passing `true` throws rather than silently doing nothing.
     */
    useShapekey?: boolean
}

export interface MirrorResult {
    /**
     * The mirrored geometry, which is Blender's `geom.out`: the elements of the copy that are still
     * distinct elements afterwards. A vertex on the mirror plane welded onto its original is *not*
     * listed, because the surviving element there belongs to the original half; neither is a
     * mirrored face that the weld found already existed. Elements the weld *rebuilt* are listed,
     * because they are the mirrored element under a new handle.
     */
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
    /**
     * Original vertex to the vertex its mirror image ended up as. For a vertex on the mirror plane
     * that is the original itself, since its image was welded onto it.
     */
    vertMap: Map<BMVert, BMVert>
    /** Original face to its mirrored face, where that face is still a distinct face. */
    faceMap: Map<BMFace, BMFace>
    /** The duplicated vertices that were welded away, one per original on the mirror plane. */
    welded: BMVert[]
}

/**
 * Mirror `input` and weld the result back to it.
 *
 * Returns the mirrored geometry only; the originals stay where they are, which is what the operator
 * does (its `geom.out` is the duplicate).
 */
export function mirrorGeometry(
    bm: BMesh, input: GeometryInput, opts: MirrorOptions = {},
): MirrorResult {
    if (opts.useShapekey) {
        throw new Error('mesh-kernel: mirrorGeometry useShapekey is not supported; the kernel has no shape keys')
    }

    const axis = opts.axis === 'y' ? 1 : opts.axis === 'z' ? 2 : 0
    const dist = opts.mergeDistance ?? 0

    // Gather the same closure a duplicate would, so the loops below can be driven from the input.
    const srcFaces = new Set(input.faces ?? [])
    const srcEdges = new Set(input.edges ?? [])
    const srcVerts = new Set(input.verts ?? [])
    for (const f of srcFaces) {
        for (const l of f.eachLoop()) {
            srcVerts.add(l.v)
            if (l.e) srcEdges.add(l.e)
        }
    }
    for (const e of srcEdges) {
        srcVerts.add(e.v1)
        srcVerts.add(e.v2)
    }
    if (!srcVerts.size) {
        return {verts: [], edges: [], faces: [], vertMap: new Map(), faceMap: new Map(), welded: []}
    }

    // `BMO_op_initf(bm, &dupeop, ..., "duplicate geom=%s", ...)`.
    const dup = duplicateGeometry(bm, {
        verts: [...srcVerts], edges: [...srcEdges], faces: [...srcFaces],
    }, false)

    // `"scale verts=%fv vec=%v space=%s"`: the transform operator takes each vertex into `space`,
    // applies the scale, and takes it back out. A scale of -1 on one axis is the reflection.
    const space = opts.matrix ?? mat4Identity()
    const spaceInv = mat4Invert(space)
    const scale: Vec3 = [1, 1, 1]
    scale[axis] = -1
    const mirrorMat = mat4Multiply(mat4Multiply(space, mat4Scale(scale)), spaceInv)

    for (const v of srcVerts) {
        const nv = dup.vertMap.get(v)!
        const p = mat4TransformPoint(mirrorMat, [v.x, v.y, v.z])
        nv.setCo(p[0], p[1], p[2])
    }

    // Reverse the winding of every mirrored face. `mesh_flip_faces` swaps corners around corner 0,
    // so the face keeps its first vertex and runs the other way; doing it by rebuilding the face is
    // the linked-topology equivalent, since a BMesh loop cycle cannot simply be re-indexed.
    const flipped = new Map<BMFace, BMFace>()
    for (const f of srcFaces) {
        const mf = dup.faceMap.get(f)!
        flipped.set(f, flipFace(bm, mf))
    }

    // `if (mirror_u || mirror_v)`: flip the UVs of the copy's faces.
    if (opts.mirrorU || opts.mirrorV) {
        flipUvs(bm, [...flipped.values()], opts.mirrorU === true, opts.mirrorV === true,
            opts.mirrorUdim === true)
    }

    // Build the weld target map. Blender tests the *original* vertex's coordinate on the axis, in
    // the mirror space, against `merge_dist`, and welds the new vertex onto the old one.
    const targetmap = new Map<BMVert, BMVert>()
    for (const v of srcVerts) {
        const local = mat4TransformPoint(spaceInv, [v.x, v.y, v.z])
        if (Math.abs(local[axis]) <= dist) {
            const vNew = dup.vertMap.get(v)!
            targetmap.set(vNew, v)
        }
    }

    const welded: BMVert[] = []
    let weld: ReturnType<typeof weldVerts> | null = null
    if (targetmap.size) {
        weld = weldVerts(bm, targetmap)
        welded.push(...weld.killedVerts)
    }

    // Collect the copy: each mirrored element, or the element the weld rebuilt in its place. An
    // element the weld resolved onto a pre-existing one is deliberately skipped - that survivor is
    // part of the original half, not of the copy.
    const vertMap = new Map<BMVert, BMVert>()
    const verts: BMVert[] = []
    for (const v of srcVerts) {
        const nv = dup.vertMap.get(v)!
        if (bm.verts.has(nv)) {
            vertMap.set(v, nv)
            verts.push(nv)
        } else {
            // Welded onto its original, which is what it became.
            vertMap.set(v, targetmap.get(nv) ?? v)
        }
    }

    const edges: BMEdge[] = []
    for (const e of srcEdges) {
        const ne = dup.edgeMap.get(e)
        if (!ne) continue
        if (bm.edges.has(ne)) edges.push(ne)
        else {
            const replacement = weld?.edgeReplace.get(ne)
            if (replacement && bm.edges.has(replacement)) edges.push(replacement)
        }
    }

    const faceMap = new Map<BMFace, BMFace>()
    const faces: BMFace[] = []
    for (const f of srcFaces) {
        const mf = flipped.get(f)
        if (!mf) continue
        let survivor: BMFace | null = null
        if (bm.faces.has(mf)) survivor = mf
        else {
            const replacement = weld?.faceReplace.get(mf)
            if (replacement && bm.faces.has(replacement)) survivor = replacement
        }
        if (!survivor) continue
        faceMap.set(f, survivor)
        faces.push(survivor)
    }

    return {verts, edges, faces, vertMap, faceMap, welded}
}

/**
 * Rebuild `f` with its winding reversed, keeping the first corner in place.
 *
 * Port of `bke::mesh_flip_faces` (`blenkernel/intern/mesh_flip_faces.cc:40`). It swaps
 * `face[j + 1]` with `face.last(j)` for the first half of the face, which for a mesh means
 * reversing corners 1 onwards; per-corner data moves with the corner it belongs to.
 */
function flipFace(bm: BMesh, f: BMFace): BMFace {
    const loops = [...f.eachLoop()]
    if (loops.length < 3) return f

    // `(v0, v1, ... vn-1)` becomes `(v0, vn-1, ... v1)`.
    const order = [loops[0], ...loops.slice(1).reverse()]
    const verts = order.map(l => l.v)

    const nf = bm.faceCreate(verts, f)
    const dstLoops = [...nf.eachLoop()]
    for (let i = 0; i < order.length; i++) copyElemAttrs(order[i], dstLoops[i], bm.ldata)

    bm.faceKill(f)
    return nf
}

/**
 * Flip the U and/or V of every `float2` corner layer on the given faces.
 *
 * Port of the `mirror_u`/`mirror_v` block of `bmo_mirror_exec` (`bmo_mirror.cc:67`). Blender walks
 * `CustomData_number_of_layers(&bm->ldata, CD_PROP_FLOAT2)`; the kernel has no separate UV registry,
 * so every `float2` corner layer is treated as a UV map, which is the same set in practice.
 */
function flipUvs(
    bm: BMesh, faces: readonly BMFace[], mirrorU: boolean, mirrorV: boolean, mirrorUdim: boolean,
): void {
    const layers = bm.ldata.layers.filter(l => l.type === 'float2')
    if (!layers.length) return

    // `luv[0] = mirror_udim ? ceilf(uv_u) - fmodf(uv_u, 1.0f) : 1.0f - uv_u`. JS `%` is `fmod`.
    const flip = (value: number): number =>
        mirrorUdim ? Math.ceil(value) - (value % 1) : 1 - value

    for (const f of faces) {
        for (const l of f.eachLoop()) {
            for (const layer of layers) {
                if (mirrorU) setComponent(l, bm.ldata, layer, 0, flip(getComponent(l, layer, 0)))
                if (mirrorV) setComponent(l, bm.ldata, layer, 1, flip(getComponent(l, layer, 1)))
            }
        }
    }
}
