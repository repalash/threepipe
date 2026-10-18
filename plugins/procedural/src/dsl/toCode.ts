/**
 * Print a node-group library as DSL code (`geometryNodes(...)` + `n.*` calls) - for agents and people
 * who import a Blender tree and want to edit it as code. The printed code rebuilds an equivalent tree
 * (same node types, properties, stored values and links; node names may differ).
 */

import {getNodeType, NodeInstance} from '../runtime/registry'
import {dslClassName, dslKey, dslPropertyKey} from './builder'
import {InterfaceSocketJSON, isInterfaceSocket, JSONValue, NodeGroupLibrary, NodeJSON, NodeTreeJSON, socketTypeFromIdname, SocketType} from '../runtime/types'

const INPUT_FN: Partial<Record<SocketType, string>> = {
    FLOAT: 'float', INT: 'int', BOOLEAN: 'bool', VECTOR: 'vector', RGBA: 'color', ROTATION: 'rotation', MATRIX: 'matrix',
    STRING: 'string', MENU: 'menu', GEOMETRY: 'geometry', OBJECT: 'object', COLLECTION: 'collection', MATERIAL: 'material', IMAGE: 'image',
}
const OUTPUT_FN: Partial<Record<SocketType, string>> = {
    GEOMETRY: 'geometry', FLOAT: 'float', INT: 'int', BOOLEAN: 'bool', VECTOR: 'vector', RGBA: 'color',
}

function ident(name: string, used: Set<string>): string {
    let base = dslKey(name).replace(/^[^A-Za-z_]/, '_$&') || 'node'
    if (['n', 'g', 'in', 'out', 'new', 'delete', 'default', 'function', 'class', 'const', 'let', 'var'].includes(base)) base += 'Node'
    let v = base
    let i = 2
    while (used.has(v)) v = `${base}${i++}`
    used.add(v)
    return v
}

function lit(v: JSONValue | JSONValue[] | undefined): string {
    return JSON.stringify(v)
}

function groupOrder(library: NodeGroupLibrary, root: string): string[] {
    const order: string[] = []
    const visit = (name: string) => {
        if (order.includes(name)) return
        const t = library[name]
        for (const n of t.nodes) if (n.type === 'GeometryNodeGroup' && n.group) visit(n.group)
        order.push(name)
    }
    visit(root)
    return order
}

function treeCode(t: NodeTreeJSON, library: NodeGroupLibrary, groupVars: Map<string, string>): string {
    const lines: string[] = []
    // Group variables are in scope in every tree; node variables must not shadow them.
    const used = new Set<string>(groupVars.values())
    const sockets = t.interface.filter(isInterfaceSocket)
    const inputVar = new Map<string, string>()
    for (const s of sockets.filter(x => x.inOut === 'INPUT')) {
        const v = ident(s.name, used)
        inputVar.set(s.identifier, v)
        const type = socketTypeFromIdname(s.socketType)
        const opts: string[] = []
        if (s.default !== undefined && type !== 'GEOMETRY') opts.push(`default: ${lit(s.default)}`)
        if (s.min_value !== undefined && Math.abs(s.min_value) < 1e30) opts.push(`min: ${s.min_value}`)
        if (s.max_value !== undefined && Math.abs(s.max_value) < 1e30) opts.push(`max: ${s.max_value}`)
        if (s.subtype && s.subtype !== 'NONE') opts.push(`subtype: ${lit(s.subtype)}`)
        if (s.default_input && s.default_input !== 'VALUE') opts.push(`defaultInput: ${lit(s.default_input)}`)
        const fn = INPUT_FN[type] ?? 'float'
        lines.push(type === 'GEOMETRY' ? `    const ${v} = g.input.geometry(${lit(s.name)})`
            : `    const ${v} = g.input.${fn}(${lit(s.name)}${opts.length ? `, {${opts.join(', ')}}` : ''})`)
    }

    const byName = new Map(t.nodes.map(n => [n.name, n]))
    const incoming = new Map<string, {from: [string, string], to: [string, string]}[]>()
    for (const l of t.links) {
        if (l.muted) continue
        const k = l.to[0]
        if (!incoming.has(k)) incoming.set(k, [])
        incoming.get(k)!.push(l)
    }
    const nodeVar = new Map<string, string>()
    const outputKey = (node: NodeJSON, socket: string): string => {
        const def = getNodeType(node.type)!
        const d = new NodeInstance(node, def).decl.outputs.find(o => o.identifier === socket)
        return dslKey(d ? d.identifier : socket)
    }
    // Group sockets are addressed by interface name: the DSL gives rebuilt groups new identifiers.
    const groupSocketKey = (node: NodeJSON, identifier: string): string => {
        const s = library[node.group!].interface.filter(isInterfaceSocket).find(i => i.identifier === identifier)
        if (!s) throw new Error(`toCode: group ${node.group} has no socket ${identifier}`)
        return dslKey(s.name)
    }
    // Repeat zones print as `g.repeatZone({...}, iterations)` and `zone.output({...})`, items addressed by name.
    const zoneItems = (input: NodeJSON): {identifier: string, name: string, type: string}[] => {
        const out = byName.get(input.pairedOutput ?? '')
        return (out?.items?.repeat_items ?? []).map((item, i) => ({
            identifier: `Item_${typeof item.identifier === 'number' ? item.identifier : i}`, name: String(item.name ?? ''), type: String(item.socket_type),
        }))
    }
    const pairedInput = (output: NodeJSON) => t.nodes.find(x => (x.type === 'GeometryNodeRepeatInput' || x.type === 'GeometryNodeForeachGeometryElementInput') &&
        x.pairedOutput === output.name)
    // For Each zones print as `g.forEachElement({...})` and `zone.output({main, generated})`.
    const feItems = (output: NodeJSON | undefined, coll: 'input_items' | 'main_items' | 'generation_items', prefix: string) =>
        (output?.items?.[coll] ?? []).map((item, i) => ({
            identifier: `${prefix}_${typeof item.identifier === 'number' ? item.identifier : i}`, name: String(item.name ?? ''),
            type: String(item.socket_type), domain: item.domain === undefined ? undefined : String(item.domain),
        }))
    /** Generation items grouped as the DSL writes them: `[group index, field name | undefined]` per item. */
    const feGeneration = (output: NodeJSON) => {
        const out = new Map<string, {group: number, field?: string}>()
        let group = -1
        for (const item of feItems(output, 'generation_items', 'Generation')) {
            if (item.type === 'GEOMETRY') out.set(item.identifier, {group: ++group})
            else if (group >= 0) out.set(item.identifier, {group, field: item.name})
        }
        return out
    }
    const prop = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? `.${name}` : `[${lit(name)}]`)
    const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : lit(name))
    const expr = (from: [string, string]): string => {
        const src = byName.get(from[0])!
        if (src.type === 'NodeGroupInput') return inputVar.get(from[1])!
        if (src.type === 'GeometryNodeRepeatInput') {
            if (from[1] === 'Iteration') return `${nodeVar.get(src.name)}.iteration`
            return `${nodeVar.get(src.name)}.input${prop(zoneItems(src).find(i => i.identifier === from[1])!.name)}`
        }
        if (src.type === 'GeometryNodeRepeatOutput') {
            return `${nodeVar.get(src.name)}${prop(zoneItems(pairedInput(src)!).find(i => i.identifier === from[1])!.name)}`
        }
        if (src.type === 'GeometryNodeForeachGeometryElementInput') {
            if (from[1] === 'Index') return `${nodeVar.get(src.name)}.index`
            if (from[1] === 'Element') return `${nodeVar.get(src.name)}.element`
            const item = feItems(byName.get(src.pairedOutput ?? ''), 'input_items', 'Input').find(i => i.identifier === from[1])!
            return `${nodeVar.get(src.name)}.input${prop(item.name)}`
        }
        if (src.type === 'GeometryNodeForeachGeometryElementOutput') {
            const v = nodeVar.get(src.name)
            if (from[1] === 'Geometry') return `${v}.geometry`
            const main = feItems(src, 'main_items', 'Main').find(i => i.identifier === from[1])
            if (main) return `${v}.main${prop(main.name)}`
            const g = feGeneration(src).get(from[1])!
            return g.field === undefined ? `${v}.generated[${g.group}].geometry` : `${v}.generated[${g.group}].fields${prop(g.field)}`
        }
        if (src.type === 'NodeReroute') {
            const l = incoming.get(src.name)?.[0]
            return l ? expr(l.from) : 'undefined'
        }
        if (src.type === 'GeometryNodeGroup') return `${nodeVar.get(src.name)}.outputs.${groupSocketKey(src, from[1])}`
        return `${nodeVar.get(src.name)}.${outputKey(src, from[1])}`
    }

    // Topological order over node links.
    const done = new Set<string>()
    const ordered: NodeJSON[] = []
    const visit = (n: NodeJSON, stack: Set<string>) => {
        if (done.has(n.name)) return
        if (stack.has(n.name)) throw new Error(`cycle through ${n.name}`)
        stack.add(n.name)
        for (const l of incoming.get(n.name) ?? []) visit(byName.get(l.from[0])!, stack)
        // A zone's output comes after its input.
        if (n.type === 'GeometryNodeRepeatOutput' || n.type === 'GeometryNodeForeachGeometryElementOutput') {
            const input = pairedInput(n)
            if (input) visit(input, stack)
        }
        stack.delete(n.name)
        done.add(n.name)
        ordered.push(n)
    }
    for (const n of t.nodes) visit(n, new Set())

    for (const node of ordered) {
        if (['NodeGroupInput', 'NodeGroupOutput', 'NodeFrame', 'NodeReroute'].includes(node.type)) continue
        const v = ident(node.label && node.label !== node.name ? node.label : node.name, used)
        nodeVar.set(node.name, v)
        const args: string[] = []
        const links = incoming.get(node.name) ?? []
        if (node.type === 'GeometryNodeRepeatInput') {
            const items = zoneItems(node).map(item => {
                const l = links.find(x => x.to[1] === item.identifier)
                if (l) return `${key(item.name)}: ${expr(l.from)}`
                const value = node.inputs?.[item.identifier]
                return `${key(item.name)}: {type: ${lit(item.type)}${value !== undefined ? `, value: ${lit(value)}` : ''}}`
            })
            const it = links.find(x => x.to[1] === 'Iterations')
            const count = it ? expr(it.from) : lit(node.inputs?.Iterations ?? 1)
            lines.push(`    const ${v} = g.repeatZone({${items.join(', ')}}, ${count})`)
            continue
        }
        if (node.type === 'GeometryNodeRepeatOutput') {
            const input = pairedInput(node)!
            const items = zoneItems(input).flatMap(item => {
                const l = links.find(x => x.to[1] === item.identifier)
                return l ? [`${key(item.name)}: ${expr(l.from)}`] : []
            })
            lines.push(`    const ${v} = ${nodeVar.get(input.name)}.output({${items.join(', ')}})`)
            continue
        }
        if (node.type === 'GeometryNodeForeachGeometryElementInput') {
            const output = byName.get(node.pairedOutput ?? '')
            const parts: string[] = []
            const geo = links.find(x => x.to[1] === 'Geometry')
            parts.push(`geometry: ${geo ? expr(geo.from) : 'undefined'}`)
            const domain = output?.properties?.domain
            if (domain !== undefined && domain !== 'POINT') parts.push(`domain: ${lit(domain as JSONValue)}`)
            const sel = links.find(x => x.to[1] === 'Selection')
            if (sel) parts.push(`selection: ${expr(sel.from)}`)
            else if (node.inputs?.Selection !== undefined && node.inputs.Selection !== true) parts.push(`selection: ${lit(node.inputs.Selection)}`)
            const items = feItems(output, 'input_items', 'Input').map(item => {
                const l = links.find(x => x.to[1] === item.identifier)
                if (l) return `${key(item.name)}: ${expr(l.from)}`
                const value = node.inputs?.[item.identifier]
                return `${key(item.name)}: {type: ${lit(item.type)}${value !== undefined ? `, value: ${lit(value)}` : ''}}`
            })
            if (items.length) parts.push(`inputs: {${items.join(', ')}}`)
            lines.push(`    const ${v} = g.forEachElement({${parts.join(', ')}})`)
            continue
        }
        if (node.type === 'GeometryNodeForeachGeometryElementOutput') {
            const input = pairedInput(node)!
            const main = feItems(node, 'main_items', 'Main').flatMap(item => {
                const l = links.find(x => x.to[1] === item.identifier)
                return l ? [`${key(item.name)}: ${expr(l.from)}`] : []
            })
            const groups: string[][] = []
            const gen = feGeneration(node)
            for (const item of feItems(node, 'generation_items', 'Generation')) {
                const g = gen.get(item.identifier)
                if (!g) continue
                const l = links.find(x => x.to[1] === item.identifier)
                if (g.field === undefined) {
                    groups[g.group] = [`name: ${lit(item.name)}`]
                    if (l) groups[g.group].push(`geometry: ${expr(l.from)}`)
                } else if (l) {
                    const value = item.domain && item.domain !== 'POINT' ? `{value: ${expr(l.from)}, domain: ${lit(item.domain)}}` : expr(l.from)
                    groups[g.group].push(`fields: {${key(item.name)}: ${value}}`)
                }
            }
            // Several fields of one group merge into one `fields` object.
            const genCode = groups.map(parts => {
                const fields = parts.filter(p => p.startsWith('fields: {')).map(p => p.slice(9, -1))
                const rest = parts.filter(p => !p.startsWith('fields: {'))
                return `{${[...rest, ...(fields.length ? [`fields: {${fields.join(', ')}}`] : [])].join(', ')}}`
            })
            const args: string[] = []
            if (main.length) args.push(`main: {${main.join(', ')}}`)
            args.push(`generated: [${genCode.join(', ')}]`)
            lines.push(`    const ${v} = ${nodeVar.get(input.name)}.output({${args.join(', ')}})`)
            continue
        }
        if (node.type === 'GeometryNodeGroup') {
            for (const [k, val] of Object.entries(node.inputs ?? {})) {
                if (!links.some(l => l.to[1] === k)) args.push(`${groupSocketKey(node, k)}: ${lit(val)}`)
            }
            for (const l of links) args.push(`${groupSocketKey(node, l.to[1])}: ${expr(l.from)}`)
            lines.push(`    const ${v} = g.group(${groupVars.get(node.group!)}${args.length ? `, {${args.join(', ')}}` : ''})`)
            continue
        }
        const def = getNodeType(node.type)
        if (!def) throw new Error(`toCode: node type ${node.type} is not ported`)
        for (const [k, val] of Object.entries(node.properties ?? {})) {
            if (def.properties && !(k in def.properties)) continue
            if (JSON.stringify(def.properties?.[k]) === JSON.stringify(val)) continue
            args.push(`${dslPropertyKey(def, k)}: ${lit(val as JSONValue)}`)
        }
        if (node.mute) args.push('mute: true')
        const inst = new NodeInstance(node, def)
        for (const d of inst.decl.inputs) {
            if (!d.available) continue
            const ls = links.filter(l => l.to[1] === d.identifier)
            if (ls.length) {
                const e = ls.map(l => expr(l.from))
                args.push(`${dslKey(d.identifier)}: ${d.multiInput ? `[${e.join(', ')}]` : e[0]}`)
            } else if (node.inputs && d.identifier in node.inputs && JSON.stringify(node.inputs[d.identifier]) !== JSON.stringify(d.default)) {
                args.push(`${dslKey(d.identifier)}: ${lit(node.inputs[d.identifier])}`)
            }
        }
        lines.push(`    const ${v} = n.${dslClassName(def)}(${args.length ? `{${args.join(', ')}}` : ''})`)
    }
    const out = t.nodes.find(n => n.type === 'NodeGroupOutput')
    for (const s of sockets.filter(x => x.inOut === 'OUTPUT')) {
        const l = out && incoming.get(out.name)?.find(x => x.to[1] === s.identifier)
        if (!l) continue
        const fn = OUTPUT_FN[socketTypeFromIdname(s.socketType)] ?? 'float'
        lines.push(`    g.output.${fn}(${lit(s.name)}, ${expr(l.from)})`)
    }
    return lines.join('\n')
}

/** DSL source for `group` and every group it uses, in dependency order. */
export function toCode(library: NodeGroupLibrary, group: string): string {
    const order = groupOrder(library, group)
    const groupVars = new Map<string, string>()
    const used = new Set<string>()
    const parts: string[] = []
    for (const name of order) {
        const v = ident(name, used)
        groupVars.set(name, v)
        parts.push(`const ${v} = geometryNodes(${lit(name)}, g => {\n${treeCode(library[name], library, groupVars)}\n})`)
    }
    return parts.join('\n\n') + '\n'
}

export type {InterfaceSocketJSON}
