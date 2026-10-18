/**
 * Every ported node declaration against Blender 5.2.2's own (`geonodes-kit/coverage/nodes-5.2.2.json`: socket
 * identifiers, names, types and subtypes, defaults, hidden values, availability and RNA properties of a
 * freshly added node). Blender output, read as data.
 */
import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {NodeInstance, registeredNodeTypes} from '../../src/runtime/registry'
import {SocketDecl} from '../../src/runtime/declaration'
import {socketTypeFromIdname} from '../../src/runtime/types'
import {f32} from '../../src/blender/f32'
import '../../src/nodes'

interface InvSocket {identifier: string, name: string, type: string, default: unknown, hideValue?: boolean, disabledByDefault?: boolean}
interface InvProp {identifier: string, type: string, items?: string[], default: unknown}
interface InvNode {idname: string, label: string, inputs: InvSocket[], outputs: InvSocket[], properties: InvProp[]}

const inventory = JSON.parse(readFileSync(join(__dirname, 'geonodes-kit/coverage/nodes-5.2.2.json'), 'utf8')) as {blender: string, nodes: InvNode[]}
const byId = new Map(inventory.nodes.map(x => [x.idname, x]))

/** `NodeSocketFloatDistance` → `DISTANCE`, `NodeSocketVectorEuler` → `EULER`, `NodeSocketFloat` → `NONE`. */
function subtypeOf(idname: string): string {
    const rest = idname.replace(/^NodeSocket(Float|Int|Bool|Vector|Color|Rotation|Matrix|String|Menu|Geometry|Object|Collection|Material|Image|Texture|Virtual)/, '')
    return rest ? rest.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() : 'NONE'
}

function sameDefault(a: unknown, b: unknown): boolean {
    if (a === null || a === undefined) return b === undefined || b === null || b === ''
    if (typeof a === 'number') return typeof b === 'number' ? f32(a) === f32(b) : (typeof b === 'boolean' && Number(b) === a)
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => f32(x) === f32(b[i]))
    return a === b
}

function compareSockets(kind: string, inv: InvSocket[], ours: SocketDecl[], errors: string[]): void {
    const ids = (s: {identifier: string}[]) => s.map(x => x.identifier).join(', ')
    if (ids(inv) !== ids(ours)) {
        errors.push(`${kind} identifiers: Blender [${ids(inv)}], ours [${ids(ours)}]`)
        return
    }
    inv.forEach((b, i) => {
        const o = ours[i]
        const where = `${kind} '${b.identifier}'`
        if (b.name !== o.name) errors.push(`${where} name: Blender '${b.name}', ours '${o.name}'`)
        if (socketTypeFromIdname(b.type) !== o.type) errors.push(`${where} type: Blender ${b.type}, ours ${o.type}`)
        if (subtypeOf(b.type) !== (o.subtype ?? 'NONE')) errors.push(`${where} subtype: Blender ${subtypeOf(b.type)}, ours ${o.subtype ?? 'NONE'}`)
        if (kind === 'input' && !sameDefault(b.default, o.default)) errors.push(`${where} default: Blender ${JSON.stringify(b.default)}, ours ${JSON.stringify(o.default)}`)
        if (kind === 'input' && !!b.hideValue !== !!o.hideValue) errors.push(`${where} hideValue: Blender ${!!b.hideValue}, ours ${!!o.hideValue}`)
        if (!!b.disabledByDefault === o.available) errors.push(`${where} available: Blender ${!b.disabledByDefault}, ours ${o.available}`)
    })
}

describe(`node declarations match Blender ${inventory.blender}`, () => {
    const types = registeredNodeTypes().filter(d => !d.idname.startsWith('Test'))
    for (const def of types) {
        it(def.idname, () => {
            const inv = byId.get(def.idname)
            if (!inv) {
                // Interface-driven nodes (group input/output, groups) have no fixed declaration.
                expect(['NodeGroupInput', 'NodeGroupOutput', 'GeometryNodeGroup', 'NodeReroute', 'NodeFrame']).toContain(def.idname)
                return
            }
            const errors: string[] = []
            if (inv.label !== def.label) errors.push(`label: Blender '${inv.label}', ours '${def.label}'`)
            const inst = new NodeInstance({name: 'n', type: def.idname, properties: {}}, def)
            compareSockets('input', inv.inputs, inst.decl.inputs, errors)
            compareSockets('output', inv.outputs, inst.decl.outputs, errors)
            for (const p of inv.properties) {
                // Struct pointers (`texture_mapping`, `color_mapping`: shader-editor mapping the geometry multi-functions
                // never read; `color_ramp`, `mapping`: carried as `colorRamp`/`curveMapping`; `paired_output`, `node_tree`:
                // `pairedOutput`/`group`) and item collections (carried as `items`) are not RNA values.
                if (p.type === 'POINTER' || p.type === 'COLLECTION') continue
                if (!def.properties || !(p.identifier in def.properties)) {
                    errors.push(`property '${p.identifier}' (${p.type}, default ${JSON.stringify(p.default)}) is not declared`)
                    continue
                }
                // The inventory records no default for array properties (`vector`, `rotation_euler`, ...).
                if (p.default !== undefined && !sameDefault(p.default, def.properties[p.identifier])) {
                    errors.push(`property '${p.identifier}' default: Blender ${JSON.stringify(p.default)}, ours ${JSON.stringify(def.properties[p.identifier])}`)
                }
                // The inventory lists an enum's static items; nodes filter them with an item function
                // (e.g. generic_attribute_type_supported), so ours must be an ordered subset holding the default.
                const ours = def.enums?.[p.identifier]
                if (p.items && ours) {
                    let i = 0
                    for (const item of ours) {
                        while (i < p.items.length && p.items[i] !== item) i++
                        if (i++ >= p.items.length) errors.push(`property '${p.identifier}' item '${item}' is not a Blender item or is out of order`)
                    }
                    if (!ours.includes(p.default as string)) errors.push(`property '${p.identifier}': default ${p.default} not in items`)
                }
                if (p.type === 'ENUM' && p.items?.length && !def.enums?.[p.identifier]) errors.push(`property '${p.identifier}': enum items not declared`)
            }
            expect(errors).toEqual([])
        })
    }
})
