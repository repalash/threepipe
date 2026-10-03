/**
 * The combined transform gizmo: translate arrows and plane squares, rotation rings, scale boxes,
 * a screen-space centre circle and a uniform-scale annulus, following Blender's
 * `transform_gizmo_3d.cc` (`gizmo_line_range`, `gizmo_get_axis_color`, `gizmo_3d_setup_draw_default`,
 * `gizmo_is_axis_visible`) in layout, colours and fading.
 *
 * It is a plain `Object3D` with no event listeners: the host picks a handle with {@link pick} on
 * pointer-down and starts a {@link ModalTransform} with the handle's mode and constraint
 * ({@link handleInfo}), so the gizmo drives the same backend as `G`/`R`/`S`, for elements and for
 * objects alike. It keeps a constant size on screen (`sizePx`, Blender's 75 px) and follows the
 * pivot and orientation it is given with {@link setPivot}.
 */

import {
    BoxGeometry,
    BufferGeometry,
    Camera,
    CircleGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    LineLoop,
    Material,
    Matrix3,
    Matrix4,
    Mesh,
    Object3D,
    Plane,
    PlaneGeometry,
    Quaternion,
    Raycaster,
    RingGeometry,
    TorusGeometry,
    UnlitLineMaterial,
    UnlitMaterial,
    Vector2,
    Vector3,
} from 'threepipe'
import type {Mat3, Vec3} from '../transform/math'
import {CON_AXIS0, CON_AXIS1, CON_AXIS2, TransformMode} from '../transform/types'

export type GizmoHandle =
    | 'TRANS_X' | 'TRANS_Y' | 'TRANS_Z' | 'TRANS_XY' | 'TRANS_YZ' | 'TRANS_ZX' | 'TRANS_C'
    | 'ROT_X' | 'ROT_Y' | 'ROT_Z' | 'ROT_C'
    | 'SCALE_X' | 'SCALE_Y' | 'SCALE_Z' | 'SCALE_C'

export interface GizmoHandleInfo {
    mode: TransformMode
    /** `CON_AXIS*` bits in the gizmo's orientation; 0 for the free centre handles. */
    constraint: number
}

/** Blender's default theme: `axis_x`, `axis_y`, `axis_z` and `gizmo_view_align`. */
export const GIZMO_COLORS = {
    x: 0xff3352,
    y: 0x8bdc00,
    z: 0x2890ff,
    c: 0xffffff,
}

/** `gizmo_get_axis_color`: alpha for the normal and highlighted states. */
const ALPHA = 0.6
const ALPHA_HI = 1.0
/** `g_tw_axis_range` (`transform_gizmo_3d.cc:99`): fade an axis pointing at the view. */
const AXIS_RANGE = {min: 0.02, max: 0.1}
const PLANE_RANGE = {min: 0.175, max: 0.25}
/** `MAN_AXIS_SCALE_PLANE_SCALE`: where the plane handles sit along their diagonal. */
const PLANE_OFFSET = 0.7
const PLANE_HALF = 0.1

interface Part {
    handle: GizmoHandle
    visuals: Mesh[] | LineLoop[]
    picker: Mesh
    color: Color
    /** 0 = axis, 1 = plane, -1 = not faded (`gizmo_orientation_axis`). */
    fadeAxis: number
    fadePlane: boolean
    /** Lower picks first when hits overlap (`select_bias`). */
    priority: number
    /** Faces the camera (the screen-space handles). */
    billboard: boolean
    /** The ring is clipped to the half facing the view (`ED_GIZMO_DIAL_DRAW_FLAG_CLIP`). */
    clipped: boolean
}

const _ray = new Raycaster()
const _pointer = new Vector2()
const _camPos = new Vector3()
const _dir = new Vector3()
const _q = new Quaternion()
const _m = new Matrix4()
const _m3 = new Matrix3()
const _v = new Vector3()

export class TransformGizmo extends Object3D {
    /** Blender's `gizmo_size` preference. */
    sizePx = 75
    /** Which of the three families are shown; the layout adapts as `gizmo_line_range` does. */
    readonly show = {translate: true, rotate: true, scale: true}
    /** The handle under the cursor. */
    hovered: GizmoHandle | null = null
    /** The handle being dragged; everything else dims. */
    active: GizmoHandle | null = null

    private _parts = new Map<GizmoHandle, Part>()
    private _orientation = new Matrix3()
    private _pivot = new Vector3()
    private _clipPlane = new Plane()
    private _pixelSize = 1

    constructor() {
        super()
        this.name = 'TransformGizmo'
        // Not `isWidgetRoot`: that would hand the gizmo to `ObjectPicker.extraObjects`, and three's
        // `Raycaster` ignores visibility, so a hidden gizmo would still swallow object clicks. The
        // plugin picks the gizmo itself.
        this.userData.excludeFromExport = true
        this.userData.userSelectable = false
        ;(this as any).assetType = 'widget'
        this.renderOrder = 1000
        this.matrixAutoUpdate = false
        this._build()
        this.visible = false
    }

    /** What a drag on a handle does, in the gizmo's orientation. */
    handleInfo(handle: GizmoHandle): GizmoHandleInfo {
        switch (handle) {
        case 'TRANS_X': return {mode: 'translate', constraint: CON_AXIS0}
        case 'TRANS_Y': return {mode: 'translate', constraint: CON_AXIS1}
        case 'TRANS_Z': return {mode: 'translate', constraint: CON_AXIS2}
        case 'TRANS_XY': return {mode: 'translate', constraint: CON_AXIS0 | CON_AXIS1}
        case 'TRANS_YZ': return {mode: 'translate', constraint: CON_AXIS1 | CON_AXIS2}
        case 'TRANS_ZX': return {mode: 'translate', constraint: CON_AXIS2 | CON_AXIS0}
        case 'TRANS_C': return {mode: 'translate', constraint: 0}
        case 'ROT_X': return {mode: 'rotate', constraint: CON_AXIS0}
        case 'ROT_Y': return {mode: 'rotate', constraint: CON_AXIS1}
        case 'ROT_Z': return {mode: 'rotate', constraint: CON_AXIS2}
        case 'ROT_C': return {mode: 'rotate', constraint: 0}
        case 'SCALE_X': return {mode: 'resize', constraint: CON_AXIS0}
        case 'SCALE_Y': return {mode: 'resize', constraint: CON_AXIS1}
        case 'SCALE_Z': return {mode: 'resize', constraint: CON_AXIS2}
        case 'SCALE_C': return {mode: 'resize', constraint: 0}
        }
    }

    /** The gizmo's orientation as Blender's 3x3 (three column vectors). */
    get orientation(): Mat3 {
        const e = this._orientation.elements
        return [[e[0], e[1], e[2]], [e[3], e[4], e[5]], [e[6], e[7], e[8]]]
    }

    get pivot(): Vec3 {
        return [this._pivot.x, this._pivot.y, this._pivot.z]
    }

    /** Place the gizmo: the pivot in world space and the orientation basis (three column vectors). */
    setPivot(center: Vec3, orientation: Mat3): void {
        this._pivot.set(center[0], center[1], center[2])
        const [x, y, z] = orientation
        this._orientation.set(
            x[0], y[0], z[0],
            x[1], y[1], z[1],
            x[2], y[2], z[2],
        )
    }

    /**
     * Per-frame: constant screen size, the screen-space handles face the camera, axes pointing at
     * the view fade out, rings are clipped to their front half.
     */
    update(camera: Camera, viewportHeight: number): void {
        camera.updateMatrixWorld()
        _camPos.setFromMatrixPosition(camera.matrixWorld)

        // World units per pixel at the pivot's depth (`ED_view3d_pixel_size`).
        _v.copy(this._pivot).applyMatrix4(camera.matrixWorldInverse)
        const pe = camera.projectionMatrix.elements
        const w = pe[3] * _v.x + pe[7] * _v.y + pe[11] * _v.z + pe[15]
        this._pixelSize = Math.abs(w) * 2 / (Math.max(1, viewportHeight) * pe[5])
        const scale = this._pixelSize * this.sizePx

        _m.setFromMatrix3(this._orientation)
        _m.setPosition(this._pivot)
        _m.scale(_v.set(scale, scale, scale))
        this.matrix.copy(_m)
        this.matrixWorld.copy(_m)

        // View direction at the pivot, for fading and clipping.
        const isOrtho = !!(camera as any).isOrthographicCamera
        if (isOrtho) camera.getWorldDirection(_dir).negate()
        else _dir.copy(_camPos).sub(this._pivot).normalize()

        // `gizmo_get_idot`.
        const idot = [0, 1, 2].map(i => {
            const e = this._orientation.elements
            const axis = _v.set(e[i * 3], e[i * 3 + 1], e[i * 3 + 2]).normalize()
            return 1 - Math.abs(_dir.dot(axis))
        })

        _m3.setFromMatrix4(camera.matrixWorld)
        _q.setFromRotationMatrix(_m.setFromMatrix3(_m3))

        this._clipPlane.setFromNormalAndCoplanarPoint(_dir, this._pivot)

        for (const part of this._parts.values()) {
            const shown = this._partShown(part.handle)
            let alphaFac = 1
            if (shown && part.fadeAxis >= 0) {
                let a = idot[part.fadeAxis]
                const range = part.fadePlane ? PLANE_RANGE : AXIS_RANGE
                if (part.fadePlane) a = 1 - a
                alphaFac = a > range.max ? 1 : a < range.min ? 0 : (a - range.min) / (range.max - range.min)
            }
            const visible = shown && alphaFac > 0 && (!this.active || this.active === part.handle)
            const highlighted = this.hovered === part.handle || this.active === part.handle
            const alpha = (highlighted ? ALPHA_HI : ALPHA) * alphaFac
            for (const vis of part.visuals as Object3D[]) {
                vis.visible = visible
                const mat = (vis as Mesh).material as Material & {opacity: number, clippingPlanes: Plane[] | null}
                mat.opacity = alpha * (part.handle === 'SCALE_C' ? highlighted ? 0.5 : 0.15 : 1)
                mat.clippingPlanes = part.clipped ? [this._clipPlane] : null
                if (part.billboard) {
                    // Undo the gizmo's orientation, then face the camera. Keep the gizmo's scale.
                    vis.quaternion.copy(_q).premultiply(_qInv.setFromRotationMatrix(_mOrient.setFromMatrix3(this._orientation)).invert())
                }
            }
            part.picker.visible = visible
            if (part.billboard) part.picker.quaternion.copy((part.visuals[0] as Object3D).quaternion)
        }
        this.updateMatrixWorld(true)
    }

    /** Which handle a pointer at normalised device coordinates would grab, or null. */
    pick(ndcX: number, ndcY: number, camera: Camera): GizmoHandle | null {
        if (!this.visible) return null
        _pointer.set(ndcX, ndcY)
        _ray.setFromCamera(_pointer, camera)
        const pickers = [...this._parts.values()].filter(p => p.picker.visible).map(p => p.picker)
        const hits = _ray.intersectObjects(pickers, false)
        if (!hits.length) return null
        let best: {handle: GizmoHandle, priority: number, distance: number} | null = null
        for (const hit of hits) {
            const handle = hit.object.userData.handle as GizmoHandle
            const part = this._parts.get(handle)!
            if (part.clipped && this._clipPlane.distanceToPoint(hit.point) < 0) continue
            if (!best || part.priority < best.priority || part.priority === best.priority && hit.distance < best.distance) {
                best = {handle, priority: part.priority, distance: hit.distance}
            }
        }
        return best?.handle ?? null
    }

    private _partShown(handle: GizmoHandle): boolean {
        if (handle.startsWith('TRANS')) return this.show.translate
        if (handle.startsWith('ROT')) return this.show.rotate
        return this.show.scale
    }

    /** `gizmo_line_range` (`transform_gizmo_3d.cc:1173`). */
    private _lineRange(kind: 'translate' | 'scale'): {start: number, end: number} {
        let start = 0.2
        let end = 1.0
        if (kind === 'translate') {
            if (this.show.scale) start = end - 0.125
            if (this.show.rotate) {
                // Avoid the rotate and translate gizmos overlapping.
                const rotateOffset = 0.215
                start += rotateOffset
                end += rotateOffset + 0.2
            }
        } else if (this.show.translate || this.show.rotate) {
            end -= 0.225
        }
        return {start, end}
    }

    private _build(): void {
        const axes: {name: 'X' | 'Y' | 'Z', dir: Vector3, color: number, i: number}[] = [
            {name: 'X', dir: new Vector3(1, 0, 0), color: GIZMO_COLORS.x, i: 0},
            {name: 'Y', dir: new Vector3(0, 1, 0), color: GIZMO_COLORS.y, i: 1},
            {name: 'Z', dir: new Vector3(0, 0, 1), color: GIZMO_COLORS.z, i: 2},
        ]
        const tr = this._lineRange('translate')
        const sc = this._lineRange('scale')

        for (const a of axes) {
            // Translate: stem and cone (`ED_GIZMO_ARROW_STYLE_NORMAL`).
            const coneLen = 0.2
            const stem = new Mesh(new CylinderGeometry(0.015, 0.015, tr.end - coneLen - tr.start, 8), this._mat(a.color))
            stem.position.copy(a.dir).multiplyScalar((tr.start + tr.end - coneLen) / 2)
            const cone = new Mesh(new ConeGeometry(0.06, coneLen, 12), this._mat(a.color))
            cone.position.copy(a.dir).multiplyScalar(tr.end - coneLen / 2)
            const picker = new Mesh(new CylinderGeometry(0.12, 0.12, tr.end - tr.start, 6), this._pickMat())
            picker.position.copy(a.dir).multiplyScalar((tr.start + tr.end) / 2)
            for (const o of [stem, cone, picker]) this._alignY(o, a.dir)
            this._addPart({handle: `TRANS_${a.name}` as GizmoHandle, visuals: [stem, cone], picker, color: new Color(a.color), fadeAxis: a.i, fadePlane: false, priority: 1, billboard: false, clipped: false})

            // Scale: stem and box (`ED_GIZMO_ARROW_STYLE_BOX`).
            const boxLen = 0.1
            const sstem = new Mesh(new CylinderGeometry(0.015, 0.015, sc.end - boxLen - sc.start, 8), this._mat(a.color))
            sstem.position.copy(a.dir).multiplyScalar((sc.start + sc.end - boxLen) / 2)
            const box = new Mesh(new BoxGeometry(boxLen, boxLen, boxLen), this._mat(a.color))
            box.position.copy(a.dir).multiplyScalar(sc.end - boxLen / 2)
            const spicker = new Mesh(new CylinderGeometry(0.12, 0.12, sc.end - sc.start, 6), this._pickMat())
            spicker.position.copy(a.dir).multiplyScalar((sc.start + sc.end) / 2)
            for (const o of [sstem, box, spicker]) this._alignY(o, a.dir)
            this._addPart({handle: `SCALE_${a.name}` as GizmoHandle, visuals: [sstem, box], picker: spicker, color: new Color(a.color), fadeAxis: a.i, fadePlane: false, priority: 1, billboard: false, clipped: false})

            // Rotate: a ring about the axis, the front half drawn (`ED_GIZMO_DIAL_DRAW_FLAG_CLIP`).
            const ring = new Mesh(new TorusGeometry(1.0, 0.018, 6, 64), this._mat(a.color))
            const rpicker = new Mesh(new TorusGeometry(1.0, 0.09, 4, 32), this._pickMat())
            for (const o of [ring, rpicker]) this._alignZ(o, a.dir)
            this._addPart({handle: `ROT_${a.name}` as GizmoHandle, visuals: [ring], picker: rpicker, color: new Color(a.color), fadeAxis: -1, fadePlane: false, priority: 2, billboard: false, clipped: true})
        }

        // Plane handles: squares along the diagonal of each pair of axes, coloured by the normal axis.
        const planes: {handle: GizmoHandle, a: Vector3, b: Vector3, normal: number, color: number}[] = [
            {handle: 'TRANS_XY', a: new Vector3(1, 0, 0), b: new Vector3(0, 1, 0), normal: 2, color: GIZMO_COLORS.z},
            {handle: 'TRANS_YZ', a: new Vector3(0, 1, 0), b: new Vector3(0, 0, 1), normal: 0, color: GIZMO_COLORS.x},
            {handle: 'TRANS_ZX', a: new Vector3(0, 0, 1), b: new Vector3(1, 0, 0), normal: 1, color: GIZMO_COLORS.y},
        ]
        for (const p of planes) {
            const center = p.a.clone().add(p.b).normalize().multiplyScalar(PLANE_OFFSET)
            const square = new Mesh(new PlaneGeometry(PLANE_HALF * 2, PLANE_HALF * 2), this._mat(p.color, true))
            const picker = new Mesh(new PlaneGeometry(PLANE_HALF * 2.6, PLANE_HALF * 2.6), this._pickMat(true))
            for (const o of [square, picker]) {
                o.position.copy(center)
                const n = p.a.clone().cross(p.b)
                this._alignZ(o, n)
            }
            this._addPart({handle: p.handle, visuals: [square], picker, color: new Color(p.color), fadeAxis: p.normal, fadePlane: true, priority: 1, billboard: false, clipped: false})
        }

        // Screen-space centre: free translate (`MAN_AXIS_TRANS_C`, scale 0.2).
        const centerRing = new LineLoop(circleGeometry(0.2, 32), this._lineMat(GIZMO_COLORS.c))
        const centerPicker = new Mesh(new CircleGeometry(0.2, 16), this._pickMat(true))
        this._addPart({handle: 'TRANS_C', visuals: [centerRing], picker: centerPicker, color: new Color(GIZMO_COLORS.c), fadeAxis: -1, fadePlane: false, priority: 0, billboard: true, clipped: false})

        // View-axis rotation ring (`MAN_AXIS_ROT_C`, scale 1.2).
        const viewRing = new Mesh(new TorusGeometry(1.2, 0.015, 6, 64), this._mat(GIZMO_COLORS.c))
        const viewPicker = new Mesh(new TorusGeometry(1.2, 0.08, 4, 32), this._pickMat())
        this._addPart({handle: 'ROT_C', visuals: [viewRing], picker: viewPicker, color: new Color(GIZMO_COLORS.c), fadeAxis: -1, fadePlane: false, priority: 2, billboard: true, clipped: false})

        // Uniform scale: the annulus between the axis rings and the view ring (`MAN_AXIS_SCALE_C`).
        const annulus = new Mesh(new RingGeometry(1.0, 1.2, 48), this._mat(GIZMO_COLORS.c, true))
        const annulusPicker = new Mesh(new RingGeometry(1.0, 1.2, 24), this._pickMat(true))
        this._addPart({handle: 'SCALE_C', visuals: [annulus], picker: annulusPicker, color: new Color(GIZMO_COLORS.c), fadeAxis: -1, fadePlane: false, priority: 3, billboard: true, clipped: false})
    }

    private _addPart(part: Part): void {
        this._parts.set(part.handle, part)
        for (const v of part.visuals as Object3D[]) {
            v.userData.handle = part.handle
            v.userData.userSelectable = false
            v.userData.excludeFromExport = true
            v.renderOrder = 1000
            v.frustumCulled = false
            this.add(v)
        }
        part.picker.userData.handle = part.handle
        part.picker.userData.userSelectable = false
        part.picker.userData.excludeFromExport = true
        part.picker.visible = true
        part.picker.frustumCulled = false
        this.add(part.picker)
    }

    private _mat(color: number, doubleSided = false): UnlitMaterial {
        const m = new UnlitMaterial({color, transparent: true, opacity: ALPHA, depthTest: false, depthWrite: false})
        m.toneMapped = false
        ;(m as any).allowOverride = false
        if (doubleSided) m.side = 2
        return m
    }

    private _lineMat(color: number): UnlitLineMaterial {
        const m = new UnlitLineMaterial({color, transparent: true, opacity: ALPHA, depthTest: false, depthWrite: false})
        m.toneMapped = false
        ;(m as any).allowOverride = false
        return m
    }

    private _pickMat(doubleSided = false): UnlitMaterial {
        const m = new UnlitMaterial({color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false})
        m.toneMapped = false
        ;(m as any).allowOverride = false
        m.visible = false
        if (doubleSided) m.side = 2
        return m
    }

    /** Point a Y-up primitive along `dir`. */
    private _alignY(o: Object3D, dir: Vector3): void {
        o.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
    }

    /** Point a Z-up primitive along `dir`. */
    private _alignZ(o: Object3D, dir: Vector3): void {
        o.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().normalize())
    }

    dispose(): void {
        for (const part of this._parts.values()) {
            for (const v of part.visuals as Mesh[]) {
                v.geometry.dispose()
                ;(v.material as Material).dispose()
            }
            part.picker.geometry.dispose()
            ;(part.picker.material as Material).dispose()
        }
        this._parts.clear()
    }
}

const _qInv = new Quaternion()
const _mOrient = new Matrix4()

function circleGeometry(radius: number, segments: number): BufferGeometry {
    const pts: number[] = []
    for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2
        pts.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    return g
}
