/**
 * Parity cases for Fillet Curve (Bézier and poly modes, count and radius fields, limit radius, every curve type) and
 * Interpolate Curves (groups, up vectors, direct and length-sampled interpolation, point / curve attributes, closest
 * index and weight outputs).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {Extra, meshCase, mod, store} from './meshCommon'
import {ParityCase} from './types'
import {mixed} from './curvesQuery'

const index = () => n.Index().index

export function curvesFilletCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    const join = (parts: Socket<'GEOMETRY'>[]) => n.JoinGeometry({geometry: parts}).geometry
    const at = (g: Socket<'GEOMETRY'>, x: number, y = 0, z = 0) => n.TransformGeometry({geometry: g, translation: [x, y, z]}).geometry
    /** Polylines: a cyclic star, an open zig-zag, a cyclic quad, with a point attribute. */
    const polys = () => store(join([
        n.Star({points: 5, innerRadius: 0.8, outerRadius: 2}).curve,
        at(n.ResampleCurve({curve: n.CurveLine({start: [0, 0, 0], end: [4, 0, 1]}).curve, count: 6}).curve, 5),
        at(n.Quadrilateral({mode: 'POINTS', point1: [0, 0, 0], point2: [2, 0.2, 0], point3: [2.2, 2, 0.5], point4: [-0.1, 1.8, 0]}).curve, 0, 5),
    ]), 'POINT', 'pf', index().mul(1.5))
    for (const mode of ['Bézier', 'Poly'] as const) {
        for (const limitRadius of [false, true]) {
            const m = mode === 'Poly' ? 'poly' : 'bezier'
            add(`fillet-${m}${limitRadius ? '-limit' : ''}`, `Fillet Curve (${mode}${limitRadius ? ', limit radius' : ''}) of polylines with a radius field (0 on some points)${mode === 'Poly' ? ' and a count field' : ''}`,
                {}, () => n.FilletCurve({curve: polys(), mode, limitRadius, radius: mod(index(), 4).mul(0.3), ...(mode === 'Poly' ? {count: mod(index(), 3).add(1)} : {})}).curve)
        }
    }
    add('fillet-mixed-types', 'Fillet Curve (Poly) of every curve type including Bézier curves with handles, evaluated', {}, () => {
        const f = n.FilletCurve({curve: mixed(), mode: 'Poly', radius: 0.2, count: 2}).curve
        return join([f, n.CurveToMesh({curve: f}).mesh])
    })
    add('fillet-bezier-handles', 'Fillet Curve (Bézier) of Bézier curves (handle types kept where unfilleted), large radius limited, evaluated', {}, () => {
        let g = join([n.BezierSegment({resolution: 6}).curve, at(n.Quadrilateral({width: 2, height: 1}).curve, 0, 3)])
        g = n.SetSplineType({curve: g, splineType: 'BEZIER'}).curve
        const f = n.FilletCurve({curve: g, radius: 3, limitRadius: true}).curve
        return join([f, n.CurveToMesh({curve: f}).mesh])
    })

    // region Interpolate Curves
    /** Guides: two groups - group 0 lines of 5 points, group 1 curves of 3, 4 and 6 points; attributes on both domains. */
    const guides = () => {
        const line = (x: number, y: number, count: number, h: number) =>
            n.ResampleCurve({curve: n.CurveLine({start: [x, y, 0], end: [x + 0.3, y - 0.2, h]}).curve, count}).curve
        let g = join([line(0, 0, 5, 1), line(1, 0, 5, 1.5), line(0, 1, 5, 0.7), line(1.2, 1.1, 5, 2),
            line(4, 0, 3, 1), line(5, 0.5, 4, 2), line(4.5, 1.5, 6, 1.5), n.ResampleCurve({curve: at(n.CurveLine().curve, 6, 2), count: 1}).curve])
        g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'INT', name: 'group', value: index().gt(3)}).geometry
        g = store(g, 'POINT', 'gp', n.CombineXYZ({x: index(), y: index().mul(0.5), z: 1}).vector)
        g = store(g, 'CURVE', 'gc', index().mul(2.5))
        g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', name: 'radius', value: index().mul(0.1).add(0.05)}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', name: 'tilt', value: index().mul(0.2)}).geometry
        return n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'cyclic', value: index().eq(2)}).geometry
    }
    const groupOf = () => n.NamedAttribute({name: 'group', dataType: 'INT'}).attribute as Socket<'INT'>
    const childPoints = (count: number) => store(n.Points({count,
        position: n.CombineXYZ({x: mod(index().mul(1.7), 6), y: mod(index().mul(0.9), 2.5), z: 0.1}).vector}).geometry, 'POINT', 'cp', index().mul(3))
    for (const maxNeighbors of [1, 2, 4]) {
        add(`interpolate-curves-n${maxNeighbors}`, `Interpolate Curves with ${maxNeighbors} neighbours, guide and point groups, attributes, Closest Index / Weight`, {}, () => {
            const r = n.InterpolateCurves({guideCurves: guides(), guideGroupID: groupOf(), points: childPoints(16), pointGroupID: mod(index(), 3), maxNeighbors})
            return store(store(r.curves, 'CURVE', 'ci', r.closestIndex), 'CURVE', 'cw', r.closestWeight)
        })
    }
    add('interpolate-curves-up', 'Interpolate Curves with guide and point up vectors (rotated relative positions)', {}, () => {
        const r = n.InterpolateCurves({guideCurves: guides(), guideUp: n.CombineXYZ({x: index().mul(0.2), y: 0.3, z: 1}).vector,
            points: childPoints(10), pointUp: n.CombineXYZ({x: 0.5, y: index().mul(-0.3), z: 1}).vector, maxNeighbors: 3})
        return r.curves
    })
    add('interpolate-curves-mesh', 'Interpolate Curves on the vertices of a mesh (grid) with no groups', {}, () =>
        n.InterpolateCurves({guideCurves: guides(), points: n.MeshGrid({sizeX: 5, sizeY: 2, verticesX: 4, verticesY: 3}).mesh}).curves)
    add('interpolate-curves-no-guides-in-group', 'Interpolate Curves with point groups that have no guides (single-point children)', {}, () =>
        n.InterpolateCurves({guideCurves: guides(), guideGroupID: groupOf(), points: childPoints(8), pointGroupID: mod(index(), 4).add(1)}).curves)
    // endregion
    return cases
}
