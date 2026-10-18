/**
 * Curve field inputs: Spline Length (`node_geo_input_spline_length.cc`, `CurveLengthFieldInput` in
 * `blenkernel/intern/geometry_component_curves.cc:252`) and Endpoint Selection (`node_geo_curve_endpoint_selection.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {CurvesEvaluator} from '../../geometry/curvesEval'
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
