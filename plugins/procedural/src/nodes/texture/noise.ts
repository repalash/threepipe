/**
 * Noise Texture (`ShaderNodeTexNoise`) - `nodes/shader/nodes/node_shader_tex_noise.cc` (declaration :24-112,
 * init :123-133, `NoiseFunction` :195-465, `sh_node_noise_build_multi_function` :467), evaluating
 * `noise::perlin_fractal_distorted` / `perlin_float3_fractal_distorted` (`blenlib/intern/noise.cc:945`,
 * `:1000-1124`, ported in `src/blender/noiseTextures.ts`).
 */

import {f32} from '../../blender/f32'
import {NOISE_TYPE, perlinFloat3FractalDistorted, stdClamp} from '../../blender/noiseTextures'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'

/** `std::max<float>` (`math::max`, `BLI_math_base.hh:49`). */
const stdMax = (a: number, b: number) => (a < b ? b : a)

/** `rna_enum_node_tex_dimensions_items` (`rna_nodetree.cc:462`). */
export function texDimensions(value: string): number {
    const d = {'1D': 1, '2D': 2, '3D': 3, '4D': 4}[value]
    if (!d) throw new Error(`procedural: unknown texture dimensions '${value}'`)
    return d
}

function noiseType(value: string): number {
    const t = (NOISE_TYPE as Record<string, number>)[value]
    if (t === undefined) throw new Error(`procedural: Noise Texture type '${value}' is not supported`)
    return t
}

const usesOffset = (type: number) =>
    type === NOISE_TYPE.RIDGED_MULTIFRACTAL || type === NOISE_TYPE.HYBRID_MULTIFRACTAL || type === NOISE_TYPE.HETERO_TERRAIN
const usesGain = (type: number) => type === NOISE_TYPE.RIDGED_MULTIFRACTAL || type === NOISE_TYPE.HYBRID_MULTIFRACTAL

/**
 * `NoiseFunction` (`node_shader_tex_noise.cc:195`). Fac is `c[0]` of the float3 variant when Color is
 * needed and `perlin_fractal_distorted` otherwise; both are the same `perlin_select` of the same
 * distorted position, so computing the float3 variant gives the same Fac.
 */
const noiseFunction = cached((key: string): MultiFunction => {
    const [dimS, typeS, normS] = key.split('|')
    const dimensions = +dimS
    const type = +typeS
    const normalize = normS === '1'
    const hasVector = dimensions !== 1
    const hasW = dimensions === 1 || dimensions === 4
    const inputs: ('float' | 'float3')[] = []
    if (hasVector) inputs.push('float3')
    if (hasW) inputs.push('float')
    inputs.push('float', 'float', 'float', 'float')
    if (usesOffset(type)) inputs.push('float')
    if (usesGain(type)) inputs.push('float')
    inputs.push('float')
    return {
        name: 'Noise', inputs, outputs: ['float', 'float4'],
        call(size, ins, outs) {
            let param = 0
            const vector = hasVector ? ins[param++] : undefined
            const w = hasW ? ins[param++] : undefined
            const scale = ins[param++]
            const detail = ins[param++]
            const roughness = ins[param++]
            const lacunarity = ins[param++]
            // "Initialize to any other variable when unused" (:263-276): offset/gain read Scale then.
            const offset = usesOffset(type) ? ins[param++] : scale
            const gain = usesGain(type) ? ins[param++] : scale
            const distortion = ins[param++]
            const [fac, color] = outs
            for (let i = 0; i < size; i++) {
                const s = scale.get(i)
                let position: number[]
                switch (dimensions) {
                case 1: position = [f32(w!.get(i) * s)]; break
                // `float2(vector[i] * scale[i])`.
                case 2: position = [f32(vector!.get(i, 0) * s), f32(vector!.get(i, 1) * s)]; break
                case 3: position = [f32(vector!.get(i, 0) * s), f32(vector!.get(i, 1) * s), f32(vector!.get(i, 2) * s)]; break
                default: position = [f32(vector!.get(i, 0) * s), f32(vector!.get(i, 1) * s), f32(vector!.get(i, 2) * s), f32(w!.get(i) * s)]
                }
                const c = perlinFloat3FractalDistorted(position,
                    stdClamp(detail.get(i), 0, 15),
                    stdMax(roughness.get(i), 0),
                    lacunarity.get(i), offset.get(i), gain.get(i), distortion.get(i), type, normalize)
                color[i * 4] = c[0]
                color[i * 4 + 1] = c[1]
                color[i * 4 + 2] = c[2]
                color[i * 4 + 3] = 1
                fac[i] = c[0]
            }
        },
    }
})

registerNodeType({
    idname: 'ShaderNodeTexNoise',
    label: 'Noise Texture',
    // `node_shader_init_tex_noise` (:123): 3D (geometry/shader trees), fBM, normalize on.
    properties: {noise_dimensions: '3D', noise_type: 'FBM', normalize: true},
    declare(b, node) {
        const dimensions = texDimensions(node.prop<string>('noise_dimensions'))
        const type = noiseType(node.prop<string>('noise_type'))
        b.input('VECTOR', 'Vector').implicit('POSITION').available(dimensions !== 1)
        b.input('FLOAT', 'W').default(0).min(-1000).max(1000).available(dimensions === 1 || dimensions === 4)
        b.input('FLOAT', 'Scale').default(5).min(-1000).max(1000)
        b.input('FLOAT', 'Detail').default(2).min(0).max(15)
        b.input('FLOAT', 'Roughness').default(0.5).min(0).max(1).subtype('FACTOR')
        b.input('FLOAT', 'Lacunarity').default(2).min(0).max(1000)
        b.input('FLOAT', 'Offset').default(0).min(-1000).max(1000).available(usesOffset(type))
        b.input('FLOAT', 'Gain').default(1).min(0).max(1000).available(usesGain(type))
        b.input('FLOAT', 'Distortion').default(0).min(-1000).max(1000)
        b.output('FLOAT', 'Factor', 'Fac')
        b.output('RGBA', 'Color')
    },
    multiFunction(node) {
        const dimensions = texDimensions(node.prop<string>('noise_dimensions'))
        const type = noiseType(node.prop<string>('noise_type'))
        return noiseFunction(`${dimensions}|${type}|${node.prop<boolean>('normalize') ? 1 : 0}`)
    },
})
