/**
 * Parity cases for Subdivide Curve (every curve type, per-point cuts, Bezier handle types, one-point curves) and the
 * curve primitives Arc (radius and points modes), Spiral, Star, Quadrilateral (every mode) and Quadratic Bézier.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {Extra, meshCase, mod, store} from './meshCommon'
import {ParityCase} from './types'
import {mixed, storeInt8, typed} from './curvesQuery'

const index = () => n.Index().index

/** One point holding a vector / float output of a primitive. */
const outputs = (values: [string, Socket<'VECTOR'> | Socket<'FLOAT'>][]) => {
    let g: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
    for (const [name, v] of values) g = store(g, 'POINT', name, v)
    return g
}

export function curvesGenerateCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    const join = (parts: Socket<'GEOMETRY'>[]) => n.JoinGeometry({geometry: parts}).geometry
    const at = (g: Socket<'GEOMETRY'>, x: number, y = 0) => n.TransformGeometry({geometry: g, translation: [x, y, 0]}).geometry

    // region Subdivide Curve
    add('subdivide-curve-field', 'Subdivide Curve of every curve type with per-point cuts (0, negative, up to 3) and attributes', {}, () =>
        n.SubdivideCurve({curve: mixed(), cuts: mod(index(), 5).sub(1)}).curve)
    add('subdivide-curve-single', 'Subdivide Curve with a single cut count of 3, then evaluated (Curve to Mesh)', {}, () => {
        const s = n.SubdivideCurve({curve: mixed(), cuts: 3}).curve
        return join([s, n.CurveToMesh({curve: s}).mesh])
    })
    add('subdivide-curve-zero', 'Subdivide Curve with 0 cuts (unchanged)', {}, () => n.SubdivideCurve({curve: mixed(), cuts: 0}).curve)
    add('subdivide-curve-bezier', 'Subdivide Curve of open and cyclic Bezier curves with every handle type pair (vector segments stay linear)', {}, () => {
        let g = join([n.BezierSegment({resolution: 4}).curve, at(n.BezierSegment({resolution: 3, mode: 'OFFSET'}).curve, 0, 2),
            at(n.BezierSegment({resolution: 5, start: [0, 0, 0], startHandle: [0.5, 1, 0], endHandle: [1.5, 1, 0.3], end: [2, 0, 0]}).curve, 0, 4)])
        g = storeInt8(g, 'POINT', 'handle_type_left', mod(index(), 4))
        g = storeInt8(g, 'POINT', 'handle_type_right', mod(index().mul(3).add(1), 4))
        g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'cyclic', value: index().eq(1)}).geometry
        g = store(g, 'POINT', 'pf', index().mul(1.5))
        const s = n.SubdivideCurve({curve: g, cuts: mod(index(), 3).add(1)}).curve
        return join([s, n.CurveToMesh({curve: s}).mesh])
    })
    add('subdivide-curve-one-point', 'Subdivide Curve of one-point curves (from Resample Curve count 1), open and cyclic', {}, () => {
        const one = n.ResampleCurve({curve: join([typed(1, false, 1), typed(0, true, 2, [3, 0, 0])]), count: 1}).curve
        return n.SubdivideCurve({curve: one, cuts: 2}).curve
    })
    // endregion

    // region primitives
    add('arc-radius', 'Arc (radius mode): sweeps, start angles, connect center, invert arc, resolution clamped to 2', {}, () => join([
        n.Arc({}).curve,
        at(n.Arc({resolution: 7, radius: 1.5, startAngle: 0.4, sweepAngle: 2.2, connectCenter: true}).curve, 4),
        at(n.Arc({resolution: 9, radius: 0.8, startAngle: -1, sweepAngle: -4, invertArc: true}).curve, 8),
        at(n.Arc({resolution: 1, radius: 2, sweepAngle: 6.2831}).curve, 12),
    ]))
    const arcPoints = (id: string, description: string, args: Parameters<typeof n.Arc>[0]) => add(id, description, {}, () => {
        const a = n.Arc({mode: 'POINTS', ...args})
        return join([a.curve, outputs([['center', a.center], ['normal', a.normal], ['radius', a.radius]])])
    })
    arcPoints('arc-points', 'Arc (points mode) through three points, with Center / Normal / Radius', {resolution: 12, start: [-1, 0.2, 0.1], middle: [0.3, 1.8, -0.2], end: [1.4, -0.1, 0.3]})
    arcPoints('arc-points-invert-offset', 'Arc (points mode) inverted, offset angle, connect center', {resolution: 10, start: [0, 0, 0], middle: [1, 1.5, 0], end: [2, 0, 0.5],
        offsetAngle: 0.3, invertArc: true, connectCenter: true})
    arcPoints('arc-points-flipped-normal', 'Arc (points mode) clockwise in the XY plane (normal flipped to Z up)', {resolution: 8, start: [1, 0, 0], middle: [0, 1, 0], end: [-1, 0, 0]})
    arcPoints('arc-points-colinear', 'Arc (points mode) through nearly colinear points (normalised directions differ by an ulp: no plane intersection, no curve)',
        {resolution: 6, start: [0, 0, 0], middle: [3, 3, 3], end: [1, 1, 1]})
    arcPoints('arc-points-colinear-axis', 'Arc (points mode) through exactly colinear points: a line between the furthest two', {resolution: 6, start: [0, 0, 0], middle: [2, 0, 0], end: [1, 0, 0]})
    arcPoints('arc-points-coincident', 'Arc (points mode) with two equal points and resolution 2', {resolution: 2, start: [0, 0, 0], middle: [0, 0, 0], end: [1, 2, 0]})
    add('spiral', 'Spiral: default, fractional rotations, reversed, shrinking radius, negative height, zero rotations', {}, () => join([
        n.Spiral({}).curve,
        at(n.Spiral({resolution: 7, rotations: 1.3, startRadius: 2, endRadius: 0.5, height: -1, reverse: true}).curve, 6),
        at(n.Spiral({resolution: 3, rotations: 0.2}).curve, 12),
        at(n.Spiral({rotations: 0}).curve, 18),
    ]))
    add('star', 'Star: points, radii and twist, with the Outer Points selection', {}, () => {
        const a = n.Star({})
        const b = n.Star({points: 5, innerRadius: 0.4, outerRadius: 1.3, twist: 0.7})
        return join([store(a.curve, 'POINT', 'outer', a.outerPoints), at(store(b.curve, 'POINT', 'outer', b.outerPoints), 5), at(n.Star({points: 2}).curve, 10)])
    })
    add('quadrilateral', 'Quadrilateral in every mode', {}, () => join([
        n.Quadrilateral({width: 3, height: 1.5}).curve,
        at(n.Quadrilateral({mode: 'PARALLELOGRAM', width: 2.5, height: 1.2, offset: 0.7}).curve, 4),
        at(n.Quadrilateral({mode: 'TRAPEZOID', bottomWidth: 3.3, topWidth: 1.1, offset: -0.4, height: 2.1}).curve, 8),
        at(n.Quadrilateral({mode: 'KITE', width: 1.7, bottomHeight: 2.3, topHeight: 0.9}).curve, 12),
        at(n.Quadrilateral({mode: 'POINTS', point1: [0, 0, 0.3], point2: [1.2, -0.1, 0], point3: [1.5, 1, 0.2], point4: [-0.2, 1.3, 0]}).curve, 16),
        at(n.Quadrilateral({width: -1, height: -2}).curve, 20),
    ]))
    add('quadratic-bezier', 'Quadratic Bézier: default, resolution clamped to 3, 3D points', {}, () => join([
        n.QuadraticBezier({}).curve,
        at(n.QuadraticBezier({resolution: 1}).curve, 3),
        at(n.QuadraticBezier({resolution: 23, start: [0, 0, 0], middle: [1.3, 2.1, 0.7], end: [2.5, -0.4, -0.3]}).curve, 6),
    ]))
    // endregion
    return cases
}
