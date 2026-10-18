/**
 * Index of Nearest (`node_geo_index_of_nearest.cc`): per element, the nearest other element of the same group (by the
 * Position field), with a KD-tree per group (`build_kdtree`, `find_nearest_non_self` with `kdtree_find_nearest_cb`).
 */

import {KDTree3} from '../../blender/kdtree'
import {FieldContext, FieldEvaluation, FieldInput, GField} from '../../fields'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

/** `IndexOfNearestFieldInput` (:63). */
class IndexOfNearestInput extends FieldInput {
    constructor(readonly position: GField, readonly group: GField) {
        super('int32', 'Index of Nearest')
    }

    children(): GField[] {
        return [this.position, this.group]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        if (context.type === 'none') return undefined
        const size = context.size
        const e = new FieldEvaluation(context, size)
        const pos = e.evaluate(this.position), groups = e.evaluate(this.group)
        const out = new Int32Array(size)
        const search = (members: number[]) => {
            const tree = new KDTree3(members.length)
            for (const i of members) tree.insert(i, pos.get(i, 0), pos.get(i, 1), pos.get(i, 2))
            tree.balance()
            for (const i of members) out[i] = tree.findNearestCb(pos.get(i, 0), pos.get(i, 1), pos.get(i, 2), other => (other === i ? 0 : 1))
        }
        if (groups.isSingle) {
            search(Array.from({length: size}, (_, i) => i))
        } else {
            const byGroup = new Map<number, number[]>()
            for (let i = 0; i < size; i++) {
                const g = groups.get(i)
                let list = byGroup.get(g)
                if (!list) byGroup.set(g, list = [])
                list.push(i)
            }
            for (const members of byGroup.values()) search(members)
        }
        return GVArray.fromArray('int32', out)
    }
}

/** `HasNeighborFieldInput` (:136): whether the element's group has another element. */
class HasNeighborInput extends FieldInput {
    constructor(readonly group: GField) {
        super('bool', 'Has Neighbor')
    }

    children(): GField[] {
        return [this.group]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        if (context.type === 'none') return undefined
        const size = context.size
        if (size === 1) return GVArray.fromSingle('bool', size, [0])
        const groups = new FieldEvaluation(context, size).evaluate(this.group)
        if (groups.isSingle) return GVArray.fromSingle('bool', size, [1])
        const counts = new Map<number, number>()
        for (let i = 0; i < size; i++) counts.set(groups.get(i), (counts.get(groups.get(i)) ?? 0) + 1)
        const out = new Uint8Array(size)
        for (let i = 0; i < size; i++) out[i] = counts.get(groups.get(i))! > 1 ? 1 : 0
        return GVArray.fromArray('bool', out)
    }
}

registerNodeType({
    idname: 'GeometryNodeIndexOfNearest',
    label: 'Index of Nearest',
    declare(b) {
        b.input('VECTOR', 'Position').implicit('POSITION').field()
        b.input('INT', 'Group ID').hideValue().field()
        b.output('INT', 'Index').field()
        b.output('BOOLEAN', 'Has Neighbor').field()
    },
    execute(p) {
        const position = p.field('Position'), group = p.field('Group ID')
        if (p.outputUsed('Index')) p.set('Index', GField.fromInput(new IndexOfNearestInput(position, group)))
        if (p.outputUsed('Has Neighbor')) p.set('Has Neighbor', GField.fromInput(new HasNeighborInput(group)))
    },
})
