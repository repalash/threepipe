/**
 * Clamp (`ShaderNodeClamp`) - `nodes/shader/nodes/node_shader_clamp.cc` (declaration :24, `node_init` :37:
 * `NODE_CLAMP_MINMAX`, functions :53-72). RNA `clamp_type` (`makesrna/intern/rna_nodetree.cc:4854`).
 */

import {clampF} from '../../blender/math/base'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {fn3, stdMax, stdMin} from '../util'

const FUNCTIONS: Record<string, MultiFunction> = {
    // `std::min(std::max(value, min), max)` (:55).
    MINMAX: fn3('Clamp (Min Max)', (value, min, max) => stdMin(stdMax(value, min), max)),
    // `a < b ? clamp_f(value, a, b) : clamp_f(value, b, a)` (:57).
    RANGE: fn3('Clamp (Range)', (value, a, b) => (a < b ? clampF(value, a, b) : clampF(value, b, a))),
}

registerNodeType({
    idname: 'ShaderNodeClamp',
    label: 'Clamp',
    properties: {clamp_type: 'MINMAX'},
    enums: {clamp_type: ['MINMAX', 'RANGE']},
    declare(b) {
        b.input('FLOAT', 'Value').default(1)
        b.input('FLOAT', 'Min').default(0).min(-10000).max(10000)
        b.input('FLOAT', 'Max').default(1).min(-10000).max(10000)
        b.output('FLOAT', 'Result')
    },
    multiFunction(node) {
        const type = node.prop<string>('clamp_type')
        const fn = FUNCTIONS[type]
        if (!fn) throw new Error(`procedural: Clamp type ${type} is not supported`)
        return fn
    },
})
