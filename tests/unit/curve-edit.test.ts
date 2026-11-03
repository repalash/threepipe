/**
 * The curve edit helpers of PathEditPlugin and LineHelper: the editable points of each curve type, moving, adding and
 * removing a point, shared joints of a path, and the shape of a split Bezier.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {
    CatmullRomCurve3,
    CubicBezierCurve3,
    EllipseCurve,
    LineCurve,
    LineCurve3,
    QuadraticBezierCurve3,
    SplineCurve,
    Vector2,
    Vector3,
} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const arr = (p: {x: number, y: number, z?: number}) => [p.x, p.y, p.z ?? 0]
const near = (a: {x: number, y: number, z?: number}, b: number[], d = 1e-6) =>
    expect(arr(a).every((x, i) => Math.abs(x - b[i]) < d)).toBe(true)

/** A path of two cubic Beziers with a shared joint, like PenToolPlugin makes */
function penPath(closed = false) {
    const a = v(0, 0, 0), b = v(2, 0, 0), c = v(4, 0, 0)
    const path = new tp.CurvePath3()
    path.add(new CubicBezierCurve3(a, v(0, 1, 0), v(1, 1, 0), b))
    path.add(new CubicBezierCurve3(b, v(3, -1, 0), v(4, -1, 0), c))
    if (closed) path.add(new CubicBezierCurve3(c, v(4, 2, 0), v(0, 2, 0), a))
    return path
}

/** The same path as loaded from a file: equal joints, not the same vector */
function loadedPath() {
    const path = new tp.CurvePath3()
    path.add(new CubicBezierCurve3(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(2, 0, 0)))
    path.add(new CubicBezierCurve3(v(2, 0, 0), v(3, -1, 0), v(4, -1, 0), v(4, 0, 0)))
    return path
}

describe('getCurveEditPoints', () => {
    test('a line: two anchors', () => {
        const pts = tp.getCurveEditPoints(new LineCurve3(v(0, 0, 0), v(1, 2, 3)))
        expect(pts.map(p => p.keys[0])).toEqual(['v1', 'v2'])
        expect(pts.every(p => p.kind === 'anchor')).toBe(true)
    })

    test('a cubic Bezier: anchors and handles, each handle on its anchor', () => {
        const pts = tp.getCurveEditPoints(new CubicBezierCurve3(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)))
        expect(pts.map(p => p.kind)).toEqual(['anchor', 'control', 'control', 'anchor'])
        expect(pts[1].anchors).toEqual([0])
        expect(pts[2].anchors).toEqual([3])
    })

    test('a quadratic Bezier: the control point pulls on both anchors', () => {
        const pts = tp.getCurveEditPoints(new QuadraticBezierCurve3(v(0, 0, 0), v(1, 1, 0), v(2, 0, 0)))
        expect(pts.map(p => p.kind)).toEqual(['anchor', 'control', 'anchor'])
        expect(pts[1].anchors).toEqual([0, 2])
    })

    test('a spline: each point, the vectors of the curve', () => {
        const curve = new CatmullRomCurve3([v(0, 0, 0), v(1, 1, 0), v(2, 0, 0)])
        const pts = tp.getCurveEditPoints(curve)
        expect(pts.map(p => p.keys[0])).toEqual(['points.0', 'points.1', 'points.2'])
        expect(pts[1].vec).toBe(curve.points[1])
    })

    test('a path: the shared joint is one point with both keys', () => {
        const pts = tp.getCurveEditPoints(penPath())
        expect(pts).toHaveLength(7)
        expect(pts[3].keys).toEqual(['curves.0.v3', 'curves.1.v0'])
        expect(pts.filter(p => p.kind === 'anchor')).toHaveLength(3)
        // the handles around the joint pull on it
        expect(pts[2].anchors).toEqual([3])
        expect(pts[4].anchors).toEqual([3])
    })

    test('a loaded path: equal joints are one point with both vectors', () => {
        const path = loadedPath()
        const pts = tp.getCurveEditPoints(path)
        expect(pts).toHaveLength(7)
        expect(pts[3].vecs).toEqual([path.curves[0].v3, path.curves[1].v0])
    })

    test('a closed path: the end of the last curve is the first point', () => {
        const pts = tp.getCurveEditPoints(penPath(true))
        expect(pts.filter(p => p.kind === 'anchor')).toHaveLength(3)
        expect(pts[0].keys).toEqual(['curves.0.v0', 'curves.2.v3'])
        // the last handle pulls on the first point
        expect(pts[pts.length - 1].anchors).toEqual([0])
    })

    test('a 2D spline and an ellipse', () => {
        expect(tp.getCurveEditPoints(new SplineCurve([new Vector2(0, 0), new Vector2(1, 1)]))).toHaveLength(2)
        expect(tp.getCurveEditPoints(new EllipseCurve(0, 0, 1, 1))).toHaveLength(0)
        expect(tp.canAddCurvePoints(new EllipseCurve(0, 0, 1, 1))).toBe(false)
    })
})

describe('setCurveEditPoint', () => {
    test('a spline point', () => {
        const curve = new CatmullRomCurve3([v(0, 0, 0), v(1, 1, 0), v(2, 0, 0)])
        tp.setCurveEditPoint(curve, 1, v(1, 3, 1))
        near(curve.points[1], [1, 3, 1])
    })

    test('a 2D curve takes x and y', () => {
        const curve = new LineCurve(new Vector2(0, 0), new Vector2(1, 1))
        tp.setCurveEditPoint(curve, 1, v(3, 4, 5))
        expect(curve.v2.toArray()).toEqual([3, 4])
    })

    test('a joint moves both curves, and its handles with it', () => {
        const path = loadedPath()
        tp.setCurveEditPoint(path, 3, v(2, 1, 0))
        near(path.curves[0].v3, [2, 1, 0])
        near(path.curves[1].v0, [2, 1, 0])
        near(path.curves[0].v2, [1, 2, 0])
        near(path.curves[1].v1, [3, 0, 0])
        // the other handles stay
        near(path.curves[0].v1, [0, 1, 0])
        near(path.curves[1].v2, [4, -1, 0])
    })

    test('moveHandles: false moves the anchor only', () => {
        const path = penPath()
        tp.setCurveEditPoint(path, 3, v(2, 1, 0), {moveHandles: false})
        near(path.curves[0].v2, [1, 1, 0])
    })

    test('a smooth point stays smooth when a handle moves; the other handle keeps its length', () => {
        const a = v(0, 0, 0), b = v(2, 0, 0), c = v(4, 0, 0)
        const path = new tp.CurvePath3()
        path.add(new CubicBezierCurve3(a, v(0, 1, 0), v(1, 0, 0), b))
        path.add(new CubicBezierCurve3(b, v(4, 0, 0), v(4, 1, 0), c))
        tp.setCurveEditPoint(path, 2, v(2, -1, 0)) // the handle before the joint, now below it
        near(path.curves[1].v1, [2, 2, 0]) // the other one above it, length 2
    })

    test('a corner stays a corner', () => {
        const b = v(2, 0, 0)
        const path = new tp.CurvePath3()
        path.add(new CubicBezierCurve3(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), b))
        path.add(new CubicBezierCurve3(b, v(3, 1, 0), v(4, 1, 0), v(4, 0, 0)))
        tp.setCurveEditPoint(path, 2, v(1, 2, 0))
        near(path.curves[1].v1, [3, 1, 0])
    })

    test('updates the cached lengths of the curves of a path', () => {
        const path = new tp.CurvePath3()
        const a = v(0, 0, 0), b = v(1, 0, 0), c = v(2, 0, 0)
        path.add(new LineCurve3(a, b))
        path.add(new LineCurve3(b, c))
        expect(path.getLength()).toBeCloseTo(2)
        tp.setCurveEditPoint(path, 2, v(5, 0, 0))
        expect(path.getLength()).toBeCloseTo(5)
        near(path.getPointAt(1), [5, 0, 0])
    })
})

describe('addCurvePoint', () => {
    test('a spline gets a point on it, in the middle of the segment; the curve is not changed', () => {
        const curve = new CatmullRomCurve3([v(0, 0, 0), v(1, 1, 0), v(2, 0, 0)])
        const mid = curve.getPoint(0.25)
        const res = tp.addCurvePoint(curve, 0)!
        expect(curve.points).toHaveLength(3)
        const next = res.curve as CatmullRomCurve3
        expect(next.points).toHaveLength(4)
        expect(res.index).toBe(1)
        near(next.points[1], arr(mid))
        expect(next.points[0]).not.toBe(curve.points[0])
    })

    test('a closed spline has a segment from the last point to the first', () => {
        const curve = new CatmullRomCurve3([v(0, 0, 0), v(1, 1, 0), v(2, 0, 0)], true)
        expect(tp.getCurveSegments(curve)).toHaveLength(3)
        const res = tp.addCurvePoint(curve, 2)!
        expect((res.curve as CatmullRomCurve3).points).toHaveLength(4)
        expect(res.index).toBe(3)
    })

    test('a line becomes a path of two straight lines', () => {
        const res = tp.addCurvePoint(new LineCurve3(v(0, 0, 0), v(2, 0, 0)), 0)!
        const path = res.curve as InstanceType<typeof tp.CurvePath3>
        expect(path.type).toBe('CurvePath3')
        expect(path.curves).toHaveLength(2)
        expect(path.curves[0]).toBeInstanceOf(LineCurve3)
        expect((path.curves[0] as LineCurve3).v2).toBe((path.curves[1] as LineCurve3).v1)
        expect(res.index).toBe(1)
        near(tp.getCurveEditPoints(path)[1].vec, [1, 0, 0])
    })

    test('a cubic Bezier split keeps the shape and shares the new joint', () => {
        const curve = new CubicBezierCurve3(v(0, 0, 0), v(0, 2, 0), v(3, 2, 1), v(3, 0, 0))
        const res = tp.addCurvePoint(curve, 0)!
        const path = res.curve as InstanceType<typeof tp.CurvePath3>
        const [c0, c1] = path.curves as CubicBezierCurve3[]
        expect(c0.v3).toBe(c1.v0)
        expect(res.index).toBe(3)
        for (let i = 0; i <= 10; i++) {
            const t = i / 10
            near(c0.getPoint(t), arr(curve.getPoint(t / 2)), 1e-9)
            near(c1.getPoint(t), arr(curve.getPoint(0.5 + t / 2)), 1e-9)
        }
    })

    test('a quadratic Bezier split keeps the shape', () => {
        const curve = new QuadraticBezierCurve3(v(0, 0, 0), v(1, 2, 0), v(2, 0, 0))
        const path = tp.addCurvePoint(curve, 0)!.curve as InstanceType<typeof tp.CurvePath3>
        const [c0, c1] = path.curves
        near(c0.getPoint(0.3), arr(curve.getPoint(0.15)), 1e-9)
        near(c1.getPoint(0.3), arr(curve.getPoint(0.65)), 1e-9)
    })

    test('a path: the segment is split in place, all the joints stay shared', () => {
        const path = penPath(true)
        const res = tp.addCurvePoint(path, 1)!
        const next = res.curve as InstanceType<typeof tp.CurvePath3>
        expect(path.curves).toHaveLength(3)
        expect(next.curves).toHaveLength(4)
        const cs = next.curves as CubicBezierCurve3[]
        for (let i = 0; i < cs.length; i++) expect(cs[i].v3).toBe(cs[(i + 1) % cs.length].v0)
        expect(tp.getCurveEditPoints(next).filter(p => p.kind === 'anchor')).toHaveLength(4)
        expect(tp.getCurveEditPoints(next)[res.index].keys).toEqual(['curves.1.v3', 'curves.2.v0'])
        // the copy shares no vector with the old path
        expect(cs[0].v0).not.toBe((path.curves[0] as CubicBezierCurve3).v0)
    })

    test('segment midpoints and a segment that does not exist', () => {
        const segs = tp.getCurveSegments(penPath())
        expect(segs.map(s => [s.from, s.to])).toEqual([[0, 3], [3, 6]])
        near(segs[0].mid, arr(penPath().curves[0].getPoint(0.5)))
        expect(tp.addCurvePoint(penPath(), 5)).toBeNull()
    })
})

describe('removeCurvePoint', () => {
    test('a spline point; a spline keeps 2 points, a closed one 3', () => {
        const curve = new CatmullRomCurve3([v(0, 0, 0), v(1, 1, 0), v(2, 0, 0)])
        const next = tp.removeCurvePoint(curve, 1) as CatmullRomCurve3
        expect(next.points.map(arr)).toEqual([[0, 0, 0], [2, 0, 0]])
        expect(curve.points).toHaveLength(3)
        expect(tp.removeCurvePoint(next, 0)).toBeNull()
        expect(tp.removeCurvePoint(new CatmullRomCurve3([v(0, 0, 0), v(1, 1, 0), v(2, 0, 0)], true), 0)).toBeNull()
    })

    test('a line keeps its two points', () => {
        expect(tp.removeCurvePoint(new LineCurve3(v(0, 0, 0), v(1, 0, 0)), 0)).toBeNull()
        expect(tp.removeCurvePoint(new CubicBezierCurve3(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), 3)).toBeNull()
    })

    test('a joint joins its two curves, with their outer handles', () => {
        const next = tp.removeCurvePoint(penPath(), 3) as InstanceType<typeof tp.CurvePath3>
        expect(next.curves).toHaveLength(1)
        const c = next.curves[0] as CubicBezierCurve3
        expect([c.v0, c.v1, c.v2, c.v3].map(arr)).toEqual([[0, 0, 0], [0, 1, 0], [4, -1, 0], [4, 0, 0]])
    })

    test('two lines join in one line', () => {
        const path = tp.addCurvePoint(new LineCurve3(v(0, 0, 0), v(2, 0, 0)), 0)!.curve
        const next = tp.removeCurvePoint(path, 1) as InstanceType<typeof tp.CurvePath3>
        expect(next.curves).toHaveLength(1)
        expect(next.curves[0]).toBeInstanceOf(LineCurve3)
    })

    test('the first or the last anchor of an open path removes its curve', () => {
        const path = tp.addCurvePoint(penPath(), 0)!.curve // 3 curves
        const first = tp.removeCurvePoint(path, 0) as InstanceType<typeof tp.CurvePath3>
        expect(first.curves).toHaveLength(2)
        const pts = tp.getCurveEditPoints(path)
        const last = tp.removeCurvePoint(path, pts.length - 1) as InstanceType<typeof tp.CurvePath3>
        expect(last.curves).toHaveLength(2)
        near(tp.getCurveEditPoints(last).at(-1)!.vec, arr(pts.at(-4)!.vec))
    })

    test('a closed path: the first point joins the last and the first curve, joints stay shared', () => {
        const next = tp.removeCurvePoint(penPath(true), 0) as InstanceType<typeof tp.CurvePath3>
        const cs = next.curves as CubicBezierCurve3[]
        expect(cs).toHaveLength(2)
        for (let i = 0; i < cs.length; i++) expect(cs[i].v3).toBe(cs[(i + 1) % cs.length].v0)
        // a closed path of 2 points keeps them
        expect(tp.removeCurvePoint(next, 0)).toBeNull()
    })

    test('a handle goes back to its anchor', () => {
        const next = tp.removeCurvePoint(penPath(), 1) as InstanceType<typeof tp.CurvePath3>
        near((next.curves[0] as CubicBezierCurve3).v1, [0, 0, 0])
        expect(next.curves).toHaveLength(2)
    })
})

test('a 2D Path of lines: points, add and remove keep a Path of 2D lines', () => {
    const path = new tp.Path().moveTo(0, 0).lineTo(2, 0).lineTo(2, 2)
    expect(tp.getCurveEditPoints(path).map(p => p.vec.toArray())).toEqual([[0, 0], [2, 0], [2, 2]])
    const added = tp.addCurvePoint(path, 1)!
    expect(added.curve).toBeInstanceOf(tp.Path)
    expect(tp.getCurveEditPoints(added.curve)[added.index].vec.toArray()).toEqual([2, 1])
    const removed = tp.removeCurvePoint(added.curve, 1) as InstanceType<typeof tp.Path>
    expect(removed.curves).toHaveLength(2)
    expect(removed.curves[0]).toBeInstanceOf(LineCurve)
    expect(tp.getCurveEditPoints(removed).map(p => p.vec.toArray())).toEqual([[0, 0], [2, 1], [2, 2]])
})

test('cloneCurve keeps shared vectors shared', () => {
    const path = penPath()
    const copy = tp.cloneCurve(path)
    const [c0, c1] = copy.curves as CubicBezierCurve3[]
    expect(c0.v3).toBe(c1.v0)
    expect(c0.v3).not.toBe((path.curves[0] as CubicBezierCurve3).v3)
    expect(copy.type).toBe('CurvePath3')
})
