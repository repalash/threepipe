/**
 * Graph definition layer — pure structure, no mutable state.
 *
 * defineNode() creates a node definition (component blueprint).
 * defineGraph() creates a graph definition with validated connections and topological order.
 * These are pure data — frozen, serializable, no side effects.
 */
/** Check if an InputDef is a PropDef (has metadata) vs a raw value. */
export function isPropDef(def) {
    return def !== null && typeof def === 'object' && 'default' in def;
}
/** Extract the default value from an InputDef. */
export function resolveDefault(def) {
    return isPropDef(def) ? def.default : def;
}
/** Extract the ui metadata from an InputDef, or undefined. */
export function resolveUi(def) {
    return isPropDef(def) ? def.ui : undefined;
}
/**
 * Create a type-checked connection. Validates:
 * 1. fromOutput exists on the source node's outputs
 * 2. toInput exists on the target node's inputs
 * 3. The resolved output type is assignable to the resolved input type
 */
export function connect(from, fromOutput, to, toInput) {
    return { from, fromOutput, to, toInput };
}
/** Create a node definition. Inputs can be raw values or PropDef objects with UI metadata. */
export function defineNode(name, inputs, outputs, evaluate) {
    return Object.freeze({ name, inputDefs: inputs, outputDefs: outputs, evaluate });
}
/** Merge override values into an input schema, preserving PropDef ui metadata. */
export function applyDefaults(inputs, overrides) {
    const merged = { ...inputs };
    for (const key in overrides) {
        if (isPropDef(merged[key])) {
            merged[key] = { ...merged[key], default: overrides[key] };
        }
        else {
            merged[key] = overrides[key];
        }
    }
    return merged;
}
/** Define a reusable node type. Returns a factory that creates named instances with overridden defaults. */
export function defineNodeType(inputs, outputs, evaluate) {
    return (name, overrides) => {
        const merged = overrides ? applyDefaults(inputs, overrides) : inputs;
        return defineNode(name, merged, outputs, evaluate);
    };
}
/** Create a graph definition from nodes and connections. Validates and computes topological order. */
export function defineGraph(nodes, connections) {
    for (const conn of connections) {
        if (!nodes.includes(conn.from))
            throw new Error(`Connection from unknown node '${conn.from.name}'`);
        if (!nodes.includes(conn.to))
            throw new Error(`Connection to unknown node '${conn.to.name}'`);
        if (!(conn.fromOutput in conn.from.outputDefs))
            throw new Error(`${conn.from.name} has no output '${conn.fromOutput}'`);
        if (!(conn.toInput in conn.to.inputDefs))
            throw new Error(`${conn.to.name} has no input '${conn.toInput}'`);
    }
    return Object.freeze({ nodes, connections, order: topoSort(nodes, connections) });
}
/** Kahn's algorithm for topological sort. Throws on cycles. */
function topoSort(nodes, connections) {
    const inDegree = new Map();
    const dependents = new Map();
    for (const node of nodes) {
        inDegree.set(node, 0);
        dependents.set(node, new Set());
    }
    for (const conn of connections) {
        if (conn.from !== conn.to && !dependents.get(conn.from).has(conn.to)) {
            dependents.get(conn.from).add(conn.to);
            inDegree.set(conn.to, (inDegree.get(conn.to) ?? 0) + 1);
        }
    }
    const queue = [];
    for (const node of nodes) {
        if (inDegree.get(node) === 0)
            queue.push(node);
    }
    const sorted = [];
    while (queue.length > 0) {
        const node = queue.shift();
        sorted.push(node);
        for (const dep of dependents.get(node)) {
            const deg = inDegree.get(dep) - 1;
            inDegree.set(dep, deg);
            if (deg === 0)
                queue.push(dep);
        }
    }
    if (sorted.length !== nodes.length)
        throw new Error('Graph has a cycle');
    return sorted;
}
