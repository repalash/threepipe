/**
 * Scale Elements (`node_geo_scale_elements.cc`): selected faces or edges, grouped into islands of connected elements,
 * scaled about the island's mean center by its mean scale, uniformly or along the mean axis.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {mat4Identity, mat4Multiply, transformPoint} from '../../blender/math/matrix'
import {cross3, isZero3, normalize3} from '../../blender/math/vec'
import {FieldContext, FieldEvaluation, GField} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshTagPositionsChanged} from '../../geometry/meshRuntime'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'
import {domainFromRNA} from '../attributeTypes'

interface Grouped {
    offsets: Int32Array
    indices: Int32Array
}

/**
 * `gather_groups` (:120): elements by island, ascending inside each (`build_groups_from_indices`). The other branch,
 * `from_indices_large_groups` (more than 1000 elements per island on average), orders each island's elements by
 * `parallel_sort` (TBB + libc++ `std::sort`, not stable), which changes the summation order of the means: not ported
 * for elements (`orderMatters`); vertices are moved independently, so their order within an island does not matter.
 */
function gatherGroups(groupIndices: Int32Array, groups: number, orderMatters: boolean): Grouped {
    if (orderMatters && Math.trunc(groupIndices.length / groups) > 1000) {
        throw new Error('procedural: Scale Elements with more than 1000 elements per island (from_indices_large_groups, ' +
            'parallel_sort order) is not ported yet (issue procedural-scale-elements-large-islands.md)')
    }
    const offsets = new Int32Array(groups + 1)
    for (const g of groupIndices) offsets[g + 1]++
    for (let g = 0; g < groups; g++) offsets[g + 1] += offsets[g]
    const fill = new Int32Array(groups)
    const indices = new Int32Array(groupIndices.length)
    for (let i = 0; i < groupIndices.length; i++) indices[offsets[groupIndices[i]] + fill[groupIndices[i]]++] = i
    return {offsets, indices}
}

/**
 * `AtomicDisjointSet` (`atomic_disjoint_set.cc`) joined over `pairs`, then `calc_reduced_ids` (:36): set ids by first
 * occurrence. Returns the number of sets.
 */
function reducedIds(size: number, join: (union: (a: number, b: number) => void) => void, out: Int32Array): number {
    const parent = Int32Array.from({length: size}, (_, i) => i)
    const find = (x: number): number => {
        while (parent[x] !== x) x = parent[x] = parent[parent[x]]
        return x
    }
    join((a, b) => {
        const ra = find(a), rb = find(b)
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
    })
    const idByRoot = new Map<number, number>()
    for (let i = 0; i < size; i++) {
        const r = find(i)
        let id = idByRoot.get(r)
        if (id === undefined) idByRoot.set(r, id = idByRoot.size)
        out[i] = id
    }
    return idByRoot.size
}

/**
 * `gather_face_islands` (:337) / `gather_edge_islands` (:404): islands of the selected elements connected through
 * vertices, as element and vertex groups (global indices).
 */
function gatherIslands(mesh: MeshData, domain: AttrDomain, mask: number[]): {items: Grouped, verts: Grouped} {
    const fo = mesh.faceOffsets, cv = mesh.cornerVerts, ev = mesh.edgeVerts
    // `vert_selection_from_face` / `vert_selection_from_edge`: the vertices used, ascending.
    const used = new Uint8Array(mesh.vertsNum)
    if (domain === AttrDomain.Face) {
        for (const f of mask) for (let c = fo[f]; c < fo[f + 1]; c++) used[cv[c]] = 1
    } else {
        for (const e of mask) used[ev[e * 2]] = used[ev[e * 2 + 1]] = 1
    }
    const vertMask: number[] = []
    for (let v = 0; v < mesh.vertsNum; v++) if (used[v]) vertMask.push(v)
    const pos = new Int32Array(mesh.vertsNum)
    vertMask.forEach((v, i) => { pos[v] = i })
    const vertIslands = new Int32Array(vertMask.length)
    const islands = reducedIds(vertMask.length, union => {
        if (domain === AttrDomain.Face) {
            for (const f of mask) for (let c = fo[f] + 1; c < fo[f + 1]; c++) union(pos[cv[fo[f]]], pos[cv[c]])
        } else {
            for (const e of mask) union(pos[ev[e * 2]], pos[ev[e * 2 + 1]])
        }
    }, vertIslands)
    const itemIslands = Int32Array.from(mask, i => vertIslands[pos[domain === AttrDomain.Face ? cv[fo[i]] : ev[i * 2]]])
    const verts = gatherGroups(vertIslands, islands, false)
    const items = gatherGroups(itemIslands, islands, true)
    for (let k = 0; k < items.indices.length; k++) items.indices[k] = mask[items.indices[k]]
    for (let k = 0; k < verts.indices.length; k++) verts.indices[k] = vertMask[verts.indices[k]]
    return {items, verts}
}

/**
 * `gather_mean` (:142) of each group: `parallel_deterministic_reduce` (grain 2048: halves until at most 2048 elements)
 * of `{sum / count, 1}` accumulators joined as `(a + b) / (count_a + count_b)`.
 */
function gatherMeans(values: GVArray, groups: Grouped, c: number): Float32Array {
    const n = groups.offsets.length - 1
    const out = new Float32Array(n * c)
    if (values.isSingle) {
        for (let g = 0; g < n; g++) for (let k = 0; k < c; k++) out[g * c + k] = values.single[k]
        return out
    }
    const identity = () => ({v: new Array<number>(c).fill(0), n: 0})
    // `join_accumulators` (:146).
    const join = (a: {v: number[], n: number}, b: {v: number[], n: number}) => {
        const cnt = a.n + b.n
        return {v: a.v.map((x, k) => f32(f32(x + b.v[k]) / cnt)), n: 1}
    }
    // The body on a range: `join_accumulators({sum, size}, identity)`.
    const body = (begin: number, end: number) => join(sumRange(values, groups.indices, begin, end, c), identity())
    // `tbb::parallel_deterministic_reduce` with a `blocked_range` of grain 2048: halves while larger than the grain.
    const reduce = (begin: number, end: number): {v: number[], n: number} => {
        if (end - begin <= 2048) return body(begin, end)
        const mid = begin + Math.trunc((end - begin) / 2)
        return join(reduce(begin, mid), reduce(mid, end))
    }
    for (let g = 0; g < n; g++) {
        const acc = reduce(groups.offsets[g], groups.offsets[g + 1])
        for (let k = 0; k < c; k++) out[g * c + k] = f32(acc.v[k] / acc.n)
    }
    return out
}

function sumRange(values: GVArray, indices: Int32Array, begin: number, end: number, c: number): {v: number[], n: number} {
    const v = new Array<number>(c).fill(0)
    for (let j = begin; j < end; j++) for (let k = 0; k < c; k++) v[k] = f32(v[k] + values.get(indices[j], k))
    return {v, n: end - begin}
}

/** `create_single_axis_transform` (:208). */
function singleAxisTransform(center: ArrayLike<number>, axis: ArrayLike<number>, scale: number): Float32Array {
    const x = normalize3(axis)
    let y = cross3(x, [0, 0, 1])
    if (isZero3(y)) y = cross3(x, [0, 1, 0])
    y = normalize3(y)
    const z = cross3(x, y)
    const transform = mat4Identity()
    for (let k = 0; k < 3; k++) transform[12 + k] = f32(transform[12 + k] - center[k])
    const base = mat4Identity()
    base.set(x, 0)
    base.set(y, 4)
    base.set(z, 8)
    const inv = new Float32Array(16)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) inv[c * 4 + r] = base[r * 4 + c]
    const scaleM = mat4Identity()
    scaleM[0] = scale
    const out = mat4Multiply(mat4Multiply(mat4Multiply(base, scaleM), inv), transform)
    for (let k = 0; k < 3; k++) out[12 + k] = f32(out[12 + k] + center[k])
    return out
}

registerNodeType({
    idname: 'GeometryNodeScaleElements',
    label: 'Scale Elements',
    properties: {domain: 'FACE'},
    enums: {domain: ['FACE', 'EDGE']},
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('FLOAT', 'Scale').default(1).min(0).field()
        b.input('VECTOR', 'Center').subtype('TRANSLATION').implicit('POSITION').field()
        // Menu values are the item names (`scale_mode_items`: Uniform, Single Axis).
        b.input('MENU', 'Scale Mode').default('Uniform')
        b.input('VECTOR', 'Axis').default([1, 0, 0]).field()
    },
    // `node_geo_exec` (:470).
    execute(p) {
        const domain = domainFromRNA(p.node.prop<string>('domain'))
        const mode = p.string('Scale Mode')
        if (mode !== 'Uniform' && mode !== 'Single Axis') throw new Error(`Scale Elements: mode '${mode}' is not a menu item`)
        const selection = p.field('Selection'), scaleField = p.field('Scale'), centerField = p.field('Center')
        const axisField: GField | undefined = mode === 'Single Axis' ? p.field('Axis') : undefined
        const out = foreachRealGeometry(p.geometry('Geometry'), g => {
            const mesh = g.meshForWrite()
            if (!mesh) return
            const size = mesh.attributes.domainSizes[domain]
            const e = new FieldEvaluation(new FieldContext('mesh', mesh, domain), size)
            const sel = e.evaluate(selection)
            const scale = e.evaluate(scaleField), center = e.evaluate(centerField)
            const axis = axisField && e.evaluate(axisField)
            const mask: number[] = []
            for (let i = 0; i < size; i++) if (sel.get(i)) mask.push(i)
            if (!mask.length) return
            const {items, verts} = gatherIslands(mesh, domain, mask)
            const scales = gatherMeans(scale, items, 1), centers = gatherMeans(center, items, 3)
            const axes = axis && gatherMeans(axis, items, 3)
            const positions = mesh.attributes.get('position')!.data as Float32Array
            for (let island = 0; island + 1 < items.offsets.length; island++) {
                const s = scales[island], c = centers.subarray(island * 3, island * 3 + 3)
                if (axes) {
                    // `scale_on_axis` (:237).
                    const a = axes.subarray(island * 3, island * 3 + 3)
                    const m = singleAxisTransform(c, isZero3(a) ? [1, 0, 0] : a, s)
                    for (let j = verts.offsets[island]; j < verts.offsets[island + 1]; j++) {
                        const v = verts.indices[j] * 3
                        transformPoint(m, positions[v], positions[v + 1], positions[v + 2], positions, v)
                    }
                } else {
                    // `transform_with_uniform_scale` (:178).
                    for (let j = verts.offsets[island]; j < verts.offsets[island + 1]; j++) {
                        const v = verts.indices[j] * 3
                        for (let k = 0; k < 3; k++) positions[v + k] = f32(c[k] + f32(s * f32(positions[v + k] - c[k])))
                    }
                }
            }
            meshTagPositionsChanged(mesh)
        }, p.options.scene)
        p.set('Geometry', out)
    },
})
