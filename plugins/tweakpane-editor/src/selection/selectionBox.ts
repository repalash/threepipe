import {Box3, IObject3D, Matrix4, Quaternion, Vector3, Vector4} from 'threepipe'
import {isHelperObject} from './selectionHierarchy'

/**
 * The box geometry of the selection overlay of `SelectionUxPlugin`: the box of objects in the world, and its projection
 * on the screen. Plain functions of the objects and the camera, so they have unit tests.
 */

/** A box around objects: the unit cube [-0.5, 0.5]^3 mapped to the world */
export interface BoxInfo {
    /** Maps the unit cube to the world */
    matrix: Matrix4
    /** The 8 corners in the world; bit 0, 1, 2 of the index is the +x, +y, +z side of the box */
    corners: Vector3[]
    center: Vector3
    /** The centre of the bottom (the lowest world y of the corners) */
    base: Vector3
    /** The world length along each box axis */
    size: Vector3
    /** The world unit axes of the box */
    axes: Vector3[]
}

/** A point on the canvas in pixels from its top left corner. `behind` is set for a point behind the camera. */
export interface ScreenPoint {x: number, y: number, behind: boolean}

/** The screen rectangle of points, in pixels */
export interface ScreenRect {minX: number, minY: number, maxX: number, maxY: number}

const UNIT_CUBE: Vector3[] = Array.from({length: 8}, (_, i) => new Vector3((i & 1) - 0.5, (i >> 1 & 1) - 0.5, (i >> 2 & 1) - 0.5))
/** The 12 edges of the box, as pairs of corner indices */
const BOX_EDGES: [number, number][] = []
for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) BOX_EDGES.push([i, i | b])

/**
 * The box of what is drawn of `obj` in a frame: the boxes of its visible meshes, lines and points, and a cube of
 * `pointSize(o)` at each light or camera inside it. Helpers (widgets, a light's target) and an object with
 * `userData.bboxVisible === false` are left out, with all inside them (as in `Box3B.expandByObject`).
 * As in `Box3B.expandByObject`, an object with its own `boundingBox` (an instanced or a skinned mesh: the box of all
 * instances, or of the pose) uses it before the box of its geometry. Empty when `obj` has none of these.
 * @param frame - maps the world to the frame; each part's box goes into the frame from its own world transform
 */
function contentBox(obj: IObject3D, frame: Matrix4, pointSize: (o: IObject3D) => number): Box3 {
    const box = new Box3()
    obj.updateWorldMatrix(true, true)
    const m = new Matrix4()
    const visit = (o: IObject3D) => {
        const c = o as IObject3D & {boundingBox?: Box3 | null, computeBoundingBox?: () => void}
        if (!c.visible || c.userData.bboxVisible === false || isHelperObject(c)) return
        c.children.forEach(visit)
        let b: Box3 | null | undefined
        if (c.boundingBox !== undefined) {
            if (c.boundingBox === null) c.computeBoundingBox?.()
            b = c.boundingBox
        } else if (c.geometry) {
            if (!c.geometry.boundingBox) c.geometry.computeBoundingBox()
            b = c.geometry.boundingBox
        } else {
            if (c !== obj && (c.isLight || c.isCamera)) {
                const p = c.getWorldPosition(new Vector3())
                box.union(new Box3().setFromCenterAndSize(p, new Vector3().setScalar(pointSize(c))).applyMatrix4(frame))
            }
            return
        }
        if (!b) return
        m.multiplyMatrices(frame, c.matrixWorld)
        box.union(b.clone().applyMatrix4(m))
    }
    visit(obj)
    return box
}

/** The box of what is drawn of `obj` (see {@link worldBox}), in its own frame */
export function localBox(obj: IObject3D, pointSize: (o: IObject3D) => number): Box3 {
    obj.updateWorldMatrix(true, false)
    return contentBox(obj, obj.matrixWorld.clone().invert(), pointSize)
}

/**
 * The world box (aligned to the world axes) of what is drawn of objects: the boxes of their visible meshes, lines and
 * points, and a cube of `pointSize(o)` at each light or camera inside them. Helpers (widgets, a light's target) and an
 * object with `userData.bboxVisible === false` are left out, with all inside them. As in `Box3B.expandByObject`, an object with its own `boundingBox` (an instanced or a skinned mesh: the box
 * of all instances, or of the pose) uses it before the box of its geometry. An object with nothing drawn adds its
 * position.
 */
export function worldBox(objs: IObject3D[], pointSize: (o: IObject3D) => number): Box3 {
    const box = new Box3()
    const identity = new Matrix4()
    for (const o of objs) {
        const b = contentBox(o, identity, pointSize)
        if (b.isEmpty()) box.expandByPoint(o.getWorldPosition(new Vector3()))
        else box.union(b)
    }
    return box
}

/**
 * The box around objects.
 * @param objs - the objects; at least one
 * @param space - `local`: one object's box turns with it; else (and for several objects) the world box
 * @param pointSize - the size of the cube that stands for a light, a camera or an empty object, in world units
 */
export function boxInfo(objs: IObject3D[], space: 'local' | 'world', pointSize: (o: IObject3D) => number): BoxInfo {
    const m = new Matrix4()
    const minSize = new Vector3(1e-6, 1e-6, 1e-6)
    if (objs.length === 1 && space === 'local') {
        const o = objs[0]
        const lb = localBox(o, pointSize)
        if (lb.isEmpty()) lb.setFromCenterAndSize(new Vector3(), new Vector3().setScalar(pointSize(o)))
        const size = lb.getSize(new Vector3()).max(minSize)
        m.copy(o.matrixWorld).multiply(new Matrix4().compose(lb.getCenter(new Vector3()), new Quaternion(), size))
    } else {
        const wb = worldBox(objs, pointSize)
        const size = wb.getSize(new Vector3())
        if (size.lengthSq() < 1e-12) size.setScalar(pointSize(objs[0]))
        m.compose(wb.getCenter(new Vector3()), new Quaternion(), size.max(minSize))
    }
    const corners = UNIT_CUBE.map(c => c.clone().applyMatrix4(m))
    const center = new Vector3().setFromMatrixPosition(m)
    const axes = [0, 1, 2].map(i => new Vector3().setFromMatrixColumn(m, i))
    const size = new Vector3(axes[0].length(), axes[1].length(), axes[2].length())
    axes.forEach(a => a.normalize())
    const base = new Vector3(center.x, Math.min(...corners.map(c => c.y)), center.z)
    return {matrix: m, corners, center, base, size, axes}
}

const v4 = new Vector4()
/**
 * The point on a canvas of `w`×`h` pixels where a camera shows a world point. The point is behind the camera when it is
 * not in front of the camera's plane (camera space z >= 0), for a perspective and an orthographic camera.
 * @param camera - its world matrix and projection matrix are up to date (as after a render)
 */
export function toScreen(v: Vector3, camera: {matrixWorldInverse: Matrix4, projectionMatrix: Matrix4}, w: number, h: number): ScreenPoint {
    const p = v4.set(v.x, v.y, v.z, 1).applyMatrix4(camera.matrixWorldInverse)
    const behind = p.z >= 0
    p.applyMatrix4(camera.projectionMatrix)
    const iw = 1 / Math.abs(p.w || 1e-6)
    return {x: (p.x * iw + 1) / 2 * w, y: (1 - p.y * iw) / 2 * h, behind}
}

/** The rectangle around the points in front of the camera, null when all are behind it */
export function screenRect(points: ScreenPoint[]): ScreenRect | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let any = false
    for (const s of points) {
        if (s.behind) continue
        any = true
        minX = Math.min(minX, s.x)
        maxX = Math.max(maxX, s.x)
        minY = Math.min(minY, s.y)
        maxY = Math.max(maxY, s.y)
    }
    return any ? {minX, minY, maxX, maxY} : null
}

/**
 * Which faces of the box face the camera; index axis * 2 + (1 for the + side, 0 for the - side)
 * @param eye - the camera position (a perspective camera: a face faces it when the camera is in front of the face)
 * @param viewDir - the view direction of an orthographic camera, whose rays are parallel: a face faces it when it
 * faces against this direction, wherever the box is
 */
export function frontFaces(info: BoxInfo, eye: Vector3, viewDir?: Vector3): boolean[] {
    const res: boolean[] = []
    for (let a = 0; a < 3; a++) for (const side of [-1, 1]) {
        const fc = info.center.clone().addScaledVector(info.axes[a], side * info.size.getComponent(a) / 2)
        const toCamera = viewDir ? viewDir.clone().negate() : eye.clone().sub(fc)
        res.push(info.axes[a].clone().multiplyScalar(side).dot(toCamera) > 0)
    }
    return res
}

/**
 * An SVG path of the box edges on the screen: the edges of a face that faces the camera (`visible`), or the others
 * (`hidden`). An edge with an end behind the camera is left out.
 * @param sc - the screen points of {@link BoxInfo.corners}
 * @param front - {@link frontFaces}
 */
export function boxEdgesPath(sc: ScreenPoint[], front: boolean[], which: 'visible' | 'hidden'): string {
    let d = ''
    for (const [i, j] of BOX_EDGES) {
        const axis = [1, 2, 4].indexOf(i ^ j)
        let visible = false
        // the two faces that share this edge
        for (let a = 0; a < 3; a++) if (a !== axis && front[a * 2 + (i & 1 << a ? 1 : 0)]) visible = true
        if (which === 'visible' !== visible || sc[i].behind || sc[j].behind) continue
        d += `M${sc[i].x.toFixed(1)} ${sc[i].y.toFixed(1)}L${sc[j].x.toFixed(1)} ${sc[j].y.toFixed(1)}`
    }
    return d
}

/** An SVG path of short strokes from each corner along its 3 edges (corner brackets), at most `len` pixels long */
export function bracketsPath(sc: ScreenPoint[], len = 16): string {
    let d = ''
    for (let i = 0; i < 8; i++) {
        if (sc[i].behind) continue
        for (const b of [1, 2, 4]) {
            const j = i ^ b
            if (sc[j].behind) continue
            const dx = sc[j].x - sc[i].x, dy = sc[j].y - sc[i].y
            const l = Math.hypot(dx, dy)
            if (l < 1e-3) continue
            const s = Math.min(len, l * 0.28) / l
            d += `M${sc[i].x.toFixed(1)} ${sc[i].y.toFixed(1)}l${(dx * s).toFixed(1)} ${(dy * s).toFixed(1)}`
        }
    }
    return d
}
