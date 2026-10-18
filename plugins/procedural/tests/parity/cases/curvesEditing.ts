/**
 * Parity cases for the curve type / handle / NURBS nodes: Set Spline Type (every source and target type, knots modes),
 * Set Handle Type, Handle Type Selection, Curve Handle Positions, Set Handle Positions, Points to Curves, Set Curve
 * Normal, Set NURBS Order and Set NURBS Weight. Results are also evaluated (Curve to Mesh) to compare shapes.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {Extra, meshCase, mod, store} from './meshCommon'
import {ParityCase} from './types'
import {mixed, storeInt8, typed} from './curvesQuery'

const index = () => n.Index().index

export function curvesEditingCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    const join = (parts: Socket<'GEOMETRY'>[]) => n.JoinGeometry({geometry: parts}).geometry
    const at = (g: Socket<'GEOMETRY'>, x: number, y = 0) => n.TransformGeometry({geometry: g, translation: [x, y, 0]}).geometry
    const withMesh = (g: Socket<'GEOMETRY'>) => join([g, n.CurveToMesh({curve: g}).mesh])
    const attrs = (g: Socket<'GEOMETRY'>) => store(store(g, 'POINT', 'pf', index().mul(0.5)), 'CURVE', 'cf', index().mul(2))
    /** Bezier curves (open and cyclic) with every handle type. */
    const beziers = () => {
        let g = join([n.BezierSegment({resolution: 4}).curve, at(n.BezierSegment({resolution: 3, mode: 'OFFSET'}).curve, 0, 2),
            at(n.BezierSegment({resolution: 5, start: [0, 0, 0], startHandle: [0.5, 1, 0], endHandle: [1.5, 1, 0.3], end: [2, 0, 0]}).curve, 0, 4)])
        g = storeInt8(g, 'POINT', 'handle_type_left', mod(index(), 4))
        g = storeInt8(g, 'POINT', 'handle_type_right', mod(index().mul(3).add(1), 4))
        return n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'cyclic', value: index().eq(1)}).geometry
    }

    // region Set Spline Type
    for (const type of ['CATMULL_ROM', 'POLY', 'BEZIER', 'NURBS'] as const) {
        add(`set-spline-type-${type.toLowerCase()}`, `Set Spline Type to ${type} of every curve type with a selection (a NURBS curve stays)`, {}, () =>
            withMesh(n.SetSplineType({curve: attrs(mixed()), splineType: type, selection: mod(index(), 3).eq(2).not()}).curve))
    }
    add('set-spline-type-bezier-all', 'Set Spline Type to Bezier of Catmull Rom (open, cyclic, 1 and 2 points) and poly curves, all selected', {}, () => {
        const short = n.ResampleCurve({curve: typed(0, false, 3, [0, 5, 0]), count: 2}).curve
        const one = n.ResampleCurve({curve: typed(1, false, 1, [3, 5, 0]), count: 1}).curve
        return withMesh(n.SetSplineType({curve: attrs(join([typed(0, false, 4), typed(0, true, 3, [3, 0, 0]), typed(1, true, 1, [6, 0, 0]), short, one])), splineType: 'BEZIER'}).curve)
    })
    add('set-spline-type-nurbs-to-bezier', 'Set Spline Type to Bezier of NURBS curves in every knots mode, open and cyclic, 2 to 7 points', {}, () => {
        const parts: Socket<'GEOMETRY'>[] = []
        let x = 0
        for (const knots of [0, 1, 2, 3]) {
            for (const cyclic of [false, true]) {
                for (const count of [2, 3, 4, 5, 7]) {
                    let g = n.ResampleCurve({curve: typed(1, cyclic, 1), count}).curve
                    g = storeInt8(g, 'CURVE', 'curve_type', 3)
                    g = storeInt8(storeInt8(g, 'CURVE', 'knots_mode', knots), 'CURVE', 'nurbs_order', 3)
                    parts.push(at(g, x, knots * 3 + (cyclic ? 1.5 : 0)))
                    x += 3
                }
            }
        }
        return n.SetSplineType({curve: attrs(join(parts)), splineType: 'BEZIER'}).curve
    })
    add('set-spline-type-nurbs-all', 'Set Spline Type to NURBS of Bezier and Catmull Rom curves without NURBS weights, then evaluated', {}, () =>
        withMesh(n.SetSplineType({curve: join([beziers(), at(typed(0, true, 3), 4)]), splineType: 'NURBS'}).curve))
    // endregion

    // region handles
    add('set-handle-type', 'Set Handle Type: AUTO both sides, VECTOR left with a selection, ALIGN right, FREE; evaluated', {}, () => {
        let g = beziers()
        g = n.SetHandleType({curve: g, handleType: 'AUTO', selection: index().lt(2)}).curve
        g = n.SetHandleType({curve: g, handleType: 'VECTOR', mode: 'LEFT', selection: mod(index(), 2).eq(1)}).curve
        g = n.SetHandleType({curve: g, handleType: 'ALIGN', mode: 'RIGHT', selection: index().gt(3)}).curve
        g = n.SetHandleType({curve: g, handleType: 'FREE', selection: index().eq(5)}).curve
        return withMesh(g)
    })
    add('set-handle-type-no-bezier', 'Set Handle Type on poly curves (no handle types: unchanged)', {}, () =>
        n.SetHandleType({curve: typed(1, false, 1), handleType: 'VECTOR'}).curve)
    add('handle-type-selection', 'Handle Type Selection for every type, left / right / both, on Bezier and other curves', {}, () => {
        let g = join([beziers(), at(typed(0, false, 3), 5)])
        for (const t of ['FREE', 'AUTO', 'VECTOR', 'ALIGN'] as const) {
            g = store(g, 'POINT', `sel_${t.toLowerCase()}`, n.HandleTypeSelection({handleType: t}).selection)
            g = store(g, 'POINT', `sel_${t.toLowerCase()}_l`, n.HandleTypeSelection({handleType: t, mode: 'LEFT'}).selection)
            g = store(g, 'POINT', `sel_${t.toLowerCase()}_r`, n.HandleTypeSelection({handleType: t, mode: 'RIGHT'}).selection)
        }
        return g
    })
    add('curve-handle-positions', 'Curve Handle Positions absolute, relative, a relative field, on points and curves, and without handles', {}, () => {
        let g = join([beziers(), at(typed(1, false, 1), 5)])
        const abs = n.CurveHandlePositions({}), rel = n.CurveHandlePositions({relative: true}), mix = n.CurveHandlePositions({relative: mod(index(), 2).eq(0)})
        g = store(store(g, 'POINT', 'l', abs.left), 'POINT', 'r', abs.right)
        g = store(store(g, 'POINT', 'rl', rel.left), 'POINT', 'rr', rel.right)
        g = store(store(g, 'POINT', 'ml', mix.left), 'POINT', 'mr', mix.right)
        return store(g, 'CURVE', 'cl', abs.left)
    })
    for (const mode of ['LEFT', 'RIGHT'] as const) {
        add(`set-handle-positions-${mode.toLowerCase()}`, `Set Handle Positions (${mode}): position field and offset on every handle type, selection; evaluated`, {}, () => {
            const g = n.SetHandlePositions({curve: beziers(), mode, selection: index().eq(4).not(),
                position: n.CombineXYZ({x: index().mul(0.3), y: 1, z: mod(index(), 3).mul(0.2)}).vector, offset: [0.1, -0.2, 0.05]}).curve
            return withMesh(g)
        })
    }
    add('set-handle-positions-offset-only', 'Set Handle Positions (LEFT) with the implicit handle position and an offset', {}, () =>
        withMesh(n.SetHandlePositions({curve: beziers(), offset: n.CombineXYZ({x: 0.2, z: index().mul(0.1)}).vector}).curve))
    // endregion

    // region Points to Curves
    const pointsIn = (count: number) => {
        let g = n.Points({count, position: n.CombineXYZ({x: index().mul(0.4), y: mod(index(), 3), z: index().mul(-0.1)}).vector, radius: index().mul(0.01)}).geometry
        return store(g, 'POINT', 'pf', index().mul(1.5))
    }
    add('points-to-curves-groups', 'Points to Curves with group IDs (first appearance order) and weights', {}, () =>
        n.PointsToCurves({points: pointsIn(20), curveGroupID: mod(index().mul(7), 4), weight: mod(index().mul(5), 7)}).curves)
    add('points-to-curves-groups-no-weight', 'Points to Curves with group IDs and no weight (index order)', {}, () =>
        n.PointsToCurves({points: pointsIn(20), curveGroupID: mod(index(), 3).sub(1)}).curves)
    add('points-to-curves-single', 'Points to Curves with one group (single and a field of one value), weight sorting with ties', {}, () => join([
        n.PointsToCurves({points: pointsIn(10)}).curves,
        at(n.PointsToCurves({points: pointsIn(10), curveGroupID: index().mul(0), weight: mod(index(), 3)}).curves, 5),
    ]))
    add('points-to-curves-mesh', 'Points to Curves of a mesh (removed) and of no points', {}, () =>
        n.PointsToCurves({points: n.MeshCube().mesh}).curves)
    // endregion

    // region Set Curve Normal, NURBS order / weight
    for (const mode of ['Minimum Twist', 'Z Up', 'Free'] as const) {
        add(`set-curve-normal-${mode.toLowerCase().replace(' ', '-')}`, `Set Curve Normal (${mode}) with a selection, read back with Normal`, {}, () => {
            let g = n.SetCurveNormal({curve: mixed(), mode, selection: mod(index(), 2).eq(0),
                normal: n.CombineXYZ({x: index(), y: 1, z: mod(index(), 2)}).vector}).curve
            g = store(g, 'POINT', 'nor', n.Normal().normal)
            // Joining curves with custom normals needs transform_normals (not ported): drop them after reading.
            return mode === 'Free' ? n.RemoveNamedAttribute({geometry: g, name: 'custom_normal'}).geometry : g
        })
    }
    add('set-nurbs-order-weight', 'Set NURBS Order (field, clamped to int8 and at least 1) and Set NURBS Weight (negative clamped), evaluated', {}, () => {
        let g = mixed()
        g = n.SetNURBSOrder({curves: g, order: mod(index(), 4).add(2), selection: index().eq(5).not()}).curves
        g = n.SetNURBSWeight({curves: g, weight: mod(index(), 5).sub(1).mul(0.6), selection: index().gt(2)}).curves
        return withMesh(g)
    })
    add('set-nurbs-order-extremes', 'Set NURBS Order of 1 and 300 (validated / int8-converted) and NURBS on poly-only curves (unchanged)', {}, () => join([
        n.SetNURBSOrder({curves: storeInt8(typed(3, false, 3), 'CURVE', 'curve_type', 3), order: 300}).curves,
        at(n.SetNURBSOrder({curves: storeInt8(typed(3, false, 3), 'CURVE', 'curve_type', 3), order: 1}).curves, 4),
        at(n.SetNURBSWeight({curves: typed(1, false, 1), weight: 3}).curves, 8),
    ]))
    // endregion
    return cases
}
