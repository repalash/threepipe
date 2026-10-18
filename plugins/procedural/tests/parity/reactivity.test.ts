/**
 * Reactivity of the Blender assets (plan 7.2): every modifier input of every graph is perturbed (float +-10 %, int
 * +-1, bool flipped, vector components +10 %, then larger steps), the graph re-evaluated with its cache, and the
 * output hash compared.
 * Recorded per input in `reactivity.status.json` ("changes" / "no change" / "not perturbed: <why>").
 *
 * Asserted: a graph with inputs reacts to at least one of them; reverting an input restores the original output
 * exactly; a re-evaluation after one input change re-runs fewer nodes than the first evaluation. Inputs that do not
 * change the output are listed, not failed: telling "unused under these values" apart from "missed" needs Blender's
 * socket usage inference (`socket_usage_inference.cc`), which is not ported yet.
 */

import {describe, expect, it} from 'vitest'
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {AttributeStorage} from '@threepipe/mesh-kernel'
import {GeometryNodesEvaluator, GeometrySet, isInterfaceSocket, JSONValue, socketTypeFromIdname} from '../../src'
import {DumpV2, dumpTime, importBlenderDump} from '../../src/io/importBlenderDump'
import {applyModifierInputs, binResolver, geometryFromDump, sceneFromDump} from '../../src/io/geometryFromDump'
import {BUILTIN_TYPES} from '../../src/runtime/evaluator'
import {getNodeType} from '../../src/runtime/registry'
import type {NodeGroupLibrary} from '../../src/runtime/types'
import '../../src/nodes'

const ROOT = join(__dirname, '../../../../tmp/gt-5.2.2')
const assets = existsSync(ROOT) ? readdirSync(ROOT).filter(d => existsSync(join(ROOT, d, 'dump.json'))).sort() : []
const status: Record<string, Record<string, Record<string, string>>> = {}

/** FNV-1a over the bytes of every array of a geometry set (attributes by name, offsets, instance references). */
function geometryHash(g: GeometrySet | undefined): string {
    let h = 0x811c9dc5
    const bytes = (a: ArrayLike<number> & {buffer?: ArrayBufferLike, byteOffset?: number, byteLength?: number}) => {
        const u = a.buffer ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : new Uint8Array(Float64Array.from(a).buffer)
        for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193)
    }
    const text = (s: string) => {
        for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
    }
    const storage = (s: AttributeStorage) => {
        for (const layer of [...s.layers()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
            text(`${layer.name}/${layer.domain}/${layer.type}`)
            bytes(layer.data)
        }
    }
    const visit = (set: GeometrySet | undefined) => {
        if (!set) return text('none')
        if (set.mesh) { text('mesh'); bytes(set.mesh.faceOffsets); storage(set.mesh.attributes) }
        if (set.pointCloud) { text('points'); storage(set.pointCloud.attributes) }
        if (set.curves) { text('curves'); bytes(set.curves.curveOffsets); storage(set.curves.attributes) }
        if (set.instances) {
            text('instances')
            storage(set.instances.attributes)
            for (const r of set.instances.references) {
                if (r.type === 'geometry') visit(r.geometry)
                else text(`${r.type}:${r.type === 'none' ? '' : r.name}`)
            }
        }
    }
    visit(g)
    return (h >>> 0).toString(16)
}

function missingTypes(library: NodeGroupLibrary, group: string, seen = new Set<string>()): string[] {
    if (seen.has(group)) return []
    seen.add(group)
    const out: string[] = []
    for (const node of library[group].nodes) {
        if (node.type === 'GeometryNodeGroup' && node.group) out.push(...missingTypes(library, node.group, seen))
        else if (!BUILTIN_TYPES.has(node.type) && !getNodeType(node.type)) out.push(node.type)
    }
    return out
}

/**
 * Perturbed values of a modifier input, tried in order until the output changes: the +-10 % / +1 step first,
 * then larger ones (the range ends, zero, x10) for inputs whose small change crosses no threshold.
 */
function perturbations(type: string, value: JSONValue, min?: number, max?: number): JSONValue[] | string {
    const inRange = (v: number) => (min === undefined || v >= min) && (max === undefined || v <= max)
    const unique = (vs: number[]) => [...new Set(vs.filter(v => inRange(v) && v !== value))]
    switch (type) {
    case 'FLOAT': {
        const v = value as number
        return unique([v === 0 ? 0.1 : v * 1.1, v === 0 ? -0.1 : v * 0.9, ...(min !== undefined ? [min] : []), ...(max !== undefined ? [max] : []), 0, v === 0 ? 10 : v * 10])
    }
    case 'INT': {
        const v = value as number
        return unique([v + 1, v - 1, ...(min !== undefined ? [min] : []), ...(max !== undefined ? [max] : []), 0, v + 10])
    }
    case 'BOOLEAN': return [!value]
    case 'VECTOR': return [(value as number[]).map(v => (v === 0 ? 0.1 : v * 1.1)), (value as number[]).map(v => (v === 0 ? 1 : v * 10))]
    default: return `not perturbed: ${type.toLowerCase()} input`
    }
}

describe.skipIf(!assets.length)('reactivity of the Blender assets', () => {
    for (const asset of assets) {
        const dir = join(ROOT, asset)
        const dump = JSON.parse(readFileSync(join(dir, 'dump.json'), 'utf8')) as DumpV2
        const resolve = binResolver(existsSync(join(dir, 'dump.bin')) ? {'dump.bin': readFileSync(join(dir, 'dump.bin'))} : {})
        const {library} = importBlenderDump(dump)
        status[asset] = {}
        for (const object of dump.objects) {
            const m = object.modifiers.find(x => x.type === 'NODES' && x.enabled)
            if (!m || missingTypes(library, m.nodeGroup!).length || object.modifiers.filter(x => x.enabled).length !== 1) continue
            it(`${asset} / ${object.name}`, () => {
                const ev = new GeometryNodesEvaluator(library, m.nodeGroup!, {scene: sceneFromDump(dump.referenced!, resolve), selfObject: object.name, time: dumpTime(dump)})
                applyModifierInputs(ev, m.inputs ?? {})
                ev.setInputGeometry(geometryFromDump(object.input_geometry!, resolve))
                const first = ev.evaluate()
                const base = geometryHash(first.geometry)
                const firstExecuted = first.stats.executed
                const rows: Record<string, string> = {}
                let changed = 0
                for (const socket of ev.interfaceInputs.filter(isInterfaceSocket)) {
                    const type = socketTypeFromIdname(socket.socketType)
                    if (type === 'GEOMETRY') continue
                    const given = m.inputs?.[socket.identifier]
                    if (given?.type === 'ATTRIBUTE' && given.attribute_name) {
                        rows[socket.name] = `not perturbed: reads attribute "${given.attribute_name}"`
                        continue
                    }
                    const value = (given?.value ?? socket.default ?? null) as JSONValue
                    const tries = perturbations(type, value, socket.min_value, socket.max_value)
                    if (typeof tries === 'string') {
                        rows[socket.name] = tries
                        continue
                    }
                    rows[socket.name] = `no change (tried ${tries.map(t => JSON.stringify(t)).join(', ')})`
                    for (const next of tries) {
                        ev.setInput(socket.identifier, next)
                        const result = ev.evaluate()
                        if (geometryHash(result.geometry) === base) continue
                        rows[socket.name] = `changes at ${JSON.stringify(next)} (${result.stats.executed} of ${firstExecuted} nodes re-run)`
                        changed++
                        expect(result.stats.executed, `${socket.name}: the cache re-runs only what the input reaches`).toBeLessThan(firstExecuted)
                        break
                    }
                    ev.setInput(socket.identifier, value)
                    expect(geometryHash(ev.evaluate().geometry), `${socket.name}: reverting restores the output`).toBe(base)
                }
                // An object whose geometry entering the modifier is empty (Buildify's top_trim_pillar) has nothing to react with.
                const input = geometryFromDump(object.input_geometry!, resolve)
                const emptyInput = !input.mesh?.vertsNum && !input.pointCloud?.pointsNum && !input.curves?.pointsNum && !input.instances?.instancesNum
                if (emptyInput) rows['(input geometry)'] = 'empty'
                else if (Object.values(rows).some(r => !r.startsWith('not perturbed'))) expect(changed, 'reacts to at least one input').toBeGreaterThan(0)
                status[asset][object.name] = rows
                writeFileSync(join(__dirname, 'reactivity.status.json'), JSON.stringify(status, null, 1) + '\n')
            })
        }
    }
})
