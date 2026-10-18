/**
 * Wave Texture (`ShaderNodeTexWave`) - `nodes/shader/nodes/node_shader_tex_wave.cc` (declaration :20-60,
 * init :76-87, `WaveFunction` :123-243), distortion by `noise::perlin_fbm<float3>`
 * (`blenlib/intern/noise.cc:687`, ported in `src/blender/noiseTextures.ts`).
 */

import {f32} from '../../blender/f32'
import {perlinFbm} from '../../blender/noiseTextures'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'

const WAVE_TYPE: Record<string, number> = {BANDS: 0, RINGS: 1}
const BANDS_DIRECTION: Record<string, number> = {X: 0, Y: 1, Z: 2, DIAGONAL: 3}
const RINGS_DIRECTION: Record<string, number> = {X: 0, Y: 1, Z: 2, SPHERICAL: 3}
const WAVE_PROFILE: Record<string, number> = {SIN: 0, SAW: 1, TRI: 2}

function enumValue(table: Record<string, number>, value: string, what: string): number {
    const v = table[value]
    if (v === undefined) throw new Error(`procedural: Wave Texture ${what} '${value}' is not supported`)
    return v
}

const F_0_000001 = f32(0.000001)
const F_0_999999 = f32(0.999999)
const M_PI_2 = Math.PI / 2

/** `WaveFunction` (`node_shader_tex_wave.cc:123`). */
const waveFunction = cached((key: string): MultiFunction => {
    const [waveType, bandsDirection, ringsDirection, waveProfile] = key.split('|').map(Number)
    return {
        name: 'MagicFunction', inputs: ['float3', 'float', 'float', 'float', 'float', 'float', 'float'], outputs: ['float4', 'float'],
        call(size, ins, outs) {
            const [vector, scale, distortion, detail, dscale, droughness, phase] = ins
            const [color, rFac] = outs
            for (let i = 0; i < size; i++) {
                const s = scale.get(i)
                // `p = vector[i] * scale[i]; p = (p + 0.000001f) * 0.999999f;`
                const p = [0, 1, 2].map(k => f32(f32(f32(vector.get(i, k) * s) + F_0_000001) * F_0_999999))
                let n = 0
                let val = 0
                if (waveType === 0) {
                    switch (bandsDirection) {
                    case 0: n = f32(p[0] * 20); break
                    case 1: n = f32(p[1] * 20); break
                    case 2: n = f32(p[2] * 20); break
                    case 3: n = f32(f32(f32(p[0] + p[1]) + p[2]) * 10); break
                    }
                } else {
                    const rp = p.slice()
                    switch (ringsDirection) {
                    case 0: rp[0] = f32(rp[0] * 0); break
                    case 1: rp[1] = f32(rp[1] * 0); break
                    case 2: rp[2] = f32(rp[2] * 0); break
                    default: break
                    }
                    // `len_v3(rp) * 20.0f` (`math_vector_inline.cc:775`: `sqrtf(dot_v3v3(a, a))`).
                    const len = f32(Math.sqrt(f32(f32(f32(rp[0] * rp[0]) + f32(rp[1] * rp[1])) + f32(rp[2] * rp[2]))))
                    n = f32(len * 20)
                }
                n = f32(n + phase.get(i))
                const dist = distortion.get(i)
                if (dist !== 0) {
                    const ds = dscale.get(i)
                    const fbm = perlinFbm([f32(p[0] * ds), f32(p[1] * ds), f32(p[2] * ds)], detail.get(i), droughness.get(i), 2, true)
                    n = f32(n + f32(dist * f32(f32(fbm * 2) - 1)))
                }
                switch (waveProfile) {
                case 0:
                    // `sinf(n - M_PI_2)`: the double difference is converted to the float argument.
                    val = f32(0.5 + f32(0.5 * f32(Math.sin(f32(n - M_PI_2)))))
                    break
                case 1:
                    n = f32(n / (Math.PI * 2.0))
                    val = f32(n - Math.floor(n))
                    break
                case 2:
                    n = f32(n / (Math.PI * 2.0))
                    val = f32(Math.abs(f32(n - Math.floor(f32(n + 0.5)))) * 2)
                    break
                }
                rFac[i] = val
                color[i * 4] = color[i * 4 + 1] = color[i * 4 + 2] = val
                color[i * 4 + 3] = 1
            }
        },
    }
})

registerNodeType({
    idname: 'ShaderNodeTexWave',
    label: 'Wave Texture',
    // `node_shader_init_tex_wave` (:76).
    properties: {wave_type: 'BANDS', bands_direction: 'X', rings_direction: 'X', wave_profile: 'SIN'},
    enums: {wave_type: ['BANDS', 'RINGS'], bands_direction: ['X', 'Y', 'Z', 'DIAGONAL'], rings_direction: ['X', 'Y', 'Z', 'SPHERICAL'], wave_profile: ['SIN', 'SAW', 'TRI']},
    declare(b) {
        b.input('VECTOR', 'Vector').implicit('POSITION')
        b.input('FLOAT', 'Scale').default(5).min(-1000).max(1000)
        b.input('FLOAT', 'Distortion').default(0).min(-1000).max(1000)
        b.input('FLOAT', 'Detail').default(2).min(0).max(15)
        b.input('FLOAT', 'Detail Scale').default(1).min(-1000).max(1000)
        b.input('FLOAT', 'Detail Roughness').default(0.5).min(0).max(1).subtype('FACTOR')
        b.input('FLOAT', 'Phase Offset').default(0).min(-1000).max(1000)
        b.output('RGBA', 'Color')
        b.output('FLOAT', 'Factor', 'Fac')
    },
    multiFunction(node) {
        const key = [
            enumValue(WAVE_TYPE, node.prop<string>('wave_type'), 'type'),
            enumValue(BANDS_DIRECTION, node.prop<string>('bands_direction'), 'bands direction'),
            enumValue(RINGS_DIRECTION, node.prop<string>('rings_direction'), 'rings direction'),
            enumValue(WAVE_PROFILE, node.prop<string>('wave_profile'), 'profile'),
        ].join('|')
        return waveFunction(key)
    },
})
