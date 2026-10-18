/**
 * Curve type and handle nodes (Blender 5.2.2): Set Spline Type (`node_geo_curve_spline_type.cc`), Set Handle Type
 * (`node_geo_curve_set_handle_type.cc`), Handle Type Selection (`node_geo_curve_handle_type_selection.cc`), Curve Handle
 * Positions (`node_geo_input_curve_handles.cc`), Set Handle Positions (`node_geo_set_curve_handles.cc`), Set Curve Normal
 * (`node_geo_set_curve_normal.cc`), Set NURBS Order (`node_geo_set_nurbs_order.cc`) and Set NURBS Weight
 * (`node_geo_set_nurbs_weight.cc`). Grease pencil is not a component here.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {captureFieldsOnGeometry, elementwise, EvaluateOnDomainInput, FieldContext, FieldEvaluation, FieldInput, FieldOperation, GField} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {
    BEZIER_HANDLE_ALIGN, BEZIER_HANDLE_AUTO, BEZIER_HANDLE_FREE, BEZIER_HANDLE_VECTOR, calculateAlignedHandle, CURVE_TYPE_BEZIER,
    CURVE_TYPE_CATMULL_ROM, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, curvesAttributeOr, curveTypes, NORMAL_MODE_FREE, NORMAL_MODE_MINIMUM_TWIST,
    NORMAL_MODE_Z_UP,
} from '../../geometry/curvesEval'
import {calculateBezierAutoHandles, curvesAttributeForWrite} from '../../geometry/curvesEdit'
import {curvesIsSingleType} from '../../geometry/curvesFields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {convertCurves} from '../../geometry/setCurveType'
import {GVArray} from '../../geometry/varray'
import {convertField} from '../../runtime/values'
import {registerNodeType} from '../../runtime/registry'

const SPLINE_TYPES: Record<string, number> = {CATMULL_ROM: CURVE_TYPE_CATMULL_ROM, POLY: CURVE_TYPE_POLY, BEZIER: CURVE_TYPE_BEZIER, NURBS: CURVE_TYPE_NURBS}
/** `handle_type_from_input_type` (`node_geo_curve_set_handle_type.cc:42`). */
const HANDLE_TYPES: Record<string, number> = {FREE: BEZIER_HANDLE_FREE, AUTO: BEZIER_HANDLE_AUTO, VECTOR: BEZIER_HANDLE_VECTOR, ALIGN: BEZIER_HANDLE_ALIGN}

/** The `mode` enum flag (`GEO_NODE_CURVE_HANDLE_LEFT | RIGHT`) as stored: a list of item names. */
function handleSides(value: unknown): {left: boolean, right: boolean} {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    return {left: items.includes('LEFT'), right: items.includes('RIGHT')}
}

const mask = (sel: GVArray, size: number) => {
    const out: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i)) out.push(i)
    return out
}

registerNodeType({
    idname: 'GeometryNodeCurveSplineType',
    label: 'Set Spline Type',
    // `node_init` (:28): POLY.
    properties: {spline_type: 'POLY'},
    enums: {spline_type: ['CATMULL_ROM', 'POLY', 'BEZIER', 'NURBS']},
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
    },
    // `node_geo_exec` (:35).
    execute(p) {
        const dstType = SPLINE_TYPES[p.node.prop<string>('spline_type')]
        const selectionField = p.field('Selection')
        p.set('Curve', foreachRealGeometry(p.geometry('Curve'), g => {
            const src = g.curves
            if (!src) return
            if (curvesIsSingleType(src, dstType)) return
            const selection = mask(new FieldEvaluation(new FieldContext('curves', src, AttrDomain.Curve), src.curvesNum).evaluate(selectionField), src.curvesNum)
            if (!selection.length) return
            const dst = convertCurves(src, selection, dstType)
            dst.materials = src.materials.slice()
            g.setCurves(dst)
        }, p.options.scene))
    },
})

registerNodeType({
    idname: 'GeometryNodeCurveSetHandles',
    label: 'Set Handle Type',
    // `node_init` (:34): AUTO, both sides.
    properties: {handle_type: 'AUTO', mode: ['LEFT', 'RIGHT']},
    enums: {handle_type: ['FREE', 'AUTO', 'VECTOR', 'ALIGN'], mode: ['LEFT', 'RIGHT']},
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
    },
    // `node_geo_exec` (:88) with `set_handle_type` (:58).
    execute(p) {
        const type = HANDLE_TYPES[p.node.prop<string>('handle_type')]
        const sides = handleSides(p.node.prop('mode'))
        const selectionField = p.field('Selection')
        let hasCurves = false, hasBezier = false
        const out = foreachRealGeometry(p.geometry('Curve'), g => {
            if (!g.curves) return
            hasCurves = true
            const read = g.curves
            if (!read.attributes.get('handle_type_left') || !read.attributes.get('handle_type_right')) return
            hasBezier = true
            const curves = g.curvesForWrite()!
            const sel = mask(new FieldEvaluation(new FieldContext('curves', curves, AttrDomain.Point), curves.pointsNum).evaluate(selectionField), curves.pointsNum)
            if (sides.left) {
                const tl = curvesAttributeForWrite(curves, 'handle_type_left', [0])
                for (const i of sel) tl[i] = type
            }
            if (sides.right) {
                const tr = curvesAttributeForWrite(curves, 'handle_type_right', [0])
                for (const i of sel) tr[i] = type
            }
            // "Eagerly calculate automatically derived handle positions if necessary."
            if (type === BEZIER_HANDLE_AUTO || type === BEZIER_HANDLE_VECTOR || type === BEZIER_HANDLE_ALIGN) calculateBezierAutoHandles(curves)
        }, p.options.scene)
        if (hasCurves && !hasBezier) p.warn('Input curves do not have Bézier type')
        p.set('Curve', out)
    },
})

/** `HandleTypeFieldInput` (`node_geo_curve_handle_type_selection.cc:71`) with `select_by_handle_type` (:45). */
class HandleTypeFieldInput extends FieldInput {
    constructor(private readonly handleType: number, private readonly left: boolean, private readonly right: boolean) {
        super('bool', 'Handle Type Selection node')
    }

    key(): string {
        return `handle-type-selection:${this.handleType}:${this.left}:${this.right}`
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const curves = context.curves
        if (!curves || context.domain !== AttrDomain.Point) return undefined
        const types = curveTypes(curves)
        const left = curvesAttributeOr(curves, 'handle_type_left', curves.pointsNum, 0)
        const right = curvesAttributeOr(curves, 'handle_type_right', curves.pointsNum, 0)
        const out = new Uint8Array(curves.pointsNum)
        for (let c = 0; c < curves.curvesNum; c++) {
            if (types[c] !== CURVE_TYPE_BEZIER) continue
            const [s, e] = curves.pointsRange(c)
            for (let i = s; i < e; i++) out[i] = (this.left && left[i] === this.handleType) || (this.right && right[i] === this.handleType) ? 1 : 0
        }
        return GVArray.fromArray('bool', out)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

registerNodeType({
    idname: 'GeometryNodeCurveHandleTypeSelection',
    label: 'Handle Type Selection',
    properties: {handle_type: 'AUTO', mode: ['LEFT', 'RIGHT']},
    enums: {handle_type: ['FREE', 'AUTO', 'VECTOR', 'ALIGN'], mode: ['LEFT', 'RIGHT']},
    declare(b) {
        b.output('BOOLEAN', 'Selection').field()
    },
    execute(p) {
        const sides = handleSides(p.node.prop('mode'))
        p.set('Selection', GField.fromInput(new HandleTypeFieldInput(HANDLE_TYPES[p.node.prop<string>('handle_type')], sides.left, sides.right)))
    },
})

/** `HandlePositionFieldInput` (`node_geo_input_curve_handles.cc:30`). */
class HandlePositionFieldInput extends FieldInput {
    constructor(private readonly relative: GField, private readonly left: boolean) {
        super('float3', 'Handle')
    }

    key(): string {
        return `handle-position:${this.left}:${this.relative.node.id}:${this.relative.index}`
    }

    children(): GField[] {
        return [this.relative]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const curves = context.curves
        if (!curves) return undefined
        const relative = new FieldEvaluation(context.withDomain(AttrDomain.Point), curves.pointsNum).evaluate(this.relative)
        const positions = curves.positions
        // `lookup_or_default<float3>(side, Point, {0, 0, 0})`.
        const layer = curves.attributes.get(this.left ? 'handle_left' : 'handle_right')
        const handles = layer ? layer.data : new Float32Array(curves.pointsNum * 3)
        const out = new Float32Array(curves.pointsNum * 3)
        for (let i = 0; i < curves.pointsNum; i++) {
            const rel = relative.isSingle ? relative.get(0) : relative.get(i)
            for (let k = 0; k < 3; k++) out[i * 3 + k] = rel ? f32(handles[i * 3 + k] - positions[i * 3 + k]) : handles[i * 3 + k]
        }
        return curves.accessor().adaptDomain(GVArray.fromArray('float3', out), AttrDomain.Point, context.domain)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

registerNodeType({
    idname: 'GeometryNodeInputCurveHandlePositions',
    label: 'Curve Handle Positions',
    declare(b) {
        b.input('BOOLEAN', 'Relative').default(false).field()
        b.output('VECTOR', 'Left').field()
        b.output('VECTOR', 'Right').field()
    },
    execute(p) {
        const relative = p.field('Relative')
        p.set('Left', GField.fromInput(new HandlePositionFieldInput(relative, true)))
        p.set('Right', GField.fromInput(new HandlePositionFieldInput(relative, false)))
    },
})

/** `update_handle_types_for_movement` (`node_geo_set_curve_handles.cc:52`) on elements `i` of `types` / `other`. */
function updateHandleTypesForMovement(types: {[i: number]: number}, other: {[i: number]: number}, i: number): boolean {
    switch (types[i]) {
    case BEZIER_HANDLE_FREE:
        return false
    case BEZIER_HANDLE_AUTO:
        if (other[i] === BEZIER_HANDLE_AUTO) {
            types[i] = BEZIER_HANDLE_ALIGN
            other[i] = BEZIER_HANDLE_ALIGN
        } else {
            types[i] = BEZIER_HANDLE_FREE
        }
        return false
    case BEZIER_HANDLE_VECTOR:
        types[i] = BEZIER_HANDLE_FREE
        return true
    case BEZIER_HANDLE_ALIGN:
        if (other[i] !== BEZIER_HANDLE_ALIGN) types[i] = BEZIER_HANDLE_FREE
        return false
    }
    return false
}

registerNodeType({
    idname: 'GeometryNodeSetCurveHandlePositions',
    label: 'Set Handle Positions',
    // `node_init` (:44): LEFT.
    properties: {mode: 'LEFT'},
    enums: {mode: ['LEFT', 'RIGHT']},
    declare(b, node) {
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Position').implicit(node.prop<string>('mode') === 'LEFT' ? 'HANDLE_LEFT' : 'HANDLE_RIGHT').field()
        b.input('VECTOR', 'Offset').default([0, 0, 0]).subtype('TRANSLATION').field()
    },
    // `node_geo_exec` (:136) with `set_position_in_component` (:79).
    execute(p) {
        const useLeft = p.node.prop<string>('mode') === 'LEFT'
        const selectionField = p.field('Selection'), positionField = p.field('Position'), offsetField = p.field('Offset')
        let hasCurves = false, hasBezier = false
        const out = foreachRealGeometry(p.geometry('Curve'), g => {
            if (!g.curves) return
            hasCurves = true
            if (!g.curves.attributes.get('handle_left') || !g.curves.attributes.get('handle_right')) return
            hasBezier = true
            if (g.curves.pointsNum === 0) return
            const curves = g.curvesForWrite()!
            const e = new FieldEvaluation(new FieldContext('curves', curves, AttrDomain.Point), curves.pointsNum)
            const sel = mask(e.evaluate(selectionField), curves.pointsNum)
            const newPositions = e.evaluate(positionField).materialize()
            const newOffsets = e.evaluate(offsetField).materialize()
            const positions = curves.positions
            const tl = curvesAttributeForWrite(curves, 'handle_type_left', [0])
            const tr = curvesAttributeForWrite(curves, 'handle_type_right', [0])
            const types = useLeft ? tl : tr, typesOther = useLeft ? tr : tl
            const hl = curvesAttributeForWrite(curves, 'handle_left', [0, 0, 0])
            const hr = curvesAttributeForWrite(curves, 'handle_right', [0, 0, 0])
            const handles = useLeft ? hl : hr, handlesOther = useLeft ? hr : hl
            for (const i of sel) updateHandleTypesForMovement(types, typesOther, i)
            for (const i of sel) {
                // `bezier::set_handle_position` (`curve_bezier.cc:215`).
                const type = types[i]
                if (type === BEZIER_HANDLE_AUTO || type === BEZIER_HANDLE_VECTOR) continue
                for (let k = 0; k < 3; k++) handles[i * 3 + k] = f32(newPositions[i * 3 + k] + newOffsets[i * 3 + k])
                if (typesOther[i] === BEZIER_HANDLE_ALIGN) {
                    const pos = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
                    const h = [handles[i * 3], handles[i * 3 + 1], handles[i * 3 + 2]]
                    const o = [handlesOther[i * 3], handlesOther[i * 3 + 1], handlesOther[i * 3 + 2]]
                    const v = calculateAlignedHandle(pos, h, o)
                    for (let k = 0; k < 3; k++) handlesOther[i * 3 + k] = v[k]
                }
            }
            calculateBezierAutoHandles(curves)
        }, p.options.scene)
        if (hasCurves && !hasBezier) p.warn('Input curves do not have Bézier type')
        p.set('Curve', out)
    },
})

/** `rna_enum_curve_normal_mode_items` (`rna_curves.cc:58`) by menu item name. */
const NORMAL_MODES: Record<string, number> = {'Minimum Twist': NORMAL_MODE_MINIMUM_TWIST, 'Z Up': NORMAL_MODE_Z_UP, 'Free': NORMAL_MODE_FREE}

registerNodeType({
    idname: 'GeometryNodeSetCurveNormal',
    label: 'Set Curve Normal',
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.output('GEOMETRY', 'Curve')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('MENU', 'Mode').default('Minimum Twist')
        b.input('VECTOR', 'Normal').default([0, 0, 1]).subtype('XYZ').field()
    },
    // `node_geo_exec` (:99) with `set_curve_normal` (:36).
    execute(p) {
        const modeName = p.string('Mode')
        const mode = NORMAL_MODES[modeName]
        if (mode === undefined) throw new Error(`Set Curve Normal: mode '${modeName}' is not a menu item`)
        const selectionField = p.field('Selection')
        const customNormal = mode === NORMAL_MODE_FREE ? p.field('Normal') : undefined
        p.set('Curve', foreachRealGeometry(p.geometry('Curve'), g => {
            if (!g.curves) return
            const curves: CurvesGeometry = g.curvesForWrite()!
            const curveMask = mask(new FieldEvaluation(new FieldContext('curves', curves, AttrDomain.Curve), curves.curvesNum).evaluate(selectionField), curves.curvesNum)
            if (customNormal) {
                const sel = GField.fromInput(new EvaluateOnDomainInput(selectionField, AttrDomain.Curve))
                captureFieldsOnGeometry(g, 'curves', ['custom_normal'], AttrDomain.Point, sel, [customNormal])
            }
            const modes = curvesAttributeForWrite(g.curves!, 'normal_mode', [0])
            for (const c of curveMask) modes[c] = mode
        }, p.options.scene))
    },
})

/** `Clamp Negative` (`node_geo_set_nurbs_weight.cc:34`): `std::max(value, 0.0f)`. */
const clampNegative = elementwise('Clamp Negative', ['float'], ['float'], (ins, outs) => {
    outs[0][0] = ins[0][0] < 0 ? 0 : ins[0][0]
})

registerNodeType({
    idname: 'GeometryNodeSetNURBSWeight',
    label: 'Set NURBS Weight',
    declare(b) {
        b.input('GEOMETRY', 'Curves')
        b.output('GEOMETRY', 'Curves')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('FLOAT', 'Weight').min(0).default(1).field()
    },
    // `node_geo_exec` (:29).
    execute(p) {
        const selection = p.field('Selection')
        const weight = new FieldOperation(clampNegative, [p.field('Weight')]).output(0)
        let hasCurves = false, hasNurbs = false
        const out = foreachRealGeometry(p.geometry('Curves'), g => {
            if (!g.curves) return
            hasCurves = true
            if (!Array.prototype.some.call(curveTypes(g.curves), (t: number) => t === CURVE_TYPE_NURBS)) return
            captureFieldsOnGeometry(g, 'curves', ['nurbs_weight'], AttrDomain.Point, selection, [weight])
            hasNurbs = true
        }, p.options.scene)
        if (hasCurves && !hasNurbs) p.warn('Input curves do not have NURBS type')
        p.set('Curves', out)
    },
})

registerNodeType({
    idname: 'GeometryNodeSetNURBSOrder',
    label: 'Set NURBS Order',
    declare(b) {
        b.input('GEOMETRY', 'Curves')
        b.output('GEOMETRY', 'Curves')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'Order').default(4).min(2).max(127).field()
    },
    // `node_geo_exec` (:56): the order converted to int8 (`try_convert`).
    execute(p) {
        const selection = p.field('Selection')
        const order = convertField(p.field('Order'), 'int8')
        let hasNurbs = false
        const out = foreachRealGeometry(p.geometry('Curves'), g => {
            if (!g.curves) return
            if (!Array.prototype.some.call(curveTypes(g.curves), (t: number) => t === CURVE_TYPE_NURBS)) return
            captureFieldsOnGeometry(g, 'curves', ['nurbs_order'], AttrDomain.Curve, selection, [order])
            hasNurbs = true
        }, p.options.scene)
        if (!hasNurbs) p.warn('Input curves do not have NURBS type')
        p.set('Curves', out)
    },
})
