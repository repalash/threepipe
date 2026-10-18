/**
 * `bke::CurvesGeometry` write helpers (`blenkernel/intern/curves_geometry.cc`) shared by the curve nodes.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {CurvesGeometry} from './components'
import {bezierCalculateAutoHandles, CURVE_TYPE_BEZIER, CURVE_TYPE_CATMULL_ROM, curvesAttributeOr, curveTypes} from './curvesEval'

/** `CurvesGeometry::fill_curve_types(type)` (:244): Catmull Rom removes the attribute (its default), others store `type` everywhere. */
export function fillCurveTypes(curves: CurvesGeometry, type: number): void {
    const acc = curves.accessor()
    if (type === CURVE_TYPE_CATMULL_ROM) {
        acc.remove('curve_type')
        return
    }
    const layer = curves.attributes.get('curve_type')
    if (layer) layer.data.fill(type)
    else acc.add('curve_type', AttrDomain.Curve, 'int8', [type])
}

/** `fill_curve_types(selection, type)` (:267). */
export function fillCurveTypesSelection(curves: CurvesGeometry, selection: ArrayLike<number>, type: number): void {
    if (selection.length === curves.curvesNum) {
        fillCurveTypes(curves, type)
        return
    }
    const layer = curves.attributes.get('curve_type')
    if (!layer) {
        if (type === CURVE_TYPE_CATMULL_ROM) return
        curves.accessor().add('curve_type', AttrDomain.Curve, 'int8', [CURVE_TYPE_CATMULL_ROM])
    }
    const data = curves.attributes.get('curve_type')!.data
    for (let i = 0; i < selection.length; i++) data[selection[i]] = type
}

/**
 * A built-in attribute's array for writing (`CurvesGeometry::*_for_write` via `get_mutable_attribute`,
 * `attribute_storage_access.hh:87`): created filled with `def` (the accessor's own default, e.g. 0.01 for
 * `radius_for_write`, 12 for `resolution_for_write`) when it does not exist.
 */
export function curvesAttributeForWrite(curves: CurvesGeometry, name: string, def: readonly number[]): ArrayLike<number> & {[i: number]: number} {
    const acc = curves.accessor()
    if (!curves.attributes.get(name)) {
        const b = acc.builtins[name]
        if (!b) throw new Error(`curvesAttributeForWrite: '${name}' is not a built-in curves attribute`)
        acc.add(name, b.domain, b.type, def)
    }
    return curves.attributes.get(name)!.data
}

/** `CurvesGeometry::calculate_bezier_auto_handles` (`curves_geometry.cc:1287`). */
export function calculateBezierAutoHandles(curves: CurvesGeometry): void {
    const types = curveTypes(curves)
    if (!Array.prototype.some.call(types, (t: number) => t === CURVE_TYPE_BEZIER)) return
    const hl = curves.attributes.get('handle_left'), hr = curves.attributes.get('handle_right')
    if (!hl || !hr) return
    const cyclic = curvesAttributeOr(curves, 'cyclic', curves.curvesNum, 0)
    const tl = curvesAttributeOr(curves, 'handle_type_left', curves.pointsNum, 0)
    const tr = curvesAttributeOr(curves, 'handle_type_right', curves.pointsNum, 0)
    const positions = curves.positions
    for (let c = 0; c < curves.curvesNum; c++) {
        if (types[c] !== CURVE_TYPE_BEZIER) continue
        const [s, e] = curves.pointsRange(c)
        bezierCalculateAutoHandles(!!cyclic[c], Array.prototype.slice.call(tl, s, e), Array.prototype.slice.call(tr, s, e),
            positions.subarray(s * 3, e * 3), (hl.data as Float32Array).subarray(s * 3, e * 3), (hr.data as Float32Array).subarray(s * 3, e * 3))
    }
}

const BEZIER_HANDLE_NAMES = new Set(['handle_left', 'handle_right', 'handle_type_left', 'handle_type_right'])

/** `reverse_swap_curve_point_data` (:1671): reverse two point layers of a curve and swap them. */
function reverseSwap(a: {[i: number]: number}, b: {[i: number]: number}, c: number, s: number, n: number): void {
    const swap = (x: {[i: number]: number}, i: number, y: {[i: number]: number}, j: number) => {
        for (let k = 0; k < c; k++) {
            const t = x[(s + i) * c + k]
            x[(s + i) * c + k] = y[(s + j) * c + k]
            y[(s + j) * c + k] = t
        }
    }
    for (let i = 0; i < Math.floor(n / 2); i++) {
        const end = n - 1 - i
        swap(a, end, b, i)
        swap(b, end, a, i)
    }
    if (n % 2) swap(a, Math.floor(n / 2), b, Math.floor(n / 2))
}

/** `CurvesGeometry::reverse_curves` (:1695) for the curves in `selection`. */
export function reverseCurves(curves: CurvesGeometry, selection: ArrayLike<number>): void {
    for (const layer of curves.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point) continue
        if (BEZIER_HANDLE_NAMES.has(layer.name)) continue
        const c = layer.data.length / Math.max(1, curves.pointsNum)
        const data = layer.data
        for (let i = 0; i < selection.length; i++) {
            const [s, e] = curves.pointsRange(selection[i])
            // `MutableSpan::reverse`.
            for (let lo = s, hi = e - 1; lo < hi; lo++, hi--) {
                for (let k = 0; k < c; k++) {
                    const t = data[lo * c + k]
                    data[lo * c + k] = data[hi * c + k]
                    data[hi * c + k] = t
                }
            }
        }
    }
    const knots = curvesAttributeOr(curves, 'knots_mode', curves.curvesNum, 0)
    for (let i = 0; i < selection.length; i++) {
        if (knots[selection[i]] === 4) throw new Error('reverse_curves: NURBS custom knots (reverse_custom_knots) are not ported')
    }
    const pairs: [string, string, number][] = [['handle_left', 'handle_right', 3], ['handle_type_left', 'handle_type_right', 1]]
    for (const [l, r, c] of pairs) {
        const a = curves.attributes.get(l), b = curves.attributes.get(r)
        if (!a || !b) continue
        for (let i = 0; i < selection.length; i++) {
            const [s, e] = curves.pointsRange(selection[i])
            reverseSwap(a.data, b.data, c, s, e - s)
        }
    }
}
