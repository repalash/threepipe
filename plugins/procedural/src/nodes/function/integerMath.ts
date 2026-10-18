/**
 * Integer Math (`FunctionNodeIntegerMath`) - `nodes/function/nodes/node_fn_integer_math.cc`
 * (declaration :23-55, availability `node_update` :62-74, operation → function :148-190) and the
 * registered functions `functions/intern/multi_function_common.cc:509-594`.
 *
 * C `int` arithmetic: results wrap to 32 bits as the hardware does (signed overflow is undefined in C++;
 * Blender's builds wrap). `math::pow(int, int)` is `std::pow` in double, converted back with a truncating
 * `int` cast (`BLI_math_base.hh:194`).
 */

import {MultiFunction} from '../../fields/field'
import {truncToInt} from '../../blender/f32'
import {divideFloorI, gcdI, lcmI, modPeriodicI, signT} from '../../blender/math/base'
import {registerNodeType} from '../../runtime/registry'
import {fn1, fn2, fn3} from '../util'

/** `math::safe_divide<int>` (`BLI_math_base.hh:107`): C integer division, 0 for a zero divisor. */
const safeDivideI = (a: number, b: number) => (b !== 0 ? (a / b) | 0 : 0)

const i1 = (name: string, f: (a: number) => number) => fn1(name, f, 'int32', 'int32')
const i2 = (name: string, f: (a: number, b: number) => number) => fn2(name, f, 'int32', 'int32')

/** `get_multi_function` (`node_fn_integer_math.cc:148`) → `multi_function_common.cc`. */
export const INTEGER_MATH_OPERATIONS: Record<string, MultiFunction> = {
    ADD: i2('int + int', (a, b) => (a + b) | 0),
    SUBTRACT: i2('int - int', (a, b) => (a - b) | 0),
    MULTIPLY: i2('int * int', (a, b) => Math.imul(a, b)),
    DIVIDE: i2('int / int', safeDivideI),
    DIVIDE_FLOOR: i2('floor(int, int)', (a, b) => (b !== 0 ? divideFloorI(a, b) : 0)),
    DIVIDE_CEIL: i2('divide_ceil(int, int)', (a, b) => (b !== 0 ? -divideFloorI(a, -b | 0) | 0 : 0)),
    // `multi_function_common.cc:542-551`.
    DIVIDE_ROUND: i2('divide_round(int, int)', (a, b) => {
        const c = Math.abs(b) | 0
        return a >= 0
            ? Math.imul(safeDivideI((Math.imul(2, a) + c) | 0, Math.imul(2, c)), signT(b))
            : Math.imul(-safeDivideI((Math.imul(2, -a | 0) + c) | 0, Math.imul(2, c)) | 0, signT(b))
    }),
    POWER: i2('int ** int', (a, b) => truncToInt(Math.pow(a, b))),
    MULTIPLY_ADD: fn3('int * int + int', (a, b, c) => (Math.imul(a, b) + c) | 0, 'int32', 'int32'),
    FLOORED_MODULO: i2('mod_periodic(int, int)', (a, b) => (b !== 0 ? modPeriodicI(a, b) : 0)),
    MODULO: i2('int % int', (a, b) => (b !== 0 ? a % b | 0 : 0)),
    ABSOLUTE: i1('abs(int)', a => Math.abs(a) | 0),
    SIGN: i1('sign(int)', signT),
    // `std::min` / `std::max`.
    MINIMUM: i2('min(int, int)', (a, b) => (b < a ? b : a)),
    MAXIMUM: i2('max(int, int)', (a, b) => (a < b ? b : a)),
    GCD: i2('gcd(int, int)', gcdI),
    LCM: i2('lcm(int, int)', lcmI),
    NEGATE: i1('-int', a => -a | 0),
}

const ONE_INPUT = new Set(['ABSOLUTE', 'SIGN', 'NEGATE'])

registerNodeType({
    idname: 'FunctionNodeIntegerMath',
    label: 'Integer Math',
    properties: {operation: 'ADD'},
    declare(b, node) {
        const op = node.prop<string>('operation')
        b.input('INT', 'Value')
        b.input('INT', 'Value', 'Value_001').available(!ONE_INPUT.has(op))
        b.input('INT', 'Value', 'Value_002').available(op === 'MULTIPLY_ADD')
        b.output('INT', 'Value')
    },
    multiFunction(node) {
        const op = node.prop<string>('operation')
        const fn = INTEGER_MATH_OPERATIONS[op]
        if (!fn) throw new Error(`procedural: Integer Math operation ${op} is not supported`)
        return fn
    },
})
