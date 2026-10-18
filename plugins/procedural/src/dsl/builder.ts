/**
 * The graph-as-code DSL (`issues/open/modelling-tools/15-procedural-on-kernel.md` §4.1): node groups
 * are written as TypeScript - typed node calls, explicit sockets, a few operator helpers - and compile
 * to the {@link NodeTreeJSON} the runtime evaluates. Shaped after nodebpy; no code from it is used.
 *
 * ```ts
 * const terrain = geometryNodes('Terrain', g => {
 *     const size = g.input.float('Size', {default: 20, min: 1})
 *     const grid = n.MeshGrid({sizeX: size, sizeY: size, verticesX: 64, verticesY: 64})
 *     const z = n.Position().z.mul(0.1)
 *     g.output.geometry('Geometry', n.SetPosition({geometry: grid.mesh, offset: n.CombineXYZ({z})}).geometry)
 * })
 * terrain.library // {Terrain: NodeTreeJSON}
 * ```
 *
 * Inputs take a socket (a link), or a plain value (the socket's stored value). Links are checked when
 * written: unknown sockets, unknown properties, enum values a property does not have, and links
 * between types Blender cannot convert are errors with the node and socket named.
 */

import {getNodeType, NodeInstance, NodeTypeDef, registeredNodeTypes} from '../runtime/registry'
import {SocketDecl, socketDataType} from '../runtime/declaration'
import {isConvertible} from '../geometry/typeConversions'
import type {ConvertibleTo, NodeConstructors} from './nodes.generated'
import {toCode} from './toCode'
import type {InterfaceSocketJSON, JSONValue, LinkJSON, NodeGroupLibrary, NodeJSON, NodeTreeJSON, SocketType} from '../runtime/types'

/** camelCase key of a socket or property: `Size X` → `sizeX`, `Value_001` → `value1`, `noise_dimensions` → `noiseDimensions`. */
export function dslKey(name: string): string {
    const cleaned = name.replace(/_0*(\d+)$/, ' $1').replace(/[^A-Za-z0-9]+/g, ' ').trim()
    const parts = cleaned.split(' ').filter(Boolean)
    if (!parts.length) return name
    return parts.map((p, i) => i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

/** DSL class name of a node type: its `dslName`, else the PascalCase UI label. */
export function dslClassName(def: NodeTypeDef): string {
    if (def.dslName) return def.dslName
    return def.label.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

const SOCKET_IDNAME: Record<SocketType, string> = {
    GEOMETRY: 'NodeSocketGeometry', FLOAT: 'NodeSocketFloat', INT: 'NodeSocketInt', BOOLEAN: 'NodeSocketBool',
    VECTOR: 'NodeSocketVector', RGBA: 'NodeSocketColor', ROTATION: 'NodeSocketRotation', MATRIX: 'NodeSocketMatrix',
    STRING: 'NodeSocketString', MENU: 'NodeSocketMenu', OBJECT: 'NodeSocketObject', COLLECTION: 'NodeSocketCollection',
    MATERIAL: 'NodeSocketMaterial', IMAGE: 'NodeSocketImage', TEXTURE: 'NodeSocketTexture', BUNDLE: 'NodeSocketBundle',
    CLOSURE: 'NodeSocketClosure', CUSTOM: 'NodeSocketVirtual',
}

/**
 * A plain value for an input socket in the shape Blender stores (`bNodeSocketValue*`): a number on a
 * vector or rotation socket is splat to all three components and on a colour socket to (v, v, v, 1) - what
 * Blender's float-to-vector/colour conversions give - so `scale: 0.5` means a uniform scale.
 */
function storedValue(d: SocketDecl, v: JSONValue, where: string): JSONValue {
    const len = d.type === 'VECTOR' || d.type === 'ROTATION' ? 3 : d.type === 'RGBA' ? 4 : 0
    if (!len) return v
    if (typeof v === 'number' || typeof v === 'boolean') {
        const x = Number(v)
        return len === 4 ? [x, x, x, 1] : [x, x, x]
    }
    if (Array.isArray(v) && (v.length === len || (d.type === 'RGBA' && v.length === 3))) return d.type === 'RGBA' && v.length === 3 ? [...v, 1] : v
    throw new Error(`${where}: expected ${len} numbers for a ${d.type} socket, got ${JSON.stringify(v)}`)
}

/** What a socket helper accepts as its other operand: a socket or a plain value. */
type Operand = Socket | number | number[]
/** Math on a vector stays a vector (Vector Math); on anything else it is a float (Math). */
type MathOut<T extends SocketType> = T extends 'VECTOR' ? Socket<'VECTOR'> : Socket<'FLOAT'>

/** A node output (or group input) a value can be linked from. `T` is its socket type. */
export class Socket<T extends SocketType = SocketType> {
    constructor(readonly builder: TreeBuilder, readonly node: string, readonly identifier: string, readonly type: T) {}

    // Math helpers create ShaderNodeMath / ShaderNodeVectorMath / FunctionNodeCompare / FunctionNodeBooleanMath
    // nodes. Vectors use Vector Math; everything else Math.
    private math(op: string, ...others: Operand[]): Socket {
        if (this.type === 'VECTOR') {
            const keys = ['vector', 'vector1', 'vector2']
            const args: Record<string, unknown> = {operation: op, vector: this}
            others.forEach((o, i) => { args[keys[i + 1]] = typeof o === 'number' ? [o, o, o] : o })
            const node = this.builder.node('ShaderNodeVectorMath', args)
            return op === 'DOT_PRODUCT' || op === 'LENGTH' || op === 'DISTANCE' ? node.outputs.value : node.outputs.vector
        }
        const keys = ['value', 'value1', 'value2']
        const args: Record<string, unknown> = {operation: op, value: this}
        others.forEach((o, i) => { args[keys[i + 1]] = o })
        return this.builder.node('ShaderNodeMath', args).outputs.value
    }

    add(b: Operand): MathOut<T> { return this.math('ADD', b) as MathOut<T> }
    sub(b: Operand): MathOut<T> { return this.math('SUBTRACT', b) as MathOut<T> }
    mul(b: Operand): MathOut<T> { return this.math('MULTIPLY', b) as MathOut<T> }
    div(b: Operand): MathOut<T> { return this.math('DIVIDE', b) as MathOut<T> }
    pow(b: Socket | number): Socket<'FLOAT'> { return this.math('POWER', b) as Socket<'FLOAT'> }
    min(b: Operand): MathOut<T> { return this.math('MINIMUM', b) as MathOut<T> }
    max(b: Operand): MathOut<T> { return this.math('MAXIMUM', b) as MathOut<T> }
    abs(): MathOut<T> { return this.math('ABSOLUTE') as MathOut<T> }
    floor(): MathOut<T> { return this.math('FLOOR') as MathOut<T> }
    dot(b: Socket | number[]): Socket<'FLOAT'> { return this.math('DOT_PRODUCT', b) as Socket<'FLOAT'> }
    cross(b: Socket | number[]): Socket<'VECTOR'> { return this.math('CROSS_PRODUCT', b) as Socket<'VECTOR'> }
    length(): Socket<'FLOAT'> { return this.math('LENGTH') as Socket<'FLOAT'> }
    normalize(): Socket<'VECTOR'> { return this.math('NORMALIZE') as Socket<'VECTOR'> }
    scale(s: Socket | number): Socket<'VECTOR'> {
        if (this.type !== 'VECTOR') throw new Error('scale() is for vectors')
        return this.builder.node('ShaderNodeVectorMath', {operation: 'SCALE', vector: this, scale: s}).outputs.vector as Socket<'VECTOR'>
    }

    private compare(op: string, b: Socket | number): Socket<'BOOLEAN'> {
        const dataType = this.type === 'INT' ? 'INT' : this.type === 'VECTOR' ? 'VECTOR' : 'FLOAT'
        return this.builder.node('FunctionNodeCompare', {dataType, operation: op, a: this, b}).outputs.result as Socket<'BOOLEAN'>
    }

    gt(b: Socket | number): Socket<'BOOLEAN'> { return this.compare('GREATER_THAN', b) }
    lt(b: Socket | number): Socket<'BOOLEAN'> { return this.compare('LESS_THAN', b) }
    ge(b: Socket | number): Socket<'BOOLEAN'> { return this.compare('GREATER_EQUAL', b) }
    le(b: Socket | number): Socket<'BOOLEAN'> { return this.compare('LESS_EQUAL', b) }
    eq(b: Socket | number): Socket<'BOOLEAN'> { return this.compare('EQUAL', b) }

    and(b: Socket | boolean): Socket<'BOOLEAN'> { return this.builder.node('FunctionNodeBooleanMath', {operation: 'AND', boolean: this, boolean1: b}).outputs.boolean as Socket<'BOOLEAN'> }
    or(b: Socket | boolean): Socket<'BOOLEAN'> { return this.builder.node('FunctionNodeBooleanMath', {operation: 'OR', boolean: this, boolean1: b}).outputs.boolean as Socket<'BOOLEAN'> }
    not(): Socket<'BOOLEAN'> { return this.builder.node('FunctionNodeBooleanMath', {operation: 'NOT', boolean: this}).outputs.boolean as Socket<'BOOLEAN'> }

    /** Components of a vector (`ShaderNodeSeparateXYZ`). */
    get x(): Socket<'FLOAT'> { return this.separate().x as Socket<'FLOAT'> }
    get y(): Socket<'FLOAT'> { return this.separate().y as Socket<'FLOAT'> }
    get z(): Socket<'FLOAT'> { return this.separate().z as Socket<'FLOAT'> }

    private separated?: Record<string, Socket>

    private separate(): Record<string, Socket> {
        if (this.type !== 'VECTOR') throw new Error('.x/.y/.z are for vectors')
        if (!this.separated) this.separated = this.builder.node('ShaderNodeSeparateXYZ', {vector: this}).outputs
        return this.separated
    }
}

/**
 * A socket whose type is only known at run time: outputs of `g.node(idname)` and `g.group(...)`, which the
 * generated typings cannot describe. The builder still checks the link when it is made.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySocket = Socket<any>

/** A node in a tree being built: its outputs by DSL key. */
export class NodeHandle {
    constructor(readonly name: string, readonly type: string, readonly outputs: Record<string, AnySocket>) {}
}

export interface InterfaceOptions {
    default?: JSONValue
    min?: number
    max?: number
    subtype?: string
    description?: string
    /** An implicit field for unlinked group inputs (`POSITION`, `INDEX`, `NORMAL`, `ID_OR_INDEX`). */
    defaultInput?: string
    hideValue?: boolean
}

/** Records nodes and links into a {@link NodeTreeJSON}. */
export class TreeBuilder {
    readonly tree: NodeTreeJSON
    readonly library: NodeGroupLibrary = {}
    private counter = new Map<string, number>()
    private interfaceUid = 0
    private groupInputNode?: string
    private groupOutputNode?: string

    constructor(name: string) {
        this.tree = {name, interface: [], nodes: [], links: []}
        this.library[name] = this.tree
    }

    private uniqueName(base: string): string {
        const n = this.counter.get(base) ?? 0
        this.counter.set(base, n + 1)
        return n === 0 ? base : `${base}.${String(n).padStart(3, '0')}`
    }

    private ensureGroupInput(): string {
        if (!this.groupInputNode) {
            this.groupInputNode = 'Group Input'
            this.tree.nodes.push({name: this.groupInputNode, type: 'NodeGroupInput'})
        }
        return this.groupInputNode
    }

    private ensureGroupOutput(): string {
        if (!this.groupOutputNode) {
            this.groupOutputNode = 'Group Output'
            this.tree.nodes.push({name: this.groupOutputNode, type: 'NodeGroupOutput'})
        }
        return this.groupOutputNode
    }

    /** Add a group input socket; returns the Group Input node's output for it. */
    addInput(type: SocketType, name: string, o: InterfaceOptions = {}): Socket {
        const identifier = `Socket_${this.interfaceUid++}`
        const s: InterfaceSocketJSON = {inOut: 'INPUT', name, identifier, socketType: SOCKET_IDNAME[type]}
        if (o.default !== undefined) s.default = o.default
        if (o.min !== undefined) s.min_value = o.min
        if (o.max !== undefined) s.max_value = o.max
        if (o.subtype) s.subtype = o.subtype
        if (o.description) s.description = o.description
        if (o.defaultInput) s.default_input = o.defaultInput
        if (o.hideValue) s.hide_value = true
        this.tree.interface.push(s)
        return new Socket(this, this.ensureGroupInput(), identifier, type)
    }

    /** Add a group output socket and link `value` to it. */
    addOutput(type: SocketType, name: string, value: Socket): void {
        const identifier = `Socket_${this.interfaceUid++}`
        this.tree.interface.push({inOut: 'OUTPUT', name, identifier, socketType: SOCKET_IDNAME[type]})
        const out = this.ensureGroupOutput()
        this.link(value, out, identifier, type)
    }

    private link(from: Socket, toNode: string, toId: string, toType: SocketType): void {
        if (from.builder !== this) throw new Error(`socket ${from.node}.${from.identifier} belongs to another node group`)
        const a = socketDataType(from.type), b = socketDataType(toType)
        const ok = from.type === toType || (a && b && isConvertible(a, b))
        if (!ok) throw new Error(`cannot link ${from.type} ${from.node}.${from.identifier} to ${toType} ${toNode}.${toId}: Blender has no conversion`)
        // A socket pair has at most one link: `links.new` replaces an existing one (`rna_nodetree.cc:1488`).
        if (this.tree.links.some(l => l.from[0] === from.node && l.from[1] === from.identifier && l.to[0] === toNode && l.to[1] === toId)) {
            throw new Error(`${from.node}.${from.identifier} is already linked to ${toNode}.${toId}; Blender keeps one link per socket pair`)
        }
        this.tree.links.push({from: [from.node, from.identifier], to: [toNode, toId]} satisfies LinkJSON)
    }

    /**
     * Add a node by `bl_idname`. `args` keys are DSL keys (camelCase) of properties or input sockets;
     * properties are applied first since they decide which sockets exist.
     */
    node(idname: string, args: Record<string, unknown> = {}): NodeHandle {
        const def = getNodeType(idname)
        if (!def) throw new Error(`node type ${idname} is not ported`)
        const name = this.uniqueName(def.label)
        const json: NodeJSON = {name, type: idname, properties: {}, inputs: {}}
        const propKeys = new Map(Object.keys(def.properties ?? {}).map(p => [dslKey(p), p]))
        const rest: [string, unknown][] = []
        for (const [k, v] of Object.entries(args)) {
            if (v === undefined) continue
            const prop = propKeys.get(k)
            if (prop) {
                const allowed = def.enums?.[prop]
                if (allowed && !allowed.includes(v as string)) {
                    throw new Error(`${dslClassName(def)}: ${k} must be one of ${allowed.join(', ')}, got ${JSON.stringify(v)}`)
                }
                json.properties![prop] = v as JSONValue
            } else {
                rest.push([k, v])
            }
        }
        if (args.mute) json.mute = true
        const inst = new NodeInstance(json, def)
        const inputs = new Map<string, SocketDecl>()
        for (const d of inst.decl.inputs) {
            inputs.set(dslKey(d.identifier), d)
            if (!inputs.has(dslKey(d.name))) inputs.set(dslKey(d.name), d)
        }
        this.tree.nodes.push(json)
        for (const [k, v] of rest) {
            if (k === 'mute') continue
            const d = inputs.get(k)
            if (!d) {
                throw new Error(`${dslClassName(def)} has no input or property '${k}' ` +
                    `(inputs: ${inst.decl.inputs.filter(x => x.available).map(x => dslKey(x.identifier)).join(', ')}; ` +
                    `properties: ${[...propKeys.keys()].join(', ')})`)
            }
            if (!d.available) throw new Error(`${dslClassName(def)}: input '${k}' is not available with these properties`)
            const values = d.multiInput && Array.isArray(v) && v.every(x => x instanceof Socket) ? v as Socket[] : [v]
            for (const value of values) {
                if (value instanceof Socket) this.link(value, name, d.identifier, d.type)
                else if (value instanceof NodeHandle) {
                    const first = Object.values(value.outputs)[0]
                    if (!first) throw new Error(`${value.type} has no output to link`)
                    this.link(first, name, d.identifier, d.type)
                } else json.inputs![d.identifier] = storedValue(d, value as JSONValue, `${dslClassName(def)}.${k}`)
            }
        }
        const outputs: Record<string, Socket> = {}
        for (const d of inst.decl.outputs) {
            if (!d.available) continue
            const s = new Socket(this, name, d.identifier, d.type)
            outputs[dslKey(d.identifier)] = s
            if (!(dslKey(d.name) in outputs)) outputs[dslKey(d.name)] = s
        }
        return new NodeHandle(name, idname, outputs)
    }

    /**
     * A repeat zone: a Repeat Input and its paired Repeat Output (`node_geo_repeat.cc`). `items` name the values the
     * loop carries (item name -> initial value); the body reads them from `zone.input` and hands the next iteration's
     * values to `zone.output(...)`, which returns the values after the last iteration.
     */
    repeatZone<I extends Record<string, AnySocket | RepeatItemValue>>(items: I, iterations: Socket<'INT'> | number = 1): RepeatZone<RepeatSockets<I>> {
        const inName = this.uniqueName('Repeat Input')
        const outName = this.uniqueName('Repeat Output')
        const keys = Object.keys(items)
        const types = keys.map(k => {
            const v = items[k]
            return v instanceof Socket ? v.type : v.type
        })
        const repeatItems = keys.map((k, i) => ({name: k, socket_type: types[i]}))
        const input: NodeJSON = {name: inName, type: 'GeometryNodeRepeatInput', pairedOutput: outName, inputs: {}}
        const output: NodeJSON = {name: outName, type: 'GeometryNodeRepeatOutput', inputs: {}, items: {repeat_items: repeatItems}}
        this.tree.nodes.push(input, output)
        if (iterations instanceof Socket) this.link(iterations, inName, 'Iterations', 'INT')
        else input.inputs!.Iterations = iterations
        keys.forEach((k, i) => {
            const v = items[k]
            if (v instanceof Socket) this.link(v, inName, `Item_${i}`, types[i])
            else if (v.value !== undefined) input.inputs![`Item_${i}`] = v.value
        })
        type S = RepeatSockets<I>
        const state = Object.fromEntries(keys.map((k, i) => [k, new Socket(this, inName, `Item_${i}`, types[i])])) as unknown as S
        const after = Object.fromEntries(keys.map((k, i) => [k, new Socket(this, outName, `Item_${i}`, types[i])])) as unknown as S
        return new RepeatZone<S>(state, new Socket(this, inName, 'Iteration', 'INT') as Socket<'INT'>, values => {
            for (const [k, v] of Object.entries(values)) {
                const i = keys.indexOf(k)
                if (i < 0) throw new Error(`repeat zone has no item '${k}' (items: ${keys.join(', ')})`)
                if (v) this.link(v, outName, `Item_${i}`, types[i])
            }
            return after
        })
    }

    /** Use another node group: adds a `GeometryNodeGroup` node and the group's trees to this library. */
    group(sub: NodeGroup, args: Record<string, Socket | JSONValue> = {}): NodeHandle {
        Object.assign(this.library, sub.library, {[this.tree.name]: this.tree})
        const name = this.uniqueName(sub.name)
        const json: NodeJSON = {name, type: 'GeometryNodeGroup', group: sub.name, inputs: {}}
        this.tree.nodes.push(json)
        const iface = sub.tree.interface.filter((s): s is InterfaceSocketJSON => s.itemType !== 'PANEL')
        for (const [k, v] of Object.entries(args)) {
            const s = iface.find(i => i.inOut === 'INPUT' && (dslKey(i.name) === k || i.identifier === k))
            if (!s) throw new Error(`group ${sub.name} has no input '${k}'`)
            if (v instanceof Socket) this.link(v, name, s.identifier, socketTypeOf(s.socketType))
            else json.inputs![s.identifier] = v as JSONValue
        }
        const outputs: Record<string, Socket> = {}
        for (const s of iface.filter(i => i.inOut === 'OUTPUT')) outputs[dslKey(s.name)] = new Socket(this, name, s.identifier, socketTypeOf(s.socketType))
        return new NodeHandle(name, 'GeometryNodeGroup', outputs)
    }
}

function socketTypeOf(idname: string): SocketType {
    const entry = (Object.entries(SOCKET_IDNAME) as [SocketType, string][]).find(([, v]) => idname.startsWith(v))
    if (!entry) throw new Error(`unknown socket type ${idname}`)
    return entry[0]
}

/** A repeat item without a linked initial value: its socket type and the unlinked input's value. */
export interface RepeatItemValue {
    type: SocketType
    value?: JSONValue
}

/** The sockets of a repeat zone's items, by item name. */
export type RepeatSockets<I> = {[K in keyof I]: I[K] extends Socket<infer T> ? Socket<T> : I[K] extends {type: infer T extends SocketType} ? Socket<T> : AnySocket}

/** A repeat zone being built ({@link GroupBuilder.repeatZone}). */
export class RepeatZone<I extends Record<string, AnySocket>> {
    private done = false

    constructor(
        /** The items' values in the current iteration (Repeat Input outputs). */
        readonly input: I,
        /** The current iteration, from 0. */
        readonly iteration: Socket<'INT'>,
        private readonly close: (values: Partial<I>) => I,
    ) {}

    /** Hand the next iteration's values to the Repeat Output; returns the values after the last iteration. */
    output(values: Partial<I>): I {
        if (this.done) throw new Error('repeat zone output() was already called')
        this.done = true
        return this.close(values)
    }
}

/** A built node group: its tree and every group it uses. */
export class NodeGroup {
    constructor(readonly name: string, readonly tree: NodeTreeJSON, readonly library: NodeGroupLibrary) {}

    /** The trees as JSON (what the `nodeGroup` command and the evaluator take). */
    toJSON(): NodeGroupLibrary {
        return this.library
    }

    /** {@link toJSON}: `{op: 'nodeGroup', library: group.json}`. */
    get json(): NodeGroupLibrary {
        return this.library
    }

    /** The group back as DSL code (the same text `toCode` gives for an imported Blender tree). */
    toCode(): string {
        return toCode(this.library, this.name)
    }
}

type InputFn<T extends SocketType> = (name: string, o?: InterfaceOptions) => Socket<T>
type OutputFn<T extends SocketType> = (name: string, s: Socket<ConvertibleTo[T]>) => void

export interface GroupBuilder {
    input: {
        float: InputFn<'FLOAT'>, int: InputFn<'INT'>, bool: InputFn<'BOOLEAN'>, vector: InputFn<'VECTOR'>, color: InputFn<'RGBA'>,
        rotation: InputFn<'ROTATION'>, matrix: InputFn<'MATRIX'>, string: InputFn<'STRING'>, menu: InputFn<'MENU'>,
        geometry: (name: string) => Socket<'GEOMETRY'>, object: InputFn<'OBJECT'>, collection: InputFn<'COLLECTION'>,
        material: InputFn<'MATERIAL'>, image: InputFn<'IMAGE'>,
    }
    output: {
        geometry: OutputFn<'GEOMETRY'>, float: OutputFn<'FLOAT'>, int: OutputFn<'INT'>, bool: OutputFn<'BOOLEAN'>,
        vector: OutputFn<'VECTOR'>, color: OutputFn<'RGBA'>,
    }
    /** Add a node by `bl_idname` (what the typed `n.*` calls do). */
    node(idname: string, args?: Record<string, unknown>): NodeHandle
    /** Use another node group. */
    group(sub: NodeGroup, args?: Record<string, Socket | JSONValue>): NodeHandle
    /** A repeat zone carrying `items` through `iterations` runs of its body (see {@link TreeBuilder.repeatZone}). */
    repeatZone<I extends Record<string, AnySocket | RepeatItemValue>>(items: I, iterations?: Socket<'INT'> | number): RepeatZone<RepeatSockets<I>>
}

let current: TreeBuilder | undefined

/** Build a node group. Node calls (`n.*`) inside `fn` add to it. */
export function geometryNodes(name: string, fn: (g: GroupBuilder) => void): NodeGroup {
    const b = new TreeBuilder(name)
    const prev = current
    current = b
    try {
        const input = <T extends SocketType>(t: T): InputFn<T> => (n, o) => b.addInput(t, n, o) as Socket<T>
        const output = (t: SocketType) => (n: string, s: Socket) => b.addOutput(t, n, s)
        fn({
            input: {
                float: input('FLOAT'), int: input('INT'), bool: input('BOOLEAN'), vector: input('VECTOR'), color: input('RGBA'),
                rotation: input('ROTATION'), matrix: input('MATRIX'), string: input('STRING'), menu: input('MENU'),
                geometry: n => b.addInput('GEOMETRY', n) as Socket<'GEOMETRY'>, object: input('OBJECT'), collection: input('COLLECTION'),
                material: input('MATERIAL'), image: input('IMAGE'),
            },
            output: {
                geometry: output('GEOMETRY'), float: output('FLOAT'), int: output('INT'), bool: output('BOOLEAN'),
                vector: output('VECTOR'), color: output('RGBA'),
            },
            node: (id, args) => b.node(id, args),
            group: (sub, args) => b.group(sub, args),
            repeatZone: (items, iterations) => b.repeatZone(items, iterations),
        })
    } finally {
        current = prev
    }
    return new NodeGroup(name, b.tree, b.library)
}

function builder(): TreeBuilder {
    if (!current) throw new Error('node calls must be made inside geometryNodes(name, g => { ... })')
    return current
}

/**
 * Node constructors by DSL class name, for every registered node type: `n.SetPosition({...})`. Their types
 * (`NodeConstructors`) are generated from the registry into `nodes.generated.ts` (`npm run generate:dsl`).
 */
export const n: NodeConstructors = new Proxy({}, {
    get(_t, key: string) {
        const def = registeredNodeTypes().find(d => dslClassName(d) === key)
        if (!def) throw new Error(`n.${key}: no ported node type has that name`)
        return (args?: Record<string, unknown>) => {
            const h = builder().node(def.idname, args)
            // Outputs are reachable as properties of the handle (`grid.mesh`, `noise.fac`); they win over
            // the handle's own fields so an output called `type` or `name` stays reachable.
            return new Proxy(h, {get: (t, k: string) => (k in t.outputs ? t.outputs[k] : (t as never)[k])})
        }
    },
}) as never
