/**
 * Blender 5.2.2 dumps of the asset files (`porting/blender/dump_blend.py`, run on the maintainer's Mac into
 * `<worktree>/tmp/gt-5.2.2/<file>/`; not committed - large). Checks every dump imports: node groups,
 * modifier inputs, input/output geometry, the referenced scene. Asset parity (evaluating the modifier and
 * comparing with `output_geometry`) is in the per-asset tests once their node types are ported; this file
 * records which node types each asset still needs in `blenderDumps.status.json`.
 */
import {describe, expect, it} from 'vitest'
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {importBlenderDump, nodeTypesOf, DumpV2} from '../../src/io/importBlenderDump'
import {binResolver, geometryFromDump, inlineBinRefs, sceneFromDump} from '../../src/io/geometryFromDump'
import {getNodeType} from '../../src/runtime/registry'
import {BUILTIN_TYPES} from '../../src/runtime/evaluator'
import '../../src/nodes'

const ROOT = join(__dirname, '../../../../tmp/gt-5.2.2')
const dumps = existsSync(ROOT) ? readdirSync(ROOT).filter(d => existsSync(join(ROOT, d, 'dump.json'))).sort() : []
const status: Record<string, unknown> = {}

describe.skipIf(!dumps.length)('Blender 5.2.2 asset dumps import', () => {
    for (const name of dumps) {
        it(name, () => {
            const dir = join(ROOT, name)
            const dump = JSON.parse(readFileSync(join(dir, 'dump.json'), 'utf8')) as DumpV2
            const resolve = binResolver(existsSync(join(dir, 'dump.bin')) ? {'dump.bin': readFileSync(join(dir, 'dump.bin'))} : {})
            expect(dump.format).toBe('threepipe-procedural-dump/2')
            expect(dump.blender).toBe('5.2.2 LTS')

            const imported = importBlenderDump(dump)
            expect(imported.modifiers.length).toBeGreaterThan(0)
            for (const m of imported.modifiers) expect(imported.library[m.group], m.group).toBeDefined()
            // Every group node points at a group in the library; every link names nodes in its tree.
            for (const t of Object.values(imported.library)) {
                const names = new Set(t.nodes.map(x => x.name))
                for (const x of t.nodes) if (x.type === 'GeometryNodeGroup') expect(imported.library[x.group!], `${t.name}/${x.name}`).toBeDefined()
                for (const l of t.links) expect(names.has(l.from[0]) && names.has(l.to[0]), `${t.name}: ${l.from} -> ${l.to}`).toBe(true)
            }

            for (const o of dump.objects) {
                expect(o.input_geometry, `${o.name} input`).toBeTruthy()
                const input = geometryFromDump(o.input_geometry!, resolve)
                const output = geometryFromDump(o.output_geometry!, resolve)
                if (o.input_geometry!.mesh) expect(input.mesh!.vertsNum).toBe(o.input_geometry!.mesh.vertices)
                if (o.output_geometry!.mesh) expect(output.mesh!.vertsNum).toBe(o.output_geometry!.mesh.vertices)
                if (o.output_geometry!.instances) expect(output.instances!.instancesNum).toBe(o.output_geometry!.instances.count)
                // The comparator reads the dump with its arrays inlined.
                expect(Array.isArray(inlineBinRefs(o.output_geometry!, resolve).mesh?.attributes[0]?.values ?? [])).toBe(true)
            }
            const scene = sceneFromDump(dump.referenced!, resolve)
            for (const objName of Object.keys(dump.referenced!.objects)) expect(scene.object!(objName), objName).toBeDefined()
            for (const c of Object.keys(dump.referenced!.collections)) {
                for (const objName of scene.collection!(c)!.objects) expect(dump.referenced!.objects[objName], `${c}/${objName}`).toBeDefined()
            }

            const types = nodeTypesOf(imported.library)
            const missing = [...types].filter(([t]) => !getNodeType(t) && !BUILTIN_TYPES.has(t)).sort((a, b) => b[1] - a[1])
            status[name] = {
                groups: Object.keys(imported.library).length,
                nodes: [...types.values()].reduce((a, b) => a + b, 0),
                nodeTypes: types.size,
                missing: Object.fromEntries(missing),
                unevaluatedObjects: dump.unevaluated_objects ?? [],
            }
            writeFileSync(join(__dirname, 'blenderDumps.status.json'), JSON.stringify(status, null, 1) + '\n')
        })
    }
})
