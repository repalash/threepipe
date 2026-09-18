/**
 * Mesh primitive generators - grid, cube, circle, cone/cylinder, UV sphere, icosphere.
 *
 * Ported from `source/blender/bmesh/operators/bmo_primitive.cc`:
 *
 * | here | Blender |
 * | --- | --- |
 * | {@link createGrid} | `bmo_create_grid_exec` (`bmo_primitive.cc:719-781`) |
 * | {@link createCube} | `bmo_create_cube_exec` (`bmo_primitive.cc:1617-1675`) |
 * | {@link createCircle} | `bmo_create_circle_exec` (`bmo_primitive.cc:1246-1325`) |
 * | {@link createCone} | `bmo_create_cone_exec` (`bmo_primitive.cc:1363-1510`) |
 * | {@link createUVSphere} | `bmo_create_uvsphere_exec` (`bmo_primitive.cc:845-963`) |
 * | {@link createIcoSphere} | `bmo_create_icosphere_exec` (`bmo_primitive.cc:965-1054`) |
 *
 * plus the UV passes `BM_mesh_calc_uvs_grid`, `BM_mesh_calc_uvs_cube`, `BM_mesh_calc_uvs_circle`,
 * `BM_mesh_calc_uvs_cone` and `BM_mesh_calc_uvs_sphere` from the same file.
 *
 * `bmo_create_monkey_exec` is deliberately not ported: it is a 271-vertex / 250-face literal table,
 * which is data rather than an algorithm, and nothing in the modelling milestone needs Suzanne.
 *
 * Each generator operates on an existing {@link BMesh} so they compose the way Blender's operators
 * do, and each has a `primitive*` wrapper that builds a fresh mesh and converts it to
 * {@link MeshData}. Blender marks its output with `BMO_vert_flag_enable(..., VERT_MARK)` and hands
 * it back through the `verts.out` slot; here the new elements are returned *and* selected, matching
 * how `ops/extrude.ts` and `ops/duplicate.ts` treat their result sets.
 *
 * The primitive operators are not self-contained in Blender - they call out to `dissolve_faces`,
 * `remove_doubles`, `extrude_edge_only`, `subdivide_edges` and `BM_edge_collapse`. Those now live
 * where they belong rather than here: `ops/dissolve.ts`, `ops/weld.ts`, `ops/subdivide.ts` and
 * `bmesh/collapse.ts`. What is left in the "Blender operators the primitives depend on" region below
 * is what has no other caller yet - `bmo_remove_doubles_exec`'s own two halves, and a chainable
 * `extrude_edge_only` that differs from `ops/extrude.ts`'s for the reason its comment gives.
 */

import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {MeshData} from '../MeshData'
import {bmToMesh} from '../bmesh/convert'
import {BMLayerDef, getComponent, setValue} from '../bmesh/customdata'
import {edgeCollapse} from '../bmesh/collapse'
import {selectFlush, selectNone, vertSelectSet} from '../bmesh/marking'
import {dissolveFaces} from '../ops/dissolve'
import {subdivideTrisOnSphere} from '../ops/subdivide'
import {weldVerts} from '../ops/weld'
import {removeDoubles} from '../ops/removeDoubles'
import {ElemFlag} from '../constants'
import {Mat4, Vec3, mat4Identity, mat4Invert, mat4RotationAxis, mat4TransformDir, mat4TransformPoint, v3normalize} from '../math'

// region Blender maths the primitives need

/**
 * Sine and cosine of `2*PI * numerator / denominator`, symmetric across octants.
 *
 * Port of `sin_cos_from_fraction` (`blenlib/intern/math_rotation_c.cc:995`). Calling `sin`/`cos` on
 * the fraction directly does not produce symmetrical values, because floats cannot represent Pi;
 * folding the numerator into the first octant and recovering the rest by symmetry does. Blender
 * added this for #87779, where a 32-segment cylinder came out with vertices that were not mirror
 * images of each other, and the primitives here depend on it for the same reason.
 *
 * Blender's `SWAP(float *, r_sin, r_cos)` swaps the *output pointers*, so after a swap the caller's
 * sine slot receives `cos(angle) * cos_sign` and the cosine slot receives `sin(angle)`.
 *
 * Returns `[sin, cos]`.
 */
function sinCosFromFraction(numerator: number, denominator: number): [number, number] {
    if (numerator < 0 || numerator > denominator || denominator <= 0) {
        throw new Error(`mesh-kernel: sinCosFromFraction(${numerator}, ${denominator}) out of range`)
    }
    let num = numerator * 8
    const octant = Math.floor(num / denominator)
    const den = denominator * 8
    let cosSign = 1
    let swap = false

    switch (octant) {
    case 0:
        // Primary octant, nothing to do.
        break
    case 1:
    case 2:
        num = den / 4 - num
        swap = true
        break
    case 3:
    case 4:
        num = den / 2 - num
        cosSign = -1
        break
    case 5:
    case 6:
        num = num - den * 3 / 4
        swap = true
        cosSign = -1
        break
    case 7:
    case 8:
        // Blender asserts unreachable for 8, which only occurs at numerator === denominator; the
        // case-7 expression is still the right one there and yields the exact (0, 1) of a full turn.
        num = num - den
        break
    }

    const angle = 2 * Math.PI * (num / den)
    const s = Math.sin(angle)
    const c = Math.cos(angle) * cosSign
    return swap ? [c, s] : [s, c]
}

/**
 * Recompute a face's normal from its loop cycle. Port of `BM_face_calc_normal`, which is Newell's
 * method - the only formula that is correct for a non-planar n-gon. The cone UV pass needs it to
 * tell a top cap from a bottom cap.
 */
function faceNormalUpdate(f: BMFace): void {
    let nx = 0, ny = 0, nz = 0
    for (const l of f.eachLoop()) {
        const a = l.v
        const b = l.next.v
        nx += (a.y - b.y) * (a.z + b.z)
        ny += (a.z - b.z) * (a.x + b.x)
        nz += (a.x - b.x) * (a.y + b.y)
    }
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) {
        f.nx = nx / len
        f.ny = ny / len
        f.nz = nz / len
    } else {
        f.nx = 0
        f.ny = 0
        f.nz = 1
    }
}

// endregion

// region UV layer access

/**
 * Name used when a generator has to create the corner UV layer itself. Matches `unbake.ts` and the
 * layer `bake.ts` looks for, so a generated primitive bakes with UVs without any further setup.
 */
export const PRIMITIVE_UV_LAYER = 'uv'

/**
 * The corner UV layer, Blender's `CustomData_get_offset(&bm->ldata, CD_PROP_FLOAT2)`.
 *
 * Blender silently turns `calc_uvs` off when the mesh has no UV layer, because its callers add one
 * first. These generators are the caller, so the layer is created on demand instead; an existing
 * float2 corner layer is reused, exactly as `CustomData_get_offset` returns the active one.
 */
function uvLayerEnsure(bm: BMesh): BMLayerDef {
    for (const layer of bm.ldata.layers) {
        if (layer.type === 'float2') return layer
    }
    return bm.addLayer('loop', PRIMITIVE_UV_LAYER, 'float2')
}

function loopUvSet(bm: BMesh, layer: BMLayerDef, l: BMLoop, u: number, v: number): void {
    setValue(l, bm.ldata, layer, [u, v])
}

function loopUvGetU(layer: BMLayerDef, l: BMLoop): number {
    return getComponent(l, layer, 0)
}

// endregion

// region Blender operators the primitives depend on

/**
 * Duplicate a set of edges and stitch each original to its copy with a quad.
 *
 * Port of `bmo_extrude_edge_only_exec` (`bmo_extrude.cc:167`) composed with the vertex and edge half
 * of `bmo_duplicate_exec`, which is where the `boundary_map` it reads comes from.
 *
 * `ops/extrude.ts` already has `extrudeEdgeOnly`, but it cannot be chained the way the UV sphere
 * chains it: it leaves the new rim edge's endpoints to whatever order `faceCreate` happened to use,
 * which is reversed relative to the original, so the next extrusion winds the opposite way and the
 * ribbon ends up with alternating normals. Blender avoids that by creating the duplicated edge
 * explicitly with the original's endpoint order, and by choosing the quad's winding from
 * `edge_normal_flip` - whether the edge already carries a loop and which way that loop runs.
 */
function extrudeEdgeOnlyOp(
    bm: BMesh, edges: BMEdge[],
): {vertMap: Map<BMVert, BMVert>, edgeMap: Map<BMEdge, BMEdge>, faces: BMFace[]} {
    const vertMap = new Map<BMVert, BMVert>()
    const ensure = (v: BMVert): BMVert => {
        let nv = vertMap.get(v)
        if (!nv) {
            nv = bm.vertCreate(v.x, v.y, v.z, v)
            nv.hflag &= ~ElemFlag.Select
            vertMap.set(v, nv)
        }
        return nv
    }
    for (const e of edges) {
        ensure(e.v1)
        ensure(e.v2)
    }

    const edgeMap = new Map<BMEdge, BMEdge>()
    for (const e of edges) {
        const ne = bm.edgeCreate(vertMap.get(e.v1)!, vertMap.get(e.v2)!, e)
        ne.hflag &= ~ElemFlag.Select
        edgeMap.set(e, ne)
    }

    const faces: BMFace[] = []
    for (const e of edges) {
        const eNew = edgeMap.get(e)!
        // `use_normal_flip` is false for every caller here.
        const edgeNormalFlip = !(e.l && e.v1 !== e.l.v)
        const f = edgeNormalFlip === false
            ? bm.faceCreate([e.v1, e.v2, eNew.v2, eNew.v1])
            : bm.faceCreate([e.v2, e.v1, eNew.v1, eNew.v2])
        f.hflag &= ~ElemFlag.Select
        faces.push(f)
    }

    return {vertMap, edgeMap, faces}
}


// endregion

// region shared options and result

/** Options every primitive takes. */
export interface PrimitiveOptions {
    /**
     * Transform applied to the generated vertices, Blender's `matrix` slot. Column-major, the same
     * element order as `THREE.Matrix4.elements`. Defaults to the identity.
     */
    matrix?: Mat4
    /**
     * Generate corner UVs, Blender's `calc_uvs` slot. The corner `float2` layer is created if the
     * mesh has none; an existing one is reused. Defaults to false, as Blender's operators do.
     */
    calcUVs?: boolean
    /**
     * Select the result and deselect everything else, matching how `ops/extrude.ts` and
     * `ops/duplicate.ts` hand back their result sets. Defaults to true.
     */
    selectResult?: boolean
}

/**
 * What a generator produced. Blender's operators return only `verts.out`; the faces are handed back
 * as well, because every caller in the modelling layer wants them.
 */
export interface PrimitiveResult {
    verts: BMVert[]
    faces: BMFace[]
}

/** Apply `matrix` to a local-space point, Blender's `mul_m4_v3`. */
function xform(matrix: Mat4 | undefined, x: number, y: number, z: number): Vec3 {
    return matrix ? mat4TransformPoint(matrix, [x, y, z]) : [x, y, z]
}

/** `BMO_slot_buffer_from_enabled_flag(..., "verts.out", BM_VERT, VERT_MARK)` plus a selection flush. */
function finishPrimitive(bm: BMesh, verts: BMVert[], faces: BMFace[], options: PrimitiveOptions): PrimitiveResult {
    if (options.selectResult !== false) {
        selectNone(bm)
        for (const v of verts) if (bm.verts.has(v)) vertSelectSet(bm, v, true)
        selectFlush(bm)
    }
    return {verts: verts.filter(v => bm.verts.has(v)), faces: faces.filter(f => bm.faces.has(f))}
}

/** Build a standalone mesh from one generator call. */
function standalone(run: (bm: BMesh) => void): MeshData {
    const bm = new BMesh()
    run(bm)
    return bmToMesh(bm)
}

// endregion

// region grid

export interface GridOptions extends PrimitiveOptions {
    /** Columns, Blender's `x_segments`. Clamped to at least 1. Defaults to 10. */
    xSegments?: number
    /** Rows, Blender's `y_segments`. Clamped to at least 1. Defaults to 10. */
    ySegments?: number
    /**
     * Half-extent, Blender's `size` slot (`dia` in the source): the grid spans `-size..+size` on both
     * X and Y, so the default of 1 gives Blender's default 2-unit grid.
     */
    size?: number
}

/**
 * A flat quad grid on the XY plane. Port of `bmo_create_grid_exec` (`bmo_primitive.cc:719`).
 */
export function createGrid(bm: BMesh, opts: GridOptions = {}): PrimitiveResult {
    const dia = opts.size ?? 1
    const xtot = Math.max(1, Math.trunc(opts.xSegments ?? 10))
    const ytot = Math.max(1, Math.trunc(opts.ySegments ?? 10))
    const xtotInv2 = 2 / xtot
    const ytotInv2 = 2 / ytot

    const varr: BMVert[] = new Array((xtot + 1) * (ytot + 1))
    let i = 0
    for (let y = 0; y <= ytot; y++) {
        const vy = (y * ytotInv2 - 1) * dia
        for (let x = 0; x <= xtot; x++) {
            const vx = (x * xtotInv2 - 1) * dia
            const co = xform(opts.matrix, vx, vy, 0)
            varr[i] = bm.vertCreate(co[0], co[1], co[2])
            i++
        }
    }

    const xy = (x: number, y: number) => x + y * (xtot + 1)

    const faces: BMFace[] = []
    for (let y = 1; y <= ytot; y++) {
        for (let x = 1; x <= xtot; x++) {
            faces.push(bm.faceCreate([
                varr[xy(x - 1, y - 1)],
                varr[xy(x, y - 1)],
                varr[xy(x, y)],
                varr[xy(x - 1, y)],
            ]))
        }
    }

    if (opts.calcUVs) calcUVsGrid(bm, xtot, ytot, faces)

    return finishPrimitive(bm, varr, faces, opts)
}

/**
 * Port of `BM_mesh_calc_uvs_grid` (`bmo_primitive.cc:783`). Blender walks the mesh's faces and keeps
 * a running index over the flagged ones; `faces` is that same sequence, in creation order.
 */
function calcUVsGrid(bm: BMesh, xSegments: number, ySegments: number, faces: BMFace[]): void {
    const layer = uvLayerEnsure(bm)
    const dx = 1 / xSegments
    const dy = 1 / ySegments

    for (const [faceIndex, f] of faces.entries()) {
        const ix = faceIndex % xSegments
        const iy = Math.floor(faceIndex / xSegments)
        for (const [loopIndex, l] of [...f.eachLoop()].entries()) {
            switch (loopIndex) {
            case 0: loopUvSet(bm, layer, l, ix * dx, iy * dy); break
            case 1: loopUvSet(bm, layer, l, (ix + 1) * dx, iy * dy); break
            case 2: loopUvSet(bm, layer, l, (ix + 1) * dx, (iy + 1) * dy); break
            case 3: loopUvSet(bm, layer, l, ix * dx, (iy + 1) * dy); break
            default: break
            }
        }
    }
}

/** {@link createGrid} on a fresh mesh, as a standalone {@link MeshData}. */
export function primitiveGrid(opts: GridOptions = {}): MeshData {
    return standalone(bm => createGrid(bm, opts))
}

// endregion

// region cube

export interface CubeOptions extends PrimitiveOptions {
    /**
     * Edge length, Blender's `size` slot: vertices sit at `±size/2`. Defaults to 2, Blender's default
     * cube. A size of exactly 0 becomes 1, which is the quirk in `bmo_create_cube_exec`.
     */
    size?: number
}

/**
 * An axis-aligned cube of six quads. Port of `bmo_create_cube_exec` (`bmo_primitive.cc:1617`).
 */
export function createCube(bm: BMesh, opts: CubeOptions = {}): PrimitiveResult {
    let off = (opts.size ?? 2) / 2
    if (!off) off = 0.5

    // Rotation order set to match `BM_mesh_calc_uvs_cube`.
    const faceIndices = [
        [0, 1, 3, 2],
        [2, 3, 7, 6],
        [6, 7, 5, 4],
        [4, 5, 1, 0],
        [2, 6, 4, 0],
        [7, 3, 1, 5],
    ]

    const verts: BMVert[] = new Array(8)
    let i = 0
    for (let x = -1; x < 2; x += 2) {
        for (let y = -1; y < 2; y += 2) {
            for (let z = -1; z < 2; z += 2) {
                const co = xform(opts.matrix, x * off, y * off, z * off)
                verts[i] = bm.vertCreate(co[0], co[1], co[2])
                i++
            }
        }
    }

    const faces = faceIndices.map(q => bm.faceCreate([verts[q[0]], verts[q[1]], verts[q[2]], verts[q[3]]]))

    if (opts.calcUVs) calcUVsCube(bm, faces)

    return finishPrimitive(bm, verts, faces, opts)
}

/**
 * Port of `BM_mesh_calc_uvs_cube` (`bmo_primitive.cc:1677`): a cross-shaped unwrap laid out by
 * walking a cursor across a 4x4 grid of quarter-unit cells, one cell per face.
 */
function calcUVsCube(bm: BMesh, faces: BMFace[]): void {
    const layer = uvLayerEnsure(bm)
    const width = 0.25
    let x = 0.375
    let y = 0.0

    for (const f of faces) {
        for (const [loopIndex, l] of [...f.eachLoop()].entries()) {
            loopUvSet(bm, layer, l, x, y)
            switch (loopIndex) {
            case 0: x += width; break
            case 1: y += width; break
            case 2: x -= width; break
            case 3: y -= width; break
            default: break
            }
        }

        if (y >= 0.75 && x > 0.125) {
            x = 0.125
            y = 0.5
        } else if (x <= 0.125) {
            x = 0.625
            y = 0.5
        } else {
            y += 0.25
        }
    }
}

/** {@link createCube} on a fresh mesh, as a standalone {@link MeshData}. */
export function primitiveCube(opts: CubeOptions = {}): MeshData {
    return standalone(bm => createCube(bm, opts))
}

// endregion

// region circle

export interface CircleOptions extends PrimitiveOptions {
    /** Number of sides, Blender's `segments`. Defaults to 32. */
    segments?: number
    /** Blender's `radius`. Defaults to 1. */
    radius?: number
    /**
     * Fill the ring with a face, Blender's `cap_ends`. Defaults to false, matching both the operator
     * and the `Add Circle` default fill type of `NOTHING`.
     */
    capEnds?: boolean
    /**
     * Fill with a triangle fan instead of a single n-gon, Blender's `cap_tris`. Defaults to false.
     * Only meaningful with {@link capEnds}.
     */
    capTris?: boolean
}

/**
 * A ring of vertices on the XY plane, optionally filled.
 * Port of `bmo_create_circle_exec` (`bmo_primitive.cc:1246`).
 */
export function createCircle(bm: BMesh, opts: CircleOptions = {}): PrimitiveResult {
    const radius = opts.radius ?? 1
    const segs = Math.trunc(opts.segments ?? 32)
    const capEnds = opts.capEnds ?? false
    const capTris = opts.capTris ?? false

    if (!segs) return finishPrimitive(bm, [], [], opts)

    const marked: BMVert[] = []
    let cent1: BMVert | null = null
    if (capEnds) {
        const co = xform(opts.matrix, 0, 0, 0)
        cent1 = bm.vertCreate(co[0], co[1], co[2])
        marked.push(cent1)
    }

    const capFaces: BMFace[] = []
    let lastv1: BMVert | null = null
    let firstv1: BMVert | null = null
    let v1: BMVert | null = null

    for (let a = 0; a < segs; a++) {
        // Going this way ends up with the normals upward.
        const [s, c] = sinCosFromFraction(a, segs)
        const co = xform(opts.matrix, s * -radius, c * radius, 0)
        v1 = bm.vertCreate(co[0], co[1], co[2])
        marked.push(v1)

        if (lastv1) bm.edgeCreate(v1, lastv1)

        if (a && capEnds) capFaces.push(bm.faceCreate([cent1!, lastv1!, v1]))

        if (!firstv1) firstv1 = v1
        lastv1 = v1
    }

    bm.edgeCreate(firstv1!, lastv1!)

    let faces: BMFace[] = capFaces
    if (capEnds) {
        capFaces.push(bm.faceCreate([cent1!, v1!, firstv1!]))
        if (opts.calcUVs) calcUVsCircle(bm, opts.matrix, radius, capFaces)
    }

    if (capEnds && !capTris) faces = dissolveFaces(bm, capFaces)

    return finishPrimitive(bm, marked, faces, opts)
}

/**
 * Port of `BM_mesh_calc_uvs_circle` (`bmo_primitive.cc:1327`): map each vertex back into the unit
 * circle on the Z plane and use its X/Y directly.
 */
function calcUVsCircle(bm: BMesh, matrix: Mat4 | undefined, radius: number, faces: BMFace[]): void {
    const layer = uvLayerEnsure(bm)
    const uvScale = 0.5 / radius
    const uvCenter = 0.5
    const invMat = mat4Invert(matrix ?? mat4Identity())

    for (const f of faces) {
        for (const l of f.eachLoop()) {
            const co = mat4TransformPoint(invMat, [l.v.x, l.v.y, l.v.z])
            loopUvSet(bm, layer, l, uvCenter + uvScale * co[0], uvCenter + uvScale * co[1])
        }
    }
}

/** {@link createCircle} on a fresh mesh, as a standalone {@link MeshData}. */
export function primitiveCircle(opts: CircleOptions = {}): MeshData {
    return standalone(bm => createCircle(bm, opts))
}

// endregion

// region cone / cylinder

export interface ConeOptions extends PrimitiveOptions {
    /** Number of sides, Blender's `segments`. Defaults to 32. */
    segments?: number
    /** Radius at `z = -depth/2`, Blender's `radius1`. Zero collapses that end to a point. Defaults to 1. */
    radiusBottom?: number
    /** Radius at `z = +depth/2`, Blender's `radius2`. Zero collapses that end to a point. Defaults to 1. */
    radiusTop?: number
    /** Height along Z, Blender's `depth`. Defaults to 2. */
    depth?: number
    /**
     * Close both ends, Blender's `cap_ends`. Defaults to true, matching `Add Cylinder` / `Add Cone`,
     * whose default fill type is `NGON`. (The bare operator slot defaults to false.)
     */
    capEnds?: boolean
    /** Fill the caps with triangle fans instead of n-gons, Blender's `cap_tris`. Defaults to false. */
    capTris?: boolean
}

/**
 * A cylinder, truncated cone or cone, depending on the two radii.
 * Port of `bmo_create_cone_exec` (`bmo_primitive.cc:1363`).
 */
export function createCone(bm: BMesh, opts: ConeOptions = {}): PrimitiveResult {
    const rad1 = opts.radiusBottom ?? 1
    const rad2 = opts.radiusTop ?? 1
    const depthHalf = 0.5 * (opts.depth ?? 2)
    const segs = Math.trunc(opts.segments ?? 32)
    const capEnds = opts.capEnds ?? true
    const capTris = opts.capTris ?? false

    if (!segs) return finishPrimitive(bm, [], [], opts)

    const marked: BMVert[] = []
    let cent1: BMVert | null = null
    let cent2: BMVert | null = null
    if (capEnds) {
        let co = xform(opts.matrix, 0, 0, -depthHalf)
        cent1 = bm.vertCreate(co[0], co[1], co[2])
        co = xform(opts.matrix, 0, 0, depthHalf)
        cent2 = bm.vertCreate(co[0], co[1], co[2])
        marked.push(cent1, cent2)
    }

    const sideFaces: BMFace[] = []
    /** Faces marked FACE_MARK, i.e. the ones the UV pass walks, in creation order. */
    const uvFaces: BMFace[] = []
    /** Faces marked FACE_NEW, i.e. the cap triangles the n-gon dissolve merges. */
    const capFaces: BMFace[] = []

    let lastv1: BMVert | null = null
    let lastv2: BMVert | null = null
    let firstv1: BMVert | null = null
    let firstv2: BMVert | null = null
    let v1: BMVert | null = null
    let v2: BMVert | null = null

    for (let i = 0; i < segs; i++) {
        // Calculated with higher precision, see Blender #87779.
        const [sinPhi, cosPhi] = sinCosFromFraction(i, segs)

        let co = xform(opts.matrix, rad1 * sinPhi, rad1 * cosPhi, -depthHalf)
        v1 = bm.vertCreate(co[0], co[1], co[2])
        co = xform(opts.matrix, rad2 * sinPhi, rad2 * cosPhi, depthHalf)
        v2 = bm.vertCreate(co[0], co[1], co[2])
        marked.push(v1, v2)

        if (i) {
            if (capEnds) {
                let f = bm.faceCreate([cent1!, lastv1!, v1])
                uvFaces.push(f)
                capFaces.push(f)

                f = bm.faceCreate([cent2!, v2, lastv2!])
                uvFaces.push(f)
                capFaces.push(f)
            }
            const f = bm.faceCreate([lastv1!, lastv2!, v2, v1])
            uvFaces.push(f)
            sideFaces.push(f)
        } else {
            firstv1 = v1
            firstv2 = v2
        }

        lastv1 = v1
        lastv2 = v2
    }

    if (capEnds) {
        let f = bm.faceCreate([cent1!, v1!, firstv1!])
        uvFaces.push(f)
        capFaces.push(f)

        f = bm.faceCreate([cent2!, firstv2!, v2!])
        uvFaces.push(f)
        capFaces.push(f)
    }

    const wrapFace = bm.faceCreate([v1!, v2!, firstv2!, firstv1!])
    uvFaces.push(wrapFace)

    if (opts.calcUVs) calcUVsCone(bm, opts.matrix, rad2, rad1, segs, capEnds, uvFaces)

    // Collapse the vertices at the first end, so a zero radius becomes an apex.
    if (rad1 === 0) {
        if (capEnds) bm.vertKill(cent1!)
        for (const f of sideFaces) {
            const l = f.lFirst
            edgeCollapse(bm, l.prev.e!, l.prev.v, true, true)
        }
    }

    // And the second end.
    if (rad2 === 0) {
        if (capEnds) bm.vertKill(cent2!)
        for (const f of sideFaces) {
            const l = f.lFirst
            edgeCollapse(bm, l.next.e!, l.next.v, true, true)
        }
    }

    const created = new Set(uvFaces)
    if (!capTris) {
        const alive = capFaces.filter(f => bm.faces.has(f))
        if (alive.length) {
            for (const f of alive) created.delete(f)
            for (const joined of dissolveFaces(bm, alive)) created.add(joined)
        }
    }

    return finishPrimitive(bm, marked, [...created], opts)
}

/**
 * Port of `BM_mesh_calc_uvs_cone` (`bmo_primitive.cc:1512`).
 *
 * Side quads are unwrapped as a strip by a cursor that walks left one segment per face; caps are
 * unwrapped by transforming back into the local frame and taking X/Y, packed into the lower half of
 * the square when the ends are capped. The `x`/`y` cursor carries across faces, so the order of
 * `faces` is load-bearing - it is the face creation order, which is Blender's mesh iteration order.
 */
function calcUVsCone(
    bm: BMesh,
    matrix: Mat4 | undefined,
    radiusTop: number,
    radiusBottom: number,
    segments: number,
    capEnds: boolean,
    faces: BMFace[],
): void {
    const layer = uvLayerEnsure(bm)
    const uvWidth = 1 / segments
    const uvHeight = capEnds ? 0.5 : 1

    // This layout handles cone, truncated cone, capped and uncapped with one piece of code.
    const uvCenterY = capEnds ? 0.25 : 0.5
    const uvCenterXTop = capEnds ? 0.25 : 0.5
    const uvCenterXBottom = capEnds ? 0.75 : 0.5
    const uvRadius = capEnds ? 0.24 : 0.5

    // Using the opposite end's scale as a fallback is what handles the real-cone case.
    const uvScaleTop = radiusTop !== 0
        ? uvRadius / radiusTop
        : (radiusBottom !== 0 ? uvRadius / radiusBottom : uvRadius)
    const uvScaleBottom = radiusBottom !== 0 ? uvRadius / radiusBottom : uvScaleTop

    const mat = matrix ?? mat4Identity()
    // Transform the up vector the way the cone itself was transformed, without location or scale.
    const localUp = v3normalize(mat4TransformDir(mat, [0, 0, 1]))
    const invMat = mat4Invert(mat)

    let x = 1
    let y = 1 - uvHeight

    for (const f of faces) {
        if (f.len === 4 && radiusTop && radiusBottom) {
            // Side face, unwrapped as a rectangle.
            for (const [loopIndex, l] of [...f.eachLoop()].entries()) {
                switch (loopIndex) {
                case 0: break // continue in the last position
                case 1: y += uvHeight; break
                case 2: x -= uvWidth; break
                case 3: y -= uvHeight; break
                default: break
                }
                loopUvSet(bm, layer, l, x, y)
            }
        } else {
            // Top or bottom face: transform back to a circle and use the X/Y coordinates.
            faceNormalUpdate(f)
            const isTop = f.nx * localUp[0] + f.ny * localUp[1] + f.nz * localUp[2] > 0
            for (const l of f.eachLoop()) {
                const co = mat4TransformPoint(invMat, [l.v.x, l.v.y, l.v.z])
                if (isTop) {
                    loopUvSet(bm, layer, l, uvCenterXTop + co[0] * uvScaleTop, uvCenterY + co[1] * uvScaleTop)
                } else {
                    loopUvSet(bm, layer, l, uvCenterXBottom + co[0] * uvScaleBottom, uvCenterY + co[1] * uvScaleBottom)
                }
            }
        }
    }
}

/** {@link createCone} on a fresh mesh, as a standalone {@link MeshData}. */
export function primitiveCone(opts: ConeOptions = {}): MeshData {
    return standalone(bm => createCone(bm, opts))
}

// endregion

// region UV sphere

export interface UVSphereOptions extends PrimitiveOptions {
    /** Meridians, Blender's `u_segments`. Clamped to at least 1. Defaults to 32. */
    uSegments?: number
    /** Parallels, Blender's `v_segments`. Clamped to at least 1. Defaults to 16. */
    vSegments?: number
    /** Blender's `radius`. Defaults to 1. */
    radius?: number
}

/**
 * A latitude/longitude sphere: quads everywhere but a triangle fan at each pole.
 *
 * Port of `bmo_create_uvsphere_exec` (`bmo_primitive.cc:845`). Blender builds it by laying down one
 * meridian arc of wire edges, extruding it `u_segments` times with a rotation between each, and then
 * removing doubles - which is what welds the duplicated poles into one vertex each and closes the
 * seam, turning the pole quads into triangles. The same three steps are followed here.
 */
export function createUVSphere(bm: BMesh, opts: UVSphereOptions = {}): PrimitiveResult {
    const rad = opts.radius ?? 1
    // Zero U/V crashes Blender; it clamps to 1.
    const seg = Math.max(1, Math.trunc(opts.uSegments ?? 32))
    const tot = Math.max(1, Math.trunc(opts.vSegments ?? 16))

    const marked: BMVert[] = []
    const arcEdges: BMEdge[] = []

    // One segment first. Going in this direction, then edge extruding, makes normals face outward.
    let preveve: BMVert | null = null
    for (let a = 0; a <= tot; a++) {
        const [sinPhi, cosPhi] = sinCosFromFraction(a, 2 * tot)
        const eve = bm.vertCreate(0, rad * sinPhi, rad * cosPhi)
        marked.push(eve)
        if (a !== 0) arcEdges.push(bm.edgeCreate(preveve!, eve))
        preveve = eve
    }

    // Extrude and rotate; a negative angle makes the normals face outward.
    const cmat = mat4RotationAxis([0, 0, 1], -(Math.PI * 2) / seg)

    let rim = arcEdges
    for (let a = 0; a < seg; a++) {
        const res = extrudeEdgeOnlyOp(bm, rim)

        // `rotate cent=%v matrix=%m3 verts=%S`: the centre is the last arc vertex, which sits on the
        // Z axis, so rotating about it is the same as rotating about the origin.
        for (const v of res.vertMap.values()) {
            marked.push(v)
            const co = mat4TransformPoint(cmat, [v.x, v.y, v.z])
            v.setCo(co[0], co[1], co[2])
        }

        rim = rim.map(e => res.edgeMap.get(e)!)
    }

    {
        const phid = Math.PI / tot
        // Length of one segment along the meridian.
        const len = 2 * rad * Math.sin(phid / 2)

        // Length of one segment in the shortest parallel.
        const vec: Vec3 = [rad * Math.sin(phid), 0, rad * Math.cos(phid)]
        const vec2 = mat4TransformDir(cmat, vec)
        const len2 = Math.hypot(vec[0] - vec2[0], vec[1] - vec2[1], vec[2] - vec2[2])

        // Use the shortest segment length divided by 3 as the merge threshold.
        removeDoubles(bm, marked.filter(v => bm.verts.has(v)), {distance: Math.min(len, len2) / 3})
    }

    // Blender cannot tag the faces while building, so it tags them afterwards from all their
    // vertices being marked, which is what `BM_mesh_calc_uvs_sphere` then walks.
    const alive = marked.filter(v => bm.verts.has(v))
    const aliveSet = new Set(alive)
    const faces = [...bm.faces].filter(f => {
        for (const l of f.eachLoop()) if (!aliveSet.has(l.v)) return false
        return true
    })

    if (opts.calcUVs) calcUVsSphere(bm, faces)

    // Only now apply the matrix, as Blender does: the UV pass needs the sphere in its local frame.
    if (opts.matrix) {
        for (const v of alive) {
            const co = mat4TransformPoint(opts.matrix, [v.x, v.y, v.z])
            v.setCo(co[0], co[1], co[2])
        }
    }

    return finishPrimitive(bm, alive, faces, opts)
}

/**
 * Port of `bm_mesh_calc_uvs_sphere_face` and `BM_mesh_calc_uvs_sphere`
 * (`bmo_primitive.cc:1056` and `:1124`): a spherical unwrap from `atan2` and `acos`, with the
 * wrap-around column shifted a whole turn and the whole map slid back to `u = 0`.
 */
function calcUVsSphere(bm: BMesh, faces: BMFace[]): void {
    const layer = uvLayerEnsure(bm)

    for (const f of faces) {
        const loops = [...f.eachLoop()]
        // A three-sided face is a polar face; its latitude has to come from a neighbouring point.
        let avgx = 0, avgy = 0
        if (f.len === 3) {
            for (const l of loops) {
                avgx += l.v.x
                avgy += l.v.y
            }
            avgx /= 3
            avgy /= 3
        }

        const us: number[] = new Array(loops.length)
        for (const [i, l] of loops.entries()) {
            const {x, y, z} = l.v
            const len = Math.hypot(x, y, z)

            let theta: number
            if (f.len === 3 && Math.abs(x) < 0.0001 && Math.abs(y) < 0.0001) {
                theta = Math.atan2(avgy, avgx)
            } else {
                theta = Math.atan2(y, x)
            }

            // Shift borderline coordinates to the left.
            if (Math.abs(theta - Math.PI) < 0.0001) theta = -Math.PI

            const phi = len !== 0 ? Math.acos(Math.max(-1, Math.min(1, z / len))) : 0
            const u = 0.5 + theta / (Math.PI * 2)
            loopUvSet(bm, layer, l, u, 1 - phi / Math.PI)
            us[i] = u
        }

        // Fix awkwardly-wrapping UVs.
        let maxX = 0
        for (let i = 1; i < loops.length; i++) if (us[i] > us[maxX]) maxX = i
        for (let i = 0; i < loops.length; i++) {
            if (i === maxX) continue
            if (us[maxX] - us[i] > 0.5) {
                us[i] += 1
                loopUvSet(bm, layer, loops[i], us[i], getComponent(loops[i], layer, 1))
            }
        }
    }

    let minx = 1
    for (const f of faces) for (const l of f.eachLoop()) minx = Math.min(loopUvGetU(layer, l), minx)
    for (const f of faces) {
        for (const l of f.eachLoop()) {
            loopUvSet(bm, layer, l, loopUvGetU(layer, l) - minx, getComponent(l, layer, 1))
        }
    }
}

/** {@link createUVSphere} on a fresh mesh, as a standalone {@link MeshData}. */
export function primitiveUVSphere(opts: UVSphereOptions = {}): MeshData {
    return standalone(bm => createUVSphere(bm, opts))
}

// endregion

// region icosphere

/** The regular icosahedron Blender starts from, at radius 200. `icovert` in `bmo_primitive.cc:29`. */
const ICO_VERT: ReadonlyArray<Vec3> = [
    [0.0, 0.0, -200.0],
    [144.72, -105.144, -89.443],
    [-55.277, -170.128, -89.443],
    [-178.885, 0.0, -89.443],
    [-55.277, 170.128, -89.443],
    [144.72, 105.144, -89.443],
    [55.277, -170.128, 89.443],
    [-144.72, -105.144, 89.443],
    [-144.72, 105.144, 89.443],
    [55.277, 170.128, 89.443],
    [178.885, 0.0, 89.443],
    [0.0, 0.0, 200.0],
]

/** Its twenty faces. `icoface` in `bmo_primitive.cc:44`. */
const ICO_FACE: ReadonlyArray<readonly [number, number, number]> = [
    [0, 1, 2], [1, 0, 5], [0, 2, 3], [0, 3, 4], [0, 4, 5], [1, 5, 10], [2, 1, 6],
    [3, 2, 7], [4, 3, 8], [5, 4, 9], [1, 10, 6], [2, 6, 7], [3, 7, 8], [4, 8, 9],
    [5, 9, 10], [6, 10, 11], [7, 6, 11], [8, 7, 11], [9, 8, 11], [10, 9, 11],
]

/** Its unwrap, three corners per face in face order. `icouvs` in `bmo_primitive.cc:50`. */
const ICO_UVS: ReadonlyArray<readonly [number, number]> = [
    [0.181819, 0.000000], [0.272728, 0.157461], [0.090910, 0.157461], [0.272728, 0.157461],
    [0.363637, 0.000000], [0.454546, 0.157461], [0.909091, 0.000000], [1.000000, 0.157461],
    [0.818182, 0.157461], [0.727273, 0.000000], [0.818182, 0.157461], [0.636364, 0.157461],
    [0.545455, 0.000000], [0.636364, 0.157461], [0.454546, 0.157461], [0.272728, 0.157461],
    [0.454546, 0.157461], [0.363637, 0.314921], [0.090910, 0.157461], [0.272728, 0.157461],
    [0.181819, 0.314921], [0.818182, 0.157461], [1.000000, 0.157461], [0.909091, 0.314921],
    [0.636364, 0.157461], [0.818182, 0.157461], [0.727273, 0.314921], [0.454546, 0.157461],
    [0.636364, 0.157461], [0.545455, 0.314921], [0.272728, 0.157461], [0.363637, 0.314921],
    [0.181819, 0.314921], [0.090910, 0.157461], [0.181819, 0.314921], [0.000000, 0.314921],
    [0.818182, 0.157461], [0.909091, 0.314921], [0.727273, 0.314921], [0.636364, 0.157461],
    [0.727273, 0.314921], [0.545455, 0.314921], [0.454546, 0.157461], [0.545455, 0.314921],
    [0.363637, 0.314921], [0.181819, 0.314921], [0.363637, 0.314921], [0.272728, 0.472382],
    [0.000000, 0.314921], [0.181819, 0.314921], [0.090910, 0.472382], [0.727273, 0.314921],
    [0.909091, 0.314921], [0.818182, 0.472382], [0.545455, 0.314921], [0.727273, 0.314921],
    [0.636364, 0.472382], [0.363637, 0.314921], [0.545455, 0.314921], [0.454546, 0.472382],
]

export interface IcoSphereOptions extends PrimitiveOptions {
    /**
     * Blender's `subdivisions`. 1 is the bare icosahedron; each further level quadruples the face
     * count, because Blender cuts every edge `2^(subdivisions-1) - 1` times. Defaults to 2.
     */
    subdivisions?: number
    /** Blender's `radius`. Defaults to 1. */
    radius?: number
}

/**
 * A geodesic sphere of triangles, subdivided from a regular icosahedron.
 * Port of `bmo_create_icosphere_exec` (`bmo_primitive.cc:965`).
 */
export function createIcoSphere(bm: BMesh, opts: IcoSphereOptions = {}): PrimitiveResult {
    const rad = opts.radius ?? 1
    const radDiv = rad / 200
    const subdiv = Math.max(1, Math.trunc(opts.subdivisions ?? 2))
    const layer = opts.calcUVs ? uvLayerEnsure(bm) : null

    const eva: BMVert[] = ICO_VERT.map(c => bm.vertCreate(radDiv * c[0], radDiv * c[1], radDiv * c[2]))
    const marked: BMVert[] = [...eva]

    const edgeMark = new Set<BMEdge>()
    const faces: BMFace[] = []
    let uvi = 0
    for (const tri of ICO_FACE) {
        const f = bm.faceCreate([eva[tri[0]], eva[tri[1]], eva[tri[2]]])
        faces.push(f)
        for (const l of f.eachLoop()) edgeMark.add(l.e!)

        // Set the UVs right after the face is created: face iteration order is not guaranteed.
        if (layer) {
            for (const l of f.eachLoop()) {
                loopUvSet(bm, layer, l, ICO_UVS[uvi][0], ICO_UVS[uvi][1])
                uvi++
            }
        }
    }

    if (subdiv > 1) {
        const before = new Set(bm.verts)
        subdivideTrisOnSphere(bm, [...edgeMark], (1 << (subdiv - 1)) - 1, rad)
        for (const v of bm.verts) if (!before.has(v)) marked.push(v)
    }

    // Must transform after, because of the sphere subdivision.
    if (opts.matrix) {
        for (const v of marked) {
            if (!bm.verts.has(v)) continue
            const co = mat4TransformPoint(opts.matrix, [v.x, v.y, v.z])
            v.setCo(co[0], co[1], co[2])
        }
    }

    // Blender returns only `verts.out`; the faces are whatever the subdivision left standing on them.
    const markedSet = new Set(marked)
    const out = [...bm.faces].filter(f => {
        for (const l of f.eachLoop()) if (!markedSet.has(l.v)) return false
        return true
    })

    return finishPrimitive(bm, marked, out, opts)
}

/** {@link createIcoSphere} on a fresh mesh, as a standalone {@link MeshData}. */
export function primitiveIcoSphere(opts: IcoSphereOptions = {}): MeshData {
    return standalone(bm => createIcoSphere(bm, opts))
}

// endregion
