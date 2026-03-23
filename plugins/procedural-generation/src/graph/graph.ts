/**
 * Graph definition layer — pure structure, no mutable state.
 *
 * defineNode() creates a node definition (component blueprint).
 * defineGraph() creates a graph definition with validated connections and topological order.
 * These are pure data — frozen, serializable, no side effects.
 */

/** An input with metadata. TUi defaults to Record<string, any> for passing any UI config properties. */
export interface PropDef<T = any, TUi = Record<string, any>> {
    default: T
    ui?: TUi
}

/** An input definition: either a raw default value, or a PropDef with metadata. */
export type InputDef<T = any> = T | PropDef<T>

/** Check if an InputDef is a PropDef (has metadata) vs a raw value. */
export function isPropDef(def: InputDef): def is PropDef {
    return def !== null && typeof def === 'object' && 'default' in def
}

/** Extract the default value from an InputDef. */
export function resolveDefault<T>(def: InputDef<T>): T {
    return isPropDef(def) ? def.default : def
}

/** Extract the ui metadata from an InputDef, or undefined. */
export function resolveUi(def: InputDef): PropDef['ui'] {
    return isPropDef(def) ? def.ui : undefined
}

/** Extract runtime value types from input defs (resolving PropDef → its default type). */
export type ResolvedInputs<T extends Record<string, InputDef>> = {
    [K in keyof T]: T[K] extends PropDef<infer V> ? V : T[K]
}

/** A node definition: name, input/output defs, and a pure evaluate function. */
export interface NodeDef<
    TIn extends Record<string, InputDef> = Record<string, InputDef>,
    TOut extends Record<string, InputDef> = Record<string, InputDef>
> {
    readonly name: string
    readonly inputDefs: {readonly [K in keyof TIn]: TIn[K]}
    readonly outputDefs: {readonly [K in keyof TOut]: TOut[K]}
    readonly evaluate: (inputs: ResolvedInputs<TIn>) => ResolvedInputs<TOut>
}

/** A connection between two nodes: from an output to an input. */
export type Connection = readonly [fromNode: NodeDef, fromOutput: string, toNode: NodeDef, toInput: string]

/** A graph definition: nodes + connections + precomputed topological order. */
export interface GraphDef {
    readonly nodes: readonly NodeDef[]
    readonly connections: readonly Connection[]
    readonly order: readonly NodeDef[]
}

/** Create a node definition. Inputs can be raw values or PropDef objects with UI metadata. */
export function defineNode<
    TIn extends Record<string, InputDef>,
    TOut extends Record<string, InputDef>
>(
    name: string,
    inputs: TIn,
    outputs: TOut,
    evaluate: (inputs: ResolvedInputs<TIn>) => ResolvedInputs<TOut>,
): NodeDef<TIn, TOut> {
    return Object.freeze({name, inputDefs: inputs, outputDefs: outputs, evaluate})
}

/** Create a graph definition from nodes and connections. Validates and computes topological order. */
export function defineGraph(
    nodes: readonly NodeDef[],
    connections: readonly Connection[],
): GraphDef {
    for (const [fromNode, fromOutput, toNode, toInput] of connections) {
        if (!nodes.includes(fromNode)) throw new Error(`Connection from unknown node '${fromNode.name}'`)
        if (!nodes.includes(toNode)) throw new Error(`Connection to unknown node '${toNode.name}'`)
        if (!(fromOutput in fromNode.outputDefs)) throw new Error(`${fromNode.name} has no output '${fromOutput}'`)
        if (!(toInput in toNode.inputDefs)) throw new Error(`${toNode.name} has no input '${toInput}'`)
    }
    return Object.freeze({nodes, connections, order: topoSort(nodes, connections)})
}

/** Kahn's algorithm for topological sort. Throws on cycles. */
function topoSort(nodes: readonly NodeDef[], connections: readonly Connection[]): NodeDef[] {
    const inDegree = new Map<NodeDef, number>()
    const dependents = new Map<NodeDef, Set<NodeDef>>()

    for (const node of nodes) {
        inDegree.set(node, 0)
        dependents.set(node, new Set())
    }

    for (const [fromNode, , toNode] of connections) {
        if (fromNode !== toNode && !dependents.get(fromNode)!.has(toNode)) {
            dependents.get(fromNode)!.add(toNode)
            inDegree.set(toNode, (inDegree.get(toNode) ?? 0) + 1)
        }
    }

    const queue: NodeDef[] = []
    for (const node of nodes) {
        if (inDegree.get(node) === 0) queue.push(node)
    }

    const sorted: NodeDef[] = []
    while (queue.length > 0) {
        const node = queue.shift()!
        sorted.push(node)
        for (const dep of dependents.get(node)!) {
            const deg = inDegree.get(dep)! - 1
            inDegree.set(dep, deg)
            if (deg === 0) queue.push(dep)
        }
    }

    if (sorted.length !== nodes.length) throw new Error('Graph has a cycle')
    return sorted
}
