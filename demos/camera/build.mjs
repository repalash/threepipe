/**
 * The camera demo's build: Canon EOS 5D Mark IV + EF 24-105mm f/4L, as the realism track left it (dress-v7, 80 parts).
 *
 *     node demos/camera/build.mjs [--out tmp/demo/camera]
 *
 * Three generators, run in order (all in Node, through the modelling command API):
 *   1. `base-commands.json` - the first camera demo's 222 model commands (lens lathes, mount, eyepiece, shoe ...),
 *      taken from its session transcript (branch demo-camera, demos/camera/transcript.json, without the
 *      film-only camera/capture/reference/light commands).
 *   2. `demos/benchmark/scripts/camera-reblock.mjs` - body, grip, prism and shoe re-blocked as subdivision cages
 *      fitted to the public measurement set (16-realism.md §3.3).
 *   3. `demos/benchmark/scripts/camera-dress.mjs` - parts, grooves, shading, UVs, material presets and printed
 *      markings (§3.4-3.5).
 * Then the geometry half is replayed in a fresh Node session to time it and count what it makes; surfaces and prints
 * need a browser (their textures), so record.mjs replays the whole list in the GPU page.
 *
 * Writes <out>/camera-dress.json (the full command list record.mjs films) and <out>/build.json (metrics).
 * The reference GLB (webgi's camera.glb) is not read anywhere here.
 */
import {spawnSync} from 'node:child_process'
import {mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {NodeModellingSession} from '../../plugins/modelling-cli/dist/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'tmp/demo/camera'
mkdirSync(out, {recursive: true})

const t0 = Date.now()
// (the modelling-cli bundle sends console.log to stderr, to keep stdout clean for the MCP stdio protocol)
const node = (script, ...a) => {
    const r = spawnSync(process.execPath, [join(here, '../benchmark/scripts', script), ...a], {encoding: 'utf8'})
    if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr}`)
    return (r.stdout + '\n' + r.stderr).split('\n').filter(l => l.startsWith('{')).at(-1)
}
copyFileSync(join(here, 'base-commands.json'), join(out, 'camera-cmds.json'))
const reblock = JSON.parse(node('camera-reblock.mjs', join(out, 'camera-cmds.json'), join(out, 'camera-reblock.json')))
const dress = JSON.parse(node('camera-dress.mjs', join(out, 'camera-reblock.json'), join(out, 'camera-dress.json')))
const genMs = Date.now() - t0

// Replay the geometry in a fresh session: every command must pass, and the counts are the model's.
const geometry = JSON.parse(readFileSync(join(out, 'camera-dress-geometry.json'), 'utf8'))
const session = new NodeModellingSession()
const t1 = Date.now()
let failed = 0, commandMs = 0
for (const c of geometry) {
    const r = await session.run(c)
    commandMs += r.ms ?? 0
    if (!r.ok) { failed++; console.error('FAILED', c.op, r.error) }
}
const replayMs = Date.now() - t1
const validate = await session.run({op: 'validate', object: '*'})
const inspected = (await session.run({op: 'inspect', object: '*'})).data
const objects = Array.isArray(inspected) ? inspected : inspected.objects ?? [inspected]
await session.close()

// evaluated (after modifiers) counts; triangles are counted on the GPU page by record.mjs
const counts = {objects: objects.length, verts: 0, faces: 0}
for (const o of objects) {
    counts.verts += o.evaluated?.verts ?? o.verts ?? 0
    counts.faces += o.evaluated?.faces ?? o.faces ?? 0
}
const build = {
    generators: {reblock, dress, ms: genMs},
    geometry: {commands: geometry.length, failed, replayMs, commandMs: +commandMs.toFixed(1), validate: validate.ok ? validate.data.verdict : validate.error, ...counts},
    full: {commands: dress.commands},
}
writeFileSync(join(out, 'build.json'), JSON.stringify(build, null, 1))
console.log(JSON.stringify(build))
if (failed) process.exit(1)
