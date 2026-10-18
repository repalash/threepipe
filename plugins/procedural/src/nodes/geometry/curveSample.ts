/** Sample Curve (`GeometryNodeSampleCurve`) - `nodes/geometry/nodes/node_geo_curve_sample.cc` (Blender 5.2.2). */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {normalize3} from '../../blender/math/vec'
import {GField, MultiFunction} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {CurvesEvaluator} from '../../geometry/curvesEval'
import {DATA_TYPES, DataType, TypedArray} from '../../geometry/dataTypes'
import {GeometrySet} from '../../geometry/GeometrySet'
import {interpolateSamples, sampleAtLength} from '../../geometry/resampleCurves'
import {registerNodeType} from '../../runtime/registry'
import {applyFunction} from '../util'
import {socketTypeFromRNA} from '../attributeTypes'
import {lazyComponentValues, SOCKET_ATTRIBUTE_TYPES} from './sample'

type Mode = 'FACTOR' | 'LENGTH'

const newHint = () => ({segmentIndex: -1, segmentStart: 0, segmentLengthInv: 0})
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : hi < v ? hi : v)

/** `curve_accumulated_lengths` (:437): the end length of every curve. */
function curveAccumulatedLengths(ev: CurvesEvaluator, curvesNum: number): Float32Array {
    const out = new Float32Array(curvesNum)
    let length = 0
    for (let i = 0; i < curvesNum; i++) {
        length = f32(length + ev.lengthTotal(i))
        out[i] = length
    }
    return out
}

/** `SampleFloatSegmentsFunction` (:150) with `sample_indices_and_lengths` (:101). */
function sampleFloatSegmentsFunction(accumulated: Float32Array, mode: Mode): MultiFunction {
    return {
        name: 'Sample Curve Index', inputs: ['float'], outputs: ['int32', 'float'],
        call(n, [lengths], [indices, lengthsInSegments]) {
            const total = accumulated[accumulated.length - 1]
            const hint = newHint()
            const idx = new Int32Array(1), fac = new Float32Array(1)
            for (let i = 0; i < n; i++) {
                const sampleLength = mode === 'FACTOR' ? f32(lengths.get(i) * total) : lengths.get(i)
                sampleAtLength(accumulated, clamp(sampleLength, 0, total), idx, fac, 0, hint)
                const seg = idx[0]
                const segmentStart = seg === 0 ? 0 : accumulated[seg - 1]
                const segmentLength = f32(accumulated[seg] - segmentStart)
                indices[i] = seg
                lengthsInSegments[i] = f32(fac[0] * segmentLength)
            }
        },
    }
}

/** `SampleCurveFunction` (:176): outputs Position, Tangent, Normal, Value. */
function sampleCurveFunction(geometry: GeometrySet, mode: Mode, valueField: GField): MultiFunction {
    const dt: DataType = valueField.type
    const c = DATA_TYPES[dt].components
    const values = lazyComponentValues(geometry, 'curves', AttrDomain.Point, valueField)
    return {
        name: 'Sample Curve', inputs: ['int32', 'float'], outputs: ['float3', 'float3', 'float3', dt],
        call(n, [curveIndices, lengths], [positions, tangents, normals, sampled]) {
            const curves = geometry.curves
            // `return_default` (:216): the value output stays as initialised.
            if (!curves || curves.pointsNum === 0) {
                positions.fill(0)
                tangents.fill(0)
                normals.fill(0)
                return
            }
            const ev = new CurvesEvaluator(curves)
            const src = values()
            const def = DATA_TYPES[dt].defaultValue
            const fillInvalid = (mask: number[]) => {
                for (const i of mask) {
                    positions.fill(0, i * 3, i * 3 + 3)
                    tangents.fill(0, i * 3, i * 3 + 3)
                    normals.fill(0, i * 3, i * 3 + 3)
                    for (let k = 0; k < c; k++) sampled[i * c + k] = def[k]
                }
            }
            const sampleCurve = (curve: number, mask: number[]) => {
                const [es, ee] = ev.evaluatedRange(curve)
                const [ps, pe] = curves.pointsRange(curve)
                if (ee - es === 1) {
                    for (const i of mask) {
                        positions.set(ev.positions.subarray(es * 3, es * 3 + 3), i * 3)
                        tangents.set(ev.tangents.subarray(es * 3, es * 3 + 3), i * 3)
                        normals.set(ev.normals.subarray(es * 3, es * 3 + 3), i * 3)
                        for (let k = 0; k < c; k++) sampled[i * c + k] = src.get(ps, k)
                    }
                    return
                }
                const accumulated = ev.lengthsForCurve(curve)
                if (accumulated.length === 0) {
                    fillInvalid(mask)
                    return
                }
                // `sample_indices_and_factors_to_compressed` (:119): one hint for the curve's mask.
                const total = accumulated[accumulated.length - 1]
                const indices = new Int32Array(mask.length), factors = new Float32Array(mask.length)
                const hint = newHint()
                mask.forEach((i, pos) => {
                    const length = mode === 'FACTOR' ? f32(lengths.get(i) * total) : lengths.get(i)
                    sampleAtLength(accumulated, clamp(length, 0, total), indices, factors, pos, hint)
                })
                // `interpolate_to_masked`, then normalised tangents / normals.
                const toMasked = (type: DataType, data: ArrayLike<number>, start: number, size: number, out: TypedArray, normalize: boolean) => {
                    const cc = DATA_TYPES[type].components
                    const tmp = new DATA_TYPES[type].array(mask.length * cc)
                    interpolateSamples(type, data, start, size, indices, factors, tmp, 0, mask.length)
                    mask.forEach((i, pos) => {
                        const v = tmp.subarray(pos * cc, pos * cc + cc)
                        out.set(normalize ? normalize3(v) : v, i * cc)
                    })
                }
                toMasked('float3', ev.positions, es, ee - es, positions, false)
                toMasked('float3', ev.tangents, es, ee - es, tangents, true)
                toMasked('float3', ev.normals, es, ee - es, normals, true)
                const original = new DATA_TYPES[dt].array((pe - ps) * c)
                for (let p = ps; p < pe; p++) for (let k = 0; k < c; k++) original[(p - ps) * c + k] = src.get(p, k)
                const evaluated = new DATA_TYPES[dt].array((ee - es) * c)
                ev.interpolateToEvaluated(curve, dt, original, evaluated)
                toMasked(dt, evaluated, 0, ee - es, sampled, false)
            }
            const all = Array.from({length: n}, (_, i) => i)
            if (curveIndices.isSingle) {
                const ci = curveIndices.get(0)
                if (ci >= 0 && ci < curves.curvesNum) sampleCurve(ci, all)
                else fillInvalid(all)
                return
            }
            // `VectorSet` of the used curves in first-use order, a mask per curve.
            const used = new Map<number, number[]>()
            const invalid: number[] = []
            for (let i = 0; i < n; i++) {
                const ci = curveIndices.get(i)
                if (ci >= 0 && ci < curves.curvesNum) {
                    let m = used.get(ci)
                    if (!m) used.set(ci, m = [])
                    m.push(i)
                } else {
                    invalid.push(i)
                }
            }
            for (const [ci, m] of used) sampleCurve(ci, m)
            fillInvalid(invalid)
        },
    }
}

registerNodeType({
    idname: 'GeometryNodeSampleCurve',
    label: 'Sample Curve',
    // `node_init` (:78).
    properties: {mode: 'FACTOR', use_all_curves: false, data_type: 'FLOAT'},
    enums: {mode: ['FACTOR', 'LENGTH'], data_type: SOCKET_ATTRIBUTE_TYPES},
    // `node_declare` (:21).
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        const mode = node.prop<string>('mode')
        b.input('GEOMETRY', 'Curves')
        b.input(type, 'Value').hideValue().field()
        b.input('FLOAT', 'Factor').min(0).max(1).subtype('FACTOR').field().available(mode === 'FACTOR')
        b.input('FLOAT', 'Length').min(0).subtype('DISTANCE').field().available(mode === 'LENGTH')
        b.input('INT', 'Curve Index').field().available(!node.prop<boolean>('use_all_curves'))
        b.output(type, 'Value')
        b.output('VECTOR', 'Position')
        b.output('VECTOR', 'Tangent')
        b.output('VECTOR', 'Normal')
    },
    // `node_geo_exec` (:449).
    execute(p) {
        const geometry = p.geometry('Curves')
        const curves: CurvesGeometry | undefined = geometry.curves
        if (!curves || curves.pointsNum === 0) return
        const mode = p.node.prop<Mode>('mode')
        const sampleLength = p.field(mode === 'FACTOR' ? 'Factor' : 'Length')
        const valueField = p.field('Value')
        let outs: GField[]
        if (curves.curvesNum === 1) {
            outs = applyFunction(sampleCurveFunction(geometry, mode, valueField), [GField.constant('int32', [0]), sampleLength])
        } else if (p.node.prop<boolean>('use_all_curves')) {
            const ev = new CurvesEvaluator(curves)
            const [curveIndex, lengthInCurve] = applyFunction(sampleFloatSegmentsFunction(curveAccumulatedLengths(ev, curves.curvesNum), mode), [sampleLength])
            outs = applyFunction(sampleCurveFunction(geometry, 'LENGTH', valueField), [curveIndex, lengthInCurve])
        } else {
            outs = applyFunction(sampleCurveFunction(geometry, mode, valueField), [p.field('Curve Index'), sampleLength])
        }
        p.set('Position', outs[0])
        p.set('Tangent', outs[1])
        p.set('Normal', outs[2])
        p.set('Value', outs[3])
    },
})

