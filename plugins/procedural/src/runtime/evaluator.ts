/**
 * The geometry-nodes evaluator: lazy, cached, reactive.
 *
 * Semantics follow Blender's lazy-function graph (`nodes/intern/geometry_nodes_lazy_function.cc`):
 * a node runs only when an output that is needed reads it (`LazyFunctionForGeometryNode` :124), a
 * node pulls only the inputs it uses (Switch), field nodes become field operations or fold to single
 * values (`LazyFunctionForMultiFunctionNode` :703, `execute_multi_function_on_value_variant` :502),
 * reroutes pass through (:344), muted nodes forward their internal links (:631), links between
 * different types convert implicitly (:573), multi-input sockets gather all their links in order
 * (:310) and group nodes evaluate their tree in their own call context (:1140). Blender's scheduler
 * (threads, partial re-execution) is not ported: results do not depend on it.
 *
 * Caching is incremental ("red-green"): every node remembers the input values it read. On the next
 * evaluation a node is reused when its own properties are unchanged and every input it read is still
 * the same value object; otherwise it runs again. Values are immutable, so identity is equality.
 * Changing one modifier input therefore re-runs exactly the nodes downstream of it.
 */

import {GeometrySet} from '../geometry/GeometrySet'
import {DATA_TYPES} from '../geometry/dataTypes'
import {GVArray} from '../geometry/varray'
import {FieldOperation, GField} from '../fields/field'
import {getNodeType, NodeInstance, NodeTypeDef} from './registry'
import {BlenderNodeError, ExecParams, singleOf} from './params'
import {SocketDecl, socketDataType} from './declaration'
import {convertLinkValue, SocketValue, unlinkedInputValue, valueFromJSON} from './values'
import {
    InterfaceSocketJSON,
    isInterfaceSocket,
    JSONValue,
    NodeGroupLibrary,
    NodeJSON,
    NodeTreeJSON,
    SocketType,
    socketTypeFromIdname,
} from './types'
import type {EvalOptions} from './context'

/** An error raised by a node, with the node and tree it happened in. Thrown once, not re-wrapped upstream. */
export class NodeEvaluationError extends Error {}

/** An output computed on first read (group node outputs). */
class Lazy {
    private done = false
    private value: SocketValue = null

    constructor(private readonly fn: () => SocketValue) {}

    get(): SocketValue {
        if (!this.done) {
            this.value = this.fn()
            this.done = true
        }
        return this.value
    }
}

interface Dep {
    socket: string
    multi: boolean
    value: SocketValue | SocketValue[]
}

interface External {
    key: string
    version: number | string
}

interface NodeCache {
    outputs: Map<string, SocketValue | Lazy>
    deps: Dep[]
    externals: External[]
    localVersion: number
}

interface LinkSource {
    node: CNode
    socket: string
}

interface CNode {
    json: NodeJSON
    /** Undefined for the built-in group input/output, reroute and frame nodes. */
    def?: NodeTypeDef
    inst?: NodeInstance
    kind: 'node' | 'group-input' | 'group-output' | 'reroute' | 'frame' | 'group'
    inputDecls: Map<string, SocketDecl>
    outputDecls: Map<string, SocketDecl>
    inputLinks: Map<string, LinkSource[]>
    linkedOutputs: Set<string>
    defaults: Map<string, SocketValue>
    localVersion: number
    checked: number
    cache?: NodeCache
    sub?: TreeEval
}

export interface EvalWarning {
    path: string
    node: string
    message: string
}

export interface EvalStats {
    /** Nodes executed in the last evaluation. */
    executed: number
    /** Nodes whose cached outputs were reused. */
    reused: number
}

/** State shared by a root evaluator and all nested group evaluations. */
interface Root {
    library: NodeGroupLibrary
    options: EvalOptions
    revision: number
    stats: EvalStats
    warnings: EvalWarning[]
    sameExternal(key: string, version: number | string): boolean
}

const BUILTIN_TYPES = new Set(['NodeGroupInput', 'NodeGroupOutput', 'NodeReroute', 'NodeFrame', 'GeometryNodeGroup'])

/** `get_internal_link_type_priority` (`blenkernel/intern/node_tree_update.cc:111`). */
function internalLinkPriority(from: SocketType, to: SocketType): number {
    const table: Partial<Record<SocketType, Partial<Record<SocketType, number>>>> = {
        RGBA: {RGBA: 4, FLOAT: 3, INT: 2, BOOLEAN: 1},
        VECTOR: {VECTOR: 4, FLOAT: 3, INT: 2, BOOLEAN: 1},
        FLOAT: {FLOAT: 5, INT: 4, BOOLEAN: 3, RGBA: 2, VECTOR: 1},
        INT: {INT: 5, FLOAT: 4, BOOLEAN: 3, RGBA: 2, VECTOR: 1},
        BOOLEAN: {BOOLEAN: 5, INT: 4, FLOAT: 3, RGBA: 2, VECTOR: 1},
        ROTATION: {ROTATION: 3, VECTOR: 2, FLOAT: 1},
    }
    const row = table[to]
    if (row) return row[from] ?? -1
    return from === to ? 1 : -1
}

function interfaceSocketDecl(s: InterfaceSocketJSON): SocketDecl {
    const type = socketTypeFromIdname(s.socketType)
    const implicit = s.default_input && s.default_input !== 'VALUE' ? s.default_input : undefined
    return {
        identifier: s.identifier, name: s.name, type, available: true,
        default: s.default as SocketDecl['default'],
        min: s.min_value, max: s.max_value, subtype: s.subtype,
        implicitInput: implicit as SocketDecl['implicitInput'],
        structure: type === 'GEOMETRY' ? 'geometry' : socketDataType(type) ? 'dynamic' : 'single',
    }
}

function sameValue(a: SocketValue | SocketValue[], b: SocketValue | SocketValue[]): boolean {
    if (Array.isArray(a) && Array.isArray(b) && !(typeof a[0] === 'number')) {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
        return true
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && '_ref' in (a as object) && '_ref' in (b as object)) {
        const x = a as {_ref: string, name: string}, y = b as {_ref: string, name: string}
        return x._ref === y._ref && x.name === y.name
    }
    return a === b
}

/** One node tree in one call context. */
class TreeEval {
    readonly nodes = new Map<string, CNode>()
    readonly groupOutputNode?: CNode
    readonly inputs: InterfaceSocketJSON[]
    readonly outputs: InterfaceSocketJSON[]
    private readonly interfaceDefaults = new Map<string, SocketValue>()

    constructor(
        readonly root: Root,
        readonly tree: NodeTreeJSON,
        readonly path: string,
        /** Reads a group input from the calling node; undefined for the root tree. */
        public parentInput: ((identifier: string) => SocketValue) | undefined,
        /** Root-tree interface input values (modifier inputs). */
        readonly rootInputs?: Map<string, SocketValue>,
    ) {
        this.inputs = tree.interface.filter(isInterfaceSocket).filter(s => s.inOut === 'INPUT')
        this.outputs = tree.interface.filter(isInterfaceSocket).filter(s => s.inOut === 'OUTPUT')
        for (const json of tree.nodes) this.nodes.set(json.name, this.compile(json))
        for (const link of tree.links) {
            if (link.muted) continue
            const from = this.nodes.get(link.from[0])
            const to = this.nodes.get(link.to[0])
            if (!from || !to) throw new Error(`procedural: link ${link.from.join('.')} -> ${link.to.join('.')} names a missing node in '${tree.name}'`)
            const fromDecl = from.outputDecls.get(link.from[1])
            const toDecl = to.inputDecls.get(link.to[1])
            // Links to or from unavailable or unknown sockets are ignored, as Blender ignores
            // `!link.is_available()` links. Unknown identifiers are an error: the tree and the
            // declaration disagree, which means the node port is incomplete.
            if (!fromDecl) throw new Error(`procedural: ${from.json.type} '${from.json.name}' has no output '${link.from[1]}' (tree '${tree.name}')`)
            if (!toDecl) throw new Error(`procedural: ${to.json.type} '${to.json.name}' has no input '${link.to[1]}' (tree '${tree.name}')`)
            if (!fromDecl.available || !toDecl.available) continue
            let list = to.inputLinks.get(link.to[1])
            if (!list) to.inputLinks.set(link.to[1], list = [])
            list.push({node: from, socket: link.from[1]})
            from.linkedOutputs.add(link.from[1])
        }
        const outs = [...this.nodes.values()].filter(n => n.kind === 'group-output')
        this.groupOutputNode = outs.find(n => n.json.properties?.is_active_output !== false) ?? outs[0]
    }

    private compile(json: NodeJSON): CNode {
        const base: Omit<CNode, 'kind'> = {
            json, inputDecls: new Map(), outputDecls: new Map(), inputLinks: new Map(), linkedOutputs: new Set(),
            defaults: new Map(), localVersion: 0, checked: -1,
        }
        const add = (map: Map<string, SocketDecl>, list: SocketDecl[]) => list.forEach(d => map.set(d.identifier, d))
        switch (json.type) {
        case 'NodeGroupInput': {
            const n: CNode = {...base, kind: 'group-input'}
            add(n.outputDecls, this.inputs.map(interfaceSocketDecl))
            return n
        }
        case 'NodeGroupOutput': {
            const n: CNode = {...base, kind: 'group-output'}
            add(n.inputDecls, this.outputs.map(interfaceSocketDecl))
            return n
        }
        case 'NodeReroute': {
            const idname = (json.properties?.socket_idname as string | undefined) ?? 'NodeSocketColor'
            const type = socketTypeFromIdname(idname)
            const decl: SocketDecl = {identifier: 'Input', name: 'Input', type, available: true, structure: socketDataType(type) ? 'dynamic' : type === 'GEOMETRY' ? 'geometry' : 'single'}
            const n: CNode = {...base, kind: 'reroute'}
            n.inputDecls.set('Input', decl)
            n.outputDecls.set('Output', {...decl, identifier: 'Output', name: 'Output'})
            return n
        }
        case 'NodeFrame':
            return {...base, kind: 'frame'}
        case 'GeometryNodeGroup': {
            const groupName = json.group ?? (json.properties?.node_tree as {name?: string} | undefined)?.name
            const group = groupName ? this.root.library[groupName] : undefined
            if (!group) throw new Error(`procedural: group node '${json.name}' uses node group '${groupName}', which is not in the library`)
            const n: CNode = {...base, kind: 'group'}
            const sockets = group.interface.filter(isInterfaceSocket)
            add(n.inputDecls, sockets.filter(s => s.inOut === 'INPUT').map(interfaceSocketDecl))
            add(n.outputDecls, sockets.filter(s => s.inOut === 'OUTPUT').map(interfaceSocketDecl))
            return n
        }
        default: {
            const def = getNodeType(json.type)
            if (!def) throw new Error(`procedural: node type ${json.type} ('${json.name}' in '${this.tree.name}') is not ported yet`)
            const inst = new NodeInstance(json, def)
            const n: CNode = {...base, kind: 'node', def, inst}
            add(n.inputDecls, inst.decl.inputs)
            add(n.outputDecls, inst.decl.outputs)
            return n
        }
        }
    }

    // region values

    private interfaceDefault(s: InterfaceSocketJSON): SocketValue {
        let v = this.interfaceDefaults.get(s.identifier)
        if (v === undefined) {
            v = unlinkedInputValue(interfaceSocketDecl(s), s.default)
            this.interfaceDefaults.set(s.identifier, v)
        }
        return v
    }

    /** The value a node output provides to a link. */
    sourceValue(src: LinkSource): SocketValue {
        const n = src.node
        switch (n.kind) {
        case 'group-input': {
            if (this.parentInput) return this.parentInput(src.socket)
            const v = this.rootInputs?.get(src.socket)
            if (v !== undefined) return v
            const s = this.inputs.find(i => i.identifier === src.socket)!
            return this.interfaceDefault(s)
        }
        case 'reroute':
            return this.inputValue(n, 'Input', undefined)
        default: {
            this.ensure(n)
            const out = n.cache!.outputs.get(src.socket)
            if (out instanceof Lazy) {
                const v = out.get()
                n.cache!.outputs.set(src.socket, v)
                return v
            }
            if (out === undefined) {
                // Node did not set this output: Blender outputs the socket type's default.
                const decl = n.outputDecls.get(src.socket)!
                const v = valueFromJSON(decl.type, undefined)
                n.cache!.outputs.set(src.socket, v)
                return v
            }
            return out
        }
        }
    }

    private unlinked(n: CNode, socket: string): SocketValue {
        let v = n.defaults.get(socket)
        if (v === undefined) {
            const decl = n.inputDecls.get(socket)!
            v = unlinkedInputValue(decl, n.json.inputs?.[socket] as JSONValue | undefined)
            n.defaults.set(socket, v)
        }
        return v
    }

    /** The value of one (non multi-input) input socket of `n`. */
    inputValue(n: CNode, socket: string, record: Dep[] | undefined): SocketValue {
        const decl = n.inputDecls.get(socket)
        if (!decl) throw new Error(`procedural: ${n.json.type} '${n.json.name}' has no input '${socket}'`)
        const links = n.inputLinks.get(socket)
        let value: SocketValue
        if (!links?.length || this.isDanglingReroute(links[0].node)) {
            value = this.unlinked(n, socket)
        } else {
            const src = links[0]
            const raw = this.sourceValue(src)
            const fromDecl = src.node.outputDecls.get(src.socket)!
            value = convertLinkValue(raw, fromDecl.type, decl.type) ?? this.unlinked(n, socket)
        }
        record?.push({socket, multi: false, value})
        return value
    }

    /**
     * A reroute chain with nothing at its start: links from it are ignored, as Blender ignores links
     * from dangling reroutes (`update_dangling_reroute_nodes`, `blenkernel/intern/node_runtime.cc:505`).
     */
    private isDanglingReroute(n: CNode): boolean {
        let cur: CNode | undefined = n
        const seen = new Set<CNode>()
        while (cur && cur.kind === 'reroute') {
            if (seen.has(cur)) return true
            seen.add(cur)
            const l = cur.inputLinks.get('Input')
            if (!l?.length) return true
            cur = l[0].node
        }
        return false
    }

    inputValues(n: CNode, socket: string, record: Dep[] | undefined): SocketValue[] {
        const decl = n.inputDecls.get(socket)!
        const links = (n.inputLinks.get(socket) ?? []).filter(l => !this.isDanglingReroute(l.node))
        const values = links.map(src => {
            const raw = this.sourceValue(src)
            return convertLinkValue(raw, src.node.outputDecls.get(src.socket)!.type, decl.type)
        }).filter((v): v is SocketValue => v !== undefined)
        record?.push({socket, multi: true, value: values})
        return values
    }

    // endregion

    // region execution

    private ensure(n: CNode): void {
        if (n.checked === this.root.revision) return
        n.checked = this.root.revision
        const c = n.cache
        if (c && c.localVersion === n.localVersion &&
            c.externals.every(e => this.root.sameExternal(e.key, e.version)) &&
            c.deps.every(d => sameValue(d.multi ? this.inputValues(n, d.socket, undefined) : this.inputValue(n, d.socket, undefined), d.value))) {
            this.root.stats.reused++
            return
        }
        this.execute(n)
    }

    private execute(n: CNode): void {
        this.root.stats.executed++
        const cache: NodeCache = {outputs: new Map(), deps: [], externals: [], localVersion: n.localVersion}
        n.cache = cache
        if (n.json.mute) {
            this.executeMuted(n, cache)
            return
        }
        switch (n.kind) {
        case 'group':
            this.executeGroup(n, cache)
            return
        case 'frame':
        case 'group-output':
            return
        default:
            break
        }
        const def = n.def!
        const single = def.singleValueFunction?.(n.inst!)
        if (single) {
            this.executeSingleValueFunction(n, cache, single)
            return
        }
        if (def.multiFunction) {
            this.executeMultiFunction(n, cache)
            return
        }
        if (!def.execute) throw new Error(`procedural: node type ${def.idname} has neither execute nor multiFunction`)
        try {
            def.execute(this.params(n, cache))
        } catch (e) {
            if (e instanceof BlenderNodeError) {
                this.root.warnings.push({path: this.path, node: n.json.name, message: e.message})
                cache.outputs.clear()
                return
            }
            if (e instanceof NodeEvaluationError) throw e
            const err = new NodeEvaluationError(`${n.json.type} '${n.json.name}' (${this.path || this.tree.name}): ${(e as Error).message}`)
            err.stack = (e as Error).stack
            throw err
        }
    }

    /** {@link NodeTypeDef.singleValueFunction}: `execute_multi_function_on_value_variant__single` over non-field types. */
    private executeSingleValueFunction(n: CNode, cache: NodeCache, fn: (inputs: SocketValue[]) => SocketValue[]): void {
        const inputs = [...n.inputDecls.values()].filter(d => d.available)
        const outputs = [...n.outputDecls.values()].filter(d => d.available)
        const values = inputs.map(d => {
            const v = this.inputValue(n, d.identifier, cache.deps)
            if (v instanceof GField && v.dependsOnInput) {
                throw new Error(`procedural: ${n.json.type} '${n.json.name}': input ${d.identifier} is a field, but this function takes single values`)
            }
            return v
        })
        const result = fn(values)
        outputs.forEach((d, i) => cache.outputs.set(d.identifier, result[i]))
    }

    /** `LazyFunctionForMultiFunctionNode` + `execute_multi_function_on_value_variant`. */
    private executeMultiFunction(n: CNode, cache: NodeCache): void {
        const fn = n.def!.multiFunction!(n.inst!)
        const inputs = [...n.inputDecls.values()].filter(d => d.available && socketDataType(d.type))
        const outputs = [...n.outputDecls.values()].filter(d => d.available && socketDataType(d.type))
        if (inputs.length !== fn.inputs.length || outputs.length !== fn.outputs.length) {
            throw new Error(`procedural: ${n.json.type} '${n.json.name}': function ${fn.name} has ${fn.inputs.length}/${fn.outputs.length} params, node has ${inputs.length}/${outputs.length} sockets`)
        }
        const fields = inputs.map((d, i) => {
            const v = this.inputValue(n, d.identifier, cache.deps)
            if (!(v instanceof GField)) throw new Error(`procedural: ${n.json.type} input ${d.identifier} is not a value`)
            if (v.type !== fn.inputs[i]) throw new Error(`procedural: ${n.json.type} input ${d.identifier} is ${v.type}, function expects ${fn.inputs[i]}`)
            return v
        })
        if (fields.every(f => !f.dependsOnInput)) {
            // `execute_multi_function_on_value_variant__single`: run once on the values.
            const singles = fields.map(f => GVArray.fromSingle(f.type, 1, singleOf(f.type, f)))
            const outs = fn.outputs.map(t => new DATA_TYPES[t].array(DATA_TYPES[t].components))
            fn.call(1, singles, outs)
            outputs.forEach((d, i) => cache.outputs.set(d.identifier, GField.constant(fn.outputs[i], Array.from(outs[i]))))
            return
        }
        const op = new FieldOperation(fn, fields)
        outputs.forEach((d, i) => cache.outputs.set(d.identifier, op.output(i)))
    }

    /** `LazyFunctionForMutedNode` (`geometry_nodes_lazy_function.cc:631`) with Blender's internal links. */
    private executeMuted(n: CNode, cache: NodeCache): void {
        for (const out of n.outputDecls.values()) {
            if (!out.available) continue
            let input: SocketDecl | undefined
            const override = n.def?.internallyLinkedInput?.(n.inst!, out.identifier)
            if (override) {
                input = n.inputDecls.get(override)
            } else {
                // `find_internally_linked_input` (`node_tree_update.cc:860`).
                let best = -1
                let bestLinked = false
                for (const d of n.inputDecls.values()) {
                    if (!d.available) continue
                    const p = internalLinkPriority(d.type, out.type)
                    if (p < 0) continue
                    const linked = (n.inputLinks.get(d.identifier)?.length ?? 0) > 0
                    if (p > best || (linked && !bestLinked)) {
                        input = d
                        best = p
                        bestLinked = linked
                    }
                }
            }
            if (!input) continue
            const v = input.multiInput ? this.inputValues(n, input.identifier, cache.deps)[0] ?? valueFromJSON(input.type, undefined)
                : this.inputValue(n, input.identifier, cache.deps)
            const converted = convertLinkValue(v, input.type, out.type)
            if (converted !== undefined) cache.outputs.set(out.identifier, converted)
        }
    }

    /** `LazyFunctionForGroupNode` (`geometry_nodes_lazy_function.cc:1140`). */
    private executeGroup(n: CNode, cache: NodeCache): void {
        const groupName = n.json.group ?? (n.json.properties?.node_tree as {name?: string} | undefined)?.name
        const tree = this.root.library[groupName!]
        if (!n.sub) {
            n.sub = new TreeEval(this.root, tree, `${this.path}${n.json.name}/`, undefined)
        }
        const sub = n.sub
        // The group reads its inputs from this node lazily; every read is recorded on this node.
        sub.parentInput = (id: string) => {
            const known = cache.deps.find(d => d.socket === id)
            if (known) return (known.multi ? (known.value as SocketValue[])[0] : known.value) as SocketValue
            const decl = n.inputDecls.get(id)!
            return decl.multiInput ? this.inputValues(n, id, cache.deps)[0] : this.inputValue(n, id, cache.deps)
        }
        for (const out of n.outputDecls.values()) {
            cache.outputs.set(out.identifier, new Lazy(() => sub.groupOutput(out.identifier)))
        }
    }

    /** The value the group output node receives for interface output `identifier`. */
    groupOutput(identifier: string): SocketValue {
        const out = this.groupOutputNode
        const decl = this.outputs.find(o => o.identifier === identifier)
        if (!decl) throw new Error(`procedural: node group '${this.tree.name}' has no output '${identifier}'`)
        if (!out) return valueFromJSON(socketTypeFromIdname(decl.socketType), undefined)
        return this.inputValue(out, identifier, undefined)
    }

    private params(n: CNode, cache: NodeCache): ExecParams {
        const self = this
        const inst = n.inst!
        const memo = new Map<string, SocketValue>()
        const get = (id: string): SocketValue => {
            let v = memo.get(id)
            if (v === undefined) {
                const decl = n.inputDecls.get(id)
                if (!decl) throw new Error(`procedural: ${n.json.type} has no input '${id}'`)
                v = decl.multiInput ? self.inputValues(n, id, cache.deps)[0] ?? null : self.inputValue(n, id, cache.deps)
                memo.set(id, v)
            }
            return v
        }
        const field = (id: string): GField => {
            const v = get(id)
            if (!(v instanceof GField)) throw new Error(`procedural: input '${id}' of ${n.json.type} is not a field socket`)
            return v
        }
        const single = (id: string) => singleOf(id, field(id))
        return {
            node: inst,
            options: this.root.options,
            get,
            getMulti: id => self.inputValues(n, id, cache.deps),
            field,
            single,
            float: id => single(id)[0],
            int: id => single(id)[0],
            bool: id => single(id)[0] !== 0,
            vector: id => {
                const v = single(id)
                return [v[0], v[1], v[2]]
            },
            geometry: id => {
                const v = get(id)
                if (!(v instanceof GeometrySet)) throw new Error(`procedural: input '${id}' of ${n.json.type} is not a geometry socket`)
                return v.copy()
            },
            string: id => {
                const v = get(id)
                return typeof v === 'string' ? v : ''
            },
            idRef: id => {
                const v = get(id)
                return v && typeof v === 'object' && '_ref' in v ? v : null
            },
            set: (id, value) => {
                if (!n.outputDecls.has(id)) throw new Error(`procedural: ${n.json.type} has no output '${id}'`)
                cache.outputs.set(id, value)
            },
            outputUsed: id => n.linkedOutputs.has(id),
            anonymousName: id => `.a_${self.path}${n.json.name}_${id}`,
            warn: message => self.root.warnings.push({path: self.path, node: n.json.name, message}),
            dependsOn: (key, version) => cache.externals.push({key, version}),
        }
    }

    // endregion

    /** Rebuild a node after a property change: new declaration, links re-resolved, cache dropped. */
    recompileNode(nodeName: string): void {
        const old = this.nodes.get(nodeName)!
        const n = this.compile(old.json)
        n.localVersion = old.localVersion + 1
        this.nodes.set(nodeName, n)
        // Re-point every link touching this node.
        for (const other of this.nodes.values()) {
            for (const [socket, list] of other.inputLinks) {
                other.inputLinks.set(socket, list.filter(l => l.node !== old))
            }
        }
        for (const link of this.tree.links) {
            if (link.muted || (link.from[0] !== nodeName && link.to[0] !== nodeName)) continue
            const from = this.nodes.get(link.from[0])!
            const to = this.nodes.get(link.to[0])!
            const fromDecl = from.outputDecls.get(link.from[1])
            const toDecl = to.inputDecls.get(link.to[1])
            if (!fromDecl?.available || !toDecl?.available) continue
            let list = to.inputLinks.get(link.to[1])
            if (!list) to.inputLinks.set(link.to[1], list = [])
            // Keep the tree's link order for multi-inputs.
            list.push({node: from, socket: link.from[1]})
            from.linkedOutputs.add(link.from[1])
        }
        for (const other of this.nodes.values()) {
            for (const [socket, list] of other.inputLinks) {
                const order = this.tree.links.filter(l => !l.muted && l.to[0] === other.json.name && l.to[1] === socket).map(l => l.from.join('\u0000'))
                list.sort((a, b) => order.indexOf(`${a.node.json.name}\u0000${a.socket}`) - order.indexOf(`${b.node.json.name}\u0000${b.socket}`))
            }
        }
        // Nodes reading this one see new output objects and re-run through their recorded inputs.
    }

    /** Mark a node's local data changed (property, unlinked input value). */
    touch(nodeName: string): CNode {
        const n = this.nodes.get(nodeName)
        if (!n) throw new Error(`procedural: no node '${nodeName}' in '${this.tree.name}'`)
        n.localVersion++
        n.defaults.clear()
        return n
    }
}

export interface EvaluationResult {
    /** Group outputs by interface identifier. */
    outputs: Record<string, SocketValue>
    /** The first geometry output, with anonymous attributes removed (`geometry_nodes_execute.cc:669`). */
    geometry?: GeometrySet
    stats: EvalStats
    warnings: EvalWarning[]
}

/**
 * Evaluates one node group of a library as a modifier does: interface inputs are the modifier's
 * input values, the first geometry input is the object's geometry.
 */
export class GeometryNodesEvaluator {
    private readonly root: Root
    private readonly tree: TreeEval
    private readonly inputs = new Map<string, SocketValue>()
    private readonly externalVersions = new Map<string, number | string>()

    constructor(library: NodeGroupLibrary, groupName: string, options: EvalOptions = {}) {
        const tree = library[groupName]
        if (!tree) throw new Error(`procedural: node group '${groupName}' is not in the library`)
        this.root = {
            library, options, revision: 0, stats: {executed: 0, reused: 0}, warnings: [],
            sameExternal: (key, version) => this.externalVersions.get(key) === version,
        }
        this.tree = new TreeEval(this.root, tree, '', undefined, this.inputs)
    }

    get interfaceInputs(): readonly InterfaceSocketJSON[] {
        return this.tree.inputs
    }

    get interfaceOutputs(): readonly InterfaceSocketJSON[] {
        return this.tree.outputs
    }

    private findInput(nameOrIdentifier: string): InterfaceSocketJSON {
        const s = this.tree.inputs.find(i => i.identifier === nameOrIdentifier) ?? this.tree.inputs.find(i => i.name === nameOrIdentifier)
        if (!s) throw new Error(`procedural: node group '${this.tree.tree.name}' has no input '${nameOrIdentifier}' (inputs: ${this.tree.inputs.map(i => i.name).join(', ')})`)
        return s
    }

    /**
     * Set a modifier input by name or identifier. JSON values (numbers, booleans, arrays, ID refs)
     * are converted to the socket's type; socket values (fields, geometry) are used as they are.
     * Setting an equal value keeps the old value object, so nothing re-runs.
     */
    setInput(nameOrIdentifier: string, value: JSONValue | SocketValue): void {
        const s = this.findInput(nameOrIdentifier)
        const type = socketTypeFromIdname(s.socketType)
        const v = value instanceof GField || value instanceof GeometrySet ? value : valueFromJSON(type, value as JSONValue)
        const old = this.inputs.get(s.identifier)
        if (old instanceof GField && v instanceof GField && !old.dependsOnInput && !v.dependsOnInput &&
            old.type === v.type && sameNumbers(singleOf(s.name, old), singleOf(s.name, v))) return
        if (old !== undefined && typeof old !== 'object' && old === v) return
        if (old && v && typeof old === 'object' && typeof v === 'object' && '_ref' in old && '_ref' in v &&
            old._ref === v._ref && old.name === v.name) return
        this.inputs.set(s.identifier, v)
    }

    /** The object's geometry, fed to the first geometry input (`modifyGeometry` input). */
    setInputGeometry(geometry: GeometrySet): void {
        const s = this.tree.inputs.find(i => socketTypeFromIdname(i.socketType) === 'GEOMETRY')
        if (!s) return
        this.inputs.set(s.identifier, geometry)
    }

    /**
     * Change a node property on the root tree (`node.operation = ...`). The node's declaration is rebuilt
     * (sockets can change with properties) and the node re-runs on the next evaluation.
     */
    setNodeProperty(nodeName: string, property: string, value: JSONValue | JSONValue[]): void {
        const n = this.tree.nodes.get(nodeName)
        if (!n) throw new Error(`procedural: no node '${nodeName}'`)
        n.json.properties = {...(n.json.properties ?? {}), [property]: value}
        this.tree.recompileNode(nodeName)
    }

    /** Change an unlinked input value of a root-tree node. */
    setSocketValue(nodeName: string, socket: string, value: JSONValue): void {
        const n = this.tree.nodes.get(nodeName)
        if (!n) throw new Error(`procedural: no node '${nodeName}'`)
        n.json.inputs = {...(n.json.inputs ?? {}), [socket]: value}
        this.tree.touch(nodeName)
    }

    /** Tell the evaluator external data (an object, a collection, an image) changed. */
    setExternalVersion(key: string, version: number | string): void {
        this.externalVersions.set(key, version)
    }

    evaluate(): EvaluationResult {
        this.root.revision++
        this.root.stats = {executed: 0, reused: 0}
        this.root.warnings = []
        const outputs: Record<string, SocketValue> = {}
        let geometry: GeometrySet | undefined
        for (const o of this.tree.outputs) {
            const v = this.tree.groupOutput(o.identifier)
            outputs[o.identifier] = v
            if (!geometry && v instanceof GeometrySet) {
                geometry = v.copy()
                geometry.removeAnonymousAttributes()
            }
        }
        return {outputs, geometry, stats: this.root.stats, warnings: this.root.warnings}
    }
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
    return true
}

export {BUILTIN_TYPES}
