/**
 * Mesh and curve topology nodes: Corners of Face / Vertex / Edge, Edges of Vertex / Corner, Face of Corner, Offset
 * Corner in Face, Vertex of Corner (`node_geo_mesh_topology_*.cc`), Points of Curve, Curve of Point
 * (`node_geo_curve_topology_*.cc`) and Offset Point in Curve (`node_geo_offset_point_in_curve.cc`).
 *
 * The "X of Y" inputs pick the `Sort Index`-th element (wrapped with `mod_i`) of each group, after a stable sort by
 * `Weights` - unless the weights are a single value, in which case the group's own (ascending) order is used.
 * Their "Total" outputs and the per-corner / per-point lookups are `EvaluateAtIndexInput`s over count / map inputs,
 * as in Blender.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {CurvesGeometry} from '../../geometry/components'
import {curvesAttributeOr} from '../../geometry/curvesEval'
import {cornerToFaceMap, faceCornerPrev, vertToCornerMap, vertToEdgeMap} from '../../geometry/meshTopology'
import {EvaluateAtIndexInput, FieldContext, FieldEvaluation, FieldInput, GField, IndexFieldInput} from '../../fields'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/** `mod_i` (`BLI_math_base_inline.cc`): `(i % n + n) % n`. */
const modI = (i: number, n: number) => ((i % n) + n) % n

/** Groups as offsets + indices (ascending inside each group). */
interface Groups {
    offsets: ArrayLike<number>
    indices: ArrayLike<number>
}

/** Element of each group chosen by sort index after a stable sort by weight (`CornersOfVertInput` & co.). */
function pickSorted(groups: Groups | ((g: number) => [number, number]), groupsNum: number, groupIdx: GVArray, sortIdx: GVArray,
    weights: GVArray, size: number, emptyIsZero: boolean): Int32Array {
    const out = new Int32Array(size)
    const useSorting = !weights.isSingle
    for (let i = 0; i < size; i++) {
        const g = groupIdx.get(i)
        if (!(g >= 0 && g < groupsNum)) continue
        let members: number[]
        if (typeof groups === 'function') {
            const [a, b] = groups(g)
            members = []
            for (let k = a; k < b; k++) members.push(k)
        } else {
            members = Array.prototype.slice.call(groups.indices, groups.offsets[g], groups.offsets[g + 1]) as number[]
        }
        if (members.length === 0) {
            // Vertex / edge groups can be empty (0); faces and curves never are in valid geometry.
            if (emptyIsZero) continue
        }
        const wrapped = modI(sortIdx.get(i), members.length)
        if (!useSorting) {
            out[i] = members[wrapped]
            continue
        }
        const w = members.map(m => weights.get(m))
        const order = members.map((_, k) => k).sort((a, b) => (w[a] < w[b] ? -1 : w[b] < w[a] ? 1 : 0))
        out[i] = members[order[wrapped]]
    }
    return out
}

/** A mesh field input (`bke::MeshFieldInput`): undefined outside mesh contexts. */
abstract class MeshInput extends FieldInput {
    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        return mesh ? this.forMesh(mesh, context) : undefined
    }

    abstract forMesh(mesh: MeshData, context: FieldContext): GVArray | undefined
}

/** Corners of Vertex / Face / Edge, Edges of Vertex: `(group index, sort index, weights)` per element. */
class SortedOfInput extends MeshInput {
    constructor(readonly kind: 'cornersOfVertex' | 'cornersOfFace' | 'cornersOfEdge' | 'edgesOfVertex',
        readonly groupIndex: GField, readonly sortIndex: GField, readonly weights: GField) {
        super('int32', kind)
    }

    children(): GField[] {
        return [this.groupIndex, this.sortIndex, this.weights]
    }

    forMesh(mesh: MeshData, context: FieldContext): GVArray {
        const evaluation = new FieldEvaluation(context, context.size)
        const groupIdx = evaluation.evaluate(this.groupIndex)
        const sortIdx = evaluation.evaluate(this.sortIndex)
        const weightDomain = this.kind === 'edgesOfVertex' ? AttrDomain.Edge : AttrDomain.Corner
        const wCtx = context.withDomain(weightDomain)
        const weights = new FieldEvaluation(wCtx, wCtx.size).evaluate(this.weights)
        let out: Int32Array
        switch (this.kind) {
        case 'cornersOfVertex': out = pickSorted(vertToCornerMap(mesh), mesh.vertsNum, groupIdx, sortIdx, weights, context.size, true); break
        case 'edgesOfVertex': out = pickSorted(vertToEdgeMap(mesh), mesh.vertsNum, groupIdx, sortIdx, weights, context.size, true); break
        case 'cornersOfEdge': out = pickSorted(edgeToCornerMap(mesh), mesh.edgesNum, groupIdx, sortIdx, weights, context.size, true); break
        default: {
            const fo = mesh.faceOffsets
            out = pickSorted(f => [fo[f], fo[f + 1]], mesh.facesNum, groupIdx, sortIdx, weights, context.size, false)
        }
        }
        return GVArray.fromArray('int32', out)
    }
}

/** `build_edge_to_corner_map` (`mesh_mapping.cc:357`): corners using each edge, ascending. */
function edgeToCornerMap(mesh: MeshData): Groups {
    const ce = mesh.cornerEdges
    const offsets = new Int32Array(mesh.edgesNum + 1)
    for (let k = 0; k < ce.length; k++) offsets[ce[k] + 1]++
    for (let e = 0; e < mesh.edgesNum; e++) offsets[e + 1] += offsets[e]
    const indices = new Int32Array(ce.length)
    const fill = new Int32Array(mesh.edgesNum)
    for (let k = 0; k < ce.length; k++) indices[offsets[ce[k]] + fill[ce[k]]++] = k
    return {offsets, indices}
}

/** Per-element values on a fixed domain (counts, corner maps); undefined on other domains, as Blender's inputs. */
class DomainArrayInput extends MeshInput {
    constructor(readonly domain: AttrDomain, readonly name: string, readonly compute: (mesh: MeshData) => Int32Array) {
        super('int32', name)
    }

    key(): string {
        return `topology:${this.name}`
    }

    forMesh(mesh: MeshData, context: FieldContext): GVArray | undefined {
        if (context.domain !== this.domain) return undefined
        return GVArray.fromArray('int32', this.compute(mesh))
    }
}

const counts = (groups: Groups, n: number) => Int32Array.from({length: n}, (_, i) => groups.offsets[i + 1] - groups.offsets[i])
const FACE_SIZE = new DomainArrayInput(AttrDomain.Face, 'Face Corner Count', m => Int32Array.from({length: m.facesNum}, (_, f) => m.faceOffsets[f + 1] - m.faceOffsets[f]))
// `CornersOfVertCountInput` (:153): `count_indices(corner_verts)`.
const VERT_CORNER_COUNT = new DomainArrayInput(AttrDomain.Point, 'Vertex Corner Count', m => counts(vertToCornerMap(m), m.vertsNum))
const VERT_EDGE_COUNT = new DomainArrayInput(AttrDomain.Point, 'Vertex Edge Count', m => counts(vertToEdgeMap(m), m.vertsNum))
const EDGE_CORNER_COUNT = new DomainArrayInput(AttrDomain.Edge, 'Edge Corner Count', m => counts(edgeToCornerMap(m), m.edgesNum))
const CORNER_NEXT_EDGE = new DomainArrayInput(AttrDomain.Corner, 'Corner Next Edge', m => Int32Array.from(m.cornerEdges))
const CORNER_PREV_EDGE = new DomainArrayInput(AttrDomain.Corner, 'Corner Previous Edge', m => {
    const c2f = cornerToFaceMap(m), fo = m.faceOffsets
    return Int32Array.from({length: m.cornersNum}, (_, c) => m.cornerEdges[faceCornerPrev(fo[c2f[c]], fo[c2f[c] + 1], c)])
})
const CORNER_FACE = new DomainArrayInput(AttrDomain.Corner, 'Corner Face Index', m => Int32Array.from(cornerToFaceMap(m)))
const CORNER_INDEX_IN_FACE = new DomainArrayInput(AttrDomain.Corner, 'Corner Index In Face', m => {
    const c2f = cornerToFaceMap(m)
    return Int32Array.from({length: m.cornersNum}, (_, c) => c - m.faceOffsets[c2f[c]])
})
const CORNER_VERT = new DomainArrayInput(AttrDomain.Corner, 'Corner Vertex', m => Int32Array.from(m.cornerVerts))

const atIndex = (index: GField, input: FieldInput, domain: AttrDomain) => GField.fromInput(new EvaluateAtIndexInput(index, GField.fromInput(input), domain))

// region mesh

const SORTED: [string, string, string, string, 'cornersOfVertex' | 'cornersOfFace' | 'cornersOfEdge' | 'edgesOfVertex', string, DomainArrayInput, AttrDomain][] = [
    ['GeometryNodeCornersOfFace', 'Corners of Face', 'Face Index', 'Corner Index', 'cornersOfFace', 'Total', FACE_SIZE, AttrDomain.Face],
    ['GeometryNodeCornersOfVertex', 'Corners of Vertex', 'Vertex Index', 'Corner Index', 'cornersOfVertex', 'Total', VERT_CORNER_COUNT, AttrDomain.Point],
    ['GeometryNodeCornersOfEdge', 'Corners of Edge', 'Edge Index', 'Corner Index', 'cornersOfEdge', 'Total', EDGE_CORNER_COUNT, AttrDomain.Edge],
    ['GeometryNodeEdgesOfVertex', 'Edges of Vertex', 'Vertex Index', 'Edge Index', 'edgesOfVertex', 'Total', VERT_EDGE_COUNT, AttrDomain.Point],
]
for (const [idname, label, indexName, outName, kind, total, countInput, countDomain] of SORTED) {
    registerNodeType({
        idname,
        label,
        declare(b) {
            b.input('INT', indexName).implicit('INDEX').field()
            b.input('FLOAT', 'Weights').hideValue().field()
            b.input('INT', 'Sort Index').field()
            b.output('INT', outName).field()
            b.output('INT', total).field()
        },
        execute(p) {
            const index = p.field(indexName)
            if (p.outputUsed(total)) p.set(total, atIndex(index, countInput, countDomain))
            if (p.outputUsed(outName)) p.set(outName, GField.fromInput(new SortedOfInput(kind, index, p.field('Sort Index'), p.field('Weights'))))
        },
    })
}

registerNodeType({
    idname: 'GeometryNodeEdgesOfCorner',
    label: 'Edges of Corner',
    declare(b) {
        b.input('INT', 'Corner Index').implicit('INDEX').field()
        b.output('INT', 'Next Edge Index').field()
        b.output('INT', 'Previous Edge Index').field()
    },
    execute(p) {
        const c = p.field('Corner Index')
        if (p.outputUsed('Next Edge Index')) p.set('Next Edge Index', atIndex(c, CORNER_NEXT_EDGE, AttrDomain.Corner))
        if (p.outputUsed('Previous Edge Index')) p.set('Previous Edge Index', atIndex(c, CORNER_PREV_EDGE, AttrDomain.Corner))
    },
})

registerNodeType({
    idname: 'GeometryNodeFaceOfCorner',
    label: 'Face of Corner',
    declare(b) {
        b.input('INT', 'Corner Index').implicit('INDEX').field()
        b.output('INT', 'Face Index').field()
        b.output('INT', 'Index in Face').field()
    },
    execute(p) {
        const c = p.field('Corner Index')
        if (p.outputUsed('Face Index')) p.set('Face Index', atIndex(c, CORNER_FACE, AttrDomain.Corner))
        if (p.outputUsed('Index in Face')) p.set('Index in Face', atIndex(c, CORNER_INDEX_IN_FACE, AttrDomain.Corner))
    },
})

registerNodeType({
    idname: 'GeometryNodeVertexOfCorner',
    label: 'Vertex of Corner',
    declare(b) {
        b.input('INT', 'Corner Index').implicit('INDEX').field()
        b.output('INT', 'Vertex Index').field()
    },
    execute(p) {
        p.set('Vertex Index', atIndex(p.field('Corner Index'), CORNER_VERT, AttrDomain.Corner))
    },
})

/** `OffsetCornerInFaceFieldInput` (`node_geo_mesh_topology_offset_corner_in_face.cc`). */
class OffsetCornerInFaceInput extends MeshInput {
    constructor(readonly corner: GField, readonly offset: GField) {
        super('int32', 'Offset Corner in Face')
    }

    children(): GField[] {
        return [this.corner, this.offset]
    }

    forMesh(mesh: MeshData, context: FieldContext): GVArray {
        const e = new FieldEvaluation(context, context.size)
        const corners = e.evaluate(this.corner), offsets = e.evaluate(this.offset)
        const c2f = cornerToFaceMap(mesh), fo = mesh.faceOffsets
        const out = new Int32Array(context.size)
        for (let i = 0; i < context.size; i++) {
            const c = corners.get(i)
            if (!(c >= 0 && c < mesh.cornersNum)) continue
            const f = c2f[c], start = fo[f], n = fo[f + 1] - start
            // `math::mod_periodic`.
            out[i] = start + modI(c - start + offsets.get(i), n)
        }
        return GVArray.fromArray('int32', out)
    }
}

registerNodeType({
    idname: 'GeometryNodeOffsetCornerInFace',
    label: 'Offset Corner in Face',
    declare(b) {
        b.input('INT', 'Corner Index').implicit('INDEX').field()
        b.input('INT', 'Offset').field()
        b.output('INT', 'Corner Index').field()
    },
    execute(p) {
        p.set('Corner Index', GField.fromInput(new OffsetCornerInFaceInput(p.field('Corner Index'), p.field('Offset'))))
    },
})

// endregion

// region curves

/** `curves.point_to_curve_map()`. */
function pointToCurve(curves: CurvesGeometry): Int32Array {
    const out = new Int32Array(curves.pointsNum)
    for (let c = 0; c < curves.curvesNum; c++) out.fill(c, curves.curveOffsets[c], curves.curveOffsets[c + 1])
    return out
}

/** A curves field input (`bke::CurvesFieldInput`): undefined outside curve contexts. */
class CurvesArrayInput extends FieldInput {
    constructor(readonly domain: AttrDomain, readonly name: string, readonly compute: (c: CurvesGeometry) => Int32Array) {
        super('int32', name)
    }

    key(): string {
        return `curves:${this.name}`
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const curves = context.curves
        if (!curves || context.domain !== this.domain) return undefined
        return GVArray.fromArray('int32', this.compute(curves))
    }
}

const CURVE_POINT_COUNT = new CurvesArrayInput(AttrDomain.Curve, 'Curve Point Count',
    c => Int32Array.from({length: c.curvesNum}, (_, i) => c.curveOffsets[i + 1] - c.curveOffsets[i]))
const POINT_CURVE = new CurvesArrayInput(AttrDomain.Point, 'Point Curve Index', pointToCurve)
const POINT_INDEX_IN_CURVE = new CurvesArrayInput(AttrDomain.Point, 'Point Index in Curve', c => {
    const p2c = pointToCurve(c)
    return Int32Array.from({length: c.pointsNum}, (_, p) => p - c.curveOffsets[p2c[p]])
})

/** `PointsOfCurveInput` (`node_geo_curve_topology_points_of_curve.cc`). */
class PointsOfCurveInput extends FieldInput {
    constructor(readonly curveIndex: GField, readonly sortIndex: GField, readonly weights: GField) {
        super('int32', 'Point of Curve')
    }

    children(): GField[] {
        return [this.curveIndex, this.sortIndex, this.weights]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const curves = context.curves
        if (!curves) return undefined
        const offsets = curves.curveOffsets
        // `use_start_point_special_case`: the curve's own index, constant sort index 0 and constant weights.
        if (context.domain === AttrDomain.Curve && this.curveIndex.node instanceof IndexFieldInput &&
            !this.sortIndex.dependsOnInput && !this.weights.dependsOnInput &&
            new FieldEvaluation(undefined, 1).evaluate(this.sortIndex).get(0) === 0) {
            return GVArray.fromArray('int32', Int32Array.from(offsets.subarray(0, curves.curvesNum)))
        }
        const e = new FieldEvaluation(context, context.size)
        const curveIdx = e.evaluate(this.curveIndex), sortIdx = e.evaluate(this.sortIndex)
        const pCtx = context.withDomain(AttrDomain.Point)
        const weights = new FieldEvaluation(pCtx, pCtx.size).evaluate(this.weights)
        return GVArray.fromArray('int32', pickSorted(c => [offsets[c], offsets[c + 1]], curves.curvesNum, curveIdx, sortIdx, weights, context.size, false))
    }
}

registerNodeType({
    idname: 'GeometryNodePointsOfCurve',
    label: 'Points of Curve',
    declare(b) {
        b.input('INT', 'Curve Index').implicit('INDEX').field()
        b.input('FLOAT', 'Weights').hideValue().field()
        b.input('INT', 'Sort Index').field()
        b.output('INT', 'Point Index').field()
        b.output('INT', 'Total').field()
    },
    execute(p) {
        const index = p.field('Curve Index')
        if (p.outputUsed('Total')) p.set('Total', atIndex(index, CURVE_POINT_COUNT, AttrDomain.Curve))
        if (p.outputUsed('Point Index')) p.set('Point Index', GField.fromInput(new PointsOfCurveInput(index, p.field('Sort Index'), p.field('Weights'))))
    },
})

registerNodeType({
    idname: 'GeometryNodeCurveOfPoint',
    label: 'Curve of Point',
    declare(b) {
        b.input('INT', 'Point Index').implicit('INDEX').field()
        b.output('INT', 'Curve Index').field()
        b.output('INT', 'Index in Curve').field()
    },
    execute(p) {
        const index = p.field('Point Index')
        if (p.outputUsed('Curve Index')) p.set('Curve Index', atIndex(index, POINT_CURVE, AttrDomain.Point))
        if (p.outputUsed('Index in Curve')) p.set('Index in Curve', atIndex(index, POINT_INDEX_IN_CURVE, AttrDomain.Point))
    },
})

/** `ControlPointNeighborFieldInput` / `OffsetValidFieldInput` (`node_geo_offset_point_in_curve.cc`). */
class OffsetPointInput extends FieldInput {
    constructor(readonly index: GField, readonly offset: GField, readonly valid: boolean) {
        super(valid ? 'bool' : 'int32', valid ? 'Offset Valid' : 'Offset Point in Curve')
    }

    children(): GField[] {
        return [this.index, this.offset]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const curves = context.curves
        if (!curves) return undefined
        const e = new FieldEvaluation(context, context.size)
        const indices = e.evaluate(this.index), offsets = e.evaluate(this.offset)
        const cyclic = curvesAttributeOr(curves, 'cyclic', curves.curvesNum, 0)
        const p2c = pointToCurve(curves), co = curves.curveOffsets, n = curves.pointsNum
        const clamp = (v: number) => Math.min(Math.max(v, 0), n - 1)
        const out = this.valid ? new Uint8Array(context.size) : new Int32Array(context.size)
        for (let i = 0; i < context.size; i++) {
            if (this.valid) {
                const p = indices.get(i)
                if (!(p >= 0 && p < n)) continue
                const c = p2c[p]
                const q = p + offsets.get(i)
                out[i] = cyclic[c] || (q >= co[c] && q < co[c + 1]) ? 1 : 0
                continue
            }
            const p = clamp(indices.get(i))
            const c = p2c[p]
            const shifted = p + offsets.get(i)
            out[i] = cyclic[c] ? co[c] + modI(shifted - co[c], co[c + 1] - co[c]) : clamp(shifted)
        }
        return GVArray.fromArray(this.valid ? 'bool' : 'int32', out)
    }
}

registerNodeType({
    idname: 'GeometryNodeOffsetPointInCurve',
    label: 'Offset Point in Curve',
    declare(b) {
        b.input('INT', 'Point Index').implicit('INDEX').field()
        b.input('INT', 'Offset').field()
        b.output('BOOLEAN', 'Is Valid Offset').field()
        b.output('INT', 'Point Index').field()
    },
    execute(p) {
        const index = p.field('Point Index'), offset = p.field('Offset')
        if (p.outputUsed('Point Index')) p.set('Point Index', GField.fromInput(new OffsetPointInput(index, offset, false)))
        if (p.outputUsed('Is Valid Offset')) p.set('Is Valid Offset', GField.fromInput(new OffsetPointInput(index, offset, true)))
    },
})

// endregion
