/**
 * Gradient Texture (`ShaderNodeTexGradient`) - `nodes/shader/nodes/node_shader_tex_gradient.cc`
 * (declaration :18-28, init :36-44, `GradientFunction` :65-159).
 */

import {f32} from '../../blender/f32'
import {stdClamp} from '../../blender/noiseTextures'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'
import {atan2f} from '../../blender/libm'

const stdMin = (a: number, b: number) => (b < a ? b : a)
const stdMax = (a: number, b: number) => (a < b ? b : a)

const F_0_999999 = f32(0.999999)

/** `math::length(float3)` (`BLI_math_vector.hh:451`). */
function length3(x: number, y: number, z: number): number {
    return f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))))
}

/** Per-type body of `GradientFunction::call` (`node_shader_tex_gradient.cc:93-146`). */
const GRADIENTS: Record<string, (x: number, y: number, z: number) => number> = {
    LINEAR: x => stdClamp(x, 0, 1),
    QUADRATIC: x => {
        const r = stdMax(x, 0)
        return stdClamp(f32(r * r), 0, 1)
    },
    EASING: x => {
        const r = stdMin(stdMax(x, 0), 1)
        const t = f32(r * r)
        return f32(f32(3 * t) - f32(f32(2 * t) * r))
    },
    DIAGONAL: (x, y) => stdClamp(f32(f32(x + y) * 0.5), 0, 1),
    // `atan2f(y, x) / (M_PI * 2.0f) + 0.5f`: the division and the sum are in double.
    RADIAL: (x, y) => f32(atan2f(y, x) / (Math.PI * 2.0) + 0.5),
    QUADRATIC_SPHERE: (x, y, z) => {
        const r = stdMax(f32(F_0_999999 - length3(x, y, z)), 0)
        return f32(r * r)
    },
    SPHERICAL: (x, y, z) => stdMax(f32(F_0_999999 - length3(x, y, z)), 0),
}

const gradientFunction = cached((type: string): MultiFunction => {
    const f = GRADIENTS[type]
    if (!f) throw new Error(`procedural: Gradient Texture type '${type}' is not supported`)
    return {
        name: 'GradientFunction', inputs: ['float3'], outputs: ['float4', 'float'],
        call(size, ins, outs) {
            const [vector] = ins
            const [color, fac] = outs
            for (let i = 0; i < size; i++) {
                const v = f(vector.get(i, 0), vector.get(i, 1), vector.get(i, 2))
                fac[i] = v
                color[i * 4] = color[i * 4 + 1] = color[i * 4 + 2] = v
                color[i * 4 + 3] = 1
            }
        },
    }
})

registerNodeType({
    idname: 'ShaderNodeTexGradient',
    label: 'Gradient Texture',
    // `node_shader_init_tex_gradient` (:36): `SHD_BLEND_LINEAR`.
    properties: {gradient_type: 'LINEAR'},
    enums: {gradient_type: ['LINEAR', 'QUADRATIC', 'EASING', 'DIAGONAL', 'SPHERICAL', 'QUADRATIC_SPHERE', 'RADIAL']},
    declare(b) {
        b.input('VECTOR', 'Vector').implicit('POSITION')
        b.output('RGBA', 'Color')
        b.output('FLOAT', 'Factor', 'Fac')
    },
    multiFunction(node) {
        return gradientFunction(node.prop<string>('gradient_type'))
    },
})
