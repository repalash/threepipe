/**
 * Map Range (`ShaderNodeMapRange`) - `nodes/shader/nodes/node_shader_map_range.cc`: declaration :34,
 * availability `node_shader_update_map_range` :75, `node_init` :108 (clamp on, FLOAT, LINEAR), functions
 * :235-440 (`clamp_range` :235 swaps reversed bounds; STEPPED clamps like LINEAR, which fixes audit M13 of
 * `issues/open/audit-procgen-math-nodes-blender-port-bugs.md`; SMOOTHSTEP/SMOOTHERSTEP never clamp the
 * result).
 */

import {f32} from '../../blender/f32'
import {stdClamp} from '../../blender/math/base'
import {elementwise, MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'

/** `safe_divide` (`math_base_safe_inline.cc:16`) / `math::safe_divide` (`BLI_math_base.hh:107`). */
const safeDivide = (a: number, b: number) => (b !== 0 ? f32(a / b) : 0)
/** `clamp_range` (`node_shader_map_range.cc:235`). */
const clampRange = (value: number, min: number, max: number) => (min > max ? stdClamp(value, max, min) : stdClamp(value, min, max))

type Scalar = (v: number, fromMin: number, fromMax: number, toMin: number, toMax: number, steps: number) => number

/**
 * The per-component formula of each interpolation (`build_float_*` / `build_vector_*`). The float and
 * vector versions perform the same float operations per component (addition and multiplication commute).
 */
const FORMULAS: Record<string, (clamp: boolean) => Scalar> = {
    // `build_float_linear` :247 / `build_vector_linear` :279.
    LINEAR: clamp => (v, fromMin, fromMax, toMin, toMax) => {
        const factor = safeDivide(f32(v - fromMin), f32(fromMax - fromMin))
        const result = f32(toMin + f32(factor * f32(toMax - toMin)))
        return clamp ? clampRange(result, toMin, toMax) : result
    },
    // `build_float_stepped` :262 / `build_vector_stepped` :298.
    STEPPED: clamp => (v, fromMin, fromMax, toMin, toMax, steps) => {
        let factor = safeDivide(f32(v - fromMin), f32(fromMax - fromMin))
        factor = safeDivide(Math.floor(f32(factor * f32(steps + 1))), steps)
        const result = f32(toMin + f32(factor * f32(toMax - toMin)))
        return clamp ? clampRange(result, toMin, toMax) : result
    },
    // :412 (`std::clamp`) / :350 (`clamp_v3`, CLAMP - the same results, NaN included).
    SMOOTHSTEP: () => (v, fromMin, fromMax, toMin, toMax) => {
        let factor = safeDivide(f32(v - fromMin), f32(fromMax - fromMin))
        factor = stdClamp(factor, 0, 1)
        factor = f32(f32(3 - f32(2 * factor)) * f32(factor * factor))
        return f32(toMin + f32(factor * f32(toMax - toMin)))
    },
    // :426 / :367: `factor * factor * factor * (factor * (factor * 6 - 15) + 10)`.
    SMOOTHERSTEP: () => (v, fromMin, fromMax, toMin, toMax) => {
        let factor = safeDivide(f32(v - fromMin), f32(fromMax - fromMin))
        factor = stdClamp(factor, 0, 1)
        factor = f32(f32(f32(factor * factor) * factor) * f32(f32(factor * f32(f32(factor * 6) - 15)) + 10))
        return f32(toMin + f32(factor * f32(toMax - toMin)))
    },
}

const functionFor = cached((key: string): MultiFunction => {
    const [dataType, interpolation, clampFlag] = key.split(':')
    const make = FORMULAS[interpolation]
    if (!make) throw new Error(`procedural: Map Range interpolation ${interpolation} is not supported`)
    const f = make(clampFlag === '1')
    const n = interpolation === 'STEPPED' ? 6 : 5
    if (dataType === 'FLOAT') {
        return elementwise(`Map Range ${interpolation}`, new Array(n).fill('float'), ['float'], (i, o) => {
            o[0][0] = f(i[0][0], i[1][0], i[2][0], i[3][0], i[4][0], n === 6 ? i[5][0] : 0)
        })
    }
    if (dataType === 'FLOAT_VECTOR') {
        return elementwise(`Vector Map Range ${interpolation}`, new Array(n).fill('float3'), ['float3'], (i, o) => {
            for (let k = 0; k < 3; k++) o[0][k] = f(i[0][k], i[1][k], i[2][k], i[3][k], i[4][k], n === 6 ? i[5][k] : 0)
        })
    }
    throw new Error(`procedural: Map Range data type ${dataType} is not supported`)
})

registerNodeType({
    idname: 'ShaderNodeMapRange',
    label: 'Map Range',
    properties: {clamp: true, interpolation_type: 'LINEAR', data_type: 'FLOAT'},
    // `def_map_range` (`makesrna/intern/rna_nodetree.cc:4865`): `rna_enum_node_map_range_items` (:428) and its
    // local `rna_enum_data_type_items`.
    enums: {interpolation_type: ['LINEAR', 'STEPPED', 'SMOOTHSTEP', 'SMOOTHERSTEP'], data_type: ['FLOAT', 'FLOAT_VECTOR']},
    declare(b, node) {
        const isFloat = node.prop<string>('data_type') === 'FLOAT'
        const stepped = node.prop<string>('interpolation_type') === 'STEPPED'
        // :34-50; availability :75-106.
        b.input('FLOAT', 'Value').min(-10000).max(10000).default(1).available(isFloat)
        b.input('FLOAT', 'From Min').min(-10000).max(10000).available(isFloat)
        b.input('FLOAT', 'From Max').min(-10000).max(10000).default(1).available(isFloat)
        b.input('FLOAT', 'To Min').min(-10000).max(10000).available(isFloat)
        b.input('FLOAT', 'To Max').min(-10000).max(10000).default(1).available(isFloat)
        b.input('FLOAT', 'Steps').min(-10000).max(10000).default(4).available(isFloat && stepped)
        b.input('VECTOR', 'Vector').min(0).max(1).hideValue().available(!isFloat)
        b.input('VECTOR', 'From Min', 'From_Min_FLOAT3').available(!isFloat)
        b.input('VECTOR', 'From Max', 'From_Max_FLOAT3').default([1, 1, 1]).available(!isFloat)
        b.input('VECTOR', 'To Min', 'To_Min_FLOAT3').available(!isFloat)
        b.input('VECTOR', 'To Max', 'To_Max_FLOAT3').default([1, 1, 1]).available(!isFloat)
        b.input('VECTOR', 'Steps', 'Steps_FLOAT3').default([4, 4, 4]).available(!isFloat && stepped)
        b.output('FLOAT', 'Result').available(isFloat)
        b.output('VECTOR', 'Vector').available(!isFloat)
    },
    // `sh_node_map_range_build_multi_function` (:319).
    multiFunction(node) {
        const interpolation = node.prop<string>('interpolation_type')
        const clamp = node.prop<boolean>('clamp') && (interpolation === 'LINEAR' || interpolation === 'STEPPED')
        return functionFor(`${node.prop<string>('data_type')}:${interpolation}:${clamp ? 1 : 0}`)
    },
})
