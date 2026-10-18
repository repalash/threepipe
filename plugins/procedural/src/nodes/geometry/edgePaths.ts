/**
 * Shortest Edge Paths (`node_geo_input_shortest_edge_paths.cc`), Edge Paths to Selection
 * (`node_geo_edge_paths_to_selection.cc`) and Edge Paths to Curves (`node_geo_edge_paths_to_curves.cc`).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {createCurveFromVertIndices} from '../../geometry/meshToCurve'
import {vertToEdgeMap} from '../../geometry/meshTopology'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

const FLT_MAX = 3.4028234663852886e38

/**
 * A binary min-heap of `(cost, vertex)` pairs (`std::priority_queue<std::pair<float, int>, ..., std::greater<>>`).
 * Pairs are totally ordered and a vertex is only pushed with a strictly smaller cost, so any min-heap pops the same
 * sequence as libc++'s.
 */
class PairHeap {
    private cost: number[] = []
    private vert: number[] = []
    private less(i: number, j: number): boolean {
        return this.cost[i] < this.cost[j] || (this.cost[i] === this.cost[j] && this.vert[i] < this.vert[j])
    }
    private swap(i: number, j: number): void {
        [this.cost[i], this.cost[j]] = [this.cost[j], this.cost[i]]
        ;[this.vert[i], this.vert[j]] = [this.vert[j], this.vert[i]]
    }
    get size(): number {
        return this.cost.length
    }
    push(cost: number, vert: number): void {
        this.cost.push(cost)
        this.vert.push(vert)
        let i = this.cost.length - 1
        while (i > 0) {
            const p = (i - 1) >> 1
            if (!this.less(i, p)) break
            this.swap(i, p)
            i = p
        }
    }
    pop(): [number, number] {
        const top: [number, number] = [this.cost[0], this.vert[0]]
        const last = this.cost.length - 1
        this.swap(0, last)
        this.cost.pop()
        this.vert.pop()
        let i = 0
        for (;;) {
            const l = 2 * i + 1, r = l + 1
            let m = i
            if (l < this.cost.length && this.less(l, m)) m = l
            if (r < this.cost.length && this.less(r, m)) m = r
            if (m === i) break
            this.swap(i, m)
            i = m
        }
        return top
    }
}

/** `shortest_paths` (:42): Dijkstra from every end vertex over edge costs clamped at zero. */
function shortestPaths(mesh: MeshData, ends: number[], inputCost: GVArray, next: Int32Array, cost: Float32Array): void {
    const ev = mesh.edgeVerts
    const map = vertToEdgeMap(mesh)
    const visited = new Uint8Array(mesh.vertsNum)
    const queue = new PairHeap()
    for (const v of ends) {
        cost[v] = 0
        queue.push(0, v)
    }
    while (queue.size) {
        const [c, v] = queue.pop()
        if (visited[v]) continue
        visited[v] = 1
        for (let k = map.offsets[v]; k < map.offsets[v + 1]; k++) {
            const e = map.indices[k]
            const other = ev[e * 2] === v ? ev[e * 2 + 1] : ev[e * 2]
            if (visited[other]) continue
            const edgeCost = Math.max(0, inputCost.get(e))
            const newCost = f32(c + edgeCost)
            if (newCost < cost[other]) {
                cost[other] = newCost
                next[other] = v
                queue.push(newCost, other)
            }
        }
    }
}

/** `ShortestEdgePathsNextVertFieldInput` (:94) and `ShortestEdgePathsCostFieldInput` (:164). */
class ShortestPathsInput extends FieldInput {
    constructor(readonly output: 'next' | 'cost', readonly endSelection: GField, readonly edgeCost: GField) {
        super(output === 'next' ? 'int32' : 'float', output === 'next' ? 'Shortest Edge Paths Next Vertex Field' : 'Shortest Edge Paths Cost Field')
    }

    children(): GField[] {
        return [this.endSelection, this.edgeCost]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        if (!mesh) return undefined
        const inputCost = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Edge), mesh.edgesNum).evaluate(this.edgeCost)
        const endSel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Point), mesh.vertsNum).evaluate(this.endSelection)
        const ends: number[] = []
        for (let v = 0; v < mesh.vertsNum; v++) if (endSel.get(v)) ends.push(v)
        const adapt = (values: GVArray) => (context.domain === AttrDomain.Point ? values : context.attributes().adaptDomain(values, AttrDomain.Point, context.domain))
        if (!ends.length) {
            if (this.output === 'cost') return adapt(GVArray.fromSingle('float', mesh.vertsNum, [0]))
            return adapt(GVArray.fromArray('int32', Int32Array.from({length: mesh.vertsNum}, (_, i) => i)))
        }
        const next = new Int32Array(mesh.vertsNum).fill(-1)
        const cost = new Float32Array(mesh.vertsNum).fill(FLT_MAX)
        shortestPaths(mesh, ends, inputCost, next, cost)
        if (this.output === 'next') {
            for (let i = 0; i < next.length; i++) if (next[i] === -1) next[i] = i
            return adapt(GVArray.fromArray('int32', next))
        }
        for (let i = 0; i < cost.length; i++) if (cost[i] === FLT_MAX) cost[i] = 0
        return adapt(GVArray.fromArray('float', cost))
    }
}

registerNodeType({
    idname: 'GeometryNodeInputShortestEdgePaths',
    label: 'Shortest Edge Paths',
    declare(b) {
        b.input('BOOLEAN', 'End Vertex').default(false).hideValue().field()
        b.input('FLOAT', 'Edge Cost').default(1).hideValue().field()
        b.output('INT', 'Next Vertex Index').field()
        b.output('FLOAT', 'Total Cost').field()
    },
    execute(p) {
        const ends = p.field('End Vertex'), cost = p.field('Edge Cost')
        p.set('Next Vertex Index', GField.fromInput(new ShortestPathsInput('next', ends, cost)))
        p.set('Total Cost', GField.fromInput(new ShortestPathsInput('cost', ends, cost)))
    },
})

/** Start vertices (as a mask) and next indices, evaluated on the points. */
function evaluatePaths(mesh: MeshData, startField: GField, nextField: GField): {starts: number[], next: Int32Array} {
    const e = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Point), mesh.vertsNum)
    const nextV = e.evaluate(nextField), startV = e.evaluate(startField)
    const next = Int32Array.from({length: mesh.vertsNum}, (_, i) => nextV.get(i))
    const starts: number[] = []
    for (let v = 0; v < mesh.vertsNum; v++) if (startV.get(v)) starts.push(v)
    return {starts, next}
}

/** `PathToEdgeSelectionFieldInput` (:61) with `edge_paths_to_selection` (:27). */
class PathToEdgeSelectionInput extends FieldInput {
    constructor(readonly starts: GField, readonly next: GField) {
        super('bool', 'Edge Selection')
    }

    children(): GField[] {
        return [this.starts, this.next]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.mesh
        if (!mesh) return undefined
        const {starts, next} = evaluatePaths(mesh, this.starts, this.next)
        if (!starts.length) return undefined
        const n = mesh.vertsNum
        const vertSel = new Uint8Array(n)
        // A selected vertex's path is selected already. Out-of-range indices end a path.
        for (const s of starts) for (let v = s; v >= 0 && v < n && !vertSel[v]; v = next[v]) vertSel[v] = 1
        const ev = mesh.edgeVerts
        const out = new Uint8Array(mesh.edgesNum)
        for (let e = 0; e < mesh.edgesNum; e++) {
            const a = ev[e * 2], b = ev[e * 2 + 1]
            if (!(vertSel[a] && vertSel[b])) continue
            if (a === next[b] || b === next[a]) out[e] = 1
        }
        const values = GVArray.fromArray('bool', out)
        return context.domain === AttrDomain.Edge ? values : context.attributes().adaptDomain(values, AttrDomain.Edge, context.domain)
    }
}

registerNodeType({
    idname: 'GeometryNodeEdgePathsToSelection',
    label: 'Edge Paths to Selection',
    declare(b) {
        b.input('BOOLEAN', 'Start Vertices').default(true).hideValue().field()
        b.input('INT', 'Next Vertex Index').default(-1).hideValue().field()
        b.output('BOOLEAN', 'Selection').field()
    },
    execute(p) {
        p.set('Selection', GField.fromInput(new PathToEdgeSelectionInput(p.field('Start Vertices'), p.field('Next Vertex Index'))))
    },
})

/** `geometry_set.keep_only({Edit})`. */
function clearReal(g: GeometrySet): void {
    for (const t of ['mesh', 'pointcloud', 'curves', 'instances'] as const) g.remove(t)
}

registerNodeType({
    idname: 'GeometryNodeEdgePathsToCurves',
    label: 'Edge Paths to Curves',
    declare(b) {
        b.input('GEOMETRY', 'Mesh')
        b.input('BOOLEAN', 'Start Vertices').default(true).hideValue().field()
        b.input('INT', 'Next Vertex Index').default(-1).hideValue().field()
        b.output('GEOMETRY', 'Curves')
    },
    // `node_geo_exec` (:72) with `edge_paths_to_curves_convert` (:30).
    execute(p) {
        const startField = p.field('Start Vertices'), nextField = p.field('Next Vertex Index')
        p.set('Curves', foreachRealGeometry(p.geometry('Mesh'), g => {
            const mesh = g.mesh
            if (!mesh) return clearReal(g)
            const {starts, next} = evaluatePaths(mesh, startField, nextField)
            if (!starts.length) return clearReal(g)
            const n = mesh.vertsNum
            const vertIndices: number[] = [], curveOffsets: number[] = []
            const visited = new Uint8Array(n)
            for (const first of starts) {
                const second = next[first]
                if (first === second || second < 0 || second >= n) continue
                curveOffsets.push(vertIndices.length)
                let current = first
                while (!visited[current]) {
                    visited[current] = 1
                    vertIndices.push(current)
                    const nv = next[current]
                    if (nv < 0 || nv >= n) break
                    current = nv
                }
                for (let k = curveOffsets[curveOffsets.length - 1]; k < vertIndices.length; k++) visited[vertIndices[k]] = 0
            }
            const src = g.attributes('mesh')!
            clearReal(g)
            if (vertIndices.length) g.setCurves(createCurveFromVertIndices(src, vertIndices, curveOffsets, curveOffsets.length, () => false))
        }, p.options.scene))
    },
})
