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
import {compareGeometry, ExpectedGeometry, GeometryNodesEvaluator, GeometrySet} from '../../src'
import {DumpV2, importBlenderDump} from '../../src/io/importBlenderDump'
import {applyModifierInputs, BinResolver, binResolver, geometryFromDump, inlineBinRefs, sceneFromDump} from '../../src/io/geometryFromDump'
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

/** Float32 policy (plan 2.6): the smallest ulp bound the whole result meets, as for the cases. */
function parityLevel(geometry: GeometrySet, expected: ExpectedGeometry): string {
    const ulps = [0, 1, 2, 4, 16, 256].find(u => !compareGeometry(geometry, expected, {byteColor: 'srgb', ulps: u}).length)
    return ulps === 0 ? 'exact' : `pass (${ulps === undefined ? 'within 1e-5, > 256' : `<= ${ulps}`} ulp)`
}

/** Run an object's modifiers from the first nodes modifier on (the dump's input geometry is what enters it). */
function evaluateObject(dump: DumpV2, resolve: BinResolver, library: NodeGroupLibrary, name: string): GeometrySet {
    const object = dump.objects.find(o => o.name === name)!
    const enabled = object.modifiers.filter(m => m.enabled)
    const scene = sceneFromDump(dump.referenced!, resolve)
    let geometry: GeometrySet = geometryFromDump(object.input_geometry!, resolve)
    for (const m of enabled.slice(enabled.findIndex(m => m.type === 'NODES'))) {
        const ev = new GeometryNodesEvaluator(library, m.nodeGroup!, {scene, selfObject: object.name})
        applyModifierInputs(ev, m.inputs ?? {})
        ev.setInputGeometry(geometry)
        geometry = ev.evaluate().geometry ?? new GeometrySet()
    }
    return geometry
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
                const geometry = evaluateObject(dump, resolve, library, object.name)
                const expected = inlineBinRefs(object.output_geometry!, resolve)
                const diffs = compareGeometry(geometry, expected, {byteColor: 'srgb'})
                const result = diffs.length ? diffs.slice(0, 3).join(' | ') : parityLevel(geometry, expected)
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

// Bundles (`porting/blender/bundle_dump.py`, the examples' input) must evaluate to exactly what the dump evaluates to:
// they carry every evaluation input (unorm8 images decode to the same float32 bits) and nothing evaluated.
const BUNDLES = join(__dirname, '../../../../tmp/bundles')
const bundled = assets.filter(a => existsSync(join(BUNDLES, a, 'bundle.json')))
describe.skipIf(!bundled.length)('runtime bundles', () => {
    for (const asset of bundled) {
        it(asset, () => {
            const dump = JSON.parse(readFileSync(join(ROOT, asset, 'dump.json'), 'utf8')) as DumpV2
            const bundle = JSON.parse(readFileSync(join(BUNDLES, asset, 'bundle.json'), 'utf8')) as DumpV2
            expect(bundle.format).toBe('threepipe-procedural-bundle/1')
            expect(bundle.objects.every(o => !('output_geometry' in o))).toBe(true)
            const fromDump = binResolver({'dump.bin': readFileSync(join(ROOT, asset, 'dump.bin'))})
            const fromBundle = binResolver({'bundle.bin': readFileSync(join(BUNDLES, asset, 'bundle.bin'))})
            const bundleLibrary = importBlenderDump(bundle).library
            for (const object of dump.objects) {
                const level = status[asset]?.[object.name]
                if (!level || level.startsWith('skip')) continue
                const expected = inlineBinRefs(object.output_geometry!, fromDump)
                const actual = evaluateObject(bundle, fromBundle, bundleLibrary, object.name)
                expect(compareGeometry(actual, expected, {byteColor: 'srgb'}), `${asset} / ${object.name}`).toEqual([])
                expect(parityLevel(actual, expected), `${asset} / ${object.name}: same parity as from the dump`).toBe(level)
            }
        })
    }
})
