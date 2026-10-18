/**
 * Mix (`ShaderNodeMix`) - `nodes/shader/nodes/node_shader_mix.cc`: declaration :40, availability
 * `sh_node_mix_update` :167, `node_init` :296 (FLOAT, uniform, clamp factor on, clamp result off, MIX),
 * `MixColorFunction` :474 (`ramp_blend`, `blenkernel/intern/material.cc:1891`), `get_multi_function` :533.
 * RNA `def_sh_mix` (`makesrna/intern/rna_nodetree.cc:4917`); ROTATION is offered in geometry node trees
 * (`rna_ShaderNodeMix_data_type_itemf` :3305).
 */

import {f32} from '../../blender/f32'
import {clampMacro, stdClamp} from '../../blender/math/base'
import {RAMP_BLEND_ITEMS, rampBlend} from '../../blender/math/color'
import {quatInterpolate} from '../../blender/math/rotation'
import {elementwise, MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'

/** `math::interpolate(a, b, t)` (`BLI_math_base.hh:274`): `a * (1 - t) + b * t`. */
const lerp = (a: number, b: number, t: number) => f32(f32(a * f32(1 - t)) + f32(b * t))
const clamp01 = (t: number) => stdClamp(t, 0, 1)

const functionFor = cached((key: string): MultiFunction => {
    const [dataType, factorMode, clampFactor, clampResult, blendType] = key.split(':')
    const cf = clampFactor === '1'
    switch (dataType) {
    case 'FLOAT':
        // :539-552.
        return elementwise(cf ? 'Clamp Mix Float' : 'Mix Float', ['float', 'float', 'float'], ['float'], (i, o) => {
            o[0][0] = lerp(i[1][0], i[2][0], cf ? clamp01(i[0][0]) : i[0][0])
        })
    case 'VECTOR':
        if (factorMode === 'UNIFORM') {
            // :555-561, :568-574.
            return elementwise(cf ? 'Clamp Mix Vector' : 'Mix Vector', ['float', 'float3', 'float3'], ['float3'], (i, o) => {
                const t = cf ? clamp01(i[0][0]) : i[0][0]
                for (let k = 0; k < 3; k++) o[0][k] = lerp(i[1][k], i[2][k], t)
            })
        }
        // :562-567, :575-579: `a * (float3(1.0f) - t) + b * t`.
        return elementwise(cf ? 'Clamp Mix Vector Non Uniform' : 'Mix Vector Non Uniform', ['float3', 'float3', 'float3'], ['float3'], (i, o) => {
            for (let k = 0; k < 3; k++) o[0][k] = lerp(i[1][k], i[2][k], cf ? clamp01(i[0][k]) : i[0][k])
        })
    case 'RGBA': {
        // `MixColorFunction::call` (:497-525).
        const cr = clampResult === '1'
        return elementwise('MixColor', ['float', 'float4', 'float4'], ['float4'], (i, o) => {
            const r = [i[1][0], i[1][1], i[1][2], i[1][3]]
            rampBlend(blendType, r, cf ? clamp01(i[0][0]) : i[0][0], i[2])
            for (let k = 0; k < 4; k++) o[0][k] = cr ? clampMacro(r[k], 0, 1) : r[k]
        })
    }
    case 'ROTATION':
        // :581-597: `math::interpolate(Quaternion, Quaternion, t)`.
        return elementwise(cf ? 'Clamp Mix Rotation' : 'Mix Rotation', ['float', 'quaternion', 'quaternion'], ['quaternion'], (i, o) => {
            const q = quatInterpolate(i[1], i[2], cf ? clamp01(i[0][0]) : i[0][0])
            for (let k = 0; k < 4; k++) o[0][k] = q[k]
        })
    }
    throw new Error(`procedural: Mix data type ${dataType} is not supported`)
})

registerNodeType({
    idname: 'ShaderNodeMix',
    label: 'Mix',
    properties: {data_type: 'FLOAT', factor_mode: 'UNIFORM', blend_type: 'MIX', clamp_factor: true, clamp_result: false},
    enums: {
        data_type: ['FLOAT', 'VECTOR', 'RGBA', 'ROTATION'],
        factor_mode: ['UNIFORM', 'NON_UNIFORM'],
        blend_type: RAMP_BLEND_ITEMS,
    },
    declare(b, node) {
        const dataType = node.prop<string>('data_type')
        const vectorFactor = dataType === 'VECTOR' && node.prop<string>('factor_mode') !== 'UNIFORM'
        // :40-110, availability :167-182.
        b.input('FLOAT', 'Factor', 'Factor_Float').default(1).min(0).max(1).subtype('FACTOR').available(!vectorFactor)
        b.input('VECTOR', 'Factor', 'Factor_Vector').default([0.5, 0.5, 0.5]).min(0).max(1).subtype('FACTOR').available(vectorFactor)
        b.input('FLOAT', 'A', 'A_Float').min(-10000).max(10000).available(dataType === 'FLOAT')
        b.input('FLOAT', 'B', 'B_Float').min(-10000).max(10000).available(dataType === 'FLOAT')
        b.input('VECTOR', 'A', 'A_Vector').available(dataType === 'VECTOR')
        b.input('VECTOR', 'B', 'B_Vector').available(dataType === 'VECTOR')
        b.input('RGBA', 'A', 'A_Color').default([0.5, 0.5, 0.5, 1]).available(dataType === 'RGBA')
        b.input('RGBA', 'B', 'B_Color').default([0.5, 0.5, 0.5, 1]).available(dataType === 'RGBA')
        b.input('ROTATION', 'A', 'A_Rotation').available(dataType === 'ROTATION')
        b.input('ROTATION', 'B', 'B_Rotation').available(dataType === 'ROTATION')
        b.output('FLOAT', 'Result', 'Result_Float').available(dataType === 'FLOAT')
        b.output('VECTOR', 'Result', 'Result_Vector').available(dataType === 'VECTOR')
        b.output('RGBA', 'Result', 'Result_Color').available(dataType === 'RGBA')
        b.output('ROTATION', 'Result', 'Result_Rotation').available(dataType === 'ROTATION')
    },
    // `sh_node_mix_build_multi_function` (:606).
    multiFunction(node) {
        const p = (k: string) => String(node.prop(k))
        const flag = (k: string) => (node.prop<boolean>(k) ? '1' : '0')
        return functionFor(`${p('data_type')}:${p('factor_mode')}:${flag('clamp_factor')}:${flag('clamp_result')}:${p('blend_type')}`)
    },
})
