/**
 * What Blender draws while a transform runs (`drawConstraint`, `drawPropCircle`, `drawSnapping`,
 * the `HLP_*` helplines): the constraint axis lines through the pivot, a line from the pivot to the
 * cursor for rotate and scale, the proportional-editing circle, and the snap target glyph.
 *
 * World-space three.js objects without depth testing; the host updates it from the running
 * {@link TransInfo} each frame.
 */

import {
    BufferGeometry,
    Camera,
    Float32BufferAttribute,
    Line,
    LineLoop,
    LineSegments,
    Material,
    Object3D,
    UnlitLineMaterial,
    Vector3,
} from 'threepipe'
import type {TransInfo} from '../transform/TransInfo'
import {CON_APPLY, T_PROP_EDIT} from '../transform/types'
import {transformConstraintLines} from '../transform/TransInfo'
import {GIZMO_COLORS} from './TransformGizmo'
import type {SnapTargetType} from '../transform/types'

const _v = new Vector3()

export class TransformOverlay extends Object3D {
    private _constraint: LineSegments
    private _helpline: Line
    private _propCircle: LineLoop
    private _snapGlyph: LineLoop
    private _constraintColors: Float32BufferAttribute

    constructor() {
        super()
        this.name = 'TransformOverlay'
        // Not `isWidgetRoot` (see `TransformGizmo`): the overlay is never picked.
        this.userData.excludeFromExport = true
        this.userData.userSelectable = false
        ;(this as any).assetType = 'widget'

        const cg = new BufferGeometry()
        cg.setAttribute('position', new Float32BufferAttribute(new Float32Array(3 * 2 * 3), 3))
        this._constraintColors = new Float32BufferAttribute(new Float32Array(3 * 2 * 3), 3)
        cg.setAttribute('color', this._constraintColors)
        this._constraint = new LineSegments(cg, this._mat(0xffffff, true))
        this._constraint.visible = false

        const hg = new BufferGeometry()
        hg.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3))
        this._helpline = new Line(hg, this._mat(0xffffff))
        this._helpline.visible = false

        const pg = new BufferGeometry()
        pg.setAttribute('position', new Float32BufferAttribute(new Float32Array(64 * 3), 3))
        this._propCircle = new LineLoop(pg, this._mat(0xbbbbbb))
        this._propCircle.visible = false

        const sg = new BufferGeometry()
        sg.setAttribute('position', new Float32BufferAttribute(new Float32Array(8 * 3), 3))
        this._snapGlyph = new LineLoop(sg, this._mat(0xffffff))
        this._snapGlyph.visible = false

        for (const o of [this._constraint, this._helpline, this._propCircle, this._snapGlyph]) {
            o.frustumCulled = false
            o.renderOrder = 999
            o.userData.userSelectable = false
            o.userData.excludeFromExport = true
            this.add(o)
        }
        this.visible = false
    }

    private _mat(color: number, vertexColors = false): UnlitLineMaterial {
        const m = new UnlitLineMaterial({color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false})
        m.toneMapped = false
        m.vertexColors = vertexColors
        ;(m as any).allowOverride = false
        return m
    }

    /**
     * Refresh from the running transform. `mouseWorld` is the cursor unprojected at the pivot's
     * depth, for the helpline; `pixelSize` is world units per pixel at the pivot.
     */
    update(t: TransInfo | null, camera: Camera, mouseWorld: [number, number, number] | null, pixelSize: number): void {
        if (!t || t.isDone) {
            this.visible = false
            return
        }
        this.visible = true
        const c = t.centerGlobal

        // `drawConstraint`: a line through the pivot along each constrained axis, in the axis colour.
        const lines = transformConstraintLines(t)
        if (t.con.mode & CON_APPLY && lines.length) {
            const pos = this._constraint.geometry.getAttribute('position') as Float32BufferAttribute
            const col = this._constraintColors
            const len = 1e4
            const axisColors = [GIZMO_COLORS.x, GIZMO_COLORS.y, GIZMO_COLORS.z]
            let n = 0
            for (let i = 0; i < 3; i++) {
                const axis = t.spacemtx[i]
                const used = lines.some(l => l === axis || l[0] === axis[0] && l[1] === axis[1] && l[2] === axis[2])
                if (!used) continue
                const color = axisColors[i]
                const r = (color >> 16 & 255) / 255, g = (color >> 8 & 255) / 255, b = (color & 255) / 255
                pos.setXYZ(n * 2, c[0] - axis[0] * len, c[1] - axis[1] * len, c[2] - axis[2] * len)
                pos.setXYZ(n * 2 + 1, c[0] + axis[0] * len, c[1] + axis[1] * len, c[2] + axis[2] * len)
                col.setXYZ(n * 2, r, g, b)
                col.setXYZ(n * 2 + 1, r, g, b)
                n++
            }
            this._constraint.geometry.setDrawRange(0, n * 2)
            pos.needsUpdate = true
            col.needsUpdate = true
            this._constraint.visible = n > 0
        } else {
            this._constraint.visible = false
        }

        // `HLP_SPRING` / `HLP_ANGLE`: a line from the pivot to the cursor.
        if (mouseWorld && t.mode !== 'translate') {
            const pos = this._helpline.geometry.getAttribute('position') as Float32BufferAttribute
            pos.setXYZ(0, c[0], c[1], c[2])
            pos.setXYZ(1, mouseWorld[0], mouseWorld[1], mouseWorld[2])
            pos.needsUpdate = true
            this._helpline.visible = true
        } else {
            this._helpline.visible = false
        }

        // `drawPropCircle`: a circle of radius `prop_size` facing the view.
        if (t.flag & T_PROP_EDIT) {
            const pos = this._propCircle.geometry.getAttribute('position') as Float32BufferAttribute
            const right = _v.set(1, 0, 0).applyQuaternion(camera.quaternion).clone()
            const up = _v.set(0, 1, 0).applyQuaternion(camera.quaternion).clone()
            const r = t.propSize
            for (let i = 0; i < 64; i++) {
                const a = i / 64 * Math.PI * 2
                const ca = Math.cos(a) * r, sa = Math.sin(a) * r
                pos.setXYZ(i, c[0] + right.x * ca + up.x * sa, c[1] + right.y * ca + up.y * sa, c[2] + right.z * ca + up.z * sa)
            }
            pos.needsUpdate = true
            this._propCircle.visible = true
        } else {
            this._propCircle.visible = false
        }

        // `drawSnapping`: a glyph at the snap target, its shape by type.
        const snap = t.tsnap.lastResult
        if (t.snapIsActive() && snap) {
            this._glyph(snap.loc, snap.type, camera, pixelSize * 6)
            this._snapGlyph.visible = true
        } else {
            this._snapGlyph.visible = false
        }
    }

    /** Circle for a vertex, diamond for an edge, triangle for a midpoint, square for a face, cross for the grid. */
    private _glyph(loc: [number, number, number], type: SnapTargetType, camera: Camera, size: number): void {
        const pos = this._snapGlyph.geometry.getAttribute('position') as Float32BufferAttribute
        const right = _v.set(1, 0, 0).applyQuaternion(camera.quaternion).clone()
        const up = _v.set(0, 1, 0).applyQuaternion(camera.quaternion).clone()
        let pts: [number, number][]
        switch (type) {
        case 'vertex':
            pts = []
            for (let i = 0; i < 8; i++) pts.push([Math.cos(i / 8 * Math.PI * 2), Math.sin(i / 8 * Math.PI * 2)])
            break
        case 'edge':
            pts = [[0, 1], [1, 0], [0, -1], [-1, 0]]
            break
        case 'edgeMidpoint':
            pts = [[0, 1], [0.87, -0.5], [-0.87, -0.5]]
            break
        case 'face':
            pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
            break
        default:
            pts = [[-1, 0], [1, 0], [0, 0], [0, 1], [0, -1], [0, 0]]
            break
        }
        for (let i = 0; i < 8; i++) {
            const p = pts[Math.min(i, pts.length - 1)]
            pos.setXYZ(i, loc[0] + (right.x * p[0] + up.x * p[1]) * size, loc[1] + (right.y * p[0] + up.y * p[1]) * size, loc[2] + (right.z * p[0] + up.z * p[1]) * size)
        }
        this._snapGlyph.geometry.setDrawRange(0, pts.length)
        pos.needsUpdate = true
    }

    dispose(): void {
        for (const o of [this._constraint, this._helpline, this._propCircle, this._snapGlyph]) {
            o.geometry.dispose()
            ;(o.material as Material).dispose()
        }
    }
}
