/**
 * `geometry::pack_islands` (`geometry/intern/uv_pack.cc`, Blender 5.2.2) and `PackIsland`. Float math is float32
 * (`f32` after every operation, Blender builds with `-ffp-contract=off`); the places Blender uses double (`cos`/`sin` in
 * `build_transformation`, `mul_v2_m2_add_v2v2`, the margin sum, `angle_wrap`) use double here too. Line numbers refer to
 * `uv_pack.cc`.
 *
 * Not ported (unreachable from the geometry nodes, they throw): `merge_overlap` (OverlapMerger), the margin-fraction
 * scale search (`pack_islands_margin_fraction`, used for `ED_UVPACK_MARGIN_FRACTION` or partly scalable islands), and the
 * in-place merge path of `std::stable_sort`.
 */

import {polyfillBeautify, polyfillCalc} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {cosf, sincos, sincosf} from '../blender/libm'
import {boxPack2d, BoxPack} from '../blender/boxpack2d'
import {convexhull2d, convexhullAabbFitPoints2d} from '../blender/convexhull2d'
import {libcxxStableSort} from '../blender/sort'

export const enum MarginMethod { SCALED, ADD, FRACTION }
export const enum RotationMethod { NONE, AXIS_ALIGNED, AXIS_ALIGNED_X, AXIS_ALIGNED_Y, CARDINAL, ANY }
export const enum ShapeMethod { AABB, CONVEX, CONCAVE }
export const enum PinMethod { NONE, IGNORE, LOCK_ROTATION, LOCK_ROTATION_SCALE, LOCK_SCALE, LOCK_ALL }

/** `UVPackIsland_Params` with its constructor defaults (:405). */
export interface UVPackIslandParams {
    rotateMethod: RotationMethod
    scaleToFit: boolean
    pinMethod: PinMethod
    mergeOverlap: boolean
    margin: number
    marginMethod: MarginMethod
    udimBaseOffset: [number, number]
    targetExtent: number
    targetAspectY: number
    shapeMethod: ShapeMethod
}

export function defaultPackParams(): UVPackIslandParams {
    return {rotateMethod: RotationMethod.NONE, scaleToFit: true, pinMethod: PinMethod.NONE, mergeOverlap: false, margin: f32(0.001),
        marginMethod: MarginMethod.SCALED, udimBaseOffset: [0, 0], targetExtent: 1, targetAspectY: 1, shapeMethod: ShapeMethod.AABB}
}

type F2 = [number, number]
const FLT_MAX = f32(3.4028234663852886e38)
const FLT_EPSILON = f32(1.1920928955078125e-7)
const DEG2RADF = (d: number) => f32(d * f32(Math.PI / 180))
const maxff = (a: number, b: number) => (a > b ? a : b)
/** `std::max(a, b)`: `(a < b) ? b : a`. */
const stdMax = (a: number, b: number) => (a < b ? b : a)
/** `std::min(a, b)`: `(b < a) ? b : a`. */
const stdMin = (a: number, b: number) => (b < a ? b : a)

/** `rctf`. */
interface Rctf {
    xmin: number
    xmax: number
    ymin: number
    ymax: number
}
const rctf = (xmin: number, xmax: number, ymin: number, ymax: number): Rctf => ({xmin, xmax, ymin, ymax})
const sizeX = (r: Rctf) => f32(r.xmax - r.xmin)
const sizeY = (r: Rctf) => f32(r.ymax - r.ymin)
/** `BLI_rctf_do_minmax_v`. */
function doMinmax(r: Rctf, x: number, y: number): void {
    if (x < r.xmin) r.xmin = x
    if (x > r.xmax) r.xmax = x
    if (y < r.ymin) r.ymin = y
    if (y > r.ymax) r.ymax = y
}

/** `UVPhi` (:30). */
class UVPhi {
    translation: F2 = [-1, -1]
    rotation = 0
    isValid(): boolean {
        return this.translation[0] !== -1
    }

    clone(): UVPhi {
        const p = new UVPhi()
        p.translation = [this.translation[0], this.translation[1]]
        p.rotation = this.rotation
        return p
    }
}

/** `mul_v2_m2v2` (`math_matrix_c.cc:725`): `M[i][j] = m[i * 2 + j]`. */
function mulV2M2V2(m: ArrayLike<number>, x: number, y: number): F2 {
    return [f32(f32(m[0] * x) + f32(m[2] * y)), f32(f32(m[1] * x) + f32(m[3] * y))]
}

/** `mul_v2_m2_add_v2v2` (:47): `r = mat * (a + b)` in double. */
export function mulV2M2AddV2V2(m: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): F2 {
    const x = a[0] + b[0], y = a[1] + b[1]
    return [f32(m[0] * x + m[2] * y), f32(m[1] * x + m[3] * y)]
}

/** `dist_signed_squared_to_edge` (:67). */
function distSignedSquaredToEdge(probe: ArrayLike<number>, uva: ArrayLike<number>, uvb: ArrayLike<number>): number {
    const ex = f32(uvb[0] - uva[0]), ey = f32(uvb[1] - uva[1])
    const sx = f32(probe[0] - uva[0]), sy = f32(probe[1] - uva[1])
    const el2 = f32(f32(ex * ex) + f32(ey * ey))
    if (el2 < f32(1e-40)) return f32(f32(sx * sx) + f32(sy * sy))
    const num = f32(f32(ex * sy) - f32(ey * sx))
    const ssq = num >= 0 ? f32(num * num) : f32(-num * num)
    return f32(ssq / el2)
}

/** `get_aspect_scaled_extent` (:87). */
const aspectScaledExtent = (r: Rctf, p: UVPackIslandParams) => stdMax(f32(sizeX(r) / p.targetAspectY), sizeY(r))
/** `get_aspect_scaled_area` (:97). */
const aspectScaledArea = (r: Rctf, p: UVPackIslandParams) => f32(f32(sizeX(r) / p.targetAspectY) * sizeY(r))

/** `ulp_diff_ff` / `compare_ff_relative` (`math_base_inline.cc:421`). */
function compareFfRelative(a: number, b: number, maxDiff: number, maxUlps: number): boolean {
    if (Math.abs(f32(a - b)) <= maxDiff) return true
    const buf = new DataView(new ArrayBuffer(8))
    buf.setFloat32(0, a)
    buf.setFloat32(4, b)
    const ua = buf.getUint32(0), ub = buf.getUint32(4)
    const aAbs = ua & 0x7fffffff, bAbs = ub & 0x7fffffff
    let diff: number
    if (aAbs > 0x7f800000 || bAbs > 0x7f800000) diff = 0xffffffff
    else if ((ua & 0x80000000) === (ub & 0x80000000)) diff = Math.max(aAbs, bAbs) - Math.min(aAbs, bAbs)
    else diff = (aAbs + bAbs) >>> 0
    return diff <= maxUlps
}

/** `is_larger` (:108). */
function isLarger(a: Rctf, b: Rctf, p: UVPackIslandParams): boolean {
    const extentA = aspectScaledExtent(a, p), extentB = aspectScaledExtent(b, p)
    if (compareFfRelative(extentA, extentB, FLT_EPSILON, 64)) return aspectScaledArea(b, p) < aspectScaledArea(a, p)
    return extentB < extentA
}

/** `angle_wrap` (:209): the argument of `floorf` is a double converted to float. */
function angleWrap(a: number): number {
    return f32(a - f32(Math.floor(f32((a + Math.PI / 2) / Math.PI))) * Math.PI)
}

/** `angle_match` (:200). */
const angleMatch = (a: number, t: number) => (Math.abs(f32(a - t)) < DEG2RADF(f32(0.1)) ? t : a)

/** `plusminus_90_angle` (:217). */
function plusminus90Angle(a: number): number {
    a = angleWrap(a)
    a = angleMatch(a, DEG2RADF(-90))
    a = angleMatch(a, DEG2RADF(0))
    a = angleMatch(a, DEG2RADF(90))
    return a
}

/** `angle_to_mat2` (`math_rotation_c.cc:1291`): `cosf` / `sinf`. */
function angleToMat2(angle: number): Float32Array {
    // `cosf` and `sinf` of one value: one `__sincosf_stret` on Darwin.
    const [s, c] = sincosf(angle)
    return Float32Array.of(c, s, -s, c)
}

/** `PackIsland` (`GEO_uv_pack.hh`). */
export class PackIsland {
    aspectY = 1
    pinned = false
    preTranslate: F2 = [0, 0]
    angle = 0
    callerIndex = -31415927
    pivot: F2 = [0, 0]
    halfDiagonal: F2 = [0, 0]
    preRotate = 0
    triangleVertices: F2[] = []

    /** `add_triangle` (:137). */
    addTriangle(uv0: ArrayLike<number>, uv1: ArrayLike<number>, uv2: ArrayLike<number>): void {
        const c = (v: ArrayLike<number>): F2 => [v[0], v[1]]
        if (distSignedSquaredToEdge(uv0, uv1, uv2) < 0) this.triangleVertices.push(c(uv0), c(uv1), c(uv2))
        else this.triangleVertices.push(c(uv0), c(uv2), c(uv1))
    }

    /** `add_polygon` (:151): `BLI_polyfill_calc` (unsigned) + `BLI_polyfill_beautify`. */
    addPolygon(uvs: F2[]): void {
        const n = uvs.length
        if (n - 2 === 1) {
            this.addTriangle(uvs[0], uvs[1], uvs[2])
            return
        }
        const coords = new Float32Array(n * 2)
        uvs.forEach((p, i) => coords.set(p, i * 2))
        const tris = polyfillCalc(coords, n, 0)
        polyfillBeautify(coords, n, tris)
        for (let j = 0; j < n - 2; j++) this.addTriangle(uvs[tris[j * 3]], uvs[tris[j * 3 + 1]], uvs[tris[j * 3 + 2]])
    }

    /** `build_transformation` (:2353): double `cos`/`sin`, stored as float. */
    buildTransformation(scale: number, angle: number): Float32Array {
        const [s, c] = sincos(angle)
        return Float32Array.of(c * scale, -s * scale * this.aspectY, s * scale / this.aspectY, c * scale)
    }

    /** `build_inverse_transformation` (:2370). */
    buildInverseTransformation(scale: number, angle: number): Float32Array {
        const [s, c] = sincos(angle)
        return Float32Array.of(c / scale, s / scale * this.aspectY, -s / scale / this.aspectY, c / scale)
    }

    /** `calculate_pre_rotation_` (:229). */
    calculatePreRotation(params: UVPackIslandParams): void {
        this.preRotate = 0
        if (params.rotateMethod === RotationMethod.CARDINAL) return
        if (!this.canRotateBeforePack(params)) return
        const coords: F2[] = this.triangleVertices.map(v => [f32(v[0] * this.aspectY), v[1]])
        let angle = f32(-convexhullAabbFitPoints2d(coords))
        const m = angleToMat2(f32(-angle))
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (let i = 0; i < coords.length; i++) {
            coords[i] = mulV2M2V2(m, coords[i][0], coords[i][1])
            // `bounds::min_max` (`math::min` / `math::max` are `std::min` / `std::max`).
            if (i === 0) {
                minX = maxX = coords[i][0]
                minY = maxY = coords[i][1]
            } else {
                minX = stdMin(minX, coords[i][0])
                minY = stdMin(minY, coords[i][1])
                maxX = stdMax(maxX, coords[i][0])
                maxY = stdMax(maxY, coords[i][1])
            }
        }
        const dx = f32(maxX - minX), dy = f32(maxY - minY)
        switch (params.rotateMethod) {
        case RotationMethod.AXIS_ALIGNED_X:
            if (dx < dy) angle = f32(angle + DEG2RADF(90))
            this.preRotate = angleWrap(angle)
            break
        case RotationMethod.AXIS_ALIGNED_Y:
            if (dx > dy) angle = f32(angle + DEG2RADF(90))
            this.preRotate = angleWrap(angle)
            break
        default:
            if (dy < dx) angle = f32(angle + DEG2RADF(90))
            this.preRotate = plusminus90Angle(angle)
        }
        if (!this.preRotate) return
        const t = this.buildTransformation(1, this.preRotate)
        this.triangleVertices = this.triangleVertices.map(v => mulV2M2V2(t, v[0], v[1]))
    }

    /** `finalize_geometry_` (:315). */
    finalizeGeometry(params: UVPackIslandParams): void {
        if (this.triangleVertices.length < 3) throw new Error('PackIsland::finalize_geometry_: island without triangles (BLI_assert)')
        this.calculatePreRotation(params)
        if (params.shapeMethod === ShapeMethod.CONVEX) {
            if (this.triangleVertices.length <= 3) {
                this.calculatePivot()
                return
            }
            const indexMap: number[] = new Array(this.triangleVertices.length)
            const convexLen = convexhull2d(this.triangleVertices, indexMap)
            if (convexLen >= 3) {
                const convex = Array.from({length: convexLen}, (_, i) => this.triangleVertices[indexMap[i]])
                this.triangleVertices = []
                this.addPolygon(convex)
            }
        }
        this.calculatePivot()
    }

    /** `calculate_pivot_` (:363). */
    calculatePivot(): void {
        const t = this.triangleVertices
        let minX = t[0][0], minY = t[0][1], maxX = t[0][0], maxY = t[0][1]
        for (let i = 1; i < t.length; i++) {
            minX = stdMin(minX, t[i][0])
            minY = stdMin(minY, t[i][1])
            maxX = stdMax(maxX, t[i][0])
            maxY = stdMax(maxY, t[i][1])
        }
        this.pivot = [f32(f32(minX + maxX) * 0.5), f32(f32(minY + maxY) * 0.5)]
        this.halfDiagonal = [f32(f32(maxX - minX) * 0.5), f32(f32(maxY - minY) * 0.5)]
    }

    /** `place_` (:387). */
    place(scale: number, phi: UVPhi): void {
        this.angle = f32(phi.rotation + this.preRotate)
        let inv = this.buildInverseTransformation(scale, phi.rotation)
        let t = mulV2M2V2(inv, phi.translation[0], phi.translation[1])
        t = [f32(t[0] - this.pivot[0]), f32(t[1] - this.pivot[1])]
        if (this.preRotate) {
            inv = this.buildInverseTransformation(1, this.preRotate)
            t = mulV2M2V2(inv, t[0], t[1])
        }
        this.preTranslate = t
    }

    /** `get_diagonal_support` (:1004). */
    getDiagonalSupport(scale: number, rotation: number, margin: number): F2 {
        if (rotation === DEG2RADF(-180) || rotation === 0 || rotation === DEG2RADF(180)) {
            return [f32(f32(this.halfDiagonal[0] * scale) + margin), f32(f32(this.halfDiagonal[1] * scale) + margin)]
        }
        if (rotation === DEG2RADF(-90) || rotation === DEG2RADF(90) || rotation === DEG2RADF(270)) {
            return [f32(f32(f32(this.halfDiagonal[1] / this.aspectY) * scale) + margin), f32(f32(f32(this.halfDiagonal[0] * this.aspectY) * scale) + margin)]
        }
        const m = this.buildTransformation(scale, rotation)
        const d = mulV2M2V2(m, this.halfDiagonal[0], this.halfDiagonal[1])
        const sx = Math.abs(d[0]), sy = Math.abs(d[1])
        const k = f32(0.7071)
        return [f32(f32(sx + f32(sy * k)) + margin), f32(f32(f32(sx * k) + sy) + margin)]
    }

    canRotateBeforePack(p: UVPackIslandParams): boolean {
        let m = p.rotateMethod
        if (m === RotationMethod.AXIS_ALIGNED_X || m === RotationMethod.AXIS_ALIGNED_Y) m = RotationMethod.AXIS_ALIGNED
        return canRotateWithMethod(this, p, m)
    }

    canRotate(p: UVPackIslandParams): boolean {
        return canRotateWithMethod(this, p, p.rotateMethod)
    }

    /** `can_scale_` (:2423). */
    canScale(p: UVPackIslandParams): boolean {
        if (!p.scaleToFit) return false
        if (!this.pinned) return true
        return !(p.pinMethod === PinMethod.LOCK_ALL || p.pinMethod === PinMethod.LOCK_SCALE || p.pinMethod === PinMethod.LOCK_ROTATION_SCALE)
    }

    /** `can_translate_` (:2441). */
    canTranslate(p: UVPackIslandParams): boolean {
        if (!this.pinned) return true
        return p.pinMethod !== PinMethod.LOCK_ALL
    }
}

/** `can_rotate_with_method` (:2387). */
function canRotateWithMethod(island: PackIsland, p: UVPackIslandParams, m: RotationMethod): boolean {
    if (m === RotationMethod.NONE || m === RotationMethod.AXIS_ALIGNED_X || m === RotationMethod.AXIS_ALIGNED_Y) return false
    if (!island.pinned) return true
    return !(p.pinMethod === PinMethod.LOCK_ALL || p.pinMethod === PinMethod.LOCK_ROTATION || p.pinMethod === PinMethod.LOCK_ROTATION_SCALE)
}

/** `UVAABBIsland` (:425). */
interface UVAABBIsland {
    uvDiagonal: F2
    index: number
    aspectY: number
}

/** `pack_islands_alpaca_turbo` (:443). */
function alpacaTurbo(excludeIndex: number, exclude: Rctf, islands: UVAABBIsland[], targetAspectY: number, phis: UVPhi[]): Rctf {
    let nextU1 = exclude.xmax, nextV1 = exclude.ymax
    let zigzag = nextU1 < f32(nextV1 * targetAspectY)
    let u0 = zigzag ? nextU1 : 0
    let v0 = zigzag ? 0 : nextV1
    for (let index = excludeIndex; index < islands.length; index++) {
        const island = islands[index]
        const dsmU = island.uvDiagonal[0], dsmV = island.uvDiagonal[1]
        const restart = zigzag ? nextV1 < f32(v0 + dsmV) : nextU1 < f32(u0 + dsmU)
        if (restart) {
            zigzag = nextU1 < f32(nextV1 * targetAspectY)
            u0 = zigzag ? nextU1 : 0
            v0 = zigzag ? 0 : nextV1
        }
        const phi = phis[island.index]
        phi.rotation = 0
        phi.translation = [f32(u0 + f32(dsmU * 0.5)), f32(v0 + f32(dsmV * 0.5))]
        if (zigzag) {
            v0 = f32(v0 + dsmV)
            nextU1 = maxff(nextU1, f32(u0 + dsmU))
            nextV1 = maxff(nextV1, v0)
        } else {
            u0 = f32(u0 + dsmU)
            nextV1 = maxff(nextV1, f32(v0 + dsmV))
            nextU1 = maxff(nextU1, u0)
        }
    }
    return rctf(0, nextU1, 0, nextV1)
}

interface Hole {
    hole: F2
    diag: F2
    rotate: boolean
}

/** `update_hole_rotate` (:513). */
function updateHoleRotate(h: Hole, u0: number, v0: number, u1: number, v1: number): void {
    const holeArea = f32(h.diag[0] * h.diag[1])
    const quadArea = f32(f32(u1 - u0) * f32(v1 - v0))
    if (quadArea <= holeArea) return
    h.hole = [u0, v0]
    h.diag = [f32(u1 - u0), f32(v1 - v0)]
    if (h.diag[1] < h.diag[0]) {
        h.diag = [h.diag[1], h.diag[0]]
        h.rotate = true
    } else h.rotate = false
}

/** `pack_islands_alpaca_rotate` (:550). */
function alpacaRotate(excludeIndex: number, exclude: Rctf, islands: UVAABBIsland[], targetAspectY: number, phis: UVPhi[]): Rctf {
    let nextU1 = exclude.xmax, nextV1 = exclude.ymax
    let zigzag = f32(nextU1 / targetAspectY) < nextV1
    const h: Hole = {hole: [0, 0], diag: [0, 0], rotate: false}
    let u0 = zigzag ? nextU1 : 0
    let v0 = zigzag ? 0 : nextV1
    for (let index = excludeIndex; index < islands.length; index++) {
        const island = islands[index]
        const phi = phis[island.index]
        const uvdiagX = f32(island.uvDiagonal[0] * island.aspectY)
        const minDsm = stdMin(uvdiagX, island.uvDiagonal[1])
        const maxDsm = stdMax(uvdiagX, island.uvDiagonal[1])
        if (minDsm < h.diag[0] && maxDsm < h.diag[1]) {
            if (h.rotate === (minDsm === island.uvDiagonal[0])) {
                phi.rotation = DEG2RADF(90)
                phi.translation = [f32(h.hole[0] + f32(f32(island.uvDiagonal[1] * 0.5) / island.aspectY)), f32(h.hole[1] + f32(f32(island.uvDiagonal[0] * 0.5) * island.aspectY))]
            } else {
                phi.rotation = 0
                phi.translation = [f32(h.hole[0] + f32(island.uvDiagonal[0] * 0.5)), f32(h.hole[1] + f32(island.uvDiagonal[1] * 0.5))]
            }
            const p = [
                h.hole[0], h.hole[1],
                f32(h.hole[0] + f32((h.rotate ? maxDsm : minDsm) / island.aspectY)), f32(h.hole[1] + (h.rotate ? minDsm : maxDsm)),
                f32(h.hole[0] + (h.rotate ? h.diag[1] : h.diag[0])), f32(h.hole[1] + (h.rotate ? h.diag[0] : h.diag[1])),
            ]
            h.diag = [0, h.diag[1]]
            updateHoleRotate(h, p[0], p[3], p[4], p[5])
            updateHoleRotate(h, p[2], p[1], p[4], p[5])
            continue
        }
        const restart = zigzag ? nextV1 < f32(v0 + minDsm) : nextU1 < f32(u0 + f32(minDsm / island.aspectY))
        if (restart) {
            updateHoleRotate(h, u0, v0, nextU1, nextV1)
            zigzag = f32(nextU1 / targetAspectY) < nextV1
            u0 = zigzag ? nextU1 : 0
            v0 = zigzag ? 0 : nextV1
        }
        if (zigzag === (minDsm === uvdiagX)) {
            phi.rotation = DEG2RADF(90)
            phi.translation = [f32(u0 + f32(f32(island.uvDiagonal[1] * 0.5) / island.aspectY)), f32(v0 + f32(f32(island.uvDiagonal[0] * 0.5) * island.aspectY))]
        } else {
            phi.rotation = 0
            phi.translation = [f32(u0 + f32(island.uvDiagonal[0] * 0.5)), f32(v0 + f32(island.uvDiagonal[1] * 0.5))]
        }
        if (zigzag) {
            v0 = f32(v0 + minDsm)
            nextU1 = maxff(nextU1, f32(u0 + f32(maxDsm / island.aspectY)))
            nextV1 = maxff(nextV1, v0)
        } else {
            u0 = f32(u0 + f32(minDsm / island.aspectY))
            nextV1 = maxff(nextV1, f32(v0 + maxDsm))
            nextU1 = maxff(nextU1, u0)
        }
    }
    return rctf(0, nextU1, 0, nextV1)
}

/** `pack_islands_fast` (:665). */
function packFast(excludeIndex: number, exclude: Rctf, aabbs: UVAABBIsland[], rotate: boolean, targetAspectY: number, phis: UVPhi[]): Rctf {
    return rotate ? alpacaRotate(excludeIndex, exclude, aabbs, targetAspectY, phis) : alpacaTurbo(excludeIndex, exclude, aabbs, targetAspectY, phis)
}

/** `pack_gobel` (:683). */
function packGobel(aabbs: UVAABBIsland[], scale: number, m: number, phis: UVPhi[]): void {
    const s05 = f32(Math.sqrt(0.5))
    for (let i = 0; i < aabbs.length; i++) {
        const phi = phis[aabbs[i].index]
        phi.rotation = 0
        if (i === 0) {
            phi.translation = [f32(0.5 * scale), f32(0.5 * scale)]
            continue
        }
        const xx = (i - 1) % m
        const yy = Math.trunc((i - 1) / m)
        phi.translation = [f32(f32(xx + 0.5) * scale), f32(f32(yy + 0.5) * scale)]
        if (xx >= yy) phi.translation[0] = f32(phi.translation[0] + f32(f32(1 + s05) * scale))
        else phi.translation[1] = f32(phi.translation[1] + f32(s05 * scale))
        if (i === m * (m + 1) + 1) {
            phi.translation[0] = f32(phi.translation[0] + f32(f32(m + s05) * scale))
            phi.translation[1] = f32(phi.translation[1] - scale)
        } else if (i > m * (m + 1) + 1) {
            phi.rotation = DEG2RADF(45)
            phi.translation[0] = f32(f32(f32(f32(i - m * (m + 1) - 1.5) * cosf(phi.rotation)) + 1) * scale)
            phi.translation[1] = phi.translation[0]
        }
    }
}

/** `pack_islands_optimal_pack_table` (:717). */
function optimalPackTable(tableCount: number, maxExtent: number, optimal: readonly number[], islandCount: number, largeUv: number,
    aabbs: UVAABBIsland[], params: UVPackIslandParams, phis: UVPhi[], extentRef: {r: Rctf}): boolean {
    if (tableCount < islandCount) return false
    const e = f32(largeUv * maxExtent)
    const extent = rctf(0, e, 0, e)
    if (isLarger(extent, extentRef.r, params)) return false
    extentRef.r = extent
    for (let i = 0; i < islandCount; i++) {
        const phi = phis[aabbs[i].index]
        phi.translation = [f32(optimal[i * 3] * largeUv), f32(optimal[i * 3 + 1] * largeUv)]
        phi.rotation = optimal[i * 3 + 2]
    }
    return true
}

/* eslint-disable array-element-newline */
const OPT_11 = [2.6238700165660708840676, 2.4365065643739085565755, 0.70130710554829878145, 1.9596047386700836678841, 1.6885655318806973568257,
    0.70130710554829878145, 1.9364970731945949644626, 3.1724566890997589752033, 0.70130710554829878145, 1.2722458068219282267819,
    2.4245322476118422727609, 0.70130710554829878145, 3.1724918301381124230431, 1.536261617698265524723, 0.70130710554829878145,
    3.3770999999999999907629, 3.3770999999999999907629, 0, 0.5, 1.5, 0, 2.5325444557069398676674, 0.5, 0, 0.5, 3.3770999999999999907629, 0,
    1.5, 0.5, 0, 0.5, 0.5, 0].map(f32)
const OPT_18 = [2.4700161985907582717914, 2.4335783708246112588824, 0.42403103949074028022892, 1.3528594569415370862941,
    2.3892972847076845432923, 0.42403103949074028022892, 2.0585783708246108147932, 1.5221405430584633577951, 0.42403103949074028022892,
    1.7642972847076845432923, 3.3007351124738324443797, 0.42403103949074028022892, 3.3228756555322949139963, 1.5, 0,
    3.3228756555322949139963, 3.3228756555322949139963, 0, 0.5, 1.5, 0, 2.3228756555322949139963, 4.3228756555322949139963, 0,
    0.5, 3.3228756555322949139963, 0, 1.5, 0.5, 0, 3.3228756555322949139963, 0.5, 0, 3.3228756555322949139963, 4.3228756555322949139963, 0,
    4.3228756555322949139963, 1.5, 0, 4.3228756555322949139963, 3.3228756555322949139963, 0, 0.5, 0.5, 0, 0.5, 4.3228756555322949139963, 0,
    4.3228756555322949139963, 0.5, 0, 4.3228756555322949139963, 4.3228756555322949139963, 0].map(f32)
const OPT_19 = [2.1785113019775792508881, 1.9428090415820631342569, 0.78539816339744827899949, 1.4714045207910317891731,
    2.6499158227686105959719, 0.78539816339744827899949, 2.9428090415820640224354, 2.7071067811865479058042, 0.78539816339744827899949,
    2.2357022603955165607204, 3.4142135623730953675192, 0.78539816339744827899949, 1.4428090415820635783462, 1.2642977396044836613243,
    0.78539816339744827899949, 3.3856180831641271566923, 1.5, 0, 0.73570226039551600560884, 1.9714045207910311230393,
    0.78539816339744827899949, 3.6213203435596432733234, 3.4428090415820635783462, 0.78539816339744827899949, 2.9142135623730958116084,
    4.1499158227686105959719, 0.78539816339744827899949, 2.3856180831641271566923, 0.5, 0, 0.5, 3.3856180831641271566923, 0, 1.5,
    4.3856180831641271566923, 0, 4.3856180831641271566923, 2.5, 0, 3.3856180831641271566923, 0.5, 0, 4.3856180831641271566923, 1.5, 0,
    0.5, 0.5, 0, 0.5, 4.3856180831641271566923, 0, 4.3856180831641271566923, 0.5, 0, 4.3856180831641271566923, 4.3856180831641271566923,
    0].map(f32)
const OPT_26 = [2.3106601717798209705279, 2.8106601717798214146171, 0.78539816339744827899949, 1.6035533905932735088129,
    2.1035533905932739529021, 0.78539816339744827899949, 3.0177669529663684322429, 2.1035533905932739529021, 0.78539816339744827899949,
    2.3106601717798209705279, 1.3964466094067264911871, 0.78539816339744827899949, 1.6035533905932735088129, 3.5177669529663688763321,
    0.78539816339744827899949, 0.89644660940672593607559, 2.8106601717798214146171, 0.78539816339744827899949, 3.0177669529663684322429,
    3.5177669529663688763321, 0.78539816339744827899949, 3.7248737341529158939579, 2.8106601717798214146171, 0.78539816339744827899949,
    2.3106601717798209705279, 4.2248737341529167821363, 0.78539816339744827899949, 0.5, 1.5, 0, 1.5, 0.5, 0, 3.1213203435596419410558,
    0.5, 0, 4.1213203435596419410558, 1.5, 0, 0.5, 4.1213203435596419410558, 0, 0.5, 0.5, 0, 4.1213203435596419410558,
    4.1213203435596419410558, 0, 4.1213203435596419410558, 0.5, 0, 1.5, 5.1213203435596419410558, 0, 3.1213203435596419410558,
    5.1213203435596419410558, 0, 5.1213203435596419410558, 2.5, 0, 5.1213203435596419410558, 1.5, 0, 0.5, 5.1213203435596419410558, 0,
    4.1213203435596419410558, 5.1213203435596419410558, 0, 5.1213203435596419410558, 4.1213203435596419410558, 0,
    5.1213203435596419410558, 0.5, 0, 5.1213203435596419410558, 5.1213203435596419410558, 0].map(f32)
/* eslint-enable array-element-newline */

/** `pack_islands_optimal_pack` (:745). */
function optimalPack(aabbs: UVAABBIsland[], params: UVPackIslandParams, phis: UVPhi[], extentRef: {r: Rctf}): void {
    if (params.shapeMethod === ShapeMethod.AABB) return
    if (params.targetAspectY !== 1) return
    if (params.rotateMethod !== RotationMethod.ANY) return
    let largeUv = 0
    for (const a of aabbs) {
        largeUv = maxff(largeUv, a.uvDiagonal[0])
        largeUv = maxff(largeUv, a.uvDiagonal[1])
    }
    let count = aabbs.length
    optimalPackTable(11, f32(3.8770999999999999907629), OPT_11, count, largeUv, aabbs, params, phis, extentRef)
    optimalPackTable(18, f32(4.8228756555322949139963), OPT_18, count, largeUv, aabbs, params, phis, extentRef)
    optimalPackTable(19, f32(4.8856180831641271566923), OPT_19, count, largeUv, aabbs, params, phis, extentRef)
    optimalPackTable(26, f32(5.6213203435596419410558), OPT_26, count, largeUv, aabbs, params, phis, extentRef)
    if (count === 37) count = 38
    if (count === 50) count = 52
    if (count === 51) count = 52
    if (count === 65) count = 67
    if (count === 66) count = 67
    const sqrt2 = f32(Math.sqrt(2)), s05 = f32(Math.sqrt(0.5))
    for (let a = 1; a < 20; a++) {
        // `int n = a * a + a + 3 + floorf((a - 1) * sqrtf(2.0f))`: int + float, truncated.
        const n = Math.trunc(f32((a * a + a + 3) + f32(Math.floor(f32((a - 1) * sqrt2)))))
        if (count === n) {
            const maxUvGobel = f32(largeUv * f32(f32(a + 1) + s05))
            const extent = rctf(0, maxUvGobel, 0, maxUvGobel)
            if (isLarger(extentRef.r, extent, params)) {
                extentRef.r = extent
                packGobel(aabbs, largeUv, a, phis)
            }
            return
        }
    }
}

/** `pack_island_box_pack_2d` (:1149). */
function boxPackIslands(aabbs: UVAABBIsland[], params: UVPackIslandParams, phis: UVPhi[], extentRef: {r: Rctf}): void {
    const boxes: BoxPack[] = aabbs.map(a => ({x: 0, y: 0, w: f32(a.uvDiagonal[0] / params.targetAspectY), h: a.uvDiagonal[1], v: []}))
    let [maxU, maxV] = boxPack2d(boxes)
    maxU = f32(maxU * params.targetAspectY)
    const extent = rctf(0, maxU, 0, maxV)
    if (isLarger(extentRef.r, extent, params)) {
        extentRef.r = extent
        aabbs.forEach((a, i) => {
            const b = boxes[i]
            const phi = phis[a.index]
            phi.rotation = 0
            phi.translation = [f32(f32(b.x + f32(b.w * 0.5)) * params.targetAspectY), f32(b.y + f32(b.h * 0.5))]
        })
    }
}

/** `dist_signed_squared_to_edge` (:67) on scalars (the hot path of the xatlas bitmap). */
function distSsq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const ex = f32(bx - ax), ey = f32(by - ay)
    const sx = f32(px - ax), sy = f32(py - ay)
    const el2 = f32(f32(ex * ex) + f32(ey * ey))
    if (el2 < F_1E_40) return f32(f32(sx * sx) + f32(sy * sy))
    const num = f32(f32(ex * sy) - f32(ey * sx))
    const ssq = num >= 0 ? f32(num * num) : f32(-num * num)
    return f32(ssq / el2)
}
const F_1E_40 = f32(1e-40)

/** `signed_distance_fat_triangle` (:1240) on scalars. */
function signedDistanceFatTriangle(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
    const d01 = distSsq(px, py, x0, y0, x1, y1)
    const d12 = distSsq(px, py, x1, y1, x2, y2)
    const d20 = distSsq(px, py, x2, y2, x0, y0)
    // `std::max({...})`: the first largest.
    let result = d01
    if (result < d12) result = d12
    if (result < d20) result = d20
    if (result < 0) return f32(-Math.sqrt(-result))
    let dx = f32(px - x0), dy = f32(py - y0)
    let l2 = f32(f32(dx * dx) + f32(dy * dy))
    if (l2 < result) result = l2
    dx = f32(px - x1)
    dy = f32(py - y1)
    l2 = f32(f32(dx * dx) + f32(dy * dy))
    if (l2 < result) result = l2
    dx = f32(px - x2)
    dy = f32(py - y2)
    l2 = f32(f32(dx * dx) + f32(dy * dy))
    if (l2 < result) result = l2
    return f32(Math.sqrt(result))
}

/** `Math.fround` bound locally: the hot loops below call it directly (it inlines; the imported `f32` binding may not). */
const fr = Math.fround

/** `Occupancy` (:1194): the xatlas bitmap. Scalar code, no allocation in the loops; same operations as Blender's. */
class Occupancy {
    readonly bitmapRadix = 800
    bitmapScaleReciprocal = 1
    private readonly bitmap: Float32Array
    private witnessX = -1
    private witnessY = -1
    private witnessDistance = 0
    triangleHint = 0
    private readonly terminal = 1048576

    constructor(initialScale: number) {
        this.bitmap = new Float32Array(this.bitmapRadix * this.bitmapRadix)
        this.increaseScale()
        this.bitmapScaleReciprocal = f32(this.bitmapRadix / initialScale)
    }

    increaseScale(): void {
        this.bitmapScaleReciprocal = f32(this.bitmapScaleReciprocal * 0.5)
        this.clear()
    }

    clear(): void {
        this.bitmap.fill(this.terminal)
        this.witnessX = -1
        this.witnessY = -1
        this.witnessDistance = 0
        this.triangleHint = 0
    }

    /** `trace_triangle` (:1266). */
    traceTriangle(u0x: number, u0y: number, u1x: number, u1y: number, u2x: number, u2y: number, margin: number, write: boolean): number {
        const r = this.bitmapScaleReciprocal
        // `std::min({...})` / `std::max({...})`: the first smallest / largest.
        let x0 = u0x
        if (u1x < x0) x0 = u1x
        if (u2x < x0) x0 = u2x
        let y0 = u0y
        if (u1y < y0) y0 = u1y
        if (u2y < y0) y0 = u2y
        let x1 = u0x
        if (x1 < u1x) x1 = u1x
        if (x1 < u2x) x1 = u2x
        let y1 = u0y
        if (y1 < u1y) y1 = u1y
        if (y1 < u2y) y1 = u2y
        const spread = write ? fr(margin * 2) : 0
        const radix = this.bitmapRadix
        const ix0 = Math.max(Math.floor(fr(fr(x0 - spread) * r)), 0)
        const iy0 = Math.max(Math.floor(fr(fr(y0 - spread) * r)), 0)
        const ix1 = Math.min(Math.floor(fr(fr(fr(x1 + spread) * r) + 2)), radix)
        const iy1 = Math.min(Math.floor(fr(fr(fr(y1 + spread) * r) + 2)), radix)
        const s0x = fr(u0x * r), s0y = fr(u0y * r), s1x = fr(u1x * r), s1y = fr(u1y * r), s2x = fr(u2x * r), s2y = fr(u2y * r)
        const twoMr = fr(fr(2 * margin) * r)
        const epsilon = EPS_7071 < twoMr ? twoMr : EPS_7071
        if (!write) {
            if (ix0 <= this.witnessX && this.witnessX < ix1 && iy0 <= this.witnessY && this.witnessY < iy1) {
                const distance = signedDistanceFatTriangle(this.witnessX, this.witnessY, s0x, s0y, s1x, s1y, s2x, s2y)
                const extent = fr(fr(epsilon - distance) - this.witnessDistance)
                if (extent > F_M01) return 0 < extent ? extent : 0
            }
        }
        const bitmap = this.bitmap
        // The edge vectors and squared lengths of `dist_signed_squared_to_edge` do not depend on the probe: computed once
        // per triangle (same operations, same values) instead of per pixel.
        const ax = fr(s1x - s0x), ay = fr(s1y - s0y), al = fr(fr(ax * ax) + fr(ay * ay)), aDeg = al < F_1E_40
        const bx = fr(s2x - s1x), by = fr(s2y - s1y), bl = fr(fr(bx * bx) + fr(by * by)), bDeg = bl < F_1E_40
        const cx = fr(s0x - s2x), cy = fr(s0y - s2y), cl = fr(fr(cx * cx) + fr(cy * cy)), cDeg = cl < F_1E_40
        for (let y = iy1 - 1; y >= iy0; y--) {
            const row = y * radix
            const d0y = fr(y - s0y), d1y = fr(y - s1y), d2y = fr(y - s2y)
            for (let x = ix1 - 1; x >= ix0; x--) {
                const h = row + x
                const hot = bitmap[h]
                if (!write && hot > epsilon) continue
                // `signed_distance_fat_triangle(probe, uv0s, uv1s, uv2s)` inlined: `dist_signed_squared_to_edge` for the
                // three edges (side = probe - edge start), the first largest, then the vertex distances.
                const d0x = fr(x - s0x), d1x = fr(x - s1x), d2x = fr(x - s2x)
                let n: number
                let r: number
                if (aDeg) r = fr(fr(d0x * d0x) + fr(d0y * d0y))
                else {
                    n = fr(fr(ax * d0y) - fr(ay * d0x))
                    r = fr((n >= 0 ? fr(n * n) : fr(-n * n)) / al)
                }
                let t: number
                if (bDeg) t = fr(fr(d1x * d1x) + fr(d1y * d1y))
                else {
                    n = fr(fr(bx * d1y) - fr(by * d1x))
                    t = fr((n >= 0 ? fr(n * n) : fr(-n * n)) / bl)
                }
                if (r < t) r = t
                if (cDeg) t = fr(fr(d2x * d2x) + fr(d2y * d2y))
                else {
                    n = fr(fr(cx * d2y) - fr(cy * d2x))
                    t = fr((n >= 0 ? fr(n * n) : fr(-n * n)) / cl)
                }
                if (r < t) r = t
                let distance: number
                if (r < 0) distance = fr(-Math.sqrt(-r))
                else {
                    t = fr(fr(d0x * d0x) + fr(d0y * d0y))
                    if (t < r) r = t
                    t = fr(fr(d1x * d1x) + fr(d1y * d1y))
                    if (t < r) r = t
                    t = fr(fr(d2x * d2x) + fr(d2y * d2y))
                    if (t < r) r = t
                    distance = fr(Math.sqrt(r))
                }
                if (write) {
                    // `min_ff(distance, *hotspot)`.
                    bitmap[h] = distance < hot ? distance : hot
                    continue
                }
                const extent = fr(fr(epsilon - distance) - hot)
                if (extent > 0) {
                    this.witnessX = x
                    this.witnessY = y
                    this.witnessDistance = hot
                    return extent
                }
            }
        }
        return -1
    }

    /** `trace_island` (:1039). */
    traceIsland(island: PackIsland, phi: UVPhi, scale: number, margin: number, write: boolean): number {
        const support = island.getDiagonalSupport(scale, phi.rotation, margin)
        if (!write && (phi.translation[0] < support[0] || phi.translation[1] < support[1])) return this.terminal
        const m = island.buildTransformation(scale, phi.rotation)
        const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3]
        // `mul_v2_m2v2(pivot_transformed, matrix, pivot_)`.
        const ptx = f32(f32(m0 * island.pivot[0]) + f32(m2 * island.pivot[1]))
        const pty = f32(f32(m1 * island.pivot[0]) + f32(m3 * island.pivot[1]))
        const dx = f32(phi.translation[0] - ptx), dy = f32(phi.translation[1] - pty)
        const tv = island.triangleVertices
        const n = tv.length
        for (let i = 0; i < n; i += 3) {
            const j = (i + this.triangleHint) % n
            const a = tv[j], b = tv[j + 1], c = tv[j + 2]
            const extent = this.traceTriangle(
                f32(f32(f32(m0 * a[0]) + f32(m2 * a[1])) + dx), f32(f32(f32(m1 * a[0]) + f32(m3 * a[1])) + dy),
                f32(f32(f32(m0 * b[0]) + f32(m2 * b[1])) + dx), f32(f32(f32(m1 * b[0]) + f32(m3 * b[1])) + dy),
                f32(f32(f32(m0 * c[0]) + f32(m2 * c[1])) + dx), f32(f32(f32(m1 * c[0]) + f32(m3 * c[1])) + dy),
                margin, write)
            if (!write && extent >= 0) {
                this.triangleHint = j
                return extent
            }
        }
        return -1
    }
}
const EPS_7071 = f32(0.7071)
const F_M01 = f32(-0.1)

/** `find_best_fit_for_island` (:1072). */
function findBestFit(island: PackIsland, scanLine: number, occ: Occupancy, scale: number, angle90: number, margin: number, targetAspectY: number): UVPhi {
    const bitmapScale = f32(1 / occ.bitmapScaleReciprocal)
    const sqrtAspect = f32(Math.sqrt(targetAspectY))
    const scanX = Math.trunc(f32(scanLine * sqrtAspect))
    const scanY = Math.trunc(f32(scanLine / sqrtAspect))
    const phi = new UVPhi()
    phi.rotation = DEG2RADF(angle90 * 90)
    const support = island.getDiagonalSupport(scale, phi.rotation, 0)
    let t = Math.trunc(Math.ceil(f32(f32(f32(2 * support[0]) + margin) * occ.bitmapScaleReciprocal)))
    while (t < scanX) {
        phi.translation = [f32(f32(t * bitmapScale) - support[0]), f32(f32(scanY * bitmapScale) - support[1])]
        const extent = occ.traceIsland(island, phi, scale, margin, false)
        if (extent < 0) return phi
        t = t + Math.max(1, Math.trunc(extent))
    }
    t = Math.trunc(Math.ceil(f32(f32(f32(2 * support[1]) + margin) * occ.bitmapScaleReciprocal)))
    while (t <= scanY) {
        phi.translation = [f32(f32(scanX * bitmapScale) - support[0]), f32(f32(t * bitmapScale) - support[1])]
        const extent = occ.traceIsland(island, phi, scale, margin, false)
        if (extent < 0) return phi
        t = t + Math.max(1, Math.trunc(extent))
    }
    return new UVPhi()
}

/** `guess_initial_scale` (:1151). */
function guessInitialScale(islands: PackIsland[], scale: number, margin: number): number {
    let sum = f32(1e-40)
    for (const island of islands) {
        sum = f32(sum + f32(f32(f32(f32(island.halfDiagonal[0] * 2) * scale)) + f32(2 * margin)))
        sum = f32(sum + f32(f32(f32(f32(island.halfDiagonal[1] * 2) * scale)) + f32(2 * margin)))
    }
    return f32(f32(Math.sqrt(sum)) / 6)
}

/** `UVMinimumEnclosingSquareFinder` (:1164). */
class SquareFinder {
    bestQuad = 0
    bestAngle = 0
    bestBounds: Rctf = rctf(0, 0, 0, 0)
    points: F2[] = []
    indices: number[] = []
    constructor(private readonly margin: number, private readonly params: UVPackIslandParams) {}

    /** `update` (:1189): `angle` is a double; `cos` / `sin` are double, stored as float. */
    update(angle: number): number {
        const [sn, cs] = sincos(angle)
        const dx = f32(cs), dy = f32(sn)
        const b = rctf(FLT_MAX, -FLT_MAX, FLT_MAX, -FLT_MAX)
        for (const i of this.indices) {
            const p = this.points[i]
            doMinmax(b, f32(f32(p[0] * dx) + f32(p[1] * dy)), f32(f32(-p[0] * dy) + f32(p[1] * dx)))
        }
        b.xmin = f32(b.xmin - this.margin)
        b.ymin = f32(b.ymin - this.margin)
        b.xmax = f32(b.xmax + this.margin)
        b.ymax = f32(b.ymax + this.margin)
        const q = aspectScaledExtent(b, this.params)
        if (this.bestQuad > q) {
            this.bestQuad = q
            this.bestAngle = f32(angle)
            this.bestBounds = b
        }
        return q
    }

    /** `update_recursive` (:1219). */
    updateRecursive(angle0: number, quad0: number, angle1: number, quad1: number): void {
        const mid = f32(f32(angle0 + angle1) * 0.5)
        const quadMid = this.update(mid)
        const sep = f32(angle1 - angle0)
        if (sep < DEG2RADF(f32(0.002))) return
        const search = DEG2RADF(10) < sep
        if (search || quad0 <= quad1) this.updateRecursive(angle0, quad0, mid, quadMid)
        if (search || quad1 <= quad0) this.updateRecursive(mid, quadMid, angle1, quad1)
    }
}

/** `rotate_inside_square` (:1250). */
function rotateInsideSquare(indices: UVAABBIsland[], islands: PackIsland[], params: UVPackIslandParams, scale: number, margin: number,
    phis: UVPhi[], extentRef: {r: Rctf}): boolean {
    if (!indices.length) return false
    if (params.rotateMethod !== RotationMethod.ANY) return false
    if (params.shapeMethod === ShapeMethod.AABB && indices.length > 1) return false
    const finder = new SquareFinder(margin, params)
    finder.bestQuad = f32(aspectScaledExtent(extentRef.r, params) * f32(0.999))
    const aspectY = 1
    for (const a of indices) {
        const i = a.index
        const island = islands[i]
        if (island.aspectY !== aspectY) return false
        const islandScale = island.canScale(params) ? scale : 1
        const m = island.buildTransformation(islandScale, phis[i].rotation)
        const pt = mulV2M2V2(m, island.pivot[0], island.pivot[1])
        const delta: F2 = [f32(phis[i].translation[0] - pt[0]), f32(phis[i].translation[1] - pt[1])]
        for (const v of island.triangleVertices) {
            const p = mulV2M2V2(m, v[0], v[1])
            finder.points.push([f32(p[0] + delta[0]), f32(p[1] + delta[1])])
        }
    }
    finder.indices = new Array(finder.points.length)
    const convexSize = convexhull2d(finder.points, finder.indices)
    finder.indices.length = convexSize
    const quad180 = finder.update(DEG2RADF(-180))
    finder.updateRecursive(DEG2RADF(-180), quad180, DEG2RADF(180), quad180)
    if (finder.bestAngle === 0) return false
    for (const a of indices) {
        const i = a.index
        const island = islands[i]
        const m = island.buildTransformation(1, finder.bestAngle)
        phis[i].rotation = f32(phis[i].rotation + finder.bestAngle)
        const t = mulV2M2V2(m, phis[i].translation[0], phis[i].translation[1])
        phis[i].translation = [f32(t[0] - finder.bestBounds.xmin), f32(t[1] - finder.bestBounds.ymin)]
    }
    extentRef.r = rctf(0, sizeX(finder.bestBounds), 0, sizeY(finder.bestBounds))
    return true
}

/** `pack_island_xatlas` (:1360): returns the number of islands it placed (0 when it gave up or did not improve). */
function packXatlas(indices: UVAABBIsland[], islands: PackIsland[], scale: number, margin: number, params: UVPackIslandParams,
    rPhis: UVPhi[], extentRef: {r: Rctf}): number {
    if (params.shapeMethod === ShapeMethod.AABB) return 0
    const phis = Array.from({length: rPhis.length}, () => new UVPhi())
    const occ = new Occupancy(guessInitialScale(islands, scale, margin))
    const extentBox = {r: rctf(0, 0, 0, 0)}
    const squareMilestone = Math.trunc(Math.sqrt(indices.length) / 4 + 2)
    let scanLine = 0, traced = 0, i = 0
    let placedCanRotate = true
    let increaseRemaining = 32
    while (i < indices.length) {
        while (traced < i) {
            const idx = indices[traced].index
            const island = islands[idx]
            occ.traceIsland(island, phis[idx], island.canScale(params) ? scale : 1, margin, true)
            traced++
        }
        let island: PackIsland | null = islands[indices[i].index]
        let phi = new UVPhi()
        if (!island.canTranslate(params)) {
            phi.translation = [f32(island.pivot[0] - params.udimBaseOffset[0]), f32(island.pivot[1] - params.udimBaseOffset[1])]
            phi.rotation = 0
            phis[indices[i].index] = phi
            i++
            placedCanRotate = false
            continue
        }
        const islandScale = island.canScale(params) ? scale : 1
        let max90 = 1
        if (island.canRotate(params)) {
            if (i && i < 50) max90 = 4
        } else placedCanRotate = false
        for (let a90 = 0; a90 < max90; a90++) {
            phi = findBestFit(island, scanLine, occ, islandScale, a90, margin, params.targetAspectY)
            if (phi.isValid()) break
        }
        if (!phi.isValid()) {
            island = null
            if (i < 10) scanLine++
            else scanLine += 2
            if (scanLine < f32(occ.bitmapRadix * f32(Math.sqrt(stdMin(params.targetAspectY, f32(1 / params.targetAspectY)))))) continue
            if (--increaseRemaining < 0) return 0
            scanLine = 0
            occ.increaseScale()
            traced = 0
            continue
        }
        phis[indices[i].index] = phi
        i++
        if (i === squareMilestone && placedCanRotate) {
            if (rotateInsideSquare(indices.slice(0, i), islands, params, scale, margin, phis, extentBox)) {
                scanLine = 0
                traced = 0
                occ.clear()
                continue
            }
        }
        const s = island.getDiagonalSupport(islandScale, phi.rotation, margin)
        const topRight: F2 = [f32(s[0] + phi.translation[0]), f32(s[1] + phi.translation[1])]
        extentBox.r.xmax = stdMax(topRight[0], extentBox.r.xmax)
        extentBox.r.ymax = stdMax(topRight[1], extentBox.r.ymax)
        if (!isLarger(extentRef.r, extentBox.r, params)) {
            if (i >= squareMilestone) return 0
        }
        if (i < 128 || (i & 31) === 16) scanLine = 0
        else scanLine = Math.max(0, scanLine - 25)
    }
    if (!isLarger(extentRef.r, extentBox.r, params)) return 0
    extentRef.r = extentBox.r
    for (let j = 0; j < i; j++) rPhis[indices[j].index] = phis[indices[j].index].clone()
    return i
}

/** `BLI_rctf_compare(a, b, 0.0f)`. */
const rctfEqual = (a: Rctf, b: Rctf) => Math.abs(f32(a.xmin - b.xmin)) <= 0 && Math.abs(f32(a.xmax - b.xmax)) <= 0 &&
    Math.abs(f32(a.ymin - b.ymin)) <= 0 && Math.abs(f32(a.ymax - b.ymax)) <= 0

/** `pack_islands_scale_margin` (:1557). */
function packIslandsScaleMargin(islands: PackIsland[], scale: number, margin: number, params: UVPackIslandParams, phis: UVPhi[]): number {
    const allCanRotate = islands.every(i => i.canRotate(params))
    const aabbs: UVAABBIsland[] = islands.map((island, i) => {
        const s = island.canScale(params) ? scale : 1
        return {index: i, aspectY: island.aspectY,
            uvDiagonal: [f32(f32(f32(island.halfDiagonal[0] * 2) * s) + f32(2 * margin)), f32(f32(f32(island.halfDiagonal[1] * 2) * s) + f32(2 * margin))]}
    })
    if (allCanRotate) {
        libcxxStableSort(aabbs, (a, b) => {
            const ta = islands[a.index].canTranslate(params), tb = islands[b.index].canTranslate(params)
            if (ta !== tb) return tb
            let au = f32(a.uvDiagonal[0] * a.aspectY), av = a.uvDiagonal[1]
            let bu = f32(b.uvDiagonal[0] * b.aspectY), bv = b.uvDiagonal[1]
            if (au > av) [au, av] = [av, au]
            if (bu > bv) [bu, bv] = [bv, bu]
            const diffU = f32(au - bu)
            let diffV = f32(av - bv)
            diffV = f32(diffV + f32(diffU * f32(0.05)))
            if (diffV === 0) return diffU > 0
            return diffV > 0
        })
    } else {
        libcxxStableSort(aabbs, (a, b) => {
            const ta = islands[a.index].canTranslate(params), tb = islands[b.index].canTranslate(params)
            if (ta !== tb) return tb
            return f32(b.uvDiagonal[0] * b.uvDiagonal[1]) < f32(a.uvDiagonal[0] * a.uvDiagonal[1])
        })
    }
    let lockedBounds = rctf(0, 0, 0, 0)
    let lockedCount = 0
    for (let i = 0; i < islands.length; i++) {
        const island = islands[aabbs[i].index]
        if (island.canTranslate(params)) break
        const bl: F2 = [f32(island.pivot[0] - island.halfDiagonal[0]), f32(island.pivot[1] - island.halfDiagonal[1])]
        const tr: F2 = [f32(island.pivot[0] + island.halfDiagonal[0]), f32(island.pivot[1] + island.halfDiagonal[1])]
        if (i === 0) lockedBounds = rctf(bl[0], tr[0], bl[1], tr[1])
        else {
            doMinmax(lockedBounds, bl[0], bl[1])
            doMinmax(lockedBounds, tr[0], tr[1])
        }
        const phi = phis[aabbs[i].index]
        phi.translation = [f32(island.pivot[0] - params.udimBaseOffset[0]), f32(island.pivot[1] - params.udimBaseOffset[1])]
        phi.rotation = 0
        lockedCount = i + 1
    }
    let alpacaCutoff = 1024
    if (params.marginMethod === MarginMethod.FRACTION && margin > 0) alpacaCutoff = 81
    alpacaCutoff = Math.max(alpacaCutoff, lockedCount)
    let slow = aabbs.slice(0, Math.min(alpacaCutoff, islands.length))
    const extent = {r: rctf(0, f32(1e30), 0, f32(1e30))}
    extent.r = packFast(lockedCount, lockedBounds, slow, allCanRotate, params.targetAspectY, phis)
    const fastExtent = {...extent.r}
    if (lockedCount === 0) optimalPack(slow, params, phis, extent)
    if (lockedCount === 0) boxPackIslands(slow, params, phis, extent)
    const maxXatlas = packXatlas(slow, islands, scale, margin, params, phis, extent)
    if (maxXatlas) slow = aabbs.slice(0, maxXatlas)
    if (allCanRotate && aabbs.length > slow.length) rotateInsideSquare(slow, islands, params, scale, margin, phis, extent)
    if (rctfEqual(extent.r, fastExtent)) {
        slow = slow.slice(0, lockedCount)
        extent.r = lockedBounds
    }
    const finalExtent = packFast(slow.length, extent.r, aabbs, allCanRotate, params.targetAspectY, phis)
    return aspectScaledExtent(finalExtent, params)
}

/** `calc_margin_from_aabb_length_sum` (:1952): a double sum of `sqrtf`, `margin * sum * 0.1f` in double. */
function calcMarginFromAabbLengthSum(islands: PackIsland[], params: UVPackIslandParams): number {
    let sum = 0
    for (const island of islands) {
        const w = f32(island.halfDiagonal[0] * 2), h = f32(island.halfDiagonal[1] * 2)
        sum += f32(Math.sqrt(f32(w * h)))
    }
    return f32(params.margin * sum * f32(0.1))
}

/** `pack_islands` (:2213): returns the scale. */
export function packIslands(islands: PackIsland[], params: UVPackIslandParams): number {
    if (!islands.length) return 1
    if (params.mergeOverlap) throw new Error('pack_islands: merge_overlap (OverlapMerger) is not ported')
    for (const island of islands) island.finalizeGeometry(params)
    let canScaleCount = 0, canTranslateCount = 0
    for (const island of islands) {
        if (island.canScale(params)) canScaleCount++
        if (island.canTranslate(params)) canTranslateCount++
    }
    if (canTranslateCount === 0) return 1
    if (params.marginMethod === MarginMethod.FRACTION && params.margin > 0 && canScaleCount > 0) {
        throw new Error('pack_islands: pack_islands_margin_fraction (ED_UVPACK_MARGIN_FRACTION) is not ported')
    }
    let margin = params.margin
    if (params.marginMethod === MarginMethod.SCALED) margin = calcMarginFromAabbLengthSum(islands, params)
    if (canScaleCount > 0 && canScaleCount !== islands.length) throw new Error('pack_islands: pack_islands_margin_fraction (partly scalable islands) is not ported')
    const phis = Array.from({length: islands.length}, () => new UVPhi())
    const scale = 1
    const maxUv = packIslandsScaleMargin(islands, scale, margin, params, phis)
    const result = canScaleCount && maxUv > f32(1e-14) ? f32(params.targetExtent / maxUv) : 1
    islands.forEach((island, i) => island.place(scale, phis[i]))
    return result
}
