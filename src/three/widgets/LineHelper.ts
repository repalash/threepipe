import {BufferAttribute, BufferGeometry, Curve, Line, LineLoop, LineSegments, Object3D, Points, PointsMaterial} from 'three'
import {AHelperWidget} from './AHelperWidget'
import {Line2} from 'three/examples/jsm/lines/Line2.js'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {IGeometry, iGeometryCommons, LineSegmentsGeometry2, MeshLine, MeshLineSegments} from '../../core'
import {onChange} from 'ts-browser-helpers'
import {uiColor, uiSlider, uiToggle} from 'uiconfig.js'
import {getCurveEditPoints} from '../utils/curve-edit'

// todo move this to geometry generator or some other plugin
export type LineType1 = (Line | LineLoop | LineSegments)
export type LineType2 = Line2 | LineSegments2 | MeshLine | MeshLineSegments
export type LineType = LineType1 | LineType2

function pointsMaterial(color: number) {
    const material = new PointsMaterial({
        color,
        size: 1,
        sizeAttenuation: false, // the size is in pixels, the same at any distance
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
    })
    material.userData.renderToGBuffer = false
    material.userData.renderToDepth = false
    return material
}

/**
 * Shows the points of a line: the control points of its curve when the line is generated from one
 * (`geometry.userData.generationParams.curve`, like a `line` of `GeometryGeneratorPlugin`), else its vertices.
 *
 * The points are dots of a constant size on the screen (`Points` with `sizeAttenuation: false`). They only show the
 * points: they cannot be picked and have no gizmo. To edit the points of a curve on the screen, add `PathEditPlugin`.
 *
 * See https://threepipe.org/notes/widgets-and-helpers for the full widget system documentation.
 */
export class LineHelper extends AHelperWidget {
    line: LineType

    /** Show the points of the line */
    @onChange(LineHelper.prototype.update)
    @uiToggle()
        showPoints = true

    /** Size of the dots at the vertices of a line without a curve, in pixels */
    @onChange(LineHelper.prototype.update)
    @uiSlider(undefined, [1, 20], 0.5)
        pointSize = 4

    /** Size of the dots at the control points of a curve, in pixels */
    @onChange(LineHelper.prototype.update)
    @uiSlider(undefined, [1, 20], 0.5)
        curvePointSize = 7

    /** Color of the dots at the vertices of a line without a curve */
    @onChange(LineHelper.prototype.update)
    @uiColor()
        pointColor = 0x0093FD

    /** Color of the dots at the control points of a curve */
    @onChange(LineHelper.prototype.update)
    @uiColor()
        curvePointColor = 0xEF0065

    autoUpgradeChildren = false // used elsewhere

    private _points: Points<BufferGeometry, PointsMaterial>

    constructor(line: LineType) {
        super(line)
        this.line = line

        const geometry = new BufferGeometry()
        iGeometryCommons.upgradeGeometry.call(geometry)
        this._points = new Points(geometry, pointsMaterial(this.curvePointColor))
        this._points.frustumCulled = false
        this._points.renderOrder = 100
        // drawn only: a click on a point picks what is under it, the line itself or another object
        this._points.raycast = () => undefined
        this._points.castShadow = false
        this._points.receiveShadow = false
        this._points.userData.__keepShadowDef = true
        this.add(this._points)

        this.update()
    }

    update() {
        super.update()
        const points = this._points
        if (!points) return // called by the decorators before the constructor ends
        const positions = this.showPoints ? this._pointPositions() : null
        points.visible = !!positions?.positions.length
        if (!positions || !points.visible) return

        const curve = positions.curve
        points.material.size = curve ? this.curvePointSize : this.pointSize
        points.material.color.set(curve ? this.curvePointColor : this.pointColor)

        const arr = positions.positions
        for (let i = 0; i < arr.length; i++) if (!isFinite(arr[i])) arr[i] = 0
        const geometry = points.geometry
        const attr = geometry.getAttribute('position') as BufferAttribute | undefined
        if (attr && attr.array.length === arr.length) {
            (attr.array as Float32Array).set(arr)
            attr.needsUpdate = true
        } else geometry.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3))
        geometry.computeBoundingSphere()
    }

    /**
     * Called by Object3DWidgetsPlugin before each render: updates the points after the line or its geometry changed
     * (a regenerated curve). Like the light and camera helpers: objects do not dispatch `beforeRender`.
     */
    preRender() {
        if (!this.visible) return
        this._objectBeforeRender()
    }

    /** The control points of the curve of the line, else its vertices, in the space of the line */
    private _pointPositions(): {positions: number[], curve: boolean} | null {
        const geometry = this.line?.geometry as IGeometry | undefined
        if (!geometry) return null
        const curve = (geometry.userData?.generationParams as {curve?: Curve<any>} | undefined)?.curve
        const curvePoints = curve ? getCurveEditPoints(curve) : []
        if (curvePoints.length) return {positions: curvePoints.flatMap(p => [p.vec.x, p.vec.y, (p.vec as any).z ?? 0]), curve: true}
        const positions = (geometry as LineSegmentsGeometry2).getPositions ?
            (geometry as LineSegmentsGeometry2).getPositions() :
            geometry.getAttribute('position')?.array as Float32Array | undefined
        return positions ? {positions: Array.from(positions), curve: false} : null
    }

    dispose() {
        this._points.removeFromParent()
        this._points.geometry.dispose()
        this._points.material.dispose()
        super.dispose()
    }

    static Check(obj: Object3D) {
        return (obj as Line).isLine || (obj as LineSegments2).isLineSegments2
    }

    static Create(obj: Object3D) {
        return new LineHelper(obj as any)
    }
}
