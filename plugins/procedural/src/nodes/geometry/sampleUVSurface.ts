/**
 * Sample UV Surface (`GeometryNodeSampleUVSurface`) - `nodes/geometry/nodes/node_geo_sample_uv_surface.cc` with
 * `geometry::ReverseUVSampler` (`geometry/intern/reverse_uv_sampler.cc`) and `BaryWeightSampleFn` (Blender 5.2.2).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {FieldContext, FieldEvaluation, GField, MultiFunction} from '../../fields'
import {meshCornerTris} from '../../geometry/meshBVH'
import {registerNodeType} from '../../runtime/registry'
import {applyFunction} from '../util'
import {socketTypeFromRNA} from '../attributeTypes'
import {baryWeightSampleFn, SOCKET_ATTRIBUTE_TYPES} from './sample'

const FLT_MAX = 3.4028234663852886e38

/** `int2{uv * resolution}`: float products, truncation toward zero. */
function uvToCell(u: number, v: number, resolution: number): [number, number] {
    const x = f32(u * resolution), y = f32(v * resolution)
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) >= 2 ** 31 || Math.abs(y) >= 2 ** 31) {
        throw new Error('ReverseUVSampler: a UV outside the int range (undefined behaviour in the int conversion) is not ported')
    }
    return [Math.trunc(x) | 0, Math.trunc(y) | 0]
}

interface Row {
    xMin: number
    xMax: number
    offsets: Int32Array
    triIndices: Int32Array
}

const enum ResultType { None, Ok, Multiple }

interface Result {
    type: ResultType
    triIndex: number
    bary: [number, number, number]
}

/** `barycentric_coords_v2` (`math_geom.cc:3800`). */
function barycentricCoordsV2(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, x: number, y: number): [number, number, number] | null {
    const x1 = v1[0], y1 = v1[1], x2 = v2[0], y2 = v2[1], x3 = v3[0], y3 = v3[1]
    const det = f32(f32(f32(y2 - y3) * f32(x1 - x3)) + f32(f32(x3 - x2) * f32(y1 - y3)))
    const w0 = f32(f32(f32(f32(y2 - y3) * f32(x - x3)) + f32(f32(x3 - x2) * f32(y - y3))) / det)
    const w1 = f32(f32(f32(f32(y3 - y1) * f32(x - x3)) + f32(f32(x1 - x3) * f32(y - y3))) / det)
    const w2 = f32(f32(1 - w0) - w1)
    return Number.isFinite(w0) && Number.isFinite(w1) && Number.isFinite(w2) ? [w0, w1, w2] : null
}

/** `area_tri_v2` (`math_geom_inline.cc:34`). */
function areaTriV2(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>): number {
    return Math.abs(f32(0.5 * f32(f32(f32(v1[0] - v2[0]) * f32(v2[1] - v3[1])) + f32(f32(v1[1] - v2[1]) * f32(v3[0] - v2[0])))))
}

/**
 * `ReverseUVSampler` (`reverse_uv_sampler.cc`). Each cell lists its triangles newest first, which is Blender's order
 * when one thread builds the grid (up to 256 triangles, the `parallel_for` grain); with more triangles Blender's
 * per-cell order also depends on its thread scheduling (`EnumerableThreadSpecific` order), which only matters for ties.
 */
export class ReverseUVSampler {
    private readonly resolution: number
    private yMin = 0
    private rows: Row[] = []

    constructor(private readonly uvMap: Float32Array, private readonly cornerTris: Int32Array) {
        const trisNum = cornerTris.length / 3
        this.resolution = Math.max(3, Math.trunc(Math.sqrt(trisNum) * 3))
        if (trisNum === 0) return
        // `sort_tris_into_rows` (:72): rows keyed by y, each a list of (tri, x range) and its x bounds.
        const rows = new Map<number, {tris: [number, number, number][], xMin: number, xMax: number}>()
        for (let t = 0; t < trisNum; t++) {
            const c0 = uvToCell(uvMap[cornerTris[t * 3] * 2], uvMap[cornerTris[t * 3] * 2 + 1], this.resolution)
            const c1 = uvToCell(uvMap[cornerTris[t * 3 + 1] * 2], uvMap[cornerTris[t * 3 + 1] * 2 + 1], this.resolution)
            const c2 = uvToCell(uvMap[cornerTris[t * 3 + 2] * 2], uvMap[cornerTris[t * 3 + 2] * 2 + 1], this.resolution)
            const minX = Math.min(c0[0], c1[0], c2[0]), maxX = Math.max(c0[0], c1[0], c2[0])
            const minY = Math.min(c0[1], c1[1], c2[1]), maxY = Math.max(c0[1], c1[1], c2[1])
            for (let y = minY; y <= maxY; y++) {
                let row = rows.get(y)
                if (!row) rows.set(y, row = {tris: [], xMin: 2147483647, xMax: -2147483648})
                row.tris.push([t, minX, maxX])
                row.xMin = Math.min(row.xMin, minX)
                row.xMax = Math.max(row.xMax, maxX)
            }
        }
        let yLo = Infinity, yHi = -Infinity
        for (const y of rows.keys()) {
            yLo = Math.min(yLo, y)
            yHi = Math.max(yHi, y)
        }
        this.yMin = yLo
        this.rows = Array.from({length: yHi - yLo + 1}, () => ({xMin: 0, xMax: 0, offsets: new Int32Array(0), triIndices: new Int32Array(0)}))
        // `finish_rows` (:104). `linear_allocator::ChunkedList` iterates newest first (segments are prepended and walked
        // from their last element, `BLI_linear_allocator_chunked_list.hh`), so each row's triangles are read in reverse.
        for (const [y, local] of rows) {
            local.tris.reverse()
            const row = this.rows[y - yLo]
            const xNum = local.xMax - local.xMin + 1
            const offsets = new Int32Array(xNum + 1)
            for (const [, x0, x1] of local.tris) for (let x = x0; x <= x1; x++) offsets[x - local.xMin]++
            let acc = 0
            for (let i = 0; i < xNum; i++) {
                const c = offsets[i]
                offsets[i] = acc
                acc += c
            }
            offsets[xNum] = acc
            const triIndices = new Int32Array(acc)
            const current = new Int32Array(xNum)
            for (const [t, x0, x1] of local.tris) {
                for (let x = x0; x <= x1; x++) triIndices[offsets[x - local.xMin] + current[x - local.xMin]++] = t
            }
            row.offsets = offsets
            row.triIndices = triIndices
            row.xMin = local.xMin
            row.xMax = local.xMax
        }
    }

    /** `lookup_tris_in_cell` (:189). */
    private trisInCell(x: number, y: number): Int32Array {
        const empty = new Int32Array(0)
        if (y < this.yMin || y >= this.yMin + this.rows.length) return empty
        const row = this.rows[y - this.yMin]
        if (x < row.xMin || x > row.xMax || row.triIndices.length === 0) return empty
        const offset = row.offsets[x - row.xMin]
        return row.triIndices.subarray(offset, row.offsets[x - row.xMin + 1])
    }

    /** `ReverseUVSampler::sample` (:215). */
    sample(u: number, v: number): Result {
        const [cx, cy] = uvToCell(u, v, this.resolution)
        const uv = this.uvMap, tris = this.cornerTris
        const corner = (c: number) => uv.subarray(c * 2, c * 2 + 2)
        let bestDist = FLT_MAX
        let bestBary: [number, number, number] = [0, 0, 0]
        let bestTri = -1
        const edgeEpsilon = f32(0.00001), areaEpsilon = f32(0.00001)
        for (const triI of this.trisInCell(cx, cy)) {
            const uv0 = corner(tris[triI * 3]), uv1 = corner(tris[triI * 3 + 1]), uv2 = corner(tris[triI * 3 + 2])
            const bary = barycentricCoordsV2(uv0, uv1, uv2, u, v)
            if (!bary) continue
            const xDist = Math.max(-bary[0], f32(bary[0] - 1))
            const yDist = Math.max(-bary[1], f32(bary[1] - 1))
            const zDist = Math.max(-bary[2], f32(bary[2] - 1))
            const dist = Math.max(xDist, yDist, zDist)
            if (dist <= 0 && bestDist <= 0) {
                const worseDist = Math.max(dist, bestDist)
                if (worseDist < -edgeEpsilon) {
                    // Blender reads `corner_tris_[tri_i]` (the current triangle) as "best_tri" here.
                    const bestTriArea = areaTriV2(uv0, uv1, uv2)
                    const currentTriArea = areaTriV2(uv0, uv1, uv2)
                    if (bestTriArea > areaEpsilon && currentTriArea > areaEpsilon) return {type: ResultType.Multiple, triIndex: -1, bary: [0, 0, 0]}
                }
            }
            if (dist < bestDist) {
                bestDist = dist
                bestBary = bary
                bestTri = triI
            }
        }
        if (bestDist < edgeEpsilon) {
            const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
            return {type: ResultType.Ok, triIndex: bestTri, bary: [clamp(bestBary[0]), clamp(bestBary[1]), clamp(bestBary[2])]}
        }
        return {type: ResultType.None, triIndex: -1, bary: [0, 0, 0]}
    }
}

/** `ReverseUVSampleFunction` (:89): the sampler is built on first use from the UV field on corners. */
function reverseUVSampleFn(mesh: MeshData, uvMapField: GField): MultiFunction {
    let sampler: ReverseUVSampler | undefined
    return {
        name: 'Sample UV Surface', inputs: ['float3'], outputs: ['bool', 'int32', 'float3'],
        call(n, ins, outs) {
            if (!sampler) {
                const values = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Corner), mesh.cornersNum).evaluate(uvMapField)
                const uv = new Float32Array(mesh.cornersNum * 2)
                for (let i = 0; i < mesh.cornersNum; i++) {
                    uv[i * 2] = values.get(i, 0)
                    uv[i * 2 + 1] = values.get(i, 1)
                }
                sampler = new ReverseUVSampler(uv, meshCornerTris(mesh))
            }
            for (let e = 0; e < n; e++) {
                const r = sampler.sample(ins[0].get(e, 0), ins[0].get(e, 1))
                outs[0][e] = r.type === ResultType.Ok ? 1 : 0
                outs[1][e] = r.triIndex
                outs[2].set(r.bary, e * 3)
            }
        },
    }
}

registerNodeType({
    idname: 'GeometryNodeSampleUVSurface',
    label: 'Sample UV Surface',
    // `node_init` (:63).
    properties: {data_type: 'FLOAT'},
    enums: {data_type: SOCKET_ATTRIBUTE_TYPES},
    // `node_declare` (:22).
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        b.input('GEOMETRY', 'Mesh')
        b.input(type, 'Value').hideValue().field()
        b.input('VECTOR', 'UV Map', 'Source UV Map').hideValue().field()
        b.input('VECTOR', 'Sample UV')
        b.output(type, 'Value')
        b.output('BOOLEAN', 'Is Valid')
    },
    // `node_geo_exec` (:146).
    execute(p) {
        const geometry = p.geometry('Mesh')
        const mesh = geometry.mesh
        if (!mesh) return
        if (mesh.facesNum === 0 && mesh.vertsNum !== 0) {
            p.warn('The source mesh must have faces')
            return
        }
        // The float3 -> float2 conversions only drop z: the function reads the first two components.
        const [isValid, triIndex, bary] = applyFunction(reverseUVSampleFn(mesh, p.field('Source UV Map')), [p.field('Sample UV')])
        p.set('Is Valid', isValid)
        const [sampled] = applyFunction(baryWeightSampleFn(mesh, p.field('Value')), [triIndex, bary])
        p.set('Value', sampled)
    },
})
