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

/** A node output (or group input) a value can be linked from. */
export class Socket {
    constructor(readonly builder: TreeBuilder, readonly node: string, readonly identifier: string, readonly type: SocketType) {}

    // Math helpers create ShaderNodeMath / ShaderNodeVectorMath / FunctionNodeCompare / FunctionNodeBooleanMath
    // nodes. Vectors use Vector Math; everything else Math.
    private math(op: string, ...others: (Socket | number | number[])[]): Socket {
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

    add(b: Socket | number | number[]): Socket { return this.math('ADD', b) }
    sub(b: Socket | number | number[]): Socket { return this.math('SUBTRACT', b) }
    mul(b: Socket | number | number[]): Socket { return this.math('MULTIPLY', b) }
    div(b: Socket | number | number[]): Socket { return this.math('DIVIDE', b) }
    pow(b: Socket | number): Socket { return this.math('POWER', b) }
    min(b: Socket | number | number[]): Socket { return this.math('MINIMUM', b) }
    max(b: Socket | number | number[]): Socket { return this.math('MAXIMUM', b) }
    abs(): Socket { return this.math('ABSOLUTE') }
    floor(): Socket { return this.math('FLOOR') }
    dot(b: Socket | number[]): Socket { return this.math('DOT_PRODUCT', b) }
    cross(b: Socket | number[]): Socket { return this.math('CROSS_PRODUCT', b) }
    length(): Socket { return this.math('LENGTH') }
    normalize(): Socket { return this.math('NORMALIZE') }
    scale(s: Socket | number): Socket {
        if (this.type !== 'VECTOR') throw new Error('scale() is for vectors')
        return this.builder.node('ShaderNodeVectorMath', {operation: 'SCALE', vector: this, scale: s}).outputs.vector
    }

    private compare(op: string, b: Socket | number): Socket {
        const dataType = this.type === 'INT' ? 'INT' : this.type === 'VECTOR' ? 'VECTOR' : 'FLOAT'
        return this.builder.node('FunctionNodeCompare', {dataType, operation: op, a: this, b}).outputs.result
    }

    gt(b: Socket | number): Socket { return this.compare('GREATER_THAN', b) }
    lt(b: Socket | number): Socket { return this.compare('LESS_THAN', b) }
    ge(b: Socket | number): Socket { return this.compare('GREATER_EQUAL', b) }
    le(b: Socket | number): Socket { return this.compare('LESS_EQUAL', b) }
    eq(b: Socket | number): Socket { return this.compare('EQUAL', b) }

    and(b: Socket | boolean): Socket { return this.builder.node('FunctionNodeBooleanMath', {operation: 'AND', boolean: this, boolean1: b}).outputs.boolean }
    or(b: Socket | boolean): Socket { return this.builder.node('FunctionNodeBooleanMath', {operation: 'OR', boolean: this, boolean1: b}).outputs.boolean }
    not(): Socket { return this.builder.node('FunctionNodeBooleanMath', {operation: 'NOT', boolean: this}).outputs.boolean }

    /** Components of a vector (`ShaderNodeSeparateXYZ`). */
    get x(): Socket { return this.separate().x }
    get y(): Socket { return this.separate().y }
    get z(): Socket { return this.separate().z }

    private separated?: Record<string, Socket>

    private separate(): Record<string, Socket> {
        if (this.type !== 'VECTOR') throw new Error('.x/.y/.z are for vectors')
        if (!this.separated) this.separated = this.builder.node('ShaderNodeSeparateXYZ', {vector: this}).outputs
        return this.separated
    }
}

/** A node in a tree being built: its outputs by DSL key. */
export class NodeHandle {
    constructor(readonly name: string, readonly type: string, readonly outputs: Record<string, Socket>) {}
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

/** A built node group: its tree and every group it uses. */
export class NodeGroup {
    constructor(readonly name: string, readonly tree: NodeTreeJSON, readonly library: NodeGroupLibrary) {}

    /** The trees as JSON (what the `nodeGroup` command and the evaluator take). */
    toJSON(): NodeGroupLibrary {
        return this.library
    }
}

type InputFn = (name: string, o?: InterfaceOptions) => Socket

export interface GroupBuilder {
    input: {float: InputFn, int: InputFn, bool: InputFn, vector: InputFn, color: InputFn, rotation: InputFn, matrix: InputFn, string: InputFn, menu: InputFn, geometry: (name: string) => Socket, object: InputFn, collection: InputFn, material: InputFn, image: InputFn}
    output: {geometry: (name: string, s: Socket) => void, float: (name: string, s: Socket) => void, int: (name: string, s: Socket) => void, bool: (name: string, s: Socket) => void, vector: (name: string, s: Socket) => void, color: (name: string, s: Socket) => void}
    /** Add a node by `bl_idname` (what the typed `n.*` calls do). */
    node(idname: string, args?: Record<string, unknown>): NodeHandle
    /** Use another node group. */
    group(sub: NodeGroup, args?: Record<string, Socket | JSONValue>): NodeHandle
}

let current: TreeBuilder | undefined

/** Build a node group. Node calls (`n.*`) inside `fn` add to it. */
export function geometryNodes(name: string, fn: (g: GroupBuilder) => void): NodeGroup {
    const b = new TreeBuilder(name)
    const prev = current
    current = b
    try {
        const input = (t: SocketType): InputFn => (n, o) => b.addInput(t, n, o)
        const output = (t: SocketType) => (n: string, s: Socket) => b.addOutput(t, n, s)
        fn({
            input: {
                float: input('FLOAT'), int: input('INT'), bool: input('BOOLEAN'), vector: input('VECTOR'), color: input('RGBA'),
                rotation: input('ROTATION'), matrix: input('MATRIX'), string: input('STRING'), menu: input('MENU'),
                geometry: n => b.addInput('GEOMETRY', n), object: input('OBJECT'), collection: input('COLLECTION'),
                material: input('MATERIAL'), image: input('IMAGE'),
            },
            output: {
                geometry: output('GEOMETRY'), float: output('FLOAT'), int: output('INT'), bool: output('BOOLEAN'),
                vector: output('VECTOR'), color: output('RGBA'),
            },
            node: (id, args) => b.node(id, args),
            group: (sub, args) => b.group(sub, args),
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
 * Node constructors by DSL class name, for every registered node type: `n.SetPosition({...})`.
 * Typed declarations for these are generated by `npm run generate:dsl` (`src/dsl/nodes.generated.ts`).
 */
export const n: Record<string, (args?: Record<string, unknown>) => NodeHandle & Record<string, Socket>> = new Proxy({}, {
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
