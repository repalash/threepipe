/**
 * Parity cases for Fill Curve (constrained Delaunay triangulation, `delaunay_2d.cc`): triangles and n-gons, even-odd and
 * non-zero fill rules, holes, overlapping and self-intersecting curves, coincident and colinear points, evaluated
 * Bezier / NURBS curves and group IDs.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {Extra, meshCase, mod} from './meshCommon'
import {ParityCase} from './types'
import {storeInt8, typed} from './curvesQuery'

const index = () => n.Index().index

export function curvesFillCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    const join = (parts: Socket<'GEOMETRY'>[]) => n.JoinGeometry({geometry: parts}).geometry
    const at = (g: Socket<'GEOMETRY'>, x: number, y = 0) => n.TransformGeometry({geometry: g, translation: [x, y, 0]}).geometry
    const reversed = (g: Socket<'GEOMETRY'>) => n.ReverseCurve({curve: g}).curve
    const circle = (r: number, res = 16) => n.CurveCircle({resolution: res, radius: r}).curve
    /** A square with a hole, an overlapping pair with the same winding, one with opposite winding, and a self-crossing bow tie. */
    const shapes = () => join([
        join([circle(2), circle(1, 9)]),
        at(join([circle(1.5, 12), at(circle(1.5, 12), 1.2, 0.3)]), 6),
        at(join([circle(1.5, 12), at(reversed(circle(1.5, 12)), 1.2, 0.3)]), 12),
        at(n.Quadrilateral({mode: 'POINTS', point1: [0, 0, 0], point2: [2, 2, 0], point3: [2, 0, 0], point4: [0, 2, 0]}).curve, 18),
        at(n.Star({points: 7, innerRadius: 0.6, outerRadius: 2, twist: 0.3}).curve, 0, 6),
        at(n.Spiral({resolution: 10, rotations: 1.6, startRadius: 0.4, endRadius: 2, height: 0}).curve, 6, 6),
    ])
    for (const mode of ['Triangles', 'N-gons'] as const) {
        for (const fillRule of ['Even-Odd', 'Non-Zero'] as const) {
            add(`fill-${mode.toLowerCase()}-${fillRule.toLowerCase()}`, `Fill Curve (${mode}, ${fillRule}): holes, overlaps with equal and opposite winding, self-crossing, concave, spiral`,
                {}, () => n.FillCurve({curve: shapes(), mode, fillRule}).mesh)
        }
    }
    add('fill-groups', 'Fill Curve with a Group ID field (curves filled separately per group, in order of first appearance)', {}, () =>
        n.FillCurve({curve: shapes(), groupID: mod(index().mul(5), 3)}).mesh)
    add('fill-evaluated', 'Fill Curve of evaluated Bezier, NURBS and Catmull Rom curves (cyclic or not, all treated as closed)', {}, () => {
        const bez = n.BezierSegment({resolution: 12, start: [-1, 0, 0], startHandle: [-1, 2, 0], endHandle: [1, -2, 0], end: [1, 0, 0]}).curve
        const nurbs = storeInt8(storeInt8(typed(3, true, 6, [4, 0, 0]), 'CURVE', 'nurbs_order', 3), 'CURVE', 'knots_mode', 0)
        return n.FillCurve({curve: join([bez, nurbs, at(typed(0, true, 4), 8), at(typed(0, false, 5), 12)]), mode: 'N-gons'}).mesh
    })
    add('fill-degenerate', 'Fill Curve of coincident points, colinear points, a two-point and a one-point curve, and touching squares', {}, () => {
        const sq = () => n.Quadrilateral({width: 1, height: 1}).curve
        const dup = n.Quadrilateral({mode: 'POINTS', point1: [0, 0, 0], point2: [1, 0, 0], point3: [1, 0, 0], point4: [0, 1, 0]}).curve
        const colinear = n.Quadrilateral({mode: 'POINTS', point1: [3, 0, 0], point2: [4, 0, 0], point3: [5, 0, 0], point4: [4, 1, 0]}).curve
        const line = at(n.CurveLine({start: [0, 0, 0], end: [1, 1, 0]}).curve, 7)
        const one = n.ResampleCurve({curve: at(n.CurveLine().curve, 9), count: 1}).curve
        return n.FillCurve({curve: join([dup, colinear, line, one, at(sq(), 0, 3), at(sq(), 1, 3), at(sq(), 0.5, 3.5)])}).mesh
    })
    add('fill-dense-circles', 'Fill Curve of many overlapping circles (many constraint crossings)', {}, () => {
        const parts: Socket<'GEOMETRY'>[] = []
        for (let i = 0; i < 6; i++) parts.push(at(circle(1 + i * 0.13, 20 + i), Math.cos(i) * 0.7, Math.sin(i * 1.3) * 0.6))
        return join([n.FillCurve({curve: join(parts)}).mesh, at(n.FillCurve({curve: join(parts), fillRule: 'Non-Zero', mode: 'N-gons'}).mesh, 5)])
    })
    add('fill-no-curves', 'Fill Curve of a mesh and an empty curve set (mesh kept)', {}, () =>
        n.FillCurve({curve: join([n.MeshCube().mesh, n.DeleteGeometry({geometry: circle(1), selection: true}).geometry])}).mesh)
    return cases
}
