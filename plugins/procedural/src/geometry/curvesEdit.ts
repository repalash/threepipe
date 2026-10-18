/**
 * `bke::CurvesGeometry` write helpers (`blenkernel/intern/curves_geometry.cc`) shared by the curve nodes.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {CurvesGeometry} from './components'
import {CURVE_TYPE_CATMULL_ROM} from './curvesEval'

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
