import {
    BoxGeometry,
    CatmullRomCurve3,
    CubicBezierCurve,
    Curve,
    CurvePath,
    Line,
    LineLoop,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Vector2,
    Vector3,
} from 'three'
import {AHelperWidget} from './AHelperWidget'
import {Line2} from 'three/examples/jsm/lines/Line2.js'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {
    IGeometry,
    iGeometryCommons,
    IObject3D,
    IObjectSetDirtyOptions,
    LineSegmentsGeometry2,
    MeshLine,
    MeshLineSegments,
} from '../../core'
import {onChange} from 'ts-browser-helpers'
import {uiColor, uiSlider} from 'uiconfig.js'
// import type {LineGeometryGeneratorParams} from '../../../plugins/geometry-generator/src'

// todo move this to geometry generator or some other plugin
export type LineType1 = (Line | LineLoop | LineSegments)
export type LineType2 = Line2 | LineSegments2 | MeshLine | MeshLineSegments
export type LineType = LineType1 | LineType2

export class LineHelper extends AHelperWidget {
    line: LineType
    private _vertexHandles: Mesh[] = []
    private _cubeGeometry: BoxGeometry
    private _cubeMaterial: MeshBasicMaterial
    private _cubeMaterial2: MeshBasicMaterial

    @onChange(LineHelper.prototype.update)
    @uiSlider(undefined, [0.001, 0.2], 0.001)
        handleSize = 0.05

    @onChange(LineHelper.prototype.update)
    @uiSlider(undefined, [0.001, 0.5], 0.001)
        editableHandleSize = 0.1

    @onChange(LineHelper.prototype.update)
    @uiColor()
        handleColor = 0x0093FD

    @onChange(LineHelper.prototype.update)
    @uiColor()
        editableHandleColor = 0xEF0065

    autoUpgradeChildren = false // used elsewhere

    constructor(line: LineType) {
        super(line)
        this.line = line

        // todo use instanced or batched mesh probably.
        // Create reusable geometry and material for vertex cubes
        this._cubeGeometry = new BoxGeometry(1, 1, 1, 2, 2, 2)
        iGeometryCommons.upgradeGeometry.call(this._cubeGeometry)
        this._cubeMaterial = new MeshBasicMaterial({
            color: this.handleColor,
            transparent: true,
            opacity: 0.95,
        })
        this._cubeMaterial.userData.renderToGBuffer = false
        this._cubeMaterial.userData.renderToDepth = false
        this._cubeMaterial2 = this._cubeMaterial.clone()
        this._cubeMaterial2.color.set(this.editableHandleColor)
        // this._cubeMaterial.depthWrite = false
        // this._cubeMaterial.depthTest = false

        this.update()
    }

    update() {
        super.update()
        if (!this.line || !this.line.geometry) return

        const geometry = this.line.geometry as IGeometry
        const positionAttribute = geometry.getAttribute('position')

        const positions = (geometry as LineSegmentsGeometry2).getPositions ? (geometry as LineSegmentsGeometry2).getPositions() : positionAttribute?.array as Float32Array
        const vertexCount = positions ? positions.length / 3 : 0

        if (!positions || !vertexCount) return

        const generationParams = this.line.geometry.userData?.generationParams /* as LineGeometryGeneratorParams*/
        const curve = generationParams?.curve as Curve<Vector2|Vector3>
        if (curve) {
            const points = getPointsForCurve(curve)

            const existingCubes = this._vertexHandles
            this._vertexHandles = []
            for (let i = points.length; i < existingCubes.length; i++) {
                this.remove(existingCubes[i])
            }
            for (let i = 0; i < points.length; i++) {
                const point1 = points[i]
                const cube = existingCubes[i] ?? new Mesh(this._cubeGeometry, this._cubeMaterial2)
                cube.renderOrder = 100
                const parr = point1[0]
                if (!isFinite(parr[0])) parr[0] = 0
                if (!isFinite(parr[1])) parr[1] = 0
                if (!isFinite(parr[2])) parr[2] = 0
                cube.position.fromArray(parr)
                cube.scale.setScalar(this.editableHandleSize)
                cube.frustumCulled = false

                // Ensure cubes don't cast/receive shadows
                cube.castShadow = false
                cube.receiveShadow = false
                cube.userData.__keepShadowDef = true

                if (!cube.parent) this.add(cube)
                this._vertexHandles.push(cube)

                cube.userData.isWidgetHandle = true
                cube.userData.transformControls = {
                    mode: 'translate',
                    space: 'local',
                    showX: true,
                    showY: true,
                    showZ: true,
                    lockProps: ['mode'],
                }

                ;(cube as any).__handle = point1

                // when the cube is moved, update the curve point
                ;(cube as any as IObject3D).setDirty = (e: IObjectSetDirtyOptions)=>{
                    // from transform controls
                    if (e.change !== 'transform') return
                    const handleData = (cube as any).__handle
                    const point = handleData[0] as [number, number, number]
                    const key = handleData[1] as string
                    const position = cube.position
                    const diff = Math.abs(point[0] - position.x) + Math.abs(point[1] - position.y) + Math.abs(point[2] - position.z)
                    if (diff <= 1e-4) return
                    point[0] = position.x
                    point[1] = position.y
                    point[2] = position.z

                    let curve1 = curve
                    let key1 = key
                    if (key1.startsWith('curves.')) {
                        const ee = key1.indexOf('.', 7)
                        const curveIndex = parseInt(key1.slice(7, ee) || '0')
                        key1 = key1.slice(ee + 1)
                        if (curveIndex >= 0 && curveIndex < (curve as CurvePath<any>).curves.length) {
                            curve1 = (curve as CurvePath<any>).curves[curveIndex]
                        }
                    }
                    if (key1.startsWith('points.')) {
                        const index = parseInt(key1.slice(7) || '0', 10)
                        ;(curve1 as CatmullRomCurve3).points?.[index]?.set(point[0], point[1], point[2])
                    } else {
                        (curve1 as any)[key1]?.set(point[0], point[1], point[2])
                    }
                    geometry.setDirty && geometry.setDirty({regenerate: true})
                }
            }
            if (points.length) return
        }

        // Cube for each vertex
        this._clearVertexCubes()
        const existingCubes = this._vertexHandles
        this._vertexHandles = []
        for (let i = vertexCount; i < existingCubes.length; i++) {
            this.remove(existingCubes[i])
        }

        for (let i = 0; i < vertexCount; i++) {
            const x = positions[i * 3]
            const y = positions[i * 3 + 1]
            const z = positions[i * 3 + 2]

            const cube = existingCubes[i] ?? new Mesh(this._cubeGeometry, this._cubeMaterial)
            cube.position.set(isFinite(x) ? x : 0, isFinite(y) ? y : 0, isFinite(z) ? z : 0)
            cube.scale.setScalar(this.handleSize)
            cube.frustumCulled = false

            // Ensure cubes don't cast/receive shadows
            cube.castShadow = false
            cube.receiveShadow = false
            cube.userData.__keepShadowDef = true

            if (!cube.parent) this.add(cube)
            this._vertexHandles.push(cube)
        }

    }

    private _clearVertexCubes() {
        // Remove existing cubes from the scene
        for (const cube of this._vertexHandles) {
            this.remove(cube)
        }
        this._vertexHandles = []
    }

    dispose() {
        this._clearVertexCubes()
        this._cubeGeometry.dispose()
        this._cubeMaterial.dispose()
        super.dispose()
    }

    static Check(obj: Object3D) {
        return (obj as Line).isLine || (obj as LineSegments2).isLineSegments2
    }

    static Create(obj: Object3D) {
        return new LineHelper(obj as any)
    }
}

function getPointsForCurve(curve: Curve<Vector2 | Vector3>) {
    const points = [] as Array<[number[], string]>
    // toArray since it can be a Vector2 or Vector3
    if ((curve as any).v0?.toArray)
        points.push([(curve as CubicBezierCurve).v0.toArray(), 'v0'])
    if ((curve as any).v1?.toArray)
        points.push([(curve as CubicBezierCurve).v1.toArray(), 'v1'])
    if ((curve as any).v2?.toArray)
        points.push([(curve as CubicBezierCurve).v2.toArray(), 'v2'])
    if ((curve as any).v3?.toArray)
        points.push([(curve as CubicBezierCurve).v3.toArray(), 'v3'])
    if ((curve as any).points !== undefined)
        (curve as CatmullRomCurve3).points.forEach((p, i) => {
            points.push([p.toArray(), 'points.' + i])
        })
    if ((curve as any).curves !== undefined)
        (curve as CurvePath<any>).curves.forEach((c, i) => {
            const points1 = getPointsForCurve(c)
            points1.forEach(p => {
                p[1] = 'curves.' + i + '.' + p[1]
            })
            points.push(...points1)
        })

    return points
}
