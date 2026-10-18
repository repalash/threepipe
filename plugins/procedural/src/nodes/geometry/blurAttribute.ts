/**
 * Blur Attribute (`node_geo_blur_attribute.cc`): `Iterations` passes of mixing each element with its neighbours
 * (vertices by edges, edges by vertices, faces by edges; curve points along their curve) with the element's
 * `Weight`, through `attribute_math::DefaultMixer`.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {CurvesGeometry} from '../../geometry/components'
import {curvesAttributeOr} from '../../geometry/curvesEval'
import {DATA_TYPES, DataType, TypedArray} from '../../geometry/dataTypes'
import {createDefaultMixer} from '../../geometry/mixers'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'
import {socketTypeFromRNA} from '../attributeTypes'

interface Groups {
    offsets: Int32Array
    indices: Int32Array
}

/** `bke::mesh::build_vert_to_edge_map` (`mesh_mapping.cc:298`): edges per vertex, ascending. */
function vertToEdge(mesh: MeshData): Groups {
    const ev = mesh.edgeVerts, n = mesh.vertsNum
    const offsets = new Int32Array(n + 1)
    for (let k = 0; k < ev.length; k++) offsets[ev[k] + 1]++
    for (let v = 0; v < n; v++) offsets[v + 1] += offsets[v]
    const indices = new Int32Array(ev.length)
    const fill = new Int32Array(n)
    for (let e = 0; e < mesh.edgesNum; e++) for (const v of [ev[e * 2], ev[e * 2 + 1]]) indices[offsets[v] + fill[v]++] = e
    return {offsets, indices}
}

/** `build_vert_to_vert_by_edge_map` (:72): the other vertex of each edge around the vertex. */
function vertToVert(mesh: MeshData): Groups {
    const g = vertToEdge(mesh), ev = mesh.edgeVerts
    const indices = new Int32Array(g.indices.length)
    for (let v = 0; v < mesh.vertsNum; v++) {
        for (let k = g.offsets[v]; k < g.offsets[v + 1]; k++) {
            const e = g.indices[k]
            indices[k] = ev[e * 2] === v ? ev[e * 2 + 1] : ev[e * 2]
        }
    }
    return {offsets: g.offsets, indices}
}

/** `build_edge_to_edge_by_vert_map` (:88): the other edges at both vertices, first vertex first. */
function edgeToEdge(mesh: MeshData): Groups {
    const g = vertToEdge(mesh), ev = mesh.edgeVerts
    const offsets = new Int32Array(mesh.edgesNum + 1)
    for (let e = 0; e < mesh.edgesNum; e++) {
        const a = ev[e * 2], b = ev[e * 2 + 1]
        offsets[e + 1] = offsets[e] + (g.offsets[a + 1] - g.offsets[a] - 1) + (g.offsets[b + 1] - g.offsets[b] - 1)
    }
    const indices = new Int32Array(offsets[mesh.edgesNum])
    for (let e = 0; e < mesh.edgesNum; e++) {
        let k = offsets[e]
        for (const v of [ev[e * 2], ev[e * 2 + 1]]) {
            for (let j = g.offsets[v]; j < g.offsets[v + 1]; j++) if (g.indices[j] !== e) indices[k++] = g.indices[j]
        }
    }
    return {offsets, indices}
}

/** `build_face_to_face_by_edge_map` (:121): the other faces at each edge of the face, in corner order. */
function faceToFace(mesh: MeshData): Groups {
    const ce = mesh.cornerEdges, fo = mesh.faceOffsets
    // `build_edge_to_face_map`: faces per edge, ascending.
    const eOff = new Int32Array(mesh.edgesNum + 1)
    for (let k = 0; k < ce.length; k++) eOff[ce[k] + 1]++
    for (let e = 0; e < mesh.edgesNum; e++) eOff[e + 1] += eOff[e]
    const eFaces = new Int32Array(ce.length)
    const fill = new Int32Array(mesh.edgesNum)
    for (let f = 0; f < mesh.facesNum; f++) for (let k = fo[f]; k < fo[f + 1]; k++) eFaces[eOff[ce[k]] + fill[ce[k]]++] = f
    const offsets = new Int32Array(mesh.facesNum + 1)
    for (let f = 0; f < mesh.facesNum; f++) {
        let n = 0
        for (let k = fo[f]; k < fo[f + 1]; k++) n += eOff[ce[k] + 1] - eOff[ce[k]] - 1
        offsets[f + 1] = offsets[f] + n
    }
    const indices = new Int32Array(offsets[mesh.facesNum])
    for (let f = 0; f < mesh.facesNum; f++) {
        let j = offsets[f]
        for (let k = fo[f]; k < fo[f + 1]; k++) {
            for (let m = eOff[ce[k]]; m < eOff[ce[k] + 1]; m++) if (eFaces[m] !== f) indices[j++] = eFaces[m]
        }
    }
    return {offsets, indices}
}

/** `BlurAttributeFieldInput` (:381). */
class BlurInput extends FieldInput {
    constructor(readonly weight: GField, readonly value: GField, readonly iterations: number) {
        super(value.type, 'Blur Attribute')
    }

    children(): GField[] {
        return [this.weight, this.value]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        if (context.type === 'none') return undefined
        const size = context.size
        const type: DataType = this.type
        const c = DATA_TYPES[type].components
        const e = new FieldEvaluation(context, size)
        const values = e.evaluate(this.value)
        let a: TypedArray = new DATA_TYPES[type].array(size * c)
        for (let i = 0; i < size; i++) for (let k = 0; k < c; k++) a[i * c + k] = values.get(i, k)
        if (size <= 1 || this.iterations <= 0) return GVArray.fromArray(type, a)
        const weightsV = e.evaluate(this.weight)
        const w = Float32Array.from({length: size}, (_, i) => weightsV.get(i))
        let b: TypedArray = new DATA_TYPES[type].array(size * c)
        const pass = (mixNeighbors: (src: TypedArray, mixer: ReturnType<typeof createDefaultMixer>) => void) => {
            // `std::swap(src, dst)` each iteration: the result of the last pass is the next source.
            let src = b, dst = a
            for (let it = 0; it < this.iterations; it++) {
                ;[src, dst] = [dst, src]
                const mixer = createDefaultMixer(type, dst)
                mixNeighbors(src, mixer)
                mixer.finalize()
            }
            return dst
        }
        const mesh = context.mesh, curves = context.curves
        if (mesh && (context.domain === AttrDomain.Point || context.domain === AttrDomain.Edge || context.domain === AttrDomain.Face)) {
            const map = context.domain === AttrDomain.Point ? vertToVert(mesh) : context.domain === AttrDomain.Edge ? edgeToEdge(mesh) : faceToFace(mesh)
            a = pass((src, mixer) => {
                for (let i = 0; i < size; i++) {
                    mixer.set(i, src, i, 1)
                    for (let k = map.offsets[i]; k < map.offsets[i + 1]; k++) mixer.mixIn(i, src, map.indices[k], w[i])
                }
            })
        } else if (curves && context.domain === AttrDomain.Point) {
            a = pass((src, mixer) => blurCurves(curves, w, src, mixer))
        }
        return GVArray.fromArray(type, a)
    }
}

/** `blur_on_curve_exec` (:244): neighbours along each curve, the ends wrapping when cyclic. */
function blurCurves(curves: CurvesGeometry, w: Float32Array, src: TypedArray, mixer: ReturnType<typeof createDefaultMixer>): void {
    const cyclic = curvesAttributeOr(curves, 'cyclic', curves.curvesNum, 0)
    for (let c = 0; c < curves.curvesNum; c++) {
        const [s, e] = curves.pointsRange(c)
        if (e - s === 1) {
            mixer.set(s, src, s, 1)
            continue
        }
        for (let p = s + 1; p < e - 1; p++) {
            mixer.set(p, src, p, 1)
            mixer.mixIn(p, src, p - 1, w[p])
            mixer.mixIn(p, src, p + 1, w[p])
        }
        const first = s, last = e - 1
        mixer.set(first, src, first, 1)
        mixer.mixIn(first, src, first + 1, w[first])
        mixer.set(last, src, last, 1)
        mixer.mixIn(last, src, last - 1, w[last])
        if (cyclic[c]) {
            mixer.mixIn(first, src, last, w[first])
            mixer.mixIn(last, src, first, w[last])
        }
    }
}

registerNodeType({
    idname: 'GeometryNodeBlurAttribute',
    label: 'Blur Attribute',
    // `node_init`: CD_PROP_FLOAT; RNA items FLOAT, INT, FLOAT_VECTOR, FLOAT_COLOR.
    properties: {data_type: 'FLOAT'},
    enums: {data_type: ['FLOAT', 'INT', 'FLOAT_VECTOR', 'FLOAT_COLOR']},
    declare(b, node) {
        const type = socketTypeFromRNA(node.prop<string>('data_type'))
        b.input(type, 'Value').hideValue().field()
        b.output(type, 'Value').field()
        b.input('INT', 'Iterations').default(1).min(0)
        b.input('FLOAT', 'Weight').default(1).min(0).max(1).subtype('FACTOR').field()
    },
    execute(p) {
        p.set('Value', GField.fromInput(new BlurInput(p.field('Weight'), p.field('Value'), p.int('Iterations'))))
    },
})
