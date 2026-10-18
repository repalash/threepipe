/**
 * `BLI_heap` (`blenlib/intern/BLI_heap.cc`, Blender 5.2.2): a binary min-heap with removable nodes and float values. Ported
 * operation for operation (sift order, ties swap on the way up, pop swaps the last node into the root, removal bubbles
 * to the root), because the order of equal values decides results in its callers.
 */

import {f32} from './f32'

export interface HeapNode<T> {
    value: number
    index: number
    ptr: T
}

export class Heap<T> {
    private tree: HeapNode<T>[] = []

    private swap(i: number, j: number): void {
        const t = this.tree
        const a = t[i], b = t[j]
        a.index = j
        t[j] = a
        b.index = i
        t[i] = b
    }

    /** `heap_down`. */
    private down(i: number): void {
        const t = this.tree, size = t.length
        for (;;) {
            const l = 2 * i + 1, r = 2 * i + 2
            let smallest = i
            if (l < size && t[l].value < t[smallest].value) smallest = l
            if (r < size && t[r].value < t[smallest].value) smallest = r
            if (smallest === i) break
            this.swap(i, smallest)
            i = smallest
        }
    }

    /** `heap_up`. */
    private up(i: number): void {
        const t = this.tree
        while (i > 0) {
            const p = (i - 1) >> 1
            if (t[p].value < t[i].value) break
            this.swap(p, i)
            i = p
        }
    }

    /** `BLI_heap_insert`. */
    insert(value: number, ptr: T): HeapNode<T> {
        const node: HeapNode<T> = {value: f32(value), index: this.tree.length, ptr}
        this.tree.push(node)
        this.up(node.index)
        return node
    }

    get size(): number {
        return this.tree.length
    }

    /** `BLI_heap_pop_min`. */
    popMin(): T {
        if (!this.tree.length) throw new Error('BLI_heap_pop_min: empty heap')
        const ptr = this.tree[0].ptr
        const size = this.tree.length - 1
        if (size) {
            this.swap(0, size)
            this.tree.pop()
            this.down(0)
        } else this.tree.pop()
        return ptr
    }

    /** `BLI_heap_remove`. */
    remove(node: HeapNode<T>): void {
        let i = node.index
        while (i > 0) {
            const p = (i - 1) >> 1
            this.swap(p, i)
            i = p
        }
        this.popMin()
    }
}
