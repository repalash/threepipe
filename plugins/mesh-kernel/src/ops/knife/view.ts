/**
 * A 3D viewport region as Blender's view code sees it: `RegionView3D` (`viewmat`, `viewinv`, `winmat`,
 * `persmat`, `persinv`, `is_persp`), the region size, and `View3D`'s clip range - with the projection
 * helpers the knife and bisect call, ported from `source/blender/editors/space_view3d/view3d_project.cc`
 * and `view3d_utils.cc`.
 *
 * Region coordinates are Blender's: pixels, origin at the **bottom-left**, `y` up. A browser caller flips
 * `y` at the boundary (`y_region = height - y_css`).
 *
 * Not supported, and not reachable from a three.js camera: the camera view (`RV3D_CAMOB`, Blender's
 * "look through the scene camera" with its own zoom/offset) and box clipping (`RV3D_CLIPPING`,
 * Alt+B). Every `RV3D_CLIPPING_ENABLED` branch in the ported code is therefore the "off" branch.
 */

import {FLT_MAX, invertM4, M4, m4Col, mulM4M4, mulProjectM4V3, mulProjectM4V3Zfac, normalize3, sub3, V2, V3, madd3, dot3, isectRayPlaneV3Factor} from './geom'

export interface KnifeViewParams {
    /** World to view (`rv3d->viewmat`), column-major. three.js: `camera.matrixWorldInverse.elements`. */
    viewmat: ArrayLike<number>
    /** The projection (`rv3d->winmat`), column-major. three.js: `camera.projectionMatrix.elements`. */
    winmat: ArrayLike<number>
    /** Region width and height in pixels. */
    winx: number
    winy: number
    /**
     * `View3D.clip_start` / `clip_end`. For a perspective three.js camera, `near` and `far`. For an
     * orthographic one, Blender centres the depth range on the view (`BKE_camera_params_from_view3d`
     * halves `clip_end` and mirrors it), so pass `clipEnd = far - near`, which puts the ray segment's
     * ends on three's near and far planes.
     */
    clipStart: number
    clipEnd: number
}

export class KnifeView {
    readonly viewmat: M4
    readonly viewinv: M4
    readonly winmat: M4
    readonly persmat: M4
    readonly persinv: M4
    readonly winx: number
    readonly winy: number
    /** `rv3d->is_persp`: a perspective projection has `winmat[3][3] == 0`. */
    readonly isPersp: boolean
    readonly clipStart: number
    readonly clipEnd: number

    constructor(p: KnifeViewParams) {
        this.viewmat = Array.from(p.viewmat)
        this.winmat = Array.from(p.winmat)
        this.viewinv = invertM4(this.viewmat)
        this.persmat = mulM4M4(this.winmat, this.viewmat)
        this.persinv = invertM4(this.persmat)
        this.winx = p.winx
        this.winy = p.winy
        this.isPersp = this.winmat[15] === 0
        this.clipStart = p.clipStart
        this.clipEnd = p.clipEnd
    }

    /** From a three.js camera with current world matrices, in a region `width` x `height`. */
    static fromCamera(camera: {
        matrixWorldInverse: {elements: ArrayLike<number>}, projectionMatrix: {elements: ArrayLike<number>},
        near: number, far: number, isOrthographicCamera?: boolean,
    }, width: number, height: number): KnifeView {
        const ortho = !!camera.isOrthographicCamera
        return new KnifeView({
            viewmat: camera.matrixWorldInverse.elements,
            winmat: camera.projectionMatrix.elements,
            winx: width, winy: height,
            clipStart: ortho ? -(camera.far - camera.near) / 2 : camera.near,
            clipEnd: ortho ? camera.far - camera.near : camera.far,
        })
    }

    /** `rv3d->viewinv[i]`: the view's x/y/z axes (0..2) or the eye position (3). */
    viewinvCol(i: number): V3 {
        return m4Col(this.viewinv, i)
    }

    /** `persmat * obmat`: Blender's `rv3d->persmatob` for an object matrix. */
    persmatob(objectMatrix: M4): M4 {
        return mulM4M4(this.persmat, objectMatrix)
    }

    /**
     * `ED_view3d_project_float_global` with `V3D_PROJ_TEST_NOP` (`view3d_project.cc:258`, via
     * `ed_view3d_project__internal`, `:103`): no clip tests, `w` taken absolute.
     */
    projectFloatGlobal(co: readonly number[]): V2 {
        const m = this.persmat
        const x = m[0] * co[0] + m[4] * co[1] + m[8] * co[2] + m[12]
        const y = m[1] * co[0] + m[5] * co[1] + m[9] * co[2] + m[13]
        const w = Math.abs(m[3] * co[0] + m[7] * co[1] + m[11] * co[2] + m[15])
        const scalar = w !== 0 ? 1 / w : 0
        return [(this.winx / 2) * (1 + x * scalar), (this.winy / 2) * (1 + y * scalar)]
    }

    /** `ED_view3d_win_to_origin` (`view3d_project.cc:700`). */
    winToOrigin(mval: readonly number[]): V3 {
        if (this.isPersp) return this.viewinvCol(3)
        return mulProjectM4V3(this.persinv, [2 * mval[0] / this.winx - 1, 2 * mval[1] / this.winy - 1, 0])
    }

    /** `ED_view3d_win_to_vector` (`view3d_project.cc:721`): normalised, pointing into the scene. */
    winToVector(mval: readonly number[]): V3 {
        if (this.isPersp) {
            const p = mulProjectM4V3(this.persinv, [2 * (mval[0] / this.winx) - 1, 2 * (mval[1] / this.winy) - 1, -0.5])
            return normalize3(sub3(p, this.viewinvCol(3)))[0]
        }
        const z = this.viewinvCol(2)
        return normalize3([-z[0], -z[1], -z[2]])[0]
    }

    /**
     * `ED_view3d_clip_range_get` (`view3d_utils.cc:168`) through `BKE_camera_params_from_view3d`
     * (`camera.cc:413`): the ortho view halves `clip_end` and mirrors it for the start.
     */
    clipRangeGet(useOrthoFactor: boolean): {isOrtho: boolean, clipStart: number, clipEnd: number} {
        let clipStart = this.clipStart
        let clipEnd = this.clipEnd
        const isOrtho = !this.isPersp
        if (isOrtho) {
            clipEnd *= 0.5
            clipStart = -clipEnd
        }
        if (useOrthoFactor && isOrtho) {
            const fac = 2 / (clipEnd - clipStart)
            clipStart *= fac
            clipEnd *= fac
        }
        return {isOrtho, clipStart, clipEnd}
    }

    /** `view3d_win_to_ray_segment` (`view3d_project.cc:325`). */
    winToRaySegment(mval: readonly number[]): {co: V3, dir: V3, start: V3, end: V3} {
        const co = this.winToOrigin(mval)
        const dir = this.winToVector(mval)
        let startOffset: number, endOffset: number
        if (!this.isPersp) {
            endOffset = this.clipEnd / 2
            startOffset = -endOffset
        } else {
            const r = this.clipRangeGet(false)
            startOffset = r.clipStart
            endOffset = r.clipEnd
        }
        return {co, dir, start: madd3(co, dir, startOffset), end: madd3(co, dir, endOffset)}
    }

    /** `ED_view3d_win_to_ray_clipped` (`view3d_project.cc:395`): ray start and normal. */
    winToRayClipped(mval: readonly number[]): {start: V3, dir: V3} {
        const r = this.winToRaySegment(mval)
        return {start: r.start, dir: r.dir}
    }

    /** `ED_view3d_win_to_segment_clipped` (`view3d_project.cc:738`). */
    winToSegmentClipped(mval: readonly number[]): {start: V3, end: V3} {
        const r = this.winToRaySegment(mval)
        return {start: r.start, end: r.end}
    }

    /**
     * `ED_view3d_unproject_v3` (`view3d_project.cc:793`) via `GPU_matrix_unproject_3fv`
     * (`gpu_matrix.cc:501`), which avoids inverting the full projection for precision.
     */
    unprojectV3(regionx: number, regiony: number, regionz: number): V3 | null {
        const proj = this.winmat
        const inX = 2 * (regionx / this.winx) - 1
        const inY = 2 * (regiony / this.winy) - 1
        const inZ = 2 * regionz - 1
        let out: V3
        if (proj[15] === 0) {
            let z = proj[14] / (proj[10] + inZ)
            if (!isFinite(z)) z = FLT_MAX
            out = [z * ((proj[8] + inX) / proj[0]), z * ((proj[9] + inY) / proj[5]), -z]
        } else {
            out = [(-proj[12] + inX) / proj[0], (-proj[13] + inY) / proj[5], (-proj[14] + inZ) / proj[10]]
        }
        if (!out.every(isFinite)) return null
        const m = this.viewinv
        return [
            m[0] * out[0] + m[4] * out[1] + m[8] * out[2] + m[12],
            m[1] * out[0] + m[5] * out[1] + m[9] * out[2] + m[13],
            m[2] * out[0] + m[6] * out[1] + m[10] * out[2] + m[14],
        ]
    }

    /** `ED_view3d_calc_zfac` (`view3d_project.cc:289`). */
    calcZfac(co: readonly number[]): number {
        let zfac = mulProjectM4V3Zfac(this.persmat, co)
        if (zfac < 1e-6 && zfac > -1e-6) zfac = 1
        if (zfac < 0) zfac = -zfac
        return zfac
    }

    /** `ED_view3d_win_to_delta` (`view3d_project.cc:675`), the non-precise branch. */
    winToDelta(xyDelta: readonly number[], zfac: number): V3 {
        const dx = 2 * xyDelta[0] * zfac / this.winx
        const dy = 2 * xyDelta[1] * zfac / this.winy
        const p = this.persinv
        return [p[0] * dx + p[4] * dy, p[1] * dx + p[5] * dy, p[2] * dx + p[6] * dy]
    }

    /** `ED_view3d_win_to_3d` (`view3d_project.cc:482`), without the camera-view branch. */
    winTo3d(depthPt: readonly number[], mval: readonly number[]): V3 {
        let rayOrigin: V3
        let rayDirection: V3
        let lambda: number
        if (this.isPersp) {
            rayOrigin = this.viewinvCol(3)
            rayDirection = this.winToVector(mval)
            // Unsigned factor: the point stays in front of the view.
            lambda = Math.abs(isectRayPlaneV3Factor(rayOrigin, rayDirection, depthPt, this.viewinvCol(2)) ?? 0)
        } else {
            const dx = (2 * mval[0] / this.winx) - 1
            const dy = (2 * mval[1] / this.winy) - 1
            const p = this.persinv
            const vi = this.viewinvCol(3)
            rayOrigin = [p[0] * dx + p[4] * dy + vi[0], p[1] * dx + p[5] * dy + vi[1], p[2] * dx + p[6] * dy + vi[2]]
            rayDirection = this.viewinvCol(2)
            // `ray_point_factor_v3`
            const d = sub3(depthPt, rayOrigin)
            lambda = dot3(rayDirection, d) / dot3(rayDirection, rayDirection)
        }
        return madd3(rayOrigin, rayDirection, lambda)
    }
}

export {mulProjectM4V3}
