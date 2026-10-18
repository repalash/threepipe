/**
 * Field utility nodes: Evaluate on Domain (`node_geo_evaluate_on_domain.cc`), Evaluate at Index
 * (`node_geo_evaluate_at_index.cc`), Domain Size (`node_geo_attribute_domain_size.cc`), Accumulate Field
 * (`node_geo_accumulate_field.cc`), and the 5.x field statistics Field Average, Field Min & Max and Field Variance
 * (`node_geo_field_average.cc`, `node_geo_field_min_and_max.cc`, `node_geo_field_variance.cc`).
 *
 * The statistics take Blender's grouped path for every input: its single-group path (`group_indices.is_single()`)
 * does the same operations in the same order on one group.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {mat4Multiply} from '../../blender/math/matrix'
import {EvaluateAtIndexInput, EvaluateOnDomainInput, FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'
import type {SocketType} from '../../runtime/types'
import {domainFromRNA, socketTypeFromRNA} from '../attributeTypes'

const DOMAINS = ['POINT', 'EDGE', 'FACE', 'CORNER', 'CURVE', 'INSTANCE', 'LAYER']
/** `rna_enum_attribute_type_items` filtered by `attribute_type_type_with_socket_fn`. */
const SOCKET_TYPES = ['FLOAT', 'INT', 'BOOLEAN', 'FLOAT_VECTOR', 'FLOAT_COLOR', 'QUATERNION', 'FLOAT4X4']
const FLT_MAX = 3.4028234663852886e38

function domainOf(name: string): AttrDomain {
    if (name === 'LAYER') throw new Error('the grease pencil layer domain is not supported (no grease pencil component)')
    return domainFromRNA(name)
}

// region Evaluate on Domain / at Index

registerNodeType({
    idname: 'GeometryNodeFieldOnDomain',
    label: 'Evaluate on Domain',
    // `node_init` (:43): POINT, CD_PROP_FLOAT; RNA `domain` (custom1) and `data_type` (custom2).
    properties: {domain: 'POINT', data_type: 'FLOAT'},
    enums: {domain: DOMAINS, data_type: SOCKET_TYPES},
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        b.input(type, 'Value').field()
        b.output(type, 'Value').field()
    },
    execute(p) {
        p.set('Value', GField.fromInput(new EvaluateOnDomainInput(p.field('Value'), domainOf(p.node.prop<string>('domain')))))
    },
})

registerNodeType({
    idname: 'GeometryNodeFieldAtIndex',
    label: 'Evaluate at Index',
    properties: {domain: 'POINT', data_type: 'FLOAT'},
    enums: {domain: DOMAINS, data_type: SOCKET_TYPES},
    // :21-33: Value, then Index (a field input; unlinked it is 0 - `min(0)`, no implicit field).
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        b.input(type, 'Value').hideValue().field()
        b.output(type, 'Value').field()
        b.input('INT', 'Index').min(0).field()
    },
    execute(p) {
        p.set('Value', GField.fromInput(new EvaluateAtIndexInput(p.field('Index'), p.field('Value'), domainOf(p.node.prop<string>('domain')))))
    },
})

// endregion

// region Domain Size

const COMPONENTS = ['MESH', 'POINTCLOUD', 'CURVE', 'INSTANCES', 'GREASEPENCIL']

registerNodeType({
    idname: 'GeometryNodeAttributeDomainSize',
    label: 'Domain Size',
    // `node_init` (:98): Mesh.
    properties: {component: 'MESH'},
    enums: {component: COMPONENTS},
    // :23-91: one output per domain, available for the chosen component.
    declare(b, node) {
        const c = node.prop<string>('component')
        b.input('GEOMETRY', 'Geometry')
        b.output('INT', 'Point Count').available(c === 'MESH' || c === 'CURVE' || c === 'POINTCLOUD')
        b.output('INT', 'Edge Count').available(c === 'MESH')
        b.output('INT', 'Face Count').available(c === 'MESH')
        b.output('INT', 'Face Corner Count').available(c === 'MESH')
        b.output('INT', 'Spline Count').available(c === 'CURVE')
        b.output('INT', 'Instance Count').available(c === 'INSTANCES')
        b.output('INT', 'Layer Count').available(c === 'GREASEPENCIL')
    },
    execute(p) {
        const g = p.geometry('Geometry')
        const set = (name: string, n: number) => p.set(name, GField.constant('int32', [n]))
        switch (p.node.prop<string>('component')) {
        case 'MESH':
            if (g.mesh) {
                set('Point Count', g.mesh.vertsNum)
                set('Edge Count', g.mesh.edgesNum)
                set('Face Count', g.mesh.facesNum)
                set('Face Corner Count', g.mesh.cornersNum)
            }
            break
        case 'CURVE':
            if (g.curves) {
                set('Point Count', g.curves.pointsNum)
                set('Spline Count', g.curves.curvesNum)
            }
            break
        case 'POINTCLOUD':
            if (g.pointCloud) set('Point Count', g.pointCloud.pointsNum)
            break
        case 'INSTANCES':
            if (g.instances) set('Instance Count', g.instances.instancesNum)
            break
        default:
            // No grease pencil component: the outputs keep their defaults, as for a missing component.
            break
        }
    },
})

// endregion

// region grouped field inputs

/** Values of `input` and the group ids on `domain` of the context's geometry, or undefined when the domain is empty. */
function evaluateGrouped(context: FieldContext, domain: AttrDomain, input: GField, groupId: GField) {
    const attrs = context.attributes()
    if (!attrs.supportsDomain(domain)) return undefined
    const size = attrs.domainSize(domain)
    if (size === 0) return undefined
    const src = context.withDomain(domain)
    const evaluation = new FieldEvaluation(src, size)
    const values = evaluation.evaluate(input)
    const groups = evaluation.evaluate(groupId)
    return {attrs, size, values, groups}
}

/** Element-wise arithmetic on the field's type (float32 per component, int32 wrapping), as `T + T` etc. */
type Vec = number[]

function read(values: GVArray, i: number, c: number): Vec {
    const v = new Array<number>(c)
    for (let k = 0; k < c; k++) v[k] = values.get(i, k)
    return v
}

function arith(type: DataType) {
    const int = type === 'int32'
    const add = (a: Vec, b: Vec) => a.map((x, k) => (int ? (x + b[k]) | 0 : f32(x + b[k])))
    const sub = (a: Vec, b: Vec) => a.map((x, k) => (int ? (x - b[k]) | 0 : f32(x - b[k])))
    const mul = (a: Vec, b: Vec) => a.map((x, k) => (int ? Math.imul(x, b[k]) : f32(x * b[k])))
    // `T / int` (a count): integer division for ints, `float / float(n)` otherwise.
    const divN = (a: Vec, n: number) => a.map(x => (int ? Math.trunc(x / n) : f32(x / f32(n))))
    return {add, sub, mul, divN}
}

function output(type: DataType, size: number, fill: (i: number) => Vec): GVArray {
    const c = DATA_TYPES[type].components
    const out = new DATA_TYPES[type].array(size * c)
    for (let i = 0; i < size; i++) out.set(fill(i), i * c)
    return GVArray.fromArray(type, out)
}

type Accumulation = 'Leading' | 'Trailing' | 'Total'

/** `AccumulateFieldInput` / `TotalFieldInput` (`node_geo_accumulate_field.cc:186`, :282): `+`, or `*` for matrices. */
class AccumulateInput extends FieldInput {
    constructor(readonly domain: AttrDomain, readonly input: GField, readonly groupId: GField, readonly mode: Accumulation) {
        super(input.type, mode === 'Total' ? 'Total Value' : 'Accumulation')
    }

    children(): GField[] {
        return [this.input, this.groupId]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const e = evaluateGrouped(context, this.domain, this.input, this.groupId)
        if (!e) return undefined
        const type = this.type, c = DATA_TYPES[type].components
        // `AccumulationInfo` (:166): identity for matrices, `T()` (zeros) otherwise.
        const initial = (): Vec => (type === 'float4x4' ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : new Array(c).fill(0))
        const {add} = arith(type)
        const accumulate = (a: Vec, b: Vec): Vec => (type === 'float4x4' ? Array.from(mat4Multiply(a, b)) : add(a, b))
        const sums = new Map<number, Vec>()
        const outputs: Vec[] = new Array(e.size)
        for (let i = 0; i < e.size; i++) {
            const g = e.groups.get(i)
            const before = sums.get(g) ?? initial()
            const after = accumulate(before, read(e.values, i, c))
            sums.set(g, after)
            outputs[i] = this.mode === 'Trailing' ? before : after
        }
        const result = output(type, e.size, i => (this.mode === 'Total' ? sums.get(e.groups.get(i))! : outputs[i]))
        return e.attrs.adaptDomain(result, this.domain, context.domain)
    }
}

type Statistic = 'Mean' | 'Median' | 'Min' | 'Max' | 'Standard Deviation' | 'Variance'

/** Median of one component: `std::nth_element` at n/2, and for even n the midpoint with the largest lower value. */
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => (a < b ? -1 : b < a ? 1 : 0))
    const mid = sorted[sorted.length >> 1]
    if (sorted.length % 2 === 0) return f32(f32(sorted[(sorted.length >> 1) - 1] + mid) * 0.5)
    return mid
}

/** `FieldAverageInput`, `FieldMinMaxInput`, `FieldVarianceInput`: per group id. */
class StatisticInput extends FieldInput {
    constructor(readonly domain: AttrDomain, readonly input: GField, readonly groupId: GField, readonly statistic: Statistic) {
        super(input.type, 'Calculation')
    }

    children(): GField[] {
        return [this.input, this.groupId]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const e = evaluateGrouped(context, this.domain, this.input, this.groupId)
        if (!e) return undefined
        const type = this.type, c = DATA_TYPES[type].components
        const {add, sub, mul, divN} = arith(type)
        const groups = new Map<number, number[]>()
        for (let i = 0; i < e.size; i++) {
            const g = e.groups.get(i)
            let list = groups.get(g)
            if (!list) groups.set(g, list = [])
            list.push(i)
        }
        const results = new Map<number, Vec>()
        for (const [g, items] of groups) {
            const values = items.map(i => read(e.values, i, c))
            let r: Vec
            switch (this.statistic) {
            case 'Min':
            case 'Max': {
                // `MinMaxInfo` (:122): max() / lowest() starts, `std::min` / `std::max`.
                const int = type === 'int32'
                const start = this.statistic === 'Min' ? (int ? 2147483647 : FLT_MAX) : (int ? -2147483648 : -FLT_MAX)
                r = new Array(c).fill(start)
                for (const v of values) r = r.map((x, k) => (this.statistic === 'Min' ? (v[k] < x ? v[k] : x) : (x < v[k] ? v[k] : x)))
                break
            }
            case 'Median':
                r = new Array(c).fill(0).map((_, k) => median(values.map(v => v[k])))
                break
            default: {
                let sum: Vec = new Array(c).fill(0)
                for (const v of values) sum = add(sum, v)
                const mean = divN(sum, values.length)
                if (this.statistic === 'Mean') {
                    r = mean
                    break
                }
                // `deviation = mean - value; deviation * deviation`, summed in element order.
                let dev: Vec = new Array(c).fill(0)
                for (const v of values) {
                    const d = sub(mean, v)
                    dev = add(dev, mul(d, d))
                }
                r = divN(dev, values.length)
                if (this.statistic === 'Standard Deviation') r = r.map(x => f32(Math.sqrt(x)))
            }
            }
            results.set(g, r)
        }
        const result = output(type, e.size, i => results.get(e.groups.get(i))!)
        return e.attrs.adaptDomain(result, this.domain, context.domain)
    }
}

/** Declaration and exec shared by the grouped field nodes. */
function groupedNode(idname: string, label: string, types: string[], outputs: readonly Statistic[] | readonly Accumulation[],
    valueDefault: (t: SocketType) => number | number[] | undefined, make: (domain: AttrDomain, input: GField, group: GField, out: string) => FieldInput) {
    registerNodeType({
        idname,
        label,
        // `node_init`: CD_PROP_FLOAT, POINT.
        properties: {data_type: 'FLOAT', domain: 'POINT'},
        enums: {data_type: types, domain: DOMAINS},
        declare(b, node) {
            const t = socketTypeFromRNA(node.prop<string>('data_type') === 'TRANSFORM' ? 'FLOAT4X4' : node.prop<string>('data_type'))
            const v = b.input(t, 'Value').field()
            const d = valueDefault(t)
            if (d !== undefined) v.default(d)
            b.input('INT', 'Group ID', 'Group Index').hideValue().field()
            for (const o of outputs) b.output(t, o).field()
        },
        execute(p) {
            const domain = domainOf(p.node.prop<string>('domain'))
            const input = p.field('Value'), group = p.field('Group Index')
            for (const o of outputs) if (p.outputUsed(o)) p.set(o, GField.fromInput(make(domain, input, group, o)))
        },
    })
}

// :28-45: Value defaults 1 / (1, 1, 1) / 1 / identity.
groupedNode('GeometryNodeAccumulateField', 'Accumulate Field', ['FLOAT', 'INT', 'FLOAT_VECTOR', 'TRANSFORM'], ['Leading', 'Trailing', 'Total'],
    t => (t === 'VECTOR' ? [1, 1, 1] : t === 'FLOAT' || t === 'INT' ? 1 : undefined),
    (d, i, g, o) => new AccumulateInput(d, i, g, o as Accumulation))
groupedNode('GeometryNodeFieldAverage', 'Field Average', ['FLOAT', 'FLOAT_VECTOR'], ['Mean', 'Median'], () => undefined,
    (d, i, g, o) => new StatisticInput(d, i, g, o as Statistic))
groupedNode('GeometryNodeFieldMinAndMax', 'Field Min & Max', ['FLOAT', 'INT', 'FLOAT_VECTOR'], ['Min', 'Max'], () => undefined,
    (d, i, g, o) => new StatisticInput(d, i, g, o as Statistic))
groupedNode('GeometryNodeFieldVariance', 'Field Variance', ['FLOAT', 'FLOAT_VECTOR'], ['Standard Deviation', 'Variance'], () => undefined,
    (d, i, g, o) => new StatisticInput(d, i, g, o as Statistic))

// endregion
