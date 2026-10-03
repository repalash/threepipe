/**
 * `BLI_heap` (`source/blender/blenlib/intern/BLI_heap.cc`): a binary min-heap whose nodes can be
 * removed, as `BM_mesh_beautify_fill` uses it.
 */

/** One entry of a {@link Heap}. Blender's `HeapNode`. */
export interface HeapNode<T> {
    value: number
    index: number
    ptr: T
}

/**
 * `BLI_heap` (`blenlib/intern/BLI_heap.cc`): a binary min-heap with removable nodes. Ported
 * operation for operation (sift order, the pop's swap-with-last, removal by bubbling to the root),
 * because the order equal keys come out in decides which edge a beautify rotates first. Values are
 * stored as `float`, as Blender's are.
 */
export class Heap<T> {
    private tree: HeapNode<T>[] = []

    private swap(i: number, j: number): void {
        const tree = this.tree
        const pi = tree[i]
        const pj = tree[j]
        pi.index = j
        tree[j] = pi
        pj.index = i
        tree[i] = pj
    }

    /** `heap_down` (`:84`). */
    private down(i: number): void {
        const tree = this.tree
        const size = tree.length
        while (true) {
            const l = (i << 1) + 1
            const r = (i << 1) + 2
            let smallest = i
            if (l < size && tree[l].value < tree[smallest].value) smallest = l
            if (r < size && tree[r].value < tree[smallest].value) smallest = r
            if (smallest === i) break
            this.swap(i, smallest)
            i = smallest
        }
    }

    /** `heap_up` (`:111`). */
    private up(i: number): void {
        const tree = this.tree
        while (i > 0) {
            const p = (i - 1) >> 1
            if (tree[p].value < tree[i].value) break
            this.swap(p, i)
            i = p
        }
    }

    /** `BLI_heap_insert` (`:236`). */
    insert(value: number, ptr: T): HeapNode<T> {
        const node: HeapNode<T> = {value: Math.fround(value), index: this.tree.length, ptr}
        this.tree.push(node)
        this.up(node.index)
        return node
    }

    /** `BLI_heap_is_empty`. */
    isEmpty(): boolean {
        return this.tree.length === 0
    }

    get size(): number {
        return this.tree.length
    }

    /** `BLI_heap_top`. */
    top(): HeapNode<T> {
        return this.tree[0]
    }

    /** `BLI_heap_pop_min` (`:293`). */
    popMin(): T {
        if (!this.tree.length) throw new Error('mesh-kernel: pop from an empty heap')
        const ptr = this.tree[0].ptr
        const size = this.tree.length - 1
        if (size) {
            this.swap(0, size)
            this.tree.pop()
            this.down(0)
        } else {
            this.tree.pop()
        }
        return ptr
    }

    /** `BLI_heap_node_value_update` (`:324`): move a node after changing its value. */
    nodeValueUpdate(node: HeapNode<T>, value: number): void {
        value = Math.fround(value)
        if (value < node.value) {
            node.value = value
            this.up(node.index)
        } else if (value > node.value) {
            node.value = value
            this.down(node.index)
        }
    }

    /** `BLI_heap_remove` (`:309`): bubble the node to the root, then pop it. */
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
