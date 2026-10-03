/**
 * The view a transform runs in: the matrices Blender keeps on `TransInfo` (`viewmat`, `viewinv`,
 * `persmat`, `persinv`), the region size, and the projection helpers from `view3d_project.cc`.
 *
 * Coordinates follow Blender's region convention: pixels with the origin at the **bottom-left**
 * and `y` up. The plugin flips the browser's `y` at the boundary, so every ported formula keeps its
 * signs. Everything here is plain arrays, so the whole transform system runs in Node.
 */

import {
    FLT_EPSILON,
    invertM4,
    lenV3,
    m4Col,
    Mat4,
    mulM4M4,
    mulProjectM4V3,
    mulProjectM4V3Zfac,
    normalizeV3,
    subV3,
    Vec2,
    Vec3,
} from './math'

export interface CameraLike {
    matrixWorldInverse: {elements: ArrayLike<number>}
    projectionMatrix: {elements: ArrayLike<number>}
    isPerspectiveCamera?: boolean
    isOrthographicCamera?: boolean
}

export class TransformView {
    /** World to view, Blender's `rv3d->viewmat`. */
    readonly viewmat: Mat4
    /** View to world; column 3 is the eye position, column 2 the view's +Z (towards the viewer). */
    readonly viewinv: Mat4
    /** The projection matrix, Blender's `rv3d->winmat`. */
    readonly winmat: Mat4
    /** `winmat * viewmat`. */
    readonly persmat: Mat4
    readonly persinv: Mat4
    readonly winx: number
    readonly winy: number
    readonly isPersp: boolean

    constructor(viewMatrix: ArrayLike<number>, projectionMatrix: ArrayLike<number>, winx: number, winy: number, isPersp: boolean) {
        this.viewmat = Array.from(viewMatrix)
        this.winmat = Array.from(projectionMatrix)
        this.viewinv = invertM4(this.viewmat)
        this.persmat = mulM4M4(this.winmat, this.viewmat)
        this.persinv = invertM4(this.persmat)
        this.winx = Math.max(1, winx)
        this.winy = Math.max(1, winy)
        this.isPersp = isPersp
    }

    /** From a three.js camera whose world matrices are current. */
    static fromCamera(camera: CameraLike, width: number, height: number): TransformView {
        return new TransformView(camera.matrixWorldInverse.elements, camera.projectionMatrix.elements, width, height,
            !!camera.isPerspectiveCamera || !camera.isOrthographicCamera)
    }

    /** `rv3d->viewinv[i]` as a direction (columns 0..2) or the eye position (column 3). */
    viewinvCol(i: number): Vec3 {
        return m4Col(this.viewinv, i)
    }

    /**
     * `ED_view3d_project_float_global` with `V3D_PROJ_TEST_NOP` (`view3d_project.cc`): region
     * pixels, or null when the point is on or behind the near plane.
     */
    projectFloatView(co: Vec3): Vec2 | null {
        const w = mulProjectM4V3Zfac(this.persmat, co)
        if (w <= FLT_EPSILON) return null
        const p = mulProjectM4V3(this.persmat, co)
        return [this.winx / 2 * (1 + p[0]), this.winy / 2 * (1 + p[1])]
    }

    /** `projectFloatView` with Blender's `projectFloatViewCenterFallback`: the region centre. */
    projectFloatViewOrCenter(co: Vec3): Vec2 {
        return this.projectFloatView(co) ?? [this.winx / 2, this.winy / 2]
    }

    /** `ED_view3d_calc_zfac` (`view3d_project.cc:289`): the perspective depth factor of a point. */
    calcZfac(co: Vec3): number {
        let zfac = mulProjectM4V3Zfac(this.persmat, co)
        if (zfac < 1e-6 && zfac > -1e-6) zfac = 1
        if (zfac < 0) zfac = -zfac
        return zfac
    }

    /** `ED_view3d_win_to_delta` (`view3d_project.cc:675`): a pixel delta as a world-space vector at depth `zfac`. */
    winToDelta(dx: number, dy: number, zfac: number): Vec3 {
        const fx = 2 * dx * zfac / this.winx
        const fy = 2 * dy * zfac / this.winy
        const p = this.persinv
        return [
            p[0] * fx + p[4] * fy,
            p[1] * fx + p[5] * fy,
            p[2] * fx + p[6] * fy,
        ]
    }

    /** `view_vector_calc` (`transform.cc:65`): the unit vector from `focus` towards the viewer. */
    viewVector(focus: Vec3): Vec3 {
        const r = this.isPersp ? subV3(this.viewinvCol(3), focus) : this.viewinvCol(2)
        normalizeV3(r)
        return r
    }

    /** `ED_view3d_win_to_origin` and `ED_view3d_win_to_vector`: the picking ray under a region pixel. */
    winToRay(mval: Vec2): {origin: Vec3, direction: Vec3} {
        const nx = 2 * (mval[0] / this.winx) - 1
        const ny = 2 * (mval[1] / this.winy) - 1
        if (this.isPersp) {
            const origin = this.viewinvCol(3)
            const p = mulProjectM4V3(this.persinv, [nx, ny, -0.5])
            const direction = subV3(p, origin)
            normalizeV3(direction)
            return {origin, direction}
        }
        const origin = mulProjectM4V3(this.persinv, [nx, ny, -1])
        const z = this.viewinvCol(2)
        const direction: Vec3 = [-z[0], -z[1], -z[2]]
        normalizeV3(direction)
        return {origin, direction}
    }

    /**
     * The near and far distances of the projection (`ED_view3d_clip_range_get`), read back from
     * `winmat` (three.js / OpenGL clip conventions).
     */
    clipRange(): {start: number, end: number} {
        const m10 = this.winmat[10], m14 = this.winmat[14]
        if (this.isPersp) return {start: m14 / (m10 - 1), end: m14 / (m10 + 1)}
        return {start: (m14 + 1) / m10, end: (m14 - 1) / m10}
    }

    /**
     * `ED_view3d_win_to_segment_clipped` without clip planes (`view3d_project.cc:738`, through
     * `view3d_win_to_ray_segment` `:325`, `ED_view3d_win_to_origin` `:700` and `ED_view3d_win_to_vector`
     * `:721`): the start and end of the view segment under a region pixel.
     */
    winToSegment(mval: Vec2): {start: Vec3, end: Vec3} {
        const nx = 2 * mval[0] / this.winx - 1
        const ny = 2 * mval[1] / this.winy - 1
        let co: Vec3
        let dir: Vec3
        let startOffset: number, endOffset: number
        if (this.isPersp) {
            co = this.viewinvCol(3)
            dir = subV3(mulProjectM4V3(this.persinv, [nx, ny, -0.5]), co)
            const clip = this.clipRange()
            startOffset = clip.start
            endOffset = clip.end
        } else {
            co = mulProjectM4V3(this.persinv, [nx, ny, 0])
            const z = this.viewinvCol(2)
            dir = [-z[0], -z[1], -z[2]]
            endOffset = this.clipRange().end / 2
            startOffset = -endOffset
        }
        normalizeV3(dir)
        return {
            start: [co[0] + dir[0] * startOffset, co[1] + dir[1] * startOffset, co[2] + dir[2] * startOffset],
            end: [co[0] + dir[0] * endOffset, co[1] + dir[1] * endOffset, co[2] + dir[2] * endOffset],
        }
    }

    /**
     * World units per screen pixel at a point, the factor `setNearestAxis3d` derives
     * (`transform_constraints.cc:1117`) and what keeps a gizmo the same size on screen.
     */
    pixelSize(co: Vec3): number {
        const zfac = mulProjectM4V3Zfac(this.persmat, co)
        return lenV3(m4Col(this.persinv, 0)) * 2 / this.winx * Math.abs(zfac)
    }

    /** True for an orthographic view looking down a world axis, which changes the grid snap step. */
    get isAxisAlignedOrtho(): boolean {
        if (this.isPersp) return false
        const z = this.viewinvCol(2)
        const a = [Math.abs(z[0]), Math.abs(z[1]), Math.abs(z[2])]
        return a.filter(v => v > 0.9999).length === 1
    }
}
