/**
 * Generates `nodes.generated.ts`: the DSL's node constructor types, from the node registry (one source of
 * truth). For every node type, every enum value and boolean of its properties is declared once, so sockets that
 * exist only for some properties are typed (with the union of their types). Run by `npm run generate:dsl`;
 * `tests/dslTypes.test.ts` fails when the committed file is stale.
 */

import {NodeInstance, NodeTypeDef, registeredNodeTypes} from '../runtime/registry'
import {SocketDecl, socketDataType} from '../runtime/declaration'
import {isConvertible} from '../geometry/typeConversions'
import type {JSONValue, SocketType} from '../runtime/types'
import {dslClassName, dslKey, dslPropertyKey} from './builder'

const SOCKET_TYPES: SocketType[] = ['GEOMETRY', 'FLOAT', 'INT', 'BOOLEAN', 'VECTOR', 'RGBA', 'ROTATION', 'MATRIX', 'STRING', 'MENU',
    'OBJECT', 'COLLECTION', 'MATERIAL', 'IMAGE', 'TEXTURE', 'BUNDLE', 'CLOSURE', 'CUSTOM']

/** Plain values a socket of each type accepts (what the DSL stores as the socket value). */
const LITERAL: Partial<Record<SocketType, string>> = {
    FLOAT: 'number', INT: 'number', BOOLEAN: 'boolean | number', VECTOR: 'number | Vec3', RGBA: 'number | Vec3 | Vec4',
    ROTATION: 'Vec3', STRING: 'string', MENU: 'string', OBJECT: 'IDRef | null', COLLECTION: 'IDRef | null',
    MATERIAL: 'IDRef | null', IMAGE: 'IDRef | null', TEXTURE: 'IDRef | null',
}

const lit = (v: JSONValue) => JSON.stringify(v)
const quote = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k))

/**
 * Declarations of a node for every combination of its enum and boolean property values (sockets can depend on
 * several properties at once, e.g. Mesh Line's Resolution on `mode` and `count_mode`). Above 4096 combinations,
 * each property's values are taken one at a time instead.
 */
function variants(def: NodeTypeDef): {inputs: SocketDecl[], outputs: SocketDecl[]}[] {
    const axes: [string, JSONValue[]][] = []
    for (const [k, v] of Object.entries(def.properties ?? {})) {
        if (def.enums?.[k]) axes.push([k, [...def.enums[k]]])
        else if (typeof v === 'boolean') axes.push([k, [false, true]])
    }
    let props: Record<string, JSONValue>[] = [{}]
    if (axes.reduce((n, [, vs]) => n * vs.length, 1) <= 4096) {
        for (const [k, vs] of axes) props = props.flatMap(p => vs.map(v => ({...p, [k]: v})))
    } else {
        for (const [k, vs] of axes) for (const v of vs) props.push({[k]: v})
    }
    const out: {inputs: SocketDecl[], outputs: SocketDecl[]}[] = []
    for (const properties of props) {
        try {
            const decl = new NodeInstance({name: 'n', type: def.idname, properties}, def).decl
            out.push({inputs: decl.inputs.filter(d => d.available), outputs: decl.outputs.filter(d => d.available)})
        } catch {
            // A property value the port does not support yet declares nothing.
        }
    }
    return out
}

function convertibleTo(target: SocketType): SocketType[] {
    const t = socketDataType(target)
    return SOCKET_TYPES.filter(src => {
        if (src === target) return true
        const s = socketDataType(src)
        return !!(s && t && isConvertible(s, t))
    })
}

export function generateDslTypes(): string {
    const lines: string[] = [
        '/* eslint-disable */',
        '// Generated from the node registry by `npm run generate:dsl` (src/dsl/generateTypes.ts). Do not edit.',
        '',
        "import type {NodeHandle, Socket} from './builder'",
        "import type {IDRef, SocketType} from '../runtime/types'",
        '',
        'type Vec3 = [number, number, number]',
        'type Vec4 = [number, number, number, number]',
        '',
        '/** Socket types Blender converts implicitly into each socket type (`isConvertible`). */',
        'export interface ConvertibleTo {',
    ]
    for (const t of SOCKET_TYPES) lines.push(`    ${t}: ${convertibleTo(t).map(lit).join(' | ')}`)
    lines.push('}', '', '/** What an input of socket type `T` accepts: a linked socket of a convertible type, or a value. */')
    lines.push('export type In<T extends SocketType> = Socket<ConvertibleTo[T]> | ' + "(T extends keyof Literals ? Literals[T] : never)", '')
    lines.push('interface Literals {')
    for (const [t, l] of Object.entries(LITERAL)) lines.push(`    ${t}: ${l}`)
    lines.push('}', '')

    const ctor: string[] = []
    const defs = registeredNodeTypes().filter(d => !d.idname.startsWith('Test')).sort((a, b) => dslClassName(a).localeCompare(dslClassName(b)))
    const seen = new Set<string>()
    for (const def of defs) {
        const cls = dslClassName(def)
        if (seen.has(cls)) throw new Error(`generateDslTypes: two node types are called ${cls}; give one a dslName`)
        seen.add(cls)
        const vs = variants(def)
        const inputs = new Map<string, {types: Set<SocketType>, multi: boolean, name: string}>()
        const outputs = new Map<string, Set<SocketType>>()
        for (const v of vs) {
            for (const d of v.inputs) {
                for (const key of new Set([dslKey(d.identifier), dslKey(d.name)])) {
                    const e = inputs.get(key) ?? {types: new Set<SocketType>(), multi: false, name: d.name}
                    e.types.add(d.type)
                    e.multi ||= !!d.multiInput
                    inputs.set(key, e)
                }
            }
            for (const d of v.outputs) {
                for (const key of new Set([dslKey(d.identifier), dslKey(d.name)])) {
                    const e = outputs.get(key) ?? new Set<SocketType>()
                    e.add(d.type)
                    outputs.set(key, e)
                }
            }
        }
        lines.push(`/** \`${def.idname}\` (${def.label}). */`, `export interface ${cls}Args {`)
        for (const [k, v] of Object.entries(def.properties ?? {})) {
            const key = dslPropertyKey(def, k)
            if (inputs.has(key)) throw new Error(`generateDslTypes: ${def.idname} property '${k}' and an input share the DSL key '${key}'; set dslPropertyKeys`)
            const t = def.enums?.[k] ? def.enums[k].map(x => lit(x)).join(' | ')
                : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'unknown'
            lines.push(`    ${quote(key)}?: ${t}`)
        }
        for (const [key, e] of inputs) {
            const types = [...e.types]
            const one = types.length === 1 ? `In<${lit(types[0])}>` : `(${types.map(t => `In<${lit(t)}>`).join(' | ')})`
            lines.push(`    ${quote(key)}?: ${e.multi ? `${one} | ${one}[]` : one}`)
        }
        lines.push('    mute?: boolean', '}')
        lines.push(`export type ${cls}Node = NodeHandle & {`)
        for (const [key, types] of outputs) {
            if (key === 'name' || key === 'type' || key === 'outputs') continue
            lines.push(`    readonly ${quote(key)}: Socket<${[...types].map(lit).join(' | ')}>`)
        }
        lines.push('}', '')
        ctor.push(`    ${cls}(args?: ${cls}Args): ${cls}Node`)
    }
    lines.push('/** `n.*`: one constructor per ported node type. */', 'export interface NodeConstructors {', ...ctor, '}', '')
    return lines.join('\n')
}
