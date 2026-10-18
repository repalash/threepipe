/**
 * Float Curve (`ShaderNodeFloatCurve`, `nodes/shader/nodes/node_shader_curves.cc`: declaration :346,
 * `node_shader_init_curve_float` :362 = `BKE_curvemapping_add(1, 0, 0, 1, 1)`, `CurveFloatFunction` :396) and
 * Color Ramp (`ShaderNodeValToRGB`, `node_shader_color_ramp.cc`: declaration :24, `BKE_colorband_add(true)`
 * :39, `ColorBandFunction` :108). The curve mapping and colour band are the node's `curveMapping` /
 * `colorRamp` (`NodeJSON`, as `porting/blender/dump_blend.py` writes them); without one the node has
 * Blender's defaults.
 */

import {f32} from '../../blender/f32'
import {buildColorBand, ColorBand, colorbandEvaluate, ColorRampJSON} from '../../blender/math/colorband'
import {buildCurveMapping, CurveMappingEval, curvemappingEvaluateF, CurveMappingJSON} from '../../blender/math/curveMapping'
import {elementwise, MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'

const curveFunctions = new WeakMap<object, MultiFunction>()
let defaultCurveFunction: MultiFunction | undefined

/** `CurveFloatFunction::call` (:417): the curve, then `(1 - fac) * value + fac * curve` when `fac != 1`. */
function curveFloatFunction(cumap: CurveMappingEval): MultiFunction {
    return elementwise('Curve Float', ['float', 'float'], ['float'], ([fac, value], [o]) => {
        let v = curvemappingEvaluateF(cumap, 0, value[0])
        if (fac[0] !== 1) v = f32(f32(f32(1 - fac[0]) * value[0]) + f32(fac[0] * v))
        o[0] = v
    })
}

registerNodeType({
    idname: 'ShaderNodeFloatCurve',
    label: 'Float Curve',
    declare(b) {
        b.input('FLOAT', 'Factor').min(0).max(1).default(1).subtype('FACTOR')
        b.input('FLOAT', 'Value').default(1)
        b.output('FLOAT', 'Value')
    },
    // `sh_node_curve_float_build_multi_function` (:440): `BKE_curvemapping_init` builds the tables once.
    multiFunction(node) {
        const json = node.json.curveMapping as CurveMappingJSON | undefined
        if (!json) return defaultCurveFunction ??= curveFloatFunction(buildCurveMapping(undefined))
        let fn = curveFunctions.get(json)
        if (!fn) curveFunctions.set(json, fn = curveFloatFunction(buildCurveMapping(json)))
        return fn
    },
})

const rampFunctions = new WeakMap<object, MultiFunction>()
let defaultRampFunction: MultiFunction | undefined

/** `ColorBandFunction::call` (:129). */
function colorBandFunction(coba: ColorBand): MultiFunction {
    return elementwise('Color Band', ['float'], ['float4', 'float'], ([value], [color, alpha]) => {
        const c = colorbandEvaluate(coba, value[0])
        color[0] = c[0]
        color[1] = c[1]
        color[2] = c[2]
        color[3] = c[3]
        alpha[0] = c[3]
    })
}

registerNodeType({
    idname: 'ShaderNodeValToRGB',
    label: 'Color Ramp',
    declare(b) {
        b.input('FLOAT', 'Factor', 'Fac').default(0.5).min(0).max(1).subtype('FACTOR')
        b.output('RGBA', 'Color')
        b.output('FLOAT', 'Alpha')
    },
    // `sh_node_valtorgb_build_multi_function` (:152).
    multiFunction(node) {
        const json = node.json.colorRamp as ColorRampJSON | undefined
        if (!json) return defaultRampFunction ??= colorBandFunction(buildColorBand(undefined))
        let fn = rampFunctions.get(json)
        if (!fn) rampFunctions.set(json, fn = colorBandFunction(buildColorBand(json)))
        return fn
    },
})
