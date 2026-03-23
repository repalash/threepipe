import {defineNode, defineGraph, connect, createRuntime} from '../src/graph'

// Benchmark: create a 10k node linear chain and measure times

const N = 10000

// 1. Define nodes
console.time('defineNode × 10k')
const nodes = []
for (let i = 0; i < N; i++) {
    nodes.push(defineNode(`node_${i}`, {val: 0}, {out: 0}, (inp) => ({out: inp.val + 1})))
}
console.timeEnd('defineNode × 10k')

// 2. Define connections (linear chain)
console.time('build connections')
const connections = []
for (let i = 0; i < N - 1; i++) {
    connections.push(connect(nodes[i], 'out', nodes[i + 1], 'val'))
}
console.timeEnd('build connections')

// 3. defineGraph (validation + topo sort)
console.time('defineGraph (10k nodes, 10k connections)')
const graph = defineGraph(nodes, connections)
console.timeEnd('defineGraph (10k nodes, 10k connections)')

// 4. createRuntime
console.time('createRuntime')
const rt = createRuntime(graph)
console.timeEnd('createRuntime')

// 5. First evaluate (all dirty)
console.time('evaluate (all 10k dirty)')
const computed = rt.evaluate()
console.timeEnd('evaluate (all 10k dirty)')
console.log(`  computed: ${computed}`)

// 6. Set root, propagate + evaluate
console.time('set root + evaluate (all 10k dirty)')
rt.set(nodes[0], 'val', 42)
const computed2 = rt.evaluate()
console.timeEnd('set root + evaluate (all 10k dirty)')
console.log(`  computed: ${computed2}`)

// 7. No change — evaluate should skip all
console.time('evaluate (nothing dirty)')
const computed3 = rt.evaluate()
console.timeEnd('evaluate (nothing dirty)')
console.log(`  computed: ${computed3}`)

// 8. Create a fresh graph+runtime from scratch (the user's question)
console.time('defineGraph + createRuntime + evaluate (fresh 10k)')
const graph2 = defineGraph(nodes, connections)
const rt2 = createRuntime(graph2)
rt2.set(nodes[0], 'val', 1)
rt2.evaluate()
console.timeEnd('defineGraph + createRuntime + evaluate (fresh 10k)')
