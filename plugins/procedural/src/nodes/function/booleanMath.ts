/**
 * Boolean Math (`FunctionNodeBooleanMath`) - `nodes/function/nodes/node_fn_boolean_math.cc`
 * (declaration :25-38: NOT has no second input at all; operation → function :79-104) and the registered
 * functions `functions/intern/multi_function_common.cc:595-628`.
 */

import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {fn1, fn2} from '../util'

const b2 = (name: string, f: (a: boolean, b: boolean) => boolean) =>
    fn2(name, (a, b) => (f(a !== 0, b !== 0) ? 1 : 0), 'bool', 'bool')

export const BOOLEAN_MATH_OPERATIONS: Record<string, MultiFunction> = {
    AND: b2('bool && bool', (a, b) => a && b),
    OR: b2('bool || bool', (a, b) => a || b),
    NOT: fn1('!bool', a => (a !== 0 ? 0 : 1), 'bool', 'bool'),
    NAND: b2('!(bool && bool)', (a, b) => !(a && b)),
    NOR: b2('!(bool || bool)', (a, b) => !(a || b)),
    XNOR: b2('bool == bool', (a, b) => a === b),
    XOR: b2('bool != bool', (a, b) => a !== b),
    IMPLY: b2('!bool || bool', (a, b) => !a || b),
    NIMPLY: b2('bool && !bool', (a, b) => a && !b),
}

registerNodeType({
    idname: 'FunctionNodeBooleanMath',
    label: 'Boolean Math',
    properties: {operation: 'AND'},
    declare(b, node) {
        b.input('BOOLEAN', 'Boolean')
        if (node.prop<string>('operation') !== 'NOT') b.input('BOOLEAN', 'Boolean', 'Boolean_001')
        b.output('BOOLEAN', 'Boolean')
    },
    multiFunction(node) {
        const op = node.prop<string>('operation')
        const fn = BOOLEAN_MATH_OPERATIONS[op]
        if (!fn) throw new Error(`procedural: Boolean Math operation ${op} is not supported`)
        return fn
    },
})
