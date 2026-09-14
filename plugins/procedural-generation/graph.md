# Graph System

A pull-based reactive node graph for defining computation pipelines. Each node is a pure function with typed inputs and outputs. The graph evaluates only dirty nodes when inputs change.

- **~400 lines** across 3 files, zero external dependencies, pure TypeScript
- **Selective recompute**: changing one input only re-evaluates affected nodes
- **Type-safe connections**: `connect()` checks key names and value type compatibility at compile time
- **Auto UI**: generates uiConfig folders per node from `PropDef` metadata

Source: `src/graph/graph.ts`, `src/graph/runtime.ts`, `src/graph/ui.ts`

## Quick Start

```typescript
import {defineNode, defineGraph, connect, createRuntime} from '@threepipe/plugin-procedural-generation'

// Define nodes
const source = defineNode('Source', {x: 0}, {doubled: 0},
    (inp) => ({doubled: inp.x * 2}))

const consumer = defineNode('Consumer', {val: 0}, {text: ''},
    (inp) => ({text: `Result: ${inp.val}`}))

// Create graph with connections
const graph = defineGraph(
    [source, consumer],
    [connect(source, 'doubled', consumer, 'val')],
)

// Create runtime and evaluate
const rt = createRuntime(graph)
rt.set(source, 'x', 5)
rt.evaluate()          // both nodes compute
rt.get(consumer, 'text') // "Result: 10"

rt.set(source, 'x', 5)
rt.evaluate()          // returns 0 — nothing changed

rt.set(source, 'x', 7)
rt.evaluate()          // returns 2 — both recompute
rt.get(consumer, 'text') // "Result: 14"
```

## Core Concepts

### defineNode

Creates a node definition — a frozen object with input defaults, output defaults, and a pure evaluate function.

```typescript
const myNode = defineNode(
    'Node Name',
    {input1: 0, input2: 'hello'},           // input defaults
    {output1: 0, output2: ''},               // output defaults
    (inp) => ({output1: inp.input1 * 2, output2: inp.input2.toUpperCase()}),
)
```

Inputs can be raw values or `PropDef` objects with UI metadata:

```typescript
const myNode = defineNode('Node', {
    x: 0,                                                        // raw value — no UI
    seed: {default: 42, ui: {label: 'Seed', bounds: [0, 999]}},  // PropDef — generates a slider
}, {out: 0}, (inp) => ({out: inp.x + inp.seed}))
```

### defineNodeType

Defines a reusable node type — same input schema, output schema, and evaluate function. Create multiple instances with different default values.

```typescript
const adderType = defineNodeType(
    {a: 0, b: 0, bias: {default: 0, ui: {label: 'Bias', bounds: [-10, 10]}}},
    {sum: 0},
    (inp) => ({sum: inp.a + inp.b + inp.bias}),
)

const adder1 = adderType('Adder 1', {a: 5, bias: 10})
const adder2 = adderType('Adder 2', {a: 3})
const adder3 = adderType('Adder 3') // all defaults
```

Overrides are `Partial` — only specify what differs from the schema. PropDef UI metadata is preserved automatically.

### connect

Creates a type-checked connection between an output and an input. TypeScript validates:
1. The output key exists on the source node
2. The input key exists on the target node
3. The output value type is assignable to the input value type

```typescript
// Given nodes with known output/input types:
connect(source, 'doubled', consumer, 'val')   // ✓ number → number
connect(source, 'doubled', consumer, 'typo')   // TS error: 'typo' not in consumer's inputs
connect(stringNode, 'text', consumer, 'val')   // TS error: string not assignable to number
```

### defineGraph

Takes an array of nodes and connections, validates them, and computes the topological evaluation order.

```typescript
const graph = defineGraph(
    [nodeA, nodeB, nodeC],
    [
        connect(nodeA, 'out', nodeB, 'in'),
        connect(nodeB, 'out', nodeC, 'in'),
    ],
)
```

Throws if a cycle is detected.

### createRuntime

Creates mutable state for a graph definition — input/output values, dirty flags, and the evaluation engine.

```typescript
const rt = createRuntime(graph)

rt.set(node, 'inputName', value)  // set input value, mark dirty (O(1))
rt.get(node, 'outputName')        // read output value
rt.evaluate()                     // run dirty nodes in topo order, returns count computed
rt.markDirty(node)                // mark dirty externally (for timers, simulation)
rt.isDirty(node)                  // check dirty state
rt.isSettable(node, 'input')      // false if input is connected to upstream
rt.settableInputs(node)           // list of unconnected input names
```

`set()` throws if you try to set a connected input — use it only for unconnected inputs (user params).

## How Evaluation Works

1. **`set()`** marks one node dirty. O(1), no propagation.
2. **`evaluate()`** walks nodes in topological order:
   - Not dirty? Skip.
   - Dirty? Pull connected inputs from upstream outputs, run evaluate, write outputs, mark clean.
   - After evaluating, mark all downstream nodes dirty.
3. Downstream nodes are reached later in the topo walk and evaluate in turn.

This means: 1000 `set()` calls in a frame = 1000 boolean flips. One `evaluate()` call does all the work in a single pass.

## PropDef and UI

Any input can carry UI metadata via `PropDef`:

```typescript
{
    seed: {default: 42, ui: {label: 'Seed', bounds: [0, 999], stepSize: 1}},
    density: {default: 0.5, ui: {label: 'Density', bounds: [0, 1], stepSize: 0.05}},
    segments: [],  // raw value — no UI
}
```

The `ui` field accepts any `UiObjectConfig` properties (from uiconfig.js) — `label`, `bounds`, `stepSize`, `hidden`, `type`, etc.

### graphUiConfig

Auto-generates a uiConfig tree from a runtime. Each node with settable PropDef inputs gets a folder.

```typescript
import {graphUiConfig} from '@threepipe/plugin-procedural-generation'

const uiConfig = graphUiConfig(rt, () => {
    rt.evaluate()
    rebuildScene()
}, 'My Graph')

tweakpaneUi.appendChild(uiConfig)
```

## API Reference

| Function | Description |
|---|---|
| `defineNode(name, inputs, outputs, evaluate)` | Create a node definition |
| `defineNodeType(inputs, outputs, evaluate)` | Create a reusable node type factory |
| `defineGraph(nodes, connections)` | Create a graph with validated connections and topo order |
| `connect(from, outputKey, to, inputKey)` | Create a type-checked connection |
| `createRuntime(graph)` | Create mutable runtime state for a graph |
| `graphUiConfig(runtime, onChange, label?)` | Generate auto UI for all nodes |
| `nodeUiConfig(runtime, node, onChange)` | Generate UI for a single node |
| `resolveDefault(inputDef)` | Extract default value from InputDef or PropDef |
| `resolveUi(inputDef)` | Extract UI metadata from PropDef, or undefined |
| `isPropDef(inputDef)` | Check if an InputDef is a PropDef |
| `applyDefaults(inputs, overrides)` | Merge override values into an input schema |

## Architecture

```
graph.ts    — defineNode, defineNodeType, defineGraph, connect (pure structure, no state)
runtime.ts  — createRuntime with set/get/evaluate/markDirty (mutable state)
ui.ts       — graphUiConfig, nodeUiConfig (UiObjectConfig generation, depends on uiconfig.js)
```

The graph layer has zero dependencies. The runtime imports only from the graph layer. The UI layer imports from both + uiconfig.js.
