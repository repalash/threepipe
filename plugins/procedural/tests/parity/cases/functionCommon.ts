/**
 * Shared builders for the function-node parity cases (`function*.ts`). A case evaluates nodes on a point
 * cloud (`Points`, `count` points) and stores every output as a named point attribute. Inputs are fields
 * of the point index, built only from nodes that are themselves bit-exact against Blender (Index, Math,
 * White Noise, Combine XYZ):
 * - `digit(base, k, lo, step)`: the k-th base-`base` digit of the index, mapped to `lo + digit * step`, so
 *   several inputs enumerate every combination of a small value set (negatives, zero, halves);
 * - `noise(seed, lo, hi)`: White Noise 1D of the index, in [lo, hi) - values that are not dyadic fractions.
 * Single-value cases put constants on the sockets (no field input), so Blender and the port evaluate the
 * function once on single values.
 */

import {AnySocket, geometryNodes, GroupBuilder, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary, SocketType} from '../../../src/runtime/types'
import {ParityCase} from './types'

/** Attribute data type that stores a socket type unchanged. */
export const ATTRIBUTE_TYPE: Partial<Record<SocketType, string>> = {
    FLOAT: 'FLOAT', INT: 'INT', BOOLEAN: 'BOOLEAN', VECTOR: 'FLOAT_VECTOR', RGBA: 'FLOAT_COLOR', ROTATION: 'QUATERNION',
    MATRIX: 'FLOAT4X4',
}

export class Inputs {
    constructor(readonly g: GroupBuilder) {}

    index(): Socket {
        return this.g.node('GeometryNodeInputIndex').outputs.index
    }

    math(operation: string, a: Socket | number, b?: Socket | number, c?: Socket | number): Socket {
        return this.g.node('ShaderNodeMath', {operation, value: a, value1: b, value2: c}).outputs.value
    }

    /** `lo + digit * step` with `digit = floor(index / base^k) mod base`. */
    digit(base: number, k: number, lo: number, step: number): Socket {
        let d: Socket = this.index()
        if (k > 0) d = this.math('FLOOR', this.math('DIVIDE', d, base ** k))
        d = this.math('FLOORED_MODULO', d, base)
        return this.math('MULTIPLY_ADD', d, step, lo)
    }

    /** White Noise 1D of `index * 0.731 + seed`, scaled to [lo, hi). */
    noise(seed: number, lo: number, hi: number): Socket {
        const w = this.math('MULTIPLY_ADD', this.index(), 0.731, seed)
        const value = this.g.node('ShaderNodeTexWhiteNoise', {noiseDimensions: '1D', w}).outputs.value
        return this.math('MULTIPLY_ADD', value, hi - lo, lo)
    }

    vector(x: Socket | number, y: Socket | number, z: Socket | number): Socket {
        return this.g.node('ShaderNodeCombineXYZ', {x, y, z}).outputs.vector
    }

    /** Three noise components. */
    noiseVector(seed: number, lo: number, hi: number): Socket {
        return this.vector(this.noise(seed, lo, hi), this.noise(seed + 17.3, lo, hi), this.noise(seed + 41.9, lo, hi))
    }

    /** Components from digits `k0, k0+1, k0+2` of base `base`. */
    digitVector(base: number, k0: number, lo: number, step: number): Socket {
        return this.vector(this.digit(base, k0, lo, step), this.digit(base, k0 + 1, lo, step), this.digit(base, k0 + 2, lo, step))
    }
}

/**
 * A case on `count` points: `body` adds nodes and returns the sockets to store, by attribute name.
 * Outputs of socket types without an attribute type are an error.
 */
export function pointsCase(id: string, description: string, count: number, body: (v: Inputs, g: GroupBuilder) => Record<string, Socket>): ParityCase {
    const group = geometryNodes(id, g => {
        let geometry: AnySocket = g.node('GeometryNodePoints', {count}).outputs.geometry
        const outputs = body(new Inputs(g), g)
        for (const [name, socket] of Object.entries(outputs)) {
            const dataType = ATTRIBUTE_TYPE[socket.type]
            if (!dataType) throw new Error(`${id}: output ${name} is a ${socket.type} socket, which no attribute stores`)
            geometry = g.node('GeometryNodeStoreNamedAttribute', {dataType, domain: 'POINT', geometry, name, value: socket}).outputs.geometry
        }
        g.output.geometry('Geometry', geometry)
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty'}
}

/** The available outputs of a node, keyed `<prefix><dsl key>` (each socket once). */
export function outputsOf(handle: {outputs: Record<string, Socket>}, prefix = ''): Record<string, Socket> {
    const out: Record<string, Socket> = {}
    const seen = new Set<Socket>()
    for (const [k, s] of Object.entries(handle.outputs)) {
        if (seen.has(s)) continue
        seen.add(s)
        out[prefix + k] = s
    }
    return out
}
