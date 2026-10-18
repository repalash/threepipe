/**
 * The loop cut preview while hovering: `EDBM_preselect_edgering_draw`
 * (`editors/mesh/editmesh_preselect_edgering.cc:151`) - the lines the cut would make through the ring,
 * or the points it would put on a lone edge, in the theme's gizmo colour, without depth testing.
 */

import {
    BufferGeometry,
    Camera,
    Float32BufferAttribute,
    LineSegments,
    Material,
    Matrix4,
    Object3D,
    UnlitLineMaterial,
    Vector3,
} from 'threepipe'
import type {EdgeRingPreview} from '@threepipe/mesh-kernel'

/** `TH_GIZMO_PRIMARY` of Blender's default theme (`userdef_default_theme.c:267`). */
const GIZMO_PRIMARY = 0xf5f14d

const _v = new Vector3()

export class LoopCutPreview extends Object3D {
    private _lines: LineSegments
    private _points: LineSegments

    constructor() {
        super()
        this.name = 'LoopCutPreview'
        this.userData.excludeFromExport = true
        this.userData.userSelectable = false
        ;(this as any).assetType = 'widget'
        this._lines = new LineSegments(new BufferGeometry(), this._mat())
        this._points = new LineSegments(new BufferGeometry(), this._mat())
        for (const o of [this._lines, this._points]) {
            o.frustumCulled = false
            o.renderOrder = 999
            o.userData.userSelectable = false
            o.userData.excludeFromExport = true
            this.add(o)
        }
        this.visible = false
    }

    private _mat(): UnlitLineMaterial {
        const m = new UnlitLineMaterial({color: GIZMO_PRIMARY, transparent: true, opacity: 1, depthTest: false, depthWrite: false})
        m.toneMapped = false
        ;(m as any).allowOverride = false
        return m
    }

    /**
     * Show `preview` (object space) under `matrixWorld`; null hides it. `pointSize` is the world size of
     * a point's square at the preview, so it reads as an edit-mode vertex.
     */
    update(preview: EdgeRingPreview | null, matrixWorld: Matrix4 | null, camera: Camera, pointSize: number): void {
        if (!preview || !matrixWorld || !preview.edges.length && !preview.verts.length) {
            this.visible = false
            return
        }
        this.visible = true
        const w = (p: number[]) => _v.set(p[0], p[1], p[2]).applyMatrix4(matrixWorld).toArray()
        const lines: number[] = []
        for (const [a, b] of preview.edges) lines.push(...w(a), ...w(b))
        this._set(this._lines, lines)

        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        const squares: number[] = []
        const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
        for (const p of preview.verts) {
            const c = w(p)
            for (let i = 0; i < 4; i++) {
                for (const [cx, cy] of [corners[i], corners[(i + 1) % 4]]) {
                    squares.push(
                        c[0] + (right.x * cx + up.x * cy) * pointSize,
                        c[1] + (right.y * cx + up.y * cy) * pointSize,
                        c[2] + (right.z * cx + up.z * cy) * pointSize,
                    )
                }
            }
        }
        this._set(this._points, squares)
    }

    private _set(o: LineSegments, pts: number[]): void {
        const g = o.geometry
        const attr = g.getAttribute('position') as Float32BufferAttribute | undefined
        if (attr && attr.array.length === pts.length) {
            (attr.array as Float32Array).set(pts)
            attr.needsUpdate = true
        } else {
            g.setAttribute('position', new Float32BufferAttribute(new Float32Array(pts), 3))
        }
        g.setDrawRange(0, pts.length / 3)
        o.visible = pts.length > 0
    }

    dispose(): void {
        for (const o of [this._lines, this._points]) {
            o.geometry.dispose()
            ;(o.material as Material).dispose()
        }
    }
}
