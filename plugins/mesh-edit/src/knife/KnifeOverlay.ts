/**
 * The knife's preview: what Blender's `knifetool_draw` (`editors/mesh/editmesh_knife.cc:832`) draws
 * while the knife runs.
 *
 * - The point under the cursor and the last placed point: 11 px on a vertex in the vertex colour, 9 px
 *   on an edge or face in the secondary gizmo colour.
 * - The edge under the cursor, 2 px, in gizmo colour A; the line from the last point to the cursor,
 *   2 px, in the primary gizmo colour.
 * - The cut so far: its edges 1 px in the primary gizmo colour and its points 5 px, depth tested unless
 *   X-ray (V) turns that off.
 * - Where the current line would cut: 11 px dots on vertices, 7 px elsewhere, 40% opaque.
 * - Relative angle snapping's reference edge, 2 px, in gizmo colour B.
 *
 * Colours are Blender's default theme, read from Blender 3.4.1's `bpy.context.preferences.themes[0]`:
 * gizmo primary `#f5f14d`, secondary `#63ffff`, A `#4da84d`, B `#a33535`, 3D-view vertex `#000000`.
 * Sizes are in CSS pixels (`UI_SCALE_FAC` 1).
 */

import {
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    LineMaterial2,
    LineSegmentsGeometry2,
    MeshLineSegments,
    Object3D,
    Points,
    ShaderMaterial,
} from 'threepipe'
import type {KnifeDrawData} from '@threepipe/mesh-kernel'

/** Blender's default theme colours the knife draws with (`knife_init_colors`, `:3902`). */
export const KnifeTheme = {
    line: '#f5f14d',        // TH_GIZMO_PRIMARY
    edge: '#4da84d',        // TH_GIZMO_A
    edgeExtra: '#a33535',   // TH_GIZMO_B
    curpoint: '#63ffff',    // TH_GIZMO_SECONDARY
    point: '#000000',       // TH_VERTEX
} as const

type V3 = [number, number, number]

/** Round, anti-aliased points of one size and colour (`GPU_SHADER_3D_POINT_UNIFORM_SIZE_UNIFORM_COLOR_AA`). */
function pointMaterial(color: string, sizePx: number, opacity: number): ShaderMaterial {
    const m = new ShaderMaterial({
        uniforms: {
            color: {value: new Color(color)},
            size: {value: sizePx},
            pixelRatio: {value: 1},
            opacity: {value: opacity},
        },
        vertexShader: /* glsl */`
            uniform float size;
            uniform float pixelRatio;
            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * pixelRatio;
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 color;
            uniform float opacity;
            void main() {
                vec2 c = gl_PointCoord * 2.0 - 1.0;
                float r = length(c);
                float aa = fwidth(r);
                float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, r);
                if (alpha <= 0.0) discard;
                gl_FragColor = vec4(color, alpha * opacity);
                #include <colorspace_fragment>
            }`,
        transparent: true,
        depthWrite: false,
    })
    ;(m as any).toneMapped = false
    ;(m as any).allowOverride = false
    return m
}

function lineMaterial(color: string, widthPx: number): LineMaterial2 {
    const m = new LineMaterial2({color: color as any, linewidth: widthPx, worldUnits: false, transparent: true, depthWrite: false} as any)
    m.toneMapped = false
    ;(m as any).allowOverride = false
    return m
}

class PointSet {
    readonly points: Points
    private _cap = 0
    constructor(readonly material: ShaderMaterial) {
        this.points = new Points(new BufferGeometry(), material as any)
        this.points.frustumCulled = false
    }

    set(cos: V3[]): void {
        const g = this.points.geometry as BufferGeometry
        if (cos.length > this._cap) {
            this._cap = Math.max(16, cos.length * 2)
            g.setAttribute('position', new Float32BufferAttribute(new Float32Array(this._cap * 3), 3))
        }
        const pos = g.getAttribute('position') as Float32BufferAttribute | undefined
        if (pos) {
            cos.forEach((c, i) => pos.setXYZ(i, c[0], c[1], c[2]))
            pos.needsUpdate = true
        }
        g.setDrawRange(0, cos.length)
        this.points.visible = cos.length > 0
    }
}

class LineSet {
    readonly lines: MeshLineSegments
    constructor(readonly material: LineMaterial2) {
        this.lines = new MeshLineSegments(new LineSegmentsGeometry2(), material)
        this.lines.frustumCulled = false
    }

    set(segments: [V3, V3][]): void {
        const flat: number[] = []
        for (const [a, b] of segments) flat.push(a[0], a[1], a[2], b[0], b[1], b[2])
        const old = this.lines.geometry
        const g = new LineSegmentsGeometry2()
        // A fresh geometry per change: three caches the instance count of an instanced geometry.
        if (flat.length) g.setPositions(flat)
        this.lines.geometry = g
        old.dispose()
        this.lines.visible = segments.length > 0
    }
}

export class KnifeOverlay extends Object3D {
    private _prevVert = new PointSet(pointMaterial(KnifeTheme.point, 11, 1))
    private _prevOther = new PointSet(pointMaterial(KnifeTheme.curpoint, 9, 1))
    private _currVert = new PointSet(pointMaterial(KnifeTheme.point, 11, 1))
    private _currOther = new PointSet(pointMaterial(KnifeTheme.curpoint, 9, 1))
    private _cutVerts = new PointSet(pointMaterial(KnifeTheme.point, 5, 1))
    private _hitVerts = new PointSet(pointMaterial(KnifeTheme.point, 11, 0.4))
    private _hitOther = new PointSet(pointMaterial(KnifeTheme.curpoint, 7, 0.4))
    private _line = new LineSet(lineMaterial(KnifeTheme.line, 2))
    private _currEdge = new LineSet(lineMaterial(KnifeTheme.edge, 2))
    private _cutEdges = new LineSet(lineMaterial(KnifeTheme.line, 1))
    private _refEdge = new LineSet(lineMaterial(KnifeTheme.edgeExtra, 2))

    constructor() {
        super()
        this.name = 'KnifeOverlay'
        this.userData.excludeFromExport = true
        this.userData.userSelectable = false
        ;(this as any).assetType = 'widget'
        for (const o of this._all()) {
            o.renderOrder = 1000
            o.userData.userSelectable = false
            o.userData.excludeFromExport = true
            this.add(o)
        }
    }

    private _points(): PointSet[] {
        return [this._prevVert, this._prevOther, this._currVert, this._currOther, this._cutVerts, this._hitVerts, this._hitOther]
    }

    private _lines(): LineSet[] {
        return [this._line, this._currEdge, this._cutEdges, this._refEdge]
    }

    private _all(): Object3D[] {
        return [...this._lines().map(l => l.lines as unknown as Object3D), ...this._points().map(p => p.points as unknown as Object3D)]
    }

    /** Redraw from the knife's state. `pixelRatio` keeps point sizes in CSS pixels. */
    update(d: KnifeDrawData, pixelRatio: number): void {
        for (const p of this._points()) (p.material.uniforms.pixelRatio as {value: number}).value = pixelRatio
        // Points under the cursor and at the last cut are drawn without depth testing (`:835`).
        this._prevVert.set(d.prev && d.prev.kind === 'vert' ? [d.prev.cage] : [])
        this._prevOther.set(d.prev && (d.prev.kind === 'edge' || d.prev.kind === 'face') ? [d.prev.cage] : [])
        this._currVert.set(d.curr.kind === 'vert' ? [d.curr.cage] : [])
        this._currOther.set(d.curr.kind === 'edge' || d.curr.kind === 'face' ? [d.curr.cage] : [])
        this._line.set(d.line ? [d.line] : [])
        this._currEdge.set(d.currEdge ? [d.currEdge] : [])
        this._cutEdges.set(d.cutEdges)
        this._cutVerts.set(d.cutVerts)
        this._refEdge.set(d.snapRefEdge ? [d.snapRefEdge] : [])
        this._hitVerts.set(d.linehits.filter(h => h.snappedToVert).map(h => h.cage))
        this._hitOther.set(d.linehits.filter(h => !h.snappedToVert).map(h => h.cage))
        // The cut (its edges, points and line hits) is depth tested unless X-ray (`:889`).
        const depthTested = [this._cutEdges.material, this._cutVerts.material, this._hitVerts.material, this._hitOther.material, this._line.material, this._currEdge.material, this._refEdge.material]
        for (const m of depthTested) {
            if (m.depthTest !== d.depthTest) {
                m.depthTest = d.depthTest
                m.needsUpdate = true
            }
        }
        for (const p of [this._prevVert, this._prevOther, this._currVert, this._currOther]) p.material.depthTest = false
        this.visible = true
    }

    dispose(): void {
        for (const p of this._points()) {
            p.points.geometry.dispose()
            p.material.dispose()
        }
        for (const l of this._lines()) {
            l.lines.geometry.dispose()
            l.material.dispose()
        }
        this.removeFromParent()
    }
}
