import {describe, expect, it} from 'vitest'
import {Heap} from './heap'

describe('Heap (BLI_heap)', () => {
    it('pops in ascending order', () => {
        const h = new Heap<number>()
        const values = [5, -1, 3.5, 0, 2, -7, 11, 3.5]
        values.forEach((v, i) => h.insert(v, i))
        const out: number[] = []
        while (!h.isEmpty()) out.push(values[h.popMin()])
        expect(out).toEqual([...values].sort((a, b) => a - b))
    })

    it('removes an arbitrary node (BLI_heap_remove bubbles it to the root first)', () => {
        const h = new Heap<string>()
        const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => h.insert(10 - i, s))
        h.remove(nodes[2]) // 'c' at 8
        h.remove(nodes[5]) // 'f', the minimum
        const out: string[] = []
        while (!h.isEmpty()) out.push(h.popMin())
        expect(out).toEqual(['e', 'd', 'b', 'a'])
    })

    it('stores values as float, as Blender does', () => {
        const h = new Heap<number>()
        const n = h.insert(0.1, 0)
        expect(n.value).toBe(Math.fround(0.1))
        // 1 + 2^-30 rounds to 1 in float: a tie, resolved by the heap's own order, as in Blender.
        // Popping 0 moves the last node (2) to the root (`heap_swap(heap, 0, size)`), and `heap_down`
        // only moves it for a strictly smaller child, so 2 comes out before 1 - in doubles 1 would.
        h.insert(1, 1)
        h.insert(1 + 2 ** -30, 2)
        expect(h.popMin()).toBe(0)
        expect([h.popMin(), h.popMin()]).toEqual([2, 1])
    })

    it('throws when popping an empty heap', () => {
        expect(() => new Heap<number>().popMin()).toThrow()
    })
})

describe('Heap.nodeValueUpdate (BLI_heap_node_value_update)', () => {
    it('re-sorts a node after its value changes either way', () => {
        const h = new Heap<string>()
        const a = h.insert(1, 'a')
        h.insert(2, 'b')
        const c = h.insert(3, 'c')
        h.nodeValueUpdate(c, 0)
        h.nodeValueUpdate(a, 5)
        const out: string[] = []
        while (!h.isEmpty()) out.push(h.popMin())
        expect(out).toEqual(['c', 'b', 'a'])
    })
})
