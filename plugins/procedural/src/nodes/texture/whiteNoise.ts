/**
 * White Noise Texture (`ShaderNodeTexWhiteNoise`) - `nodes/shader/nodes/node_shader_tex_white_noise.cc`
 * (declaration :20-46, init :54-57, `WhiteNoiseFunction` :75-210): hashes of the input's float bits,
 * `noise::hash_float_to_float` / `hash_float_to_float3` (`blenlib/intern/noise.cc:254-317`).
 * The dimensions live in `custom1`, exposed as RNA `noise_dimensions` (`rna_nodetree.cc`).
 */

import {
    hashFloatToFloat1, hashFloatToFloat2, hashFloatToFloat3, hashFloatToFloat3From1, hashFloatToFloat3From2,
    hashFloatToFloat3From3, hashFloatToFloat3From4, hashFloatToFloat4,
} from '../../blender/noise'
import {DataType} from '../../geometry/dataTypes'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'
import {texDimensions} from './noise'

/** `WhiteNoiseFunction` (`node_shader_tex_white_noise.cc:75`). */
const whiteNoiseFunction = cached((key: string): MultiFunction => {
    const dimensions = +key
    const inputs: DataType[] = []
    if (dimensions !== 1) inputs.push('float3')
    if (dimensions === 1 || dimensions === 4) inputs.push('float')
    return {
        name: 'WhiteNoise', inputs, outputs: ['float', 'float4'],
        call(size, ins, outs) {
            const [value, color] = outs
            const vector = dimensions !== 1 ? ins[0] : undefined
            const w = dimensions === 1 ? ins[0] : dimensions === 4 ? ins[1] : undefined
            for (let i = 0; i < size; i++) {
                let c: number[]
                switch (dimensions) {
                case 1: {
                    const x = w!.get(i)
                    c = hashFloatToFloat3From1(x)
                    value[i] = hashFloatToFloat1(x)
                    break
                }
                case 2: {
                    const x = vector!.get(i, 0), y = vector!.get(i, 1)
                    c = hashFloatToFloat3From2(x, y)
                    value[i] = hashFloatToFloat2(x, y)
                    break
                }
                case 3: {
                    const x = vector!.get(i, 0), y = vector!.get(i, 1), z = vector!.get(i, 2)
                    c = hashFloatToFloat3From3(x, y, z)
                    value[i] = hashFloatToFloat3(x, y, z)
                    break
                }
                default: {
                    const x = vector!.get(i, 0), y = vector!.get(i, 1), z = vector!.get(i, 2), ww = w!.get(i)
                    c = hashFloatToFloat3From4(x, y, z, ww)
                    value[i] = hashFloatToFloat4(x, y, z, ww)
                }
                }
                color[i * 4] = c[0]
                color[i * 4 + 1] = c[1]
                color[i * 4 + 2] = c[2]
                color[i * 4 + 3] = 1
            }
        },
    }
})

registerNodeType({
    idname: 'ShaderNodeTexWhiteNoise',
    label: 'White Noise Texture',
    // `node_shader_init_tex_white_noise` (:54): `custom1 = 3` outside the compositor.
    properties: {noise_dimensions: '3D'},
    enums: {noise_dimensions: ['1D', '2D', '3D', '4D']},
    declare(b, node) {
        const dimensions = texDimensions(node.prop<string>('noise_dimensions'))
        b.input('VECTOR', 'Vector').min(-10000).max(10000).implicit('POSITION').available(dimensions !== 1)
        b.input('FLOAT', 'W').default(0).min(-10000).max(10000).available(dimensions === 1 || dimensions === 4)
        b.output('FLOAT', 'Value')
        b.output('RGBA', 'Color')
    },
    multiFunction(node) {
        return whiteNoiseFunction(`${texDimensions(node.prop<string>('noise_dimensions'))}`)
    },
})
