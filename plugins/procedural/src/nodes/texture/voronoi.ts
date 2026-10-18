/**
 * Voronoi Texture (`ShaderNodeTexVoronoi`) - `nodes/shader/nodes/node_shader_tex_voronoi.cc`
 * (declaration :24-125, init :139-150, `VoronoiMetricFunction` :218-560, `VoronoiDistToEdgeFunction`
 * :562-700, `VoronoiNSphereFunction` :702-805, `sh_node_voronoi_build_multi_function` :807), evaluating
 * `noise::fractal_voronoi_x_fx`, `fractal_voronoi_distance_to_edge`, `voronoi_n_sphere_radius`
 * (`blenlib/intern/noise.cc:1126-2200`, ported in `src/blender/noiseTextures.ts`).
 */

import {f32} from '../../blender/f32'
import {
    fractalVoronoiDistanceToEdge, fractalVoronoiXFx, VORONOI_FEATURE, VORONOI_METRIC, voronoiDistance,
    VoronoiParams, voronoiNSphereRadius,
} from '../../blender/noiseTextures'
import {GVArray} from '../../geometry/varray'
import {DataType} from '../../geometry/dataTypes'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'
import {texDimensions} from './noise'

const stdMin = (a: number, b: number) => (b < a ? b : a)
const stdMax = (a: number, b: number) => (a < b ? b : a)

function feature(value: string): number {
    const f = (VORONOI_FEATURE as Record<string, number>)[value]
    if (f === undefined) throw new Error(`procedural: Voronoi Texture feature '${value}' is not supported`)
    return f
}

function metric(value: string): number {
    const m = (VORONOI_METRIC as Record<string, number>)[value]
    if (m === undefined) throw new Error(`procedural: Voronoi Texture distance '${value}' is not supported`)
    return m
}

const newParams = (): VoronoiParams => ({
    scale: 0, detail: 0, roughness: 0, lacunarity: 0, smoothness: 0, exponent: 0, randomness: 0, max_distance: 0,
    normalize: false, feature: 0, metric: 0,
})

/** The coordinate of element `i`: `w[i] * scale`, `float2(v.x, v.y) * scale`, `v * scale`, `float4(v, w) * scale`. */
function coordinate(dimensions: number, vector: GVArray | undefined, w: GVArray | undefined, i: number, scale: number): number[] {
    switch (dimensions) {
    case 1: return [f32(w!.get(i) * scale)]
    case 2: return [f32(vector!.get(i, 0) * scale), f32(vector!.get(i, 1) * scale)]
    case 3: return [f32(vector!.get(i, 0) * scale), f32(vector!.get(i, 1) * scale), f32(vector!.get(i, 2) * scale)]
    default: return [f32(vector!.get(i, 0) * scale), f32(vector!.get(i, 1) * scale), f32(vector!.get(i, 2) * scale), f32(w!.get(i) * scale)]
    }
}

/** `std::min(std::max(randomness[i], 0.0f), 1.0f)`. */
const clampRandomness = (r: number) => stdMin(stdMax(r, 0), 1)

/** Leading `Vector` / `W` inputs of every signature (`create_signature`). */
function coordInputs(dimensions: number): DataType[] {
    const inputs: DataType[] = []
    if (dimensions !== 1) inputs.push('float3')
    if (dimensions === 1 || dimensions === 4) inputs.push('float')
    return inputs
}

/** `VoronoiMetricFunction` (`node_shader_tex_voronoi.cc:218`): F1, F2, Smooth F1. */
const metricFunction = cached((key: string): MultiFunction => {
    const [dimS, featS, metS, normS] = key.split('|')
    const dimensions = +dimS, feat = +featS, met = +metS, normalize = normS === '1'
    const minkowski = met === VORONOI_METRIC.MINKOWSKI && dimensions !== 1
    const inputs = coordInputs(dimensions)
    inputs.push('float', 'float', 'float', 'float')
    if (feat === VORONOI_FEATURE.SMOOTH_F1) inputs.push('float')
    if (minkowski) inputs.push('float')
    inputs.push('float')
    const outputs: DataType[] = ['float', 'float4']
    if (dimensions !== 1) outputs.push('float3')
    if (dimensions === 1 || dimensions === 4) outputs.push('float')
    return {
        name: 'voronoi_metric', inputs, outputs,
        call(size, ins, outs) {
            let param = 0
            const vector = dimensions !== 1 ? ins[param++] : undefined
            const w = dimensions === 1 || dimensions === 4 ? ins[param++] : undefined
            const scale = ins[param++]
            const detail = ins[param++]
            const roughness = ins[param++]
            const lacunarity = ins[param++]
            const smoothness = feat === VORONOI_FEATURE.SMOOTH_F1 ? ins[param++] : undefined
            const exponent = minkowski ? ins[param++] : undefined
            const randomness = ins[param++]
            let out = 0
            const rDistance = outs[out++]
            const rColor = outs[out++]
            const rPosition = dimensions !== 1 ? outs[out++] : undefined
            const rW = dimensions === 1 || dimensions === 4 ? outs[out++] : undefined
            const params = newParams()
            params.feature = feat
            params.metric = met
            params.normalize = normalize
            for (let i = 0; i < size; i++) {
                params.scale = scale.get(i)
                params.detail = detail.get(i)
                params.roughness = roughness.get(i)
                params.lacunarity = lacunarity.get(i)
                params.smoothness = smoothness ? stdMin(stdMax(f32(smoothness.get(i) / 2), 0), 0.5) : 0
                params.exponent = exponent ? exponent.get(i) : 0
                params.randomness = clampRandomness(randomness.get(i))
                const f2Factor = feat === VORONOI_FEATURE.F2 ? 2 : 1
                if (dimensions === 1) {
                    params.max_distance = f32(f32(0.5 + f32(0.5 * params.randomness)) * f2Factor)
                } else {
                    // `voronoi_distance(floatN{0}, floatN(0.5f + 0.5f * randomness), params) * (F2 ? 2 : 1)`.
                    const r = f32(0.5 + f32(0.5 * params.randomness))
                    const zero = new Array<number>(dimensions).fill(0)
                    const corner = new Array<number>(dimensions).fill(r)
                    params.max_distance = f32(voronoiDistance(zero, corner, params.metric, params.exponent) * f2Factor)
                }
                const output = fractalVoronoiXFx(params, coordinate(dimensions, vector, w, i, params.scale), true)
                rDistance[i] = output.distance
                rColor[i * 4] = output.color[0]
                rColor[i * 4 + 1] = output.color[1]
                rColor[i * 4 + 2] = output.color[2]
                rColor[i * 4 + 3] = 1
                if (rPosition) {
                    rPosition[i * 3] = output.position[0]
                    rPosition[i * 3 + 1] = output.position[1]
                    rPosition[i * 3 + 2] = dimensions === 2 ? 0 : output.position[2]
                }
                if (rW) rW[i] = output.position[3]
            }
        },
    }
})

/** `VoronoiDistToEdgeFunction` (`node_shader_tex_voronoi.cc:562`). */
const distToEdgeFunction = cached((key: string): MultiFunction => {
    const [dimS, normS] = key.split('|')
    const dimensions = +dimS, normalize = normS === '1'
    const inputs = coordInputs(dimensions)
    inputs.push('float', 'float', 'float', 'float', 'float')
    return {
        name: 'voronoi_dist_to_edge', inputs, outputs: ['float'],
        call(size, ins, outs) {
            let param = 0
            const vector = dimensions !== 1 ? ins[param++] : undefined
            const w = dimensions === 1 || dimensions === 4 ? ins[param++] : undefined
            const [scale, detail, roughness, lacunarity, randomness] = ins.slice(param)
            const params = newParams()
            params.normalize = normalize
            for (let i = 0; i < size; i++) {
                params.scale = scale.get(i)
                params.detail = detail.get(i)
                params.roughness = roughness.get(i)
                params.lacunarity = lacunarity.get(i)
                params.randomness = clampRandomness(randomness.get(i))
                params.max_distance = f32(0.5 + f32(0.5 * params.randomness))
                outs[0][i] = fractalVoronoiDistanceToEdge(params, coordinate(dimensions, vector, w, i, params.scale))
            }
        },
    }
})

/** `VoronoiNSphereFunction` (`node_shader_tex_voronoi.cc:702`). */
const nSphereFunction = cached((key: string): MultiFunction => {
    const dimensions = +key
    const inputs = coordInputs(dimensions)
    inputs.push('float', 'float')
    return {
        name: 'voronoi_n_sphere', inputs, outputs: ['float'],
        call(size, ins, outs) {
            let param = 0
            const vector = dimensions !== 1 ? ins[param++] : undefined
            const w = dimensions === 1 || dimensions === 4 ? ins[param++] : undefined
            const [scale, randomness] = ins.slice(param)
            const params = newParams()
            for (let i = 0; i < size; i++) {
                params.scale = scale.get(i)
                params.randomness = clampRandomness(randomness.get(i))
                outs[0][i] = voronoiNSphereRadius(params, coordinate(dimensions, vector, w, i, params.scale))
            }
        },
    }
})

registerNodeType({
    idname: 'ShaderNodeTexVoronoi',
    label: 'Voronoi Texture',
    // `node_shader_init_tex_voronoi` (:139): 3D, Euclidean, F1, normalize off.
    properties: {voronoi_dimensions: '3D', distance: 'EUCLIDEAN', feature: 'F1', normalize: false},
    enums: {
        voronoi_dimensions: ['1D', '2D', '3D', '4D'], distance: ['EUCLIDEAN', 'MANHATTAN', 'CHEBYCHEV', 'MINKOWSKI'],
        feature: ['F1', 'F2', 'SMOOTH_F1', 'DISTANCE_TO_EDGE', 'N_SPHERE_RADIUS'],
    },
    declare(b, node) {
        const dimensions = texDimensions(node.prop<string>('voronoi_dimensions'))
        const feat = feature(node.prop<string>('feature'))
        const met = metric(node.prop<string>('distance'))
        const nSphere = feat === VORONOI_FEATURE.N_SPHERE_RADIUS
        const edgeOrSphere = feat === VORONOI_FEATURE.DISTANCE_TO_EDGE || nSphere
        b.input('VECTOR', 'Vector').implicit('POSITION').available(dimensions !== 1)
        b.input('FLOAT', 'W').default(0).min(-1000).max(1000).available(dimensions === 1 || dimensions === 4)
        b.input('FLOAT', 'Scale').default(5).min(-1000).max(1000)
        b.input('FLOAT', 'Detail').default(0).min(0).max(15).available(!nSphere)
        b.input('FLOAT', 'Roughness').default(0.5).min(0).max(1).subtype('FACTOR').available(!nSphere)
        b.input('FLOAT', 'Lacunarity').default(2).min(0).max(1000).available(!nSphere)
        b.input('FLOAT', 'Smoothness').default(1).min(0).max(1).subtype('FACTOR').available(feat === VORONOI_FEATURE.SMOOTH_F1)
        b.input('FLOAT', 'Exponent').default(0.5).min(0).max(32)
            .available(met === VORONOI_METRIC.MINKOWSKI && dimensions !== 1 && !edgeOrSphere)
        b.input('FLOAT', 'Randomness').default(1).min(0).max(1).subtype('FACTOR')
        b.output('FLOAT', 'Distance').available(!nSphere)
        b.output('RGBA', 'Color').available(!edgeOrSphere)
        b.output('VECTOR', 'Position').available(!edgeOrSphere && dimensions !== 1)
        b.output('FLOAT', 'W').available(!edgeOrSphere && (dimensions === 1 || dimensions === 4))
        b.output('FLOAT', 'Radius').available(nSphere)
    },
    multiFunction(node) {
        const dimensions = texDimensions(node.prop<string>('voronoi_dimensions'))
        const feat = feature(node.prop<string>('feature'))
        const normalize = node.prop<boolean>('normalize') ? 1 : 0
        switch (feat) {
        case VORONOI_FEATURE.DISTANCE_TO_EDGE: return distToEdgeFunction(`${dimensions}|${normalize}`)
        case VORONOI_FEATURE.N_SPHERE_RADIUS: return nSphereFunction(`${dimensions}`)
        default: return metricFunction(`${dimensions}|${feat}|${metric(node.prop<string>('distance'))}|${normalize}`)
        }
    },
})
