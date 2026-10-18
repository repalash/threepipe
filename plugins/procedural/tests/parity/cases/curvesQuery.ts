/**
 * Parity cases for the curve fields and query nodes: Normal and Curve Tangent on curves (every type, every normal
 * mode, tilt), Spline Parameter, Curve Length, Reverse Curve, Curve to Points (every mode and the Tangent / Normal /
 * Rotation outputs) and Sample Curve (factor / length, single curve, curve index field, all curves, value types).
 */

import {AnySocket, n, Socket} from '../../../src/dsl/builder'
import {Extra, meshCase, mod, store} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export const storeInt8 = (geometry: Socket<'GEOMETRY'>, domain: 'POINT' | 'CURVE', name: string, value: Socket<'INT' | 'FLOAT'> | number) =>
    n.StoreNamedAttribute({geometry, domain, dataType: 'INT8', name, value}).geometry

/** A 6 point curve with uneven spacing turned into `type`, translated by `t`. */
export function typed(type: number, cyclic: boolean, resolution: number, t: [number, number, number] = [0, 0, 0]): Socket<'GEOMETRY'> {
    let g: Socket<'GEOMETRY'> = n.CurveCircle({resolution: 6, radius: 1}).curve
    g = n.SetPosition({geometry: g, offset: n.CombineXYZ({x: mod(index(), 2).mul(0.3).add(t[0]), y: t[1], z: mod(index(), 3).mul(0.4).add(t[2])}).vector}).geometry
    g = storeInt8(g, 'CURVE', 'curve_type', type)
    g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'cyclic', value: cyclic}).geometry
    return n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'INT', name: 'resolution', value: resolution}).geometry
}

/**
 * Curves of every type: Catmull Rom (open, cyclic), poly (cyclic), Bezier (vector / free / auto handles, two
 * segments), NURBS (order 3 open, order 4 endpoint cyclic, weights), a two-point line and a zero-length curve, with
 * tilt and a point attribute.
 */
export function mixed(): Socket<'GEOMETRY'> {
    let nurbs = storeInt8(storeInt8(typed(3, false, 4, [0, 3, 0]), 'CURVE', 'nurbs_order', 3), 'CURVE', 'knots_mode', 0)
    nurbs = n.StoreNamedAttribute({geometry: nurbs, domain: 'POINT', name: 'nurbs_weight', value: mod(index(), 3).mul(0.5).add(0.5)}).geometry
    const nurbs2 = storeInt8(storeInt8(typed(3, true, 3, [3, 3, 0]), 'CURVE', 'nurbs_order', 4), 'CURVE', 'knots_mode', 1)
    let bezier: Socket<'GEOMETRY'> = n.BezierSegment({resolution: 5, start: [-1, 0, 6], startHandle: [-0.5, 1, 6.5], endHandle: [0.5, -1, 6.2], end: [1, 0, 6]}).curve
    const bezier2 = n.BezierSegment({resolution: 3, mode: 'OFFSET', start: [2, 1, 6], end: [3, 2, 6.5]}).curve
    bezier = n.JoinGeometry({geometry: [bezier, bezier2]}).geometry
    bezier = storeInt8(bezier, 'POINT', 'handle_type_left', n.Math({operation: 'MULTIPLY', value: mod(index(), 2), value1: 2}).value)
    const line = n.CurveLine({start: [0, -2, 0], end: [1.5, -2.5, 0.5]}).curve
    const zero = n.CurveLine({start: [4, -2, 0], end: [4, -2, 0]}).curve
    const parts = [typed(0, false, 5), typed(0, true, 4, [3, 0, 0]), typed(1, true, 1, [6, 0, 0]), bezier, nurbs, nurbs2, line, zero]
    let g = n.JoinGeometry({geometry: parts}).geometry
    g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', name: 'tilt', value: index().mul(0.3)}).geometry
    return store(g, 'POINT', 'pv', n.CombineXYZ({x: index(), y: mod(index(), 3), z: index().mul(-0.25)}).vector)
}

export function curvesQueryCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    const onBoth = (g: Socket<'GEOMETRY'>, name: string, value: AnySocket) => store(store(g, 'POINT', `${name}_p`, value), 'CURVE', `${name}_c`, value)

    // region group 1: Normal, Curve Tangent
    add('curve-normal-tangent', 'Normal and Curve Tangent on points and curves of every curve type, with tilt', {}, () =>
        onBoth(onBoth(mixed(), 'n', n.Normal().normal), 't', n.CurveTangent().tangent))
    add('curve-normal-tangent-poly', 'Normal and Curve Tangent of poly-only curves (evaluated normals adapted to the domain)', {}, () => {
        const g = n.JoinGeometry({geometry: [typed(1, false, 1), typed(1, true, 1, [3, 0, 0]), n.CurveLine().curve]}).geometry
        return onBoth(onBoth(n.StoreNamedAttribute({geometry: g, domain: 'POINT', name: 'tilt', value: index().mul(0.5)}).geometry, 'n', n.Normal().normal), 't', n.CurveTangent().tangent)
    })
    for (const [mode, label] of [[0, 'minimum'], [1, 'z-up'], [2, 'free']] as const) {
        add(`curve-normal-mode-${label}`, `Normal of every curve type with normal mode ${label}${mode === 2 ? ' (custom normals, NURBS read them directly)' : ''}`, {}, () => {
            const parts: Socket<'GEOMETRY'>[] = []
            for (const type of [0, 1, 2, 3]) {
                let g = type === 2 ? n.BezierSegment({resolution: 4, start: [-1, 0, 0], startHandle: [-0.5, 1, 0.5], endHandle: [0.5, -1, 0.2], end: [1, 0, 0]}).curve
                    : typed(type, type !== 1, 3)
                g = storeInt8(g, 'CURVE', 'normal_mode', mode)
                if (mode === 2) g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', dataType: 'FLOAT_VECTOR', name: 'custom_normal',
                    value: n.CombineXYZ({x: index(), y: 1, z: mod(index(), 2)}).vector}).geometry
                g = store(store(g, 'POINT', 'n', n.Normal().normal), 'CURVE', 'nc', n.Normal().normal)
                // Joining curves with custom normals needs transform_normals (not ported): drop them after reading.
                if (mode === 2) g = n.RemoveNamedAttribute({geometry: g, name: 'custom_normal'}).geometry
                parts.push(n.TransformGeometry({geometry: g, translation: [type * 3, 0, 0]}).geometry)
            }
            return n.JoinGeometry({geometry: parts}).geometry
        })
    }
    // endregion

    // region group 2
    add('spline-parameter', 'Spline Parameter factor / length / index on points and curves of every curve type', {}, () => {
        const s = n.SplineParameter()
        return onBoth(onBoth(store(mixed(), 'POINT', 'i_p', s.index), 'f', s.factor), 'l', s.length)
    })
    add('spline-parameter-zero', 'Spline Parameter of zero-length curves only (factor fallback to the index)', {}, () => {
        const zero = (x: number) => n.CurveLine({start: [x, 0, 0], end: [x, 0, 0]}).curve
        const s = n.SplineParameter()
        return onBoth(onBoth(n.JoinGeometry({geometry: [zero(0), zero(1), zero(2)]}).geometry, 'f', s.factor), 'l', s.length)
    })
    add('curve-length', 'Curve Length of mixed curves, of nothing, and of a mesh', {}, () => {
        const pts = n.Points({count: 1}).geometry
        let g = store(pts, 'POINT', 'len', n.CurveLength({curve: mixed()}).length)
        g = store(g, 'POINT', 'len_mesh', n.CurveLength({curve: n.MeshCube().mesh}).length)
        return g
    })
    add('reverse-curve', 'Reverse Curve with a selection (every type; handles swap sides)', {}, () => {
        const r = n.ReverseCurve({curve: mixed(), selection: mod(index(), 3).eq(1).not()}).curve
        return onBoth(r, 't', n.CurveTangent().tangent)
    })
    add('reverse-curve-bezier', 'Reverse Curve of Bezier curves with every handle type, then evaluated (Curve to Mesh)', {}, () => {
        let g: Socket<'GEOMETRY'> = n.BezierSegment({resolution: 4}).curve
        g = n.JoinGeometry({geometry: [g, n.TransformGeometry({geometry: n.BezierSegment({resolution: 3, mode: 'OFFSET'}).curve, translation: [0, 2, 0]}).geometry]}).geometry
        g = storeInt8(g, 'POINT', 'handle_type_left', mod(index(), 4))
        g = storeInt8(g, 'POINT', 'handle_type_right', mod(index().add(1), 4))
        const r = n.ReverseCurve({curve: g}).curve
        return n.JoinGeometry({geometry: [r, n.CurveToMesh({curve: r}).mesh]}).geometry
    })
    for (const mode of ['EVALUATED', 'COUNT', 'LENGTH'] as const) {
        add(`curve-to-points-${mode.toLowerCase()}`, `Curve to Points (${mode}) of every curve type, Tangent / Normal / Rotation outputs, curve attributes`, {}, () => {
            const src = store(store(mixed(), 'CURVE', 'cf', index().mul(1.5)), 'CURVE', 'ci', index())
            const c = n.CurveToPoints({curve: src, mode, ...(mode === 'COUNT' ? {count: mod(index(), 4).add(2)} : mode === 'LENGTH' ? {length: index().mul(0.1).add(0.15)} : {})})
            let g = store(c.points, 'POINT', 'tan', c.tangent)
            g = store(g, 'POINT', 'nor', c.normal)
            return store(g, 'POINT', 'rot', c.rotation)
        })
    }
    add('curve-to-points-tangent-only', 'Curve to Points (COUNT) with only the Tangent output used, a mesh in the input (removed)', {}, () => {
        const c = n.CurveToPoints({curve: n.JoinGeometry({geometry: [mixed(), n.MeshCube().mesh]}).geometry, count: 7})
        return store(c.points, 'POINT', 'tan', c.tangent)
    })
    const samplePoints = (count: number) => n.Points({count, position: n.CombineXYZ({x: index().mul(0.1)}).vector}).geometry
    const sampleStore = (g: Socket<'GEOMETRY'>, s: ReturnType<typeof n.SampleCurve>, value: boolean) => {
        g = store(g, 'POINT', 'pos', s.position)
        g = store(g, 'POINT', 'tan', s.tangent)
        g = store(g, 'POINT', 'nor', s.normal)
        return value ? store(g, 'POINT', 'val', s.value) : g
    }
    for (const mode of ['FACTOR', 'LENGTH'] as const) {
        const amount = (count: number) => mode === 'FACTOR' ? index().div(count - 1).mul(1.2).sub(0.1) : index().mul(0.37).sub(0.2)
        const at = (a: Socket<'FLOAT'> | number) => (mode === 'FACTOR' ? {factor: a} : {length: a})
        add(`sample-curve-${mode.toLowerCase()}-index`, `Sample Curve (${mode}) with a Curve Index field (in and out of range), float value`, {}, () => {
            const s = n.SampleCurve({curves: mixed(), mode, value: n.Position().position.x, ...at(amount(40)),
                curveIndex: mod(index(), 10).sub(1)})
            return sampleStore(samplePoints(40), s, true)
        })
        add(`sample-curve-${mode.toLowerCase()}-all`, `Sample Curve (${mode}) over all curves (use_all_curves)`, {}, () => {
            const s = n.SampleCurve({curves: mixed(), mode, useAllCurves: true, dataType: 'FLOAT_VECTOR', value: n.Position().position,
                ...at(mode === 'FACTOR' ? amount(60) : amount(60).mul(4))})
            return sampleStore(samplePoints(60), s, true)
        })
        add(`sample-curve-${mode.toLowerCase()}-single`, `Sample Curve (${mode}) of a single curve, single and field inputs`, {}, () => {
            const bez = n.BezierSegment({resolution: 6, start: [-1, 0, 0], startHandle: [-0.5, 1, 0.5], endHandle: [0.5, -1, 0.2], end: [1, 0, 0]}).curve
            const s = n.SampleCurve({curves: bez, mode, value: index().mul(2.5), ...at(amount(25))})
            const single = n.SampleCurve({curves: bez, mode, ...at(mode === 'FACTOR' ? 0.3 : 0.7)})
            let g = sampleStore(samplePoints(25), s, true)
            return store(g, 'POINT', 'single_pos', single.position)
        })
    }
    for (const dataType of ['INT', 'BOOLEAN', 'FLOAT_COLOR', 'QUATERNION'] as const) {
        add(`sample-curve-value-${dataType.toLowerCase()}`, `Sample Curve value of type ${dataType} (interpolated on evaluated points)`, {}, () => {
            const i = index()
            const value: AnySocket = dataType === 'INT' ? i.mul(3) : dataType === 'BOOLEAN' ? mod(i, 2).eq(1)
                : dataType === 'FLOAT_COLOR' ? n.CombineColor({red: i.mul(0.1), green: 0.5, blue: mod(i, 3), alpha: 1}).color
                    : n.EulerToRotation({euler: n.CombineXYZ({x: i.mul(0.3), y: 0.2, z: i.mul(-0.1)}).vector}).rotation
            const s = n.SampleCurve({curves: mixed(), dataType, value, factor: index().div(29), curveIndex: mod(index(), 8)})
            return sampleStore(samplePoints(30), s, true)
        })
    }
    // endregion
    return cases
}
