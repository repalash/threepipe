/**
 * Curve field inputs: Spline Length (`node_geo_input_spline_length.cc`, `CurveLengthFieldInput` in
 * `blenkernel/intern/geometry_component_curves.cc:252`) and Endpoint Selection (`node_geo_curve_endpoint_selection.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {CURVE_TYPE_BEZIER, CURVE_TYPE_CATMULL_ROM, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, CurvesEvaluator} from '../../geometry/curvesEval'
import {curveTangentsVArray} from '../../geometry/curvesFields'
import {f32} from '../../blender/f32'
import {length3, sub3} from '../../blender/math/vec'
import type {DataType} from '../../geometry/dataTypes'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/** `bke::CurvesFieldInput` (`geometry_fields.cc:341`): nothing off curves. */
abstract class CurvesFieldInput extends FieldInput {
    constructor(type: DataType, name: string, private readonly keyName: string) {
        super(type, name)
    }

    key(): string {
        return this.keyName
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const curves = context.curves
        if (!curves) return undefined
        return this.curvesVArray(curves, context.domain, context)
    }

    abstract curvesVArray(curves: CurvesGeometry, domain: AttrDomain, context: FieldContext): GVArray | undefined
}

/** Per-curve values on the curve domain, or adapted to points (`adapt_domain`); nothing on other domains. */
function curveValues(curves: CurvesGeometry, domain: AttrDomain, values: GVArray): GVArray | undefined {
    if (domain === AttrDomain.Curve) return values
    if (domain === AttrDomain.Point) return curves.accessor().adaptDomain(values, AttrDomain.Curve, AttrDomain.Point)
    return undefined
}

/** `CurveLengthFieldInput` (`geometry_component_curves.cc:274`): `evaluated_length_total_for_curve`. */
export class CurveLengthFieldInput extends CurvesFieldInput {
    constructor() {
        super('float', 'Spline Length node', 'curve-length')
    }

    curvesVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
        const ev = new CurvesEvaluator(curves)
        const out = new Float32Array(curves.curvesNum)
        for (let c = 0; c < curves.curvesNum; c++) out[c] = ev.lengthTotal(c)
        return curveValues(curves, domain, GVArray.fromArray('float', out))
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Curve
    }
}

/** `SplineCountFieldInput` (`node_geo_input_spline_length.cc:43`). */
class SplineCountFieldInput extends CurvesFieldInput {
    constructor() {
        super('int32', 'Spline Point Count', 'curve-point-count')
    }

    curvesVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
        const out = new Int32Array(curves.curvesNum)
        for (let c = 0; c < curves.curvesNum; c++) out[c] = curves.curveOffsets[c + 1] - curves.curveOffsets[c]
        return curveValues(curves, domain, GVArray.fromArray('int32', out))
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Curve
    }
}

registerNodeType({
    idname: 'GeometryNodeSplineLength',
    label: 'Spline Length',
    declare(b) {
        b.output('FLOAT', 'Length').field()
        b.output('INT', 'Point Count').field()
    },
    // `node_geo_exec` (:69).
    execute(p) {
        p.set('Length', GField.fromInput(new CurveLengthFieldInput()))
        p.set('Point Count', GField.fromInput(new SplineCountFieldInput()))
    },
})

/** `EndpointFieldInput` (`node_geo_curve_endpoint_selection.cc:30`). */
class EndpointFieldInput extends FieldInput {
    constructor(private readonly startSize: GField, private readonly endSize: GField) {
        super('bool', 'Endpoint Selection node')
    }

    key(): string {
        return `curve-endpoint:${this.startSize.node.id}:${this.startSize.index}:${this.endSize.node.id}:${this.endSize.index}`
    }

    children(): GField[] {
        return [this.startSize, this.endSize]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        if (context.domain !== AttrDomain.Point) return undefined
        const curves = context.curves
        if (!curves) return undefined
        if (curves.pointsNum === 0) return undefined
        const e = new FieldEvaluation(context.withDomain(AttrDomain.Curve), curves.curvesNum)
        const start = e.evaluate(this.startSize)
        const end = e.evaluate(this.endSize)
        const out = new Uint8Array(curves.pointsNum)
        for (let c = 0; c < curves.curvesNum; c++) {
            const [ps, pe] = curves.pointsRange(c)
            const size = pe - ps
            // `points.take_front(start)` / `take_back(end)` clamp to the curve's size.
            const s = Math.min(Math.max(start.get(c, 0), 0), size)
            const t = Math.min(Math.max(end.get(c, 0), 0), size)
            out.fill(1, ps, ps + s)
            out.fill(1, pe - t, pe)
        }
        return GVArray.fromArray('bool', out)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

registerNodeType({
    idname: 'GeometryNodeCurveEndpointSelection',
    label: 'Endpoint Selection',
    declare(b) {
        b.input('INT', 'Start Size').min(0).default(1).field()
        b.input('INT', 'End Size').min(0).default(1).field()
        b.output('BOOLEAN', 'Selection').field()
    },
    // `node_geo_exec` (:103).
    execute(p) {
        p.set('Selection', GField.fromInput(new EndpointFieldInput(p.field('Start Size'), p.field('End Size'))))
    },
})

/** `TangentFieldInput` (`node_geo_input_tangent.cc:91`). */
class TangentFieldInput extends CurvesFieldInput {
    constructor() {
        super('float3', 'Tangent node', 'curve-tangent')
    }

    curvesVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
        return curveTangentsVArray(curves, domain)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

registerNodeType({
    idname: 'GeometryNodeInputTangent',
    label: 'Curve Tangent',
    declare(b) {
        b.output('VECTOR', 'Tangent').field()
    },
    execute(p) {
        p.set('Tangent', GField.fromInput(new TangentFieldInput()))
    },
})

// region Spline Parameter (`node_geo_curve_spline_parameter.cc`)

/** `accumulated_lengths_curve_domain` (:39): the length of all previous curves. */
function accumulatedLengthsCurveDomain(curves: CurvesGeometry, ev: CurvesEvaluator): Float32Array {
    const lengths = new Float32Array(curves.curvesNum)
    let length = 0
    for (let i = 0; i < curves.curvesNum; i++) {
        lengths[i] = length
        length = f32(length + ev.lengthTotal(i))
    }
    return lengths
}

/** `calculate_curve_parameters` (:53). */
function calculateCurveParameters(curves: CurvesGeometry): Float32Array {
    const ev = new CurvesEvaluator(curves)
    const lengths = accumulatedLengthsCurveDomain(curves, ev)
    const last = curves.curvesNum - 1
    const totalLength = f32(lengths[last] + ev.lengthTotal(last))
    if (totalLength > 0) {
        const factor = f32(1 / totalLength)
        for (let i = 0; i < lengths.length; i++) lengths[i] = f32(lengths[i] * factor)
    } else {
        for (let i = 0; i < lengths.length; i++) lengths[i] = f32(i / f32(lengths.length - 1))
    }
    return lengths
}

/** `calculate_point_lengths` (:86) with a per-curve `postprocess(lengths, total)`. */
function calculatePointLengths(curves: CurvesGeometry, postprocess: (lengths: Float32Array, total: number) => void): Float32Array {
    const ev = new CurvesEvaluator(curves)
    const result = new Float32Array(curves.pointsNum)
    const positions = curves.positions
    for (let c = 0; c < curves.curvesNum; c++) {
        const [s, e] = curves.pointsRange(c)
        const cyclic = !!ev.cyclic[c]
        const evaluatedLengths = ev.lengthsForCurve(c)
        const lengths = result.subarray(s, e)
        lengths[0] = 0
        const lastEvaluatedLength = evaluatedLengths.length ? evaluatedLengths[evaluatedLengths.length - 1] : 0
        let total = 0
        switch (ev.types[c]) {
        case CURVE_TYPE_CATMULL_ROM: {
            const resolution = ev.resolution[c]
            for (let i = 0; i < lengths.length - 1; i++) lengths[i + 1] = evaluatedLengths[resolution * (i + 1) - 1]
            total = lastEvaluatedLength
            break
        }
        case CURVE_TYPE_POLY:
            lengths.set(evaluatedLengths.subarray(0, lengths.length - 1), 1)
            total = lastEvaluatedLength
            break
        case CURVE_TYPE_BEZIER: {
            const offsets = ev.bezierOffsets(c)
            for (let i = 0; i < lengths.length - 1; i++) lengths[i + 1] = evaluatedLengths[offsets[i + 1] - 1]
            total = lastEvaluatedLength
            break
        }
        case CURVE_TYPE_NURBS: {
            const n = e - s
            const p = (i: number) => positions.subarray((s + i) * 3, (s + i) * 3 + 3)
            let length = 0
            for (let i = 0; i < n - 1; i++) {
                lengths[i] = length
                length = f32(length + length3(sub3(p(i), p(i + 1))))
            }
            lengths[n - 1] = length
            if (cyclic) length = f32(length + length3(sub3(p(0), p(n - 1))))
            total = length
            break
        }
        }
        postprocess(lengths, total)
    }
    return result
}

/** `convert_lengths_to_factors` (:155). */
function convertLengthsToFactors(lengths: Float32Array, totalCurveLength: number): void {
    if (totalCurveLength > 0) {
        const factor = f32(1 / totalCurveLength)
        for (let i = 1; i < lengths.length; i++) lengths[i] = f32(lengths[i] * factor)
    } else if (lengths.length === 1) {
        lengths[0] = 0
    } else {
        for (let i = 0; i < lengths.length; i++) lengths[i] = f32(i / f32(lengths.length - 1))
    }
}

/** `CurveParameterFieldInput` (:183). */
class CurveParameterFieldInput extends CurvesFieldInput {
    constructor() {
        super('float', 'Spline Parameter node', 'curve-parameter')
    }

    curvesVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
        if (domain === AttrDomain.Point) return GVArray.fromArray('float', calculatePointLengths(curves, convertLengthsToFactors))
        if (domain === AttrDomain.Curve) return GVArray.fromArray('float', calculateCurveParameters(curves))
        return undefined
    }
}

/** `CurveLengthParameterFieldInput` (:212). */
class CurveLengthParameterFieldInput extends CurvesFieldInput {
    constructor() {
        super('float', 'Curve Length node', 'curve-length-parameter')
    }

    curvesVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
        if (domain === AttrDomain.Point) return GVArray.fromArray('float', calculatePointLengths(curves, () => undefined))
        if (domain === AttrDomain.Curve) return GVArray.fromArray('float', accumulatedLengthsCurveDomain(curves, new CurvesEvaluator(curves)))
        return undefined
    }
}

/** `IndexOnSplineFieldInput` (:241). */
class IndexOnSplineFieldInput extends CurvesFieldInput {
    constructor() {
        super('int32', 'Spline Index', 'curve-index-on-spline')
    }

    curvesVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
        if (domain !== AttrDomain.Point) return undefined
        const out = new Int32Array(curves.pointsNum)
        for (let c = 0; c < curves.curvesNum; c++) {
            const [s, e] = curves.pointsRange(c)
            for (let i = s; i < e; i++) out[i] = i - s
        }
        return GVArray.fromArray('int32', out)
    }

    preferredDomain(): AttrDomain {
        return AttrDomain.Point
    }
}

registerNodeType({
    idname: 'GeometryNodeSplineParameter',
    label: 'Spline Parameter',
    declare(b) {
        b.output('FLOAT', 'Factor').field()
        b.output('FLOAT', 'Length').field()
        b.output('INT', 'Index').field()
    },
    // `node_geo_exec` (:275).
    execute(p) {
        p.set('Factor', GField.fromInput(new CurveParameterFieldInput()))
        p.set('Length', GField.fromInput(new CurveLengthParameterFieldInput()))
        p.set('Index', GField.fromInput(new IndexOnSplineFieldInput()))
    },
})

// endregion

/** `curves_total_length` (`node_geo_curve_length.cc:19`). */
registerNodeType({
    idname: 'GeometryNodeCurveLength',
    label: 'Curve Length',
    declare(b) {
        b.input('GEOMETRY', 'Curve')
        b.output('FLOAT', 'Length')
    },
    // `node_geo_exec` (:31): only the top-level curves component.
    execute(p) {
        const curves = p.geometry('Curve').curves
        if (!curves) return
        const ev = new CurvesEvaluator(curves)
        let total = 0
        for (let i = 0; i < curves.curvesNum; i++) total = f32(total + ev.lengthTotal(i))
        p.set('Length', GField.constant('float', [total]))
    },
})
