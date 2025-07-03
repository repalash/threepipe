import {
    Camera,
    Color,
    InterleavedBufferAttribute,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Vector3,
} from 'three'
import {ACameraHelperWidget} from './ACameraHelperWidget'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {LineMaterial2} from '../../core'

/**
 * Fork of CameraHelper from three.js
 *	- shows frustum, line of sight and up of the camera
 *	- suitable for fast updates
 * 	- based on frustum visualization in lightgl.js shadowmap example
 *		https://github.com/evanw/lightgl.js/blob/master/tests/shadowmap.html
 */
export class CameraHelper2 extends ACameraHelperWidget {
    protected _vector = new Vector3()
    protected _camera = new Camera()

    line: LineSegments2
    pointMap: Record<string, number[]>

    constructor(camera: PerspectiveCamera|OrthographicCamera) {
        super(camera)

        const geometry = new LineSegmentsGeometry()
        const material = new LineMaterial2({
            color: 0xffffff,
            linewidth: 5, // in world units with size attenuation, pixels otherwise
            vertexColors: true,
            worldUnits: false,

            dashed: false,
            alphaToCoverage: true,

            toneMapped: false,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })
        material.userData.renderToGBuffer = false
        material.userData.renderToDepth = false

        const {vertices, colors, pointMap} = generateVertices()

        geometry.setPositions(vertices)
        geometry.setColors(colors)

        this.line = new LineSegments2(geometry, material)
        this.line.frustumCulled = false
        this.add(this.line)

        this.pointMap = pointMap

        this.update()

        // colors

        const colorFrustum = new Color(0xffaa00)
        const colorCone = new Color(0xff0000)
        const colorUp = new Color(0x00aaff)
        const colorTarget = new Color(0xffffff)
        const colorCross = new Color(0x333333)

        this.setColors(colorFrustum, colorCone, colorUp, colorTarget, colorCross)

    }

    setColors(frustum: Color, cone: Color, up: Color, target: Color, cross: Color) {

        const geometry = this.line.geometry

        const colorAttribute = geometry.getAttribute('instanceColorStart')
        const colorAttribute2 = geometry.getAttribute('instanceColorEnd')

        function setXYZ(i: number, color: Color) {

            colorAttribute.setXYZ(i / 2, color.r, color.g, color.b)
            colorAttribute2.setXYZ(i / 2, color.r, color.g, color.b)

        }
        // near

        setXYZ(0, frustum) // n1, n2
        setXYZ(2, frustum) // n2, n4
        setXYZ(4, frustum) // n4, n3
        setXYZ(6, frustum) // n3, n1

        // far

        setXYZ(8, frustum) // f1, f2
        setXYZ(10, frustum) // f2, f4
        setXYZ(12, frustum) // f4, f3
        setXYZ(14, frustum) // f3, f1

        // sides

        setXYZ(16, frustum) // n1, f1
        setXYZ(18, frustum) // n2, f2
        setXYZ(20, frustum) // n3, f3
        setXYZ(22, frustum) // n4, f4

        // cone

        setXYZ(24, cone) // p, n1
        setXYZ(26, cone) // p, n2
        setXYZ(28, cone) // p, n3
        setXYZ(30, cone) // p, n4

        // up

        setXYZ(32, up) // u1, u2
        setXYZ(34, up) // u2, u3
        setXYZ(36, up) // u3, u1

        // target

        setXYZ(38, target) // c, t
        setXYZ(40, cross) // p, c

        // cross

        setXYZ(42, cross) // cn1, cn2
        setXYZ(44, cross) // cn3, cn4

        setXYZ(46, cross) // cf1, cf2
        setXYZ(48, cross) // cf3, cf4

        colorAttribute.needsUpdate = true
        colorAttribute2.needsUpdate = true

    }

    update() {
        if (!this.camera) return

        const geometry = this.line.geometry
        const pointMap = this.pointMap

        const w = 1, h = 1

        // we need just camera projection matrix inverse
        // world matrix must be identity

        // eslint-disable-next-line @typescript-eslint/naming-convention
        const {_camera, _vector} = this

        _camera.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse)

        // center / target

        setPoint('c', pointMap, geometry, _camera, 0, 0, -1, _vector)
        setPoint('t', pointMap, geometry, _camera, 0, 0, 1, _vector)

        // near

        setPoint('n1', pointMap, geometry, _camera, -w, -h, -1, _vector)
        setPoint('n2', pointMap, geometry, _camera, w, -h, -1, _vector)
        setPoint('n3', pointMap, geometry, _camera, -w, h, -1, _vector)
        setPoint('n4', pointMap, geometry, _camera, w, h, -1, _vector)

        // far

        setPoint('f1', pointMap, geometry, _camera, -w, -h, 1, _vector)
        setPoint('f2', pointMap, geometry, _camera, w, -h, 1, _vector)
        setPoint('f3', pointMap, geometry, _camera, -w, h, 1, _vector)
        setPoint('f4', pointMap, geometry, _camera, w, h, 1, _vector)

        // up

        setPoint('u1', pointMap, geometry, _camera, w * 0.7, h * 1.1, -1, _vector)
        setPoint('u2', pointMap, geometry, _camera, -w * 0.7, h * 1.1, -1, _vector)
        setPoint('u3', pointMap, geometry, _camera, 0, h * 2, -1, _vector)

        // cross

        setPoint('cf1', pointMap, geometry, _camera, -w, 0, 1, _vector)
        setPoint('cf2', pointMap, geometry, _camera, w, 0, 1, _vector)
        setPoint('cf3', pointMap, geometry, _camera, 0, -h, 1, _vector)
        setPoint('cf4', pointMap, geometry, _camera, 0, h, 1, _vector)

        setPoint('cn1', pointMap, geometry, _camera, -w, 0, -1, _vector)
        setPoint('cn2', pointMap, geometry, _camera, w, 0, -1, _vector)
        setPoint('cn3', pointMap, geometry, _camera, 0, -h, -1, _vector)
        setPoint('cn4', pointMap, geometry, _camera, 0, h, -1, _vector)

        geometry.getAttribute('instanceStart').needsUpdate = true
        geometry.getAttribute('instanceEnd').needsUpdate = true

        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()

        super.update()
    }

    dispose() {

        this.line.geometry.dispose()
        this.line.material.dispose()

        super.dispose()
    }

    static Check(camera: Object3D) {
        return (camera as any).isCamera
    }
    static Create(camera: Object3D) {
        return new CameraHelper2(camera as any)
    }

}


function setPoint(point: string, pointMap: Record<string, number[]>, geometry: LineSegmentsGeometry, camera: Camera, x: number, y: number, z: number, _vector: Vector3) {

    _vector.set(x, y, z).unproject(camera)

    const points = pointMap[ point ]

    if (points !== undefined) {

        const position1 = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
        const position2 = geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute

        for (let i = 0, l = points.length; i < l; i++) {

            const j = Math.floor(points[ i ] / 2.)
            ;(points[ i ] % 2 === 0 ? position1 : position2).setXYZ(j, _vector.x, _vector.y, _vector.z)
            // (i % 2 === 0 ? position1 : position2).setXYZ(points[ i ], _vector.x, _vector.y, _vector.z)

        }

    }

}

function generateVertices() {
    const vertices: number[] = []
    const colors: number[] = []

    const pointMap: any = {}

    // near

    addLine('n1', 'n2')
    addLine('n2', 'n4')
    addLine('n4', 'n3')
    addLine('n3', 'n1')

    // far

    addLine('f1', 'f2')
    addLine('f2', 'f4')
    addLine('f4', 'f3')
    addLine('f3', 'f1')

    // sides

    addLine('n1', 'f1')
    addLine('n2', 'f2')
    addLine('n3', 'f3')
    addLine('n4', 'f4')

    // cone

    addLine('p', 'n1')
    addLine('p', 'n2')
    addLine('p', 'n3')
    addLine('p', 'n4')

    // up

    addLine('u1', 'u2')
    addLine('u2', 'u3')
    addLine('u3', 'u1')

    // target

    addLine('c', 't')
    addLine('p', 'c')

    // cross

    addLine('cn1', 'cn2')
    addLine('cn3', 'cn4')

    addLine('cf1', 'cf2')
    addLine('cf3', 'cf4')

    function addLine(a: string, b: string) {

        addPoint(a)
        addPoint(b)

    }

    function addPoint(id: string) {

        vertices.push(0, 0, 0)
        colors.push(0, 0, 0)

        if (pointMap[id] === undefined) {

            pointMap[id] = []

        }

        pointMap[id].push(vertices.length / 3 - 1)

    }

    return {vertices, colors, pointMap}
}
