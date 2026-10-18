/**
 * Parity cases for Resample Curve (Count, Length with and without the last segment, Evaluated) and Trim Curve
 * (factor and length modes) on every curve type, open and cyclic, with selections and point/curve attributes.
 */

import {n, Socket} from '../../../src/dsl/builder'
import type {TrimCurveArgs} from '../../../src/dsl/nodes.generated'
import {attributed, Extra, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

const storeInt8 = (geometry: Socket<'GEOMETRY'>, domain: 'POINT' | 'CURVE', name: string, value: Socket<'INT' | 'FLOAT'> | number) =>
    n.StoreNamedAttribute({geometry, domain, dataType: 'INT8', name, value}).geometry

/** A 7 point curve of `type` (`0` Catmull Rom .. `3` NURBS), open or cyclic, with uneven spacing. */
function typedCurve(type: number, cyclic: boolean, translation: [number, number, number]): Socket<'GEOMETRY'> {
    let g: Socket<'GEOMETRY'> = n.CurveCircle({resolution: 7, radius: 1}).curve
    g = n.SetPosition({geometry: g, offset: n.CombineXYZ({x: mod(index(), 2).mul(0.35), y: mod(index(), 3).mul(-0.2), z: mod(index(), 3).mul(0.4)}).vector}).geometry
    if (type === 2) {
        // Bézier: handles a third of the way to the neighbours (vector handles keep them on the evaluated polygon's corners).
        g = storeInt8(g, 'POINT', 'handle_type_left', 0)
        g = storeInt8(g, 'POINT', 'handle_type_right', 0)
        g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', dataType: 'FLOAT_VECTOR', name: 'handle_left',
            value: n.Position().position.add(n.CombineXYZ({x: -0.2, y: mod(index(), 2).mul(0.15), z: 0.1}).vector)}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', dataType: 'FLOAT_VECTOR', name: 'handle_right',
            value: n.Position().position.add(n.CombineXYZ({x: 0.25, y: mod(index(), 3).mul(-0.1), z: -0.05}).vector)}).geometry
    }
    g = storeInt8(g, 'CURVE', 'curve_type', type)
    g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'BOOLEAN', name: 'cyclic', value: cyclic}).geometry
    g = n.StoreNamedAttribute({geometry: g, domain: 'CURVE', dataType: 'INT', name: 'resolution', value: 3}).geometry
    if (type === 3) g = storeInt8(g, 'CURVE', 'nurbs_order', 3)
    return n.TransformGeometry({geometry: g, translation}).geometry
}

/** Every curve type, open and cyclic, plus the poly curves of Mesh to Curve; point and curve attributes. */
function mixedCurves(): Socket<'GEOMETRY'> {
    const parts: Socket<'GEOMETRY'>[] = []
    for (const type of [0, 1, 2, 3]) {
        for (const cyclic of [false, true]) parts.push(typedCurve(type, cyclic, [type * 3, cyclic ? 3 : 0, 0]))
    }
    parts.push(n.TransformGeometry({geometry: n.MeshToCurve({mesh: attributed(testMeshes())}).curve, translation: [0, 7, 0]}).geometry)
    let g = n.JoinGeometry({geometry: parts}).geometry
    g = store(g, 'POINT', 'pf', index().mul(0.75).add(0.5))
    g = store(g, 'POINT', 'pi', mod(index(), 5))
    g = store(g, 'POINT', 'pb', mod(index(), 3).eq(1))
    g = store(g, 'POINT', 'pv', n.CombineXYZ({x: index(), y: mod(index(), 4), z: -1}).vector)
    return store(g, 'CURVE', 'cf', index().mul(2).sub(1))
}

export function curvesOpsCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))

    // region Resample Curve
    add('resample-count', 'Resample Curve (Count) of every curve type with a per-curve count', SHAPE_SCENE, () =>
        n.ResampleCurve({curve: mixedCurves(), mode: 'Count', count: mod(index(), 6).add(1)}).curve)
    add('resample-count-selection', 'Resample Curve (Count 9) of a curve selection', SHAPE_SCENE, () =>
        n.ResampleCurve({curve: mixedCurves(), mode: 'Count', count: 9, selection: mod(index(), 3).eq(1)}).curve)
    for (const keepLastSegment of [true, false]) {
        add(`resample-length${keepLastSegment ? '' : '-no-last-segment'}`, `Resample Curve (Length 0.6), keep last segment ${keepLastSegment}`, SHAPE_SCENE, () =>
            n.ResampleCurve({curve: mixedCurves(), mode: 'Length', length: 0.6, keepLastSegment}).curve)
    }
    add('resample-length-field', 'Resample Curve (Length) with a per-curve length, no last segment (as Buildify uses it)', SHAPE_SCENE, () =>
        n.ResampleCurve({curve: mixedCurves(), mode: 'Length', length: mod(index(), 4).mul(0.9).add(0.3), keepLastSegment: false}).curve)
    add('resample-evaluated', 'Resample Curve (Evaluated) with a selection', SHAPE_SCENE, () =>
        n.ResampleCurve({curve: mixedCurves(), mode: 'Evaluated', selection: mod(index(), 4).eq(0).not()}).curve)
    // endregion

    // region Trim Curve
    const trim = (id: string, description: string, args: () => TrimCurveArgs) =>
        add(id, description, SHAPE_SCENE, () => n.TrimCurve({curve: mixedCurves(), ...args()}).curve)
    trim('trim-factor', 'Trim Curve (Factor) 0.2 .. 0.7', () => ({start: 0.2, end: 0.7}))
    trim('trim-factor-field', 'Trim Curve (Factor) with per-curve start and end, some reversed or equal', () => ({
        start: mod(index(), 4).mul(0.25), end: mod(index().add(2), 5).mul(0.25)}))
    trim('trim-factor-ends', 'Trim Curve (Factor) 0 .. 1 (whole curves, control point ends)', () => ({start: 0, end: 1}))
    trim('trim-factor-start-only', 'Trim Curve (Factor) 0.35 .. 1', () => ({start: 0.35, end: 1}))
    trim('trim-length', 'Trim Curve (Length) 0.5 .. 2.3', () => ({mode: 'LENGTH', start1: 0.5, end1: 2.3}))
    trim('trim-length-field', 'Trim Curve (Length) with per-curve lengths past the ends', () => ({mode: 'LENGTH',
        start1: mod(index(), 3).mul(0.8), end1: mod(index(), 5).mul(1.7)}))
    trim('trim-selection', 'Trim Curve (Factor) of a curve selection', () => ({start: 0.1, end: 0.55, selection: mod(index(), 2).eq(0)}))
    trim('trim-equal', 'Trim Curve (Factor) with start equal to end (single points, or split cyclic curves)', () => ({start: 0.4, end: 0.4}))
    // endregion

    // region Duplicate Elements on curves
    for (const domain of ['SPLINE', 'POINT'] as const) {
        add(`duplicate-${domain.toLowerCase()}-curves`, `Duplicate Elements (${domain}) of curves with ids, a count field and a selection`, SHAPE_SCENE, () => {
            const g = n.SetID({geometry: mixedCurves(), iD: index().mul(3).add(2)}).geometry
            const d = n.DuplicateElements({geometry: g, domain, amount: mod(index(), 3), selection: mod(index(), 4).eq(3).not()})
            return store(d.geometry, domain === 'SPLINE' ? 'CURVE' : 'POINT', 'dup', d.duplicateIndex)
        })
    }
    // endregion
    return cases
}
