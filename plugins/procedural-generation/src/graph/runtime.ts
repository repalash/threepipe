/**
 * Runtime layer — mutable state for a graph definition.
 *
 * createRuntime() takes a GraphDef and creates a runtime with:
 * - Current values for all inputs and outputs
 * - Dirty flags per node
 * - set() to write input values (O(1), no propagation)
 * - get() to read output values
 * - evaluate() to run dirty nodes in topological order, propagating dirty to
 *   downstream nodes as each dirty node evaluates
 */

import {resolveDefault, type NodeDef, type GraphDef, type Connection} from './graph'

/** Per-node runtime state. */
interface NodeState {
    inputs: Record<string, any>
    outputs: Record<string, any>
    dirty: boolean
}

/** The runtime: mutable state + evaluation engine for a graph. */
export interface Runtime {
    readonly graph: GraphDef

    /** Set an input value on a node. O(1). Throws if the input is connected. */
    set(node: NodeDef, input: string, value: any): void

    /** Mark a node as dirty. O(1). For external use (simulation, timers). */
    markDirty(node: NodeDef): void

    /** Read an output value from a node. */
    get(node: NodeDef, output: string): any

    /** Read whether a node is dirty. */
    isDirty(node: NodeDef): boolean

    /** Check if an input is settable (not connected to an upstream output). */
    isSettable(node: NodeDef, input: string): boolean

    /** Get all settable input names for a node. */
    settableInputs(node: NodeDef): string[]

    /** Evaluate all dirty nodes in topological order. Returns count of nodes computed. */
    evaluate(): number
}

/** Create a runtime for a graph definition. */
export function createRuntime(graph: GraphDef): Runtime {
    const state = new Map<NodeDef, NodeState>()
    for (const node of graph.nodes) {
        // Resolve defaults: PropDef → .default, raw value → as-is
        const inputs: Record<string, any> = {}
        for (const [k, v] of Object.entries(node.inputDefs)) inputs[k] = resolveDefault(v)
        const outputs: Record<string, any> = {}
        for (const [k, v] of Object.entries(node.outputDefs)) outputs[k] = resolveDefault(v)
        state.set(node, {inputs, outputs, dirty: true})
    }

    // For each node, which downstream nodes depend on it?
    const downstream = new Map<NodeDef, Set<NodeDef>>()
    for (const node of graph.nodes) downstream.set(node, new Set())
    for (const conn of graph.connections) {
        if (conn.from !== conn.to) downstream.get(conn.from)!.add(conn.to)
    }

    // Connections grouped by target node (for resolving inputs during evaluate)
    const incomingByNode = new Map<NodeDef, Connection[]>()
    for (const node of graph.nodes) incomingByNode.set(node, [])
    for (const conn of graph.connections) {
        incomingByNode.get(conn.to)!.push(conn)
    }

    // Which inputs are connected (not settable)
    const connectedInputs = new Map<NodeDef, Set<string>>()
    for (const node of graph.nodes) connectedInputs.set(node, new Set())
    for (const conn of graph.connections) {
        connectedInputs.get(conn.to)!.add(conn.toInput)
    }

    return {
        graph,

        set(node: NodeDef, input: string, value: any): void {
            const s = state.get(node)
            if (!s) throw new Error(`Unknown node '${node.name}'`)
            if (!(input in s.inputs)) throw new Error(`${node.name} has no input '${input}'`)
            if (connectedInputs.get(node)?.has(input)) {
                throw new Error(`${node.name}.${input} is connected — use set() only on unconnected inputs`)
            }

            const old = s.inputs[input]
            const isPrimitive = value === null || typeof value !== 'object' && typeof value !== 'function'
            if (isPrimitive && old === value) return

            s.inputs[input] = value
            s.dirty = true
        },

        markDirty(node: NodeDef): void {
            const s = state.get(node)
            if (!s) throw new Error(`Unknown node '${node.name}'`)
            s.dirty = true
        },

        get(node: NodeDef, output: string): any {
            const s = state.get(node)
            if (!s) throw new Error(`Unknown node '${node.name}'`)
            if (!(output in s.outputs)) throw new Error(`${node.name} has no output '${output}'`)
            return s.outputs[output]
        },

        isDirty(node: NodeDef): boolean {
            return state.get(node)?.dirty ?? false
        },

        isSettable(node: NodeDef, input: string): boolean {
            const connected = connectedInputs.get(node)
            if (!connected) return false // unknown node
            return !connected.has(input)
        },

        settableInputs(node: NodeDef): string[] {
            const connected = connectedInputs.get(node)
            if (!connected) return []
            return Object.keys(state.get(node)?.inputs ?? {}).filter(k => !connected.has(k))
        },

        evaluate(): number {
            let computed = 0

            for (const node of graph.order) {
                const s = state.get(node)!
                if (!s.dirty) continue

                // Pull connected inputs from upstream outputs
                for (const conn of incomingByNode.get(node)!) {
                    s.inputs[conn.toInput] = state.get(conn.from)!.outputs[conn.fromOutput]
                }

                // Run evaluate
                const result = node.evaluate(s.inputs)

                // Write outputs
                for (const key in result) {
                    s.outputs[key] = result[key]
                }

                s.dirty = false
                computed++

                // Mark downstream nodes dirty (they'll be reached later in topo order)
                for (const dep of downstream.get(node)!) {
                    state.get(dep)!.dirty = true
                }
            }

            return computed
        },
    }
}


// todo - evaluate results could be same, if soem output is same, that outputs dependants should not be dirtied
