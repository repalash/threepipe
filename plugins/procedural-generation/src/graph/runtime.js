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
import { resolveDefault } from './graph';
/** Create a runtime for a graph definition. */
export function createRuntime(graph) {
    const state = new Map();
    for (const node of graph.nodes) {
        // Resolve defaults: PropDef → .default, raw value → as-is
        const inputs = {};
        for (const [k, v] of Object.entries(node.inputDefs))
            inputs[k] = resolveDefault(v);
        const outputs = {};
        for (const [k, v] of Object.entries(node.outputDefs))
            outputs[k] = resolveDefault(v);
        state.set(node, { inputs, outputs, dirty: true });
    }
    // For each node, which downstream nodes depend on it?
    const downstream = new Map();
    for (const node of graph.nodes)
        downstream.set(node, new Set());
    for (const conn of graph.connections) {
        if (conn.from !== conn.to)
            downstream.get(conn.from).add(conn.to);
    }
    // Connections grouped by target node (for resolving inputs during evaluate)
    const incomingByNode = new Map();
    for (const node of graph.nodes)
        incomingByNode.set(node, []);
    for (const conn of graph.connections) {
        incomingByNode.get(conn.to).push(conn);
    }
    // Which inputs are connected (not settable)
    const connectedInputs = new Map();
    for (const node of graph.nodes)
        connectedInputs.set(node, new Set());
    for (const conn of graph.connections) {
        connectedInputs.get(conn.to).add(conn.toInput);
    }
    return {
        graph,
        set(node, input, value) {
            const s = state.get(node);
            if (!s)
                throw new Error(`Unknown node '${node.name}'`);
            if (!(input in s.inputs))
                throw new Error(`${node.name} has no input '${input}'`);
            if (connectedInputs.get(node)?.has(input)) {
                throw new Error(`${node.name}.${input} is connected — use set() only on unconnected inputs`);
            }
            const old = s.inputs[input];
            const isPrimitive = value === null || typeof value !== 'object' && typeof value !== 'function';
            if (isPrimitive && old === value)
                return;
            s.inputs[input] = value;
            s.dirty = true;
        },
        markDirty(node) {
            const s = state.get(node);
            if (!s)
                throw new Error(`Unknown node '${node.name}'`);
            s.dirty = true;
        },
        get(node, output) {
            const s = state.get(node);
            if (!s)
                throw new Error(`Unknown node '${node.name}'`);
            if (!(output in s.outputs))
                throw new Error(`${node.name} has no output '${output}'`);
            return s.outputs[output];
        },
        isDirty(node) {
            return state.get(node)?.dirty ?? false;
        },
        isSettable(node, input) {
            const connected = connectedInputs.get(node);
            if (!connected)
                return false; // unknown node
            return !connected.has(input);
        },
        settableInputs(node) {
            const connected = connectedInputs.get(node);
            if (!connected)
                return [];
            return Object.keys(state.get(node)?.inputs ?? {}).filter(k => !connected.has(k));
        },
        evaluate() {
            let computed = 0;
            for (const node of graph.order) {
                const s = state.get(node);
                if (!s.dirty)
                    continue;
                // Pull connected inputs from upstream outputs
                for (const conn of incomingByNode.get(node)) {
                    s.inputs[conn.toInput] = state.get(conn.from).outputs[conn.fromOutput];
                }
                // Run evaluate
                const result = node.evaluate(s.inputs);
                // Write outputs
                for (const key in result) {
                    s.outputs[key] = result[key];
                }
                s.dirty = false;
                computed++;
                // Mark downstream nodes dirty (they'll be reached later in topo order)
                for (const dep of downstream.get(node)) {
                    state.get(dep).dirty = true;
                }
            }
            return computed;
        },
    };
}
// todo - evaluate results could be same, if soem output is same, that outputs dependants should not be dirtied
