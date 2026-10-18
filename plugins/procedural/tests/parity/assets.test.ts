/**
 * Asset parity: each modifier object of a Blender 5.2.2 asset dump (`tmp/gt-5.2.2/<asset>/`, see
 * blenderDumps.test.ts) is evaluated here - its node group, the modifier's input values, the geometry entering
 * the modifier and the referenced scene, all from the dump - and compared with the object Blender evaluated.
 * Objects whose stacks contain node types that are not ported yet are skipped and named in
 * `assets.status.json`; nothing is approximated.
 */
import {describe, expect, it} from 'vitest'
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {compareGeometry, GeometryNodesEvaluator, GeometrySet} from '../../src'
import {DumpV2, importBlenderDump} from '../../src/io/importBlenderDump'
import {applyModifierInputs, binResolver, geometryFromDump, inlineBinRefs, sceneFromDump} from '../../src/io/geometryFromDump'
import {BUILTIN_TYPES} from '../../src/runtime/evaluator'
import {getNodeType} from '../../src/runtime/registry'
import type {NodeGroupLibrary} from '../../src/runtime/types'
import '../../src/nodes'

const ROOT = join(__dirname, '../../../../tmp/gt-5.2.2')
const assets = existsSync(ROOT) ? readdirSync(ROOT).filter(d => existsSync(join(ROOT, d, 'dump.json'))).sort() : []
const status: Record<string, Record<string, string>> = {}

/** Node types a group needs, through the groups it uses. */
function missingTypes(library: NodeGroupLibrary, group: string, seen = new Set<string>()): string[] {
    if (seen.has(group)) return []
    seen.add(group)
    const out = new Set<string>()
    for (const node of library[group].nodes) {
        if (node.type === 'GeometryNodeGroup' && node.group) missingTypes(library, node.group, seen).forEach(t => out.add(t))
        else if (!BUILTIN_TYPES.has(node.type) && !getNodeType(node.type)) out.add(node.type)
    }
    return [...out].sort()
}

describe.skipIf(!assets.length)('Blender 5.2.2 assets', () => {
    for (const asset of assets) {
        const dir = join(ROOT, asset)
        const dump = JSON.parse(readFileSync(join(dir, 'dump.json'), 'utf8')) as DumpV2
        const resolve = binResolver(existsSync(join(dir, 'dump.bin')) ? {'dump.bin': readFileSync(join(dir, 'dump.bin'))} : {})
        const {library} = importBlenderDump(dump)
        status[asset] = {}
        for (const object of dump.objects) {
            // The dump's input geometry already went through everything before the first nodes modifier.
            const enabled = object.modifiers.filter(m => m.enabled)
            const nodes = enabled.slice(enabled.findIndex(m => m.type === 'NODES'))
            const other = nodes.filter(m => m.type !== 'NODES')
            const missing = nodes.filter(m => m.type === 'NODES').flatMap(m => missingTypes(library, m.nodeGroup!))
            const reason = other.length ? `non-node modifiers: ${other.map(m => m.type).join(', ')}`
                : missing.length ? `not ported: ${[...new Set(missing)].join(', ')}` : ''
            if (reason) {
                status[asset][object.name] = `skip (${reason})`
                it.skip(`${asset} / ${object.name} (${reason})`, () => undefined)
                continue
            }
            it(`${asset} / ${object.name}`, () => {
                const scene = sceneFromDump(dump.referenced!, resolve)
                let geometry: GeometrySet = geometryFromDump(object.input_geometry!, resolve)
                for (const m of nodes) {
                    const ev = new GeometryNodesEvaluator(library, m.nodeGroup!, {scene, selfObject: object.name})
                    applyModifierInputs(ev, m.inputs ?? {})
                    ev.setInputGeometry(geometry)
                    geometry = ev.evaluate().geometry ?? new GeometrySet()
                }
                const diffs = compareGeometry(geometry, inlineBinRefs(object.output_geometry!, resolve), {byteColor: 'srgb'})
                let result = diffs.length ? diffs.slice(0, 3).join(' | ') : 'pass'
                if (!diffs.length) {
                    // Float32 policy (plan 2.6): the smallest ulp bound the whole result meets, as for the cases.
                    const expected = inlineBinRefs(object.output_geometry!, resolve)
                    const ulps = [0, 1, 2, 4, 16, 256].find(u => !compareGeometry(geometry, expected, {byteColor: 'srgb', ulps: u}).length)
                    result = ulps === 0 ? 'exact' : `pass (${ulps === undefined ? 'within 1e-5, > 256' : `<= ${ulps}`} ulp)`
                }
                status[asset][object.name] = result
                writeFileSync(join(__dirname, 'assets.status.json'), JSON.stringify(status, null, 1) + '\n')
                expect(diffs, `${asset} / ${object.name}`).toEqual([])
            })
        }
    }
    it('writes the status file', () => {
        writeFileSync(join(__dirname, 'assets.status.json'), JSON.stringify(status, null, 1) + '\n')
    })
})
