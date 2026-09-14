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
    TIn extends Record<string, InputDef> = any,
    TOut extends Record<string, InputDef> = any
> {
    readonly name: string
    readonly inputDefs: {readonly [K in keyof TIn]: TIn[K]}
    readonly outputDefs: {readonly [K in keyof TOut]: TOut[K]}
    readonly evaluate: (inputs: ResolvedInputs<TIn>) => ResolvedInputs<TOut>
}

/** A connection between two nodes: from an output to an input. */
export interface Connection<
    TOut extends Record<string, InputDef> = any,
    TIn extends Record<string, InputDef> = any,
    K1 extends string = string,
    K2 extends string = string
> {
    readonly from: NodeDef<any, TOut>
    readonly fromOutput: K1
    readonly to: NodeDef<TIn, any>
    readonly toInput: K2
}

/**
 * Create a type-checked connection. Validates:
 * 1. fromOutput exists on the source node's outputs
 * 2. toInput exists on the target node's inputs
 * 3. The resolved output type is assignable to the resolved input type
 */
export function connect<
    TOut extends Record<string, InputDef>,
    TIn extends Record<string, InputDef>,
    K1 extends keyof TOut & string,
    K2 extends keyof TIn & string
>(
    from: NodeDef<any, TOut>, fromOutput: K1,
    to: NodeDef<TIn, any>,
    toInput: K2 & ([ResolvedInputs<TOut>[K1]] extends [ResolvedInputs<TIn>[K2]] ? unknown : never),
): Connection {
    return {from, fromOutput, to, toInput}
}

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

/** Merge override values into an input schema, preserving PropDef ui metadata. */
export function applyDefaults<TIn extends Record<string, InputDef>>(
    inputs: TIn,
    overrides: Partial<ResolvedInputs<TIn>>,
): TIn {
    const merged = {...inputs} as Record<string, InputDef>
    for (const key in overrides) {
        if (isPropDef(merged[key])) {
            merged[key] = {...(merged[key] as PropDef), default: overrides[key]}
        } else {
            merged[key] = overrides[key] as any
        }
    }
    return merged as TIn
}

/** Define a reusable node type. Returns a factory that creates named instances with overridden defaults. */
export function defineNodeType<
    TIn extends Record<string, InputDef>,
    TOut extends Record<string, InputDef>
>(
    inputs: TIn,
    outputs: TOut,
    evaluate: (inputs: ResolvedInputs<TIn>) => ResolvedInputs<TOut>,
) {
    return (name: string, overrides?: Partial<ResolvedInputs<TIn>>): NodeDef<TIn, TOut> => {
        const merged = overrides ? applyDefaults(inputs, overrides) : inputs
        return defineNode(name, merged, outputs, evaluate)
    }
}

/** Create a graph definition from nodes and connections. Validates and computes topological order. */
export function defineGraph(
    nodes: readonly NodeDef[],
    connections: readonly Connection[],
): GraphDef {
    for (const conn of connections) {
        if (!nodes.includes(conn.from)) throw new Error(`Connection from unknown node '${conn.from.name}'`)
        if (!nodes.includes(conn.to)) throw new Error(`Connection to unknown node '${conn.to.name}'`)
        if (!(conn.fromOutput in conn.from.outputDefs)) throw new Error(`${conn.from.name} has no output '${conn.fromOutput}'`)
        if (!(conn.toInput in conn.to.inputDefs)) throw new Error(`${conn.to.name} has no input '${conn.toInput}'`)
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

    for (const conn of connections) {
        if (conn.from !== conn.to && !dependents.get(conn.from)!.has(conn.to)) {
            dependents.get(conn.from)!.add(conn.to)
            inDegree.set(conn.to, (inDegree.get(conn.to) ?? 0) + 1)
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
