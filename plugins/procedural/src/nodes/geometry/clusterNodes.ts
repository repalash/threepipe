/**
 * Merge Points (`node_geo_merge_points.cc`), Cluster by Connected (`node_geo_cluster_by_connected.cc`) and Cluster by
 * Distance (`node_geo_cluster_by_distance.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {KDTree3} from '../../blender/kdtree'
import {FieldContext, FieldEvaluation, FieldInput, GField, IndexFieldInput} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshMergeVertsByIds} from '../../geometry/meshMergeVerts'
import {mergePoints} from '../../geometry/pointMerge'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeMergePoints',
    label: 'Merge Points',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'Merge ID').implicit('INDEX').field()
    },
    // `node_geo_exec` (:28): the plain Index field merges nothing.
    execute(p) {
        const geometry = p.geometry('Geometry')
        const ids = p.field('Merge ID'), selection = p.field('Selection')
        if (ids.node instanceof IndexFieldInput) return p.set('Geometry', geometry)
        p.set('Geometry', foreachRealGeometry(geometry, g => {
            const evaluate = (type: 'pointcloud' | 'mesh', size: number) => {
                const e = new FieldEvaluation(new FieldContext(type, g.get(type)!, AttrDomain.Point), size)
                const sel = e.evaluate(selection), idv = e.evaluate(ids)
                const mask: number[] = []
                const mergeIds = new Int32Array(size)
                for (let i = 0; i < size; i++) {
                    if (!sel.get(i)) continue
                    mask.push(i)
                    mergeIds[i] = idv.get(i)
                }
                return {mask, mergeIds}
            }
            const pc = g.pointCloud
            if (pc) {
                const {mask, mergeIds} = evaluate('pointcloud', pc.pointsNum)
                if (mask.length) g.setPointCloud(mergePoints(pc, mask, mergeIds))
            }
            const mesh = g.mesh
            if (mesh) {
                const {mask, mergeIds} = evaluate('mesh', mesh.vertsNum)
                if (mask.length) g.setMesh(meshMergeVertsByIds(mesh, mask, mergeIds))
            }
        }, p.options.scene))
    },
})

/** `blender::DisjointSet` (`BLI_disjoint_set.hh`): union by rank, path compression on non-const finds. */
class DisjointSet {
    private readonly parents: Int32Array
    private readonly ranks: Int32Array

    constructor(size: number) {
        this.parents = Int32Array.from({length: size}, (_, i) => i)
        this.ranks = new Int32Array(size)
    }

    join(x: number, y: number): number {
        let r1 = this.findRoot(x), r2 = this.findRoot(y)
        if (r1 === r2) return r1
        if (this.ranks[r1] < this.ranks[r2]) [r1, r2] = [r2, r1]
        this.parents[r2] = r1
        if (this.ranks[r1] === this.ranks[r2]) this.ranks[r1]++
        return r1
    }

    findRoot(x: number): number {
        let root = x
        while (this.parents[root] !== root) root = this.parents[root]
        let to = x
        while (this.parents[to] !== root) {
            const parent = this.parents[to]
            this.parents[to] = root
            to = parent
        }
        return root
    }

    /** The `const` overload: no path compression. */
    findRootConst(x: number): number {
        let root = x
        while (this.parents[root] !== root) root = this.parents[root]
        return root
    }
}

const indexVArray = (size: number) => GVArray.fromArray('int32', Int32Array.from({length: size}, (_, i) => i))

/** `ClusterByConnectedFieldInput` (:29). */
class ClusterByConnectedInput extends FieldInput {
    constructor(readonly selection: GField, readonly position: GField, readonly distance: number) {
        super('int32', 'Cluster by Connected')
    }

    children(): GField[] {
        return [this.selection, this.position]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const mesh = context.type === 'mesh' ? context.mesh : undefined
        if (!mesh) return context.type === 'none' ? undefined : indexVArray(context.size)
        const sel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Edge), mesh.edgesNum).evaluate(this.selection)
        const edges: number[] = []
        for (let e = 0; e < mesh.edgesNum; e++) if (sel.get(e)) edges.push(e)
        if (!edges.length) return indexVArray(context.size)
        const pos = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Point), mesh.vertsNum).evaluate(this.position)
        const set = new DisjointSet(mesh.vertsNum)
        const center = new Float32Array(mesh.vertsNum * 3)
        for (let v = 0; v < mesh.vertsNum; v++) for (let k = 0; k < 3; k++) center[v * 3 + k] = pos.get(v, k)
        const size = new Int32Array(mesh.vertsNum).fill(1)
        const ev = mesh.edgeVerts
        for (const e of edges) {
            const a = ev[e * 2], b = ev[e * 2 + 1]
            const ra = set.findRoot(a), rb = set.findRoot(b)
            if (ra === rb) continue
            const ca = [center[ra * 3], center[ra * 3 + 1], center[ra * 3 + 2]], cb = [center[rb * 3], center[rb * 3 + 1], center[rb * 3 + 2]]
            // `math::distance`: the length of the difference.
            const d = [0, 1, 2].map(k => f32(ca[k] - cb[k]))
            const dist = f32(Math.sqrt(f32(f32(f32(d[0] * d[0]) + f32(d[1] * d[1])) + f32(d[2] * d[2]))))
            if (dist >= this.distance) continue
            const root = set.join(a, b)
            const total = size[ra] + size[rb]
            // `math::interpolate(a, b, t)`: `a * (1 - t) + b * t`.
            const t = f32(size[rb] / total), omt = f32(1 - t)
            for (let k = 0; k < 3; k++) center[root * 3 + k] = f32(f32(ca[k] * omt) + f32(cb[k] * t))
            size[root] = total
        }
        const ids = Int32Array.from({length: mesh.vertsNum}, (_, i) => set.findRootConst(i))
        const values = GVArray.fromArray('int32', ids)
        return context.domain === AttrDomain.Point ? values : context.attributes().adaptDomain(values, AttrDomain.Point, context.domain)
    }
}

registerNodeType({
    idname: 'GeometryNodeClusterByConnected',
    label: 'Cluster by Connected',
    declare(b) {
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Position').implicit('POSITION').field()
        b.input('FLOAT', 'Distance').default(0.001).min(0).subtype('DISTANCE')
        b.output('INT', 'Cluster ID').field()
    },
    execute(p) {
        p.set('Cluster ID', GField.fromInput(new ClusterByConnectedInput(p.field('Selection'), p.field('Position'), p.float('Distance'))))
    },
})

/** `ClusterByDistanceFieldInput` (:33). */
class ClusterByDistanceInput extends FieldInput {
    constructor(readonly position: GField, readonly group: GField, readonly selection: GField, readonly distance: number) {
        super('int32', 'Cluster by Distance')
    }

    children(): GField[] {
        return [this.position, this.group, this.selection]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        if (context.type === 'none') return undefined
        const size = context.size
        const e = new FieldEvaluation(context, size)
        const pos = e.evaluate(this.position), groups = e.evaluate(this.group), sel = e.evaluate(this.selection)
        const mask: number[] = []
        for (let i = 0; i < size; i++) if (sel.get(i)) mask.push(i)
        if (!mask.length) return indexVArray(size)
        const ids = Int32Array.from({length: size}, (_, i) => i)
        const groupOf = new Map<number, number>()
        if (groups.isSingle) groupOf.set(groups.single[0], 0)
        else for (const i of mask) if (!groupOf.has(groups.get(i))) groupOf.set(groups.get(i), groupOf.size)
        const p = (i: number, k: number) => pos.get(i, k)
        if (groupOf.size === 1) {
            const tree = new KDTree3(mask.length)
            for (const i of mask) tree.insert(i, p(i, 0), p(i, 1), p(i, 2))
            tree.balance()
            for (const i of mask) ids[i] = -1
            tree.calcDuplicatesFast(this.distance, ids, true)
            for (const i of mask) if (ids[i] === -1) ids[i] = i
            return GVArray.fromArray('int32', ids)
        }
        // Elements by group, ascending (`sort_groups`).
        const members: number[][] = Array.from({length: groupOf.size}, () => [])
        for (const i of mask) members[groupOf.get(groups.get(i))!].push(i)
        for (const group of members) {
            const local = new Int32Array(group.length).fill(-1)
            const tree = new KDTree3(group.length)
            group.forEach((i, k) => tree.insert(k, p(i, 0), p(i, 1), p(i, 2)))
            tree.balance()
            tree.calcDuplicatesFast(this.distance, local, true)
            for (let k = 0; k < local.length; k++) if (local[k] === -1) local[k] = k
            group.forEach((i, k) => { ids[i] = group[local[k]] })
        }
        return GVArray.fromArray('int32', ids)
    }
}

registerNodeType({
    idname: 'GeometryNodeClusterByDistance',
    label: 'Cluster by Distance',
    declare(b) {
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'Group ID').hideValue().field()
        b.input('VECTOR', 'Position').implicit('POSITION').field()
        b.input('FLOAT', 'Distance').default(0.001).min(0).subtype('DISTANCE')
        b.output('INT', 'Cluster ID').field()
    },
    execute(p) {
        p.set('Cluster ID', GField.fromInput(new ClusterByDistanceInput(p.field('Position'), p.field('Group ID'), p.field('Selection'), p.float('Distance'))))
    },
})
