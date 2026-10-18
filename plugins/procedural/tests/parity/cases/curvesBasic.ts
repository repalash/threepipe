/**
 * Parity cases for the curve basics: Mesh to Curve, Curve to Mesh (wire and swept, caps, scale), Spline Length,
 * Endpoint Selection, the Curve Line / Curve Circle / Bézier Segment primitives, and curve evaluation of every curve
 * type (Catmull Rom, poly, Bézier, NURBS knot modes), tilt and normal modes - read through Curve to Mesh.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, Extra, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

/** Store an INT8 built-in (`curve_type`, `nurbs_order`, `knots_mode`, `normal_mode`, `handle_type_*`). */
const storeInt8 = (geometry: Socket<'GEOMETRY'>, domain: 'POINT' | 'CURVE', name: string, value: Socket<'INT' | 'FLOAT'> | number) =>
    n.StoreNamedAttribute({geometry, domain, dataType: 'INT8', name, value}).geometry

export function curvesBasicCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    /** Joined meshes with chains, loops (the circle, the grid holes) and branching vertices. */
    const meshes = () => attributed(n.JoinGeometry({geometry: [testMeshes(), n.MeshCircle({vertices: 7, radius: 0.6}).mesh]}).geometry)

    // region Mesh to Curve
    add('mesh-to-curve-edges', 'Mesh to Curve (edges) of the joined test meshes with attributes on every domain', SHAPE_SCENE, () =>
        n.MeshToCurve({mesh: meshes()}).curve)
    add('mesh-to-curve-edges-selection', 'Mesh to Curve (edges) of a selection', SHAPE_SCENE, () =>
        n.MeshToCurve({mesh: meshes(), selection: mod(index(), 3).eq(0).not()}).curve)
    add('mesh-to-curve-faces', 'Mesh to Curve (faces): one cyclic curve per face', SHAPE_SCENE, () =>
        n.MeshToCurve({mesh: meshes(), mode: 'FACES'}).curve)
    add('mesh-to-curve-faces-selection', 'Mesh to Curve (faces) of a selection', SHAPE_SCENE, () =>
        n.MeshToCurve({mesh: meshes(), mode: 'FACES', selection: mod(index(), 2).eq(1)}).curve)
    // endregion

    // region Curve to Mesh
    add('curve-to-mesh-wire', 'Curve to Mesh without a profile (poly curves from Mesh to Curve)', SHAPE_SCENE, () =>
        n.CurveToMesh({curve: n.MeshToCurve({mesh: meshes()}).curve}).mesh)
    for (const fillCaps of [false, true]) {
        add(`curve-to-mesh-sweep${fillCaps ? '-caps' : ''}`, `Curve to Mesh with a circle profile, fill caps ${fillCaps}, a Scale field`, SHAPE_SCENE, () => {
            const curve = store(n.MeshToCurve({mesh: meshes()}).curve, 'CURVE', 'cf', index().mul(0.5))
            const profile = store(n.CurveCircle({resolution: 5, radius: 0.15}).curve, 'POINT', 'pp', index().mul(2))
            return n.CurveToMesh({curve, profileCurve: profile, fillCaps, scale: mod(index(), 4).mul(0.3).add(0.4)}).mesh
        })
    }
    add('curve-to-mesh-line-profile', 'Curve to Mesh with an open line profile along cyclic and open curves', SHAPE_SCENE, () =>
        n.CurveToMesh({curve: n.MeshToCurve({mesh: meshes(), mode: 'FACES'}).curve,
            profileCurve: n.CurveLine({start: [-0.1, 0, 0], end: [0.1, 0.05, 0]}).curve}).mesh)
    // endregion

    // region Spline Length, Endpoint Selection
    add('spline-length', 'Spline Length and Point Count on points and curves', SHAPE_SCENE, () => {
        const curve = n.MeshToCurve({mesh: meshes()}).curve
        const s = n.SplineLength()
        let g = store(curve, 'POINT', 'len_p', s.length)
        g = store(g, 'POINT', 'count_p', s.pointCount)
        g = store(g, 'CURVE', 'len_c', s.length)
        return store(g, 'CURVE', 'count_c', s.pointCount)
    })
    add('endpoint-selection', 'Endpoint Selection with per-curve start and end sizes', SHAPE_SCENE, () => {
        const curve = n.MeshToCurve({mesh: meshes()}).curve
        let g = store(curve, 'POINT', 'sel_default', n.EndpointSelection().selection)
        g = store(g, 'POINT', 'sel_field', n.EndpointSelection({startSize: mod(index(), 3), endSize: mod(index(), 4).sub(1)}).selection)
        return store(g, 'CURVE', 'sel_curve', n.EndpointSelection({startSize: 2}).selection)
    })
    // endregion

    // region primitives
    add('curve-line', 'Curve Line in both modes', {}, () => n.JoinGeometry({geometry: [
        n.CurveLine({start: [0.2, -0.4, 1], end: [1.5, 2, -0.3]}).curve,
        n.CurveLine({mode: 'DIRECTION', start: [1, 1, 0], direction: [0.3, -2, 0.7], length: 2.7}).curve,
    ]}).geometry)
    add('curve-circle', 'Curve Circle by radius (3, 7 and 32 points) and through three points, with Center', {}, () => {
        const parts: Socket<'GEOMETRY'>[] = [3, 7, 32].map((resolution, i) => n.CurveCircle({resolution, radius: 0.7 + i * 0.4}).curve)
        const c = n.CurveCircle({mode: 'POINTS', resolution: 9, point1: [-1, 0.2, 0.1], point2: [0.3, 1.4, -0.2], point3: [1.2, -0.3, 0.4]})
        parts.push(c.curve, store(n.Points({count: 1}).geometry, 'POINT', 'center', c.center))
        const colinear = n.CurveCircle({mode: 'POINTS', point1: [0, 0, 0], point2: [1, 1, 1], point3: [2, 2, 2]})
        parts.push(colinear.curve, store(n.Points({count: 1}).geometry, 'POINT', 'center_colinear', colinear.center))
        return n.JoinGeometry({geometry: parts}).geometry
    })
    for (const mode of ['POSITION', 'OFFSET'] as const) {
        add(`bezier-segment-${mode.toLowerCase()}`, `Bézier Segment (${mode}) and its evaluated points (Curve to Mesh)`, {}, () => {
            const b = n.BezierSegment({mode, resolution: 7, start: [-1, 0.2, 0], startHandle: [-0.3, 1.1, 0.4], endHandle: [0.6, -0.8, 0.2], end: [1.3, 0, -0.1]}).curve
            return n.JoinGeometry({geometry: [b, n.CurveToMesh({curve: b}).mesh]}).geometry
        })
    }
    // endregion

    // region evaluation of every curve type
    /** A 6 point closed or open poly curve with uneven spacing, turned into `type`. */
    const typed = (type: number, cyclic: boolean, resolution: number) => {
        let g: Socket<'GEOMETRY'> = n.CurveCircle({resolution: 6, radius: 1}).curve
        g = n.SetPosition({geometry: g, offset: n.CombineXYZ({x: mod(index(), 2).mul(0.3), y: 0, z: mod(index(), 3).mul(0.4)}).vector}).geometry
        g = storeInt8(g, 'CURVE', 'curve_type', type)
        g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'cyclic', value: cyclic}).geometry
        return n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'INT', name: 'resolution', value: resolution}).geometry
    }
    const evaluated = (g: Socket<'GEOMETRY'>) => {
        const s = n.SplineLength()
        const wire = n.CurveToMesh({curve: store(g, 'POINT', 'w', index().mul(0.5))}).mesh
        const swept = n.CurveToMesh({curve: g, profileCurve: n.CurveLine({start: [0, 0, 0], end: [0.1, 0.2, 0.05]}).curve}).mesh
        return n.JoinGeometry({geometry: [store(store(g, 'CURVE', 'len', s.length), 'POINT', 'len_p', s.length), wire, swept]}).geometry
    }
    for (const cyclic of [false, true]) {
        const c = cyclic ? 'cyclic' : 'open'
        add(`eval-catmull-rom-${c}`, `Catmull Rom (${c}): evaluated points, tangents, normals and length`, {}, () => evaluated(typed(0, cyclic, 5)))
        add(`eval-poly-${c}`, `Poly (${c}): tangents, normals and length`, {}, () => evaluated(typed(1, cyclic, 5)))
        for (const [order, knotsMode] of [[2, 0], [3, 0], [4, 1], [3, 2], [4, 3], [5, 0]] as const) {
            add(`eval-nurbs-${c}-order${order}-knots${knotsMode}`, `NURBS (${c}) order ${order}, knots mode ${knotsMode}, weights`, {}, () => {
                let g = typed(3, cyclic, 4)
                g = storeInt8(g, 'CURVE', 'nurbs_order', order)
                g = storeInt8(g, 'CURVE', 'knots_mode', knotsMode)
                g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', name: 'nurbs_weight', value: mod(index(), 3).mul(0.5).add(0.5)}).geometry
                return evaluated(g)
            })
        }
    }
    add('eval-catmull-rom-short', 'Catmull Rom curves with 1, 2 and 3 points, open and cyclic', {}, () => {
        const parts: Socket<'GEOMETRY'>[] = []
        for (const count of [1, 2, 3]) {
            for (const cyclic of [false, true]) {
                let g: Socket<'GEOMETRY'> = n.MeshToCurve({mesh: n.MeshLine({count, offset: [0.5, 0.3, count * 0.1]}).mesh}).curve
                if (count === 1) g = n.MeshToCurve({mesh: n.MeshLine({count: 2, offset: [0, 0, 0]}).mesh}).curve
                g = storeInt8(g, 'CURVE', 'curve_type', 0)
                g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'cyclic', value: cyclic}).geometry
                parts.push(n.TransformGeometry({geometry: g, translation: [count * 2, cyclic ? 2 : 0, 0]}).geometry)
            }
        }
        return evaluated(n.JoinGeometry({geometry: parts}).geometry)
    })
    add('eval-bezier-vector', 'Bézier with vector and free handle segments (evaluated offsets), swept with sharp edges', {}, () => {
        let g = n.BezierSegment({resolution: 5}).curve
        g = n.JoinGeometry({geometry: [g, n.TransformGeometry({geometry: n.BezierSegment({resolution: 3, mode: 'OFFSET'}).curve, translation: [0, 2, 0]}).geometry]}).geometry
        g = storeInt8(g, 'POINT', 'handle_type_left', n.Math({operation: 'MULTIPLY', value: mod(index(), 2), value1: 2}).value)
        g = storeInt8(g, 'POINT', 'handle_type_right', 2)
        const profile = storeInt8(storeInt8(n.BezierSegment({resolution: 2}).curve, 'POINT', 'handle_type_left', 2), 'POINT', 'handle_type_right', 0)
        return n.JoinGeometry({geometry: [evaluated(g), n.CurveToMesh({curve: g, profileCurve: profile}).mesh]}).geometry
    })
    for (const cyclic of [false, true]) {
        add(`eval-tilt-normal-modes-${cyclic ? 'cyclic' : 'open'}`, 'Tilt and every normal mode (minimum twist, Z up, free with custom normals) read through a swept line', {}, () => {
            const parts: Socket<'GEOMETRY'>[] = []
            for (const [mode, type] of [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] as const) {
                let g = typed(type, cyclic, 3)
                g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', name: 'tilt', value: index().mul(0.4)}).geometry
                g = storeInt8(g, 'CURVE', 'normal_mode', mode)
                if (mode === 2) g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', dataType: 'FLOAT_VECTOR', name: 'custom_normal',
                    value: n.CombineXYZ({x: index(), y: 1, z: mod(index(), 2)}).vector}).geometry
                // Only the meshes: joining or transforming curves with custom normals needs transform_normals (not ported).
                const swept = n.CurveToMesh({curve: g, profileCurve: n.CurveLine({start: [0, 0, 0], end: [0.1, 0.2, 0.05]}).curve}).mesh
                const wire = n.CurveToMesh({curve: store(g, 'POINT', 'len_p', n.SplineLength().length)}).mesh
                parts.push(n.TransformGeometry({geometry: n.JoinGeometry({geometry: [wire, swept]}).geometry, translation: [mode * 3, type * 3, 0]}).geometry)
            }
            return n.JoinGeometry({geometry: parts}).geometry
        })
    }
    for (const useRadius of [false, true]) {
        add(`bounding-box-curves${useRadius ? '-radius' : ''}`, `Bounding Box of evaluated curves (every type), use radius ${useRadius}, with and without a radius attribute`, {}, () => {
            const box = (g: Socket<'GEOMETRY'>) => {
                const b = n.BoundingBox({geometry: g, useRadius})
                let pt: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
                pt = store(store(pt, 'POINT', 'min', b.min), 'POINT', 'max', b.max)
                return n.JoinGeometry({geometry: [b.boundingBox, pt]}).geometry
            }
            const types = n.JoinGeometry({geometry: [0, 2, 3].map(t => n.TransformGeometry({geometry: typed(t, t === 3, 4), translation: [t * 0.7, 0, 0]}).geometry)}).geometry
            const withRadius = n.StoreNamedAttribute({geometry: types, domain: 'POINT', name: 'radius', value: mod(index(), 4).mul(0.2)}).geometry
            const poly = n.StoreNamedAttribute({geometry: typed(1, false, 2), domain: 'POINT', name: 'radius', value: index().mul(0.1)}).geometry
            return n.JoinGeometry({geometry: [box(types), box(withRadius), box(poly)]}).geometry
        })
    }
    // endregion
    return cases
}
