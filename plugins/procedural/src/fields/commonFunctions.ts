/**
 * Multi-functions Blender registers by name in `functions/intern/multi_function_common.cc` and looks up
 * with `mf::registry::lookup(...)` (e.g. Set Position's "float3 + float3"). Add entries here as ports need
 * them, under Blender's names.
 */

import {f32} from '../blender/f32'
import {elementwise, MultiFunction} from './field'

const FUNCTIONS: Record<string, MultiFunction> = {
    // :365.
    'float3 + float3': elementwise('float3 + float3', ['float3', 'float3'], ['float3'], ([a, b], [o]) => {
        o[0] = f32(a[0] + b[0])
        o[1] = f32(a[1] + b[1])
        o[2] = f32(a[2] + b[2])
    }),
    // :369.
    'float3 - float3': elementwise('float3 - float3', ['float3', 'float3'], ['float3'], ([a, b], [o]) => {
        o[0] = f32(a[0] - b[0])
        o[1] = f32(a[1] - b[1])
        o[2] = f32(a[2] - b[2])
    }),
}

/** `mf::registry::lookup(name)`. */
export function lookupMultiFunction(name: string): MultiFunction {
    const fn = FUNCTIONS[name]
    if (!fn) throw new Error(`procedural: multi-function '${name}' is not ported`)
    return fn
}
