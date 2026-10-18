/**
 * Replay determinism: the same transcript, replayed twice from nothing, gives a byte-identical GLB.
 *
 * One mechanism buys regression tests, reproducible bug reports and a build file worth keeping; it
 * holds only while no command depends on `Math.random()`, the clock, or the iteration order of
 * anything unordered. The Eiffel tower build (271 commands: generators, extrude chains, live
 * modifiers, wireframe, weld, sweep, lathe, inset, solidify) is the transcript.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {describe, expect, it} from 'vitest'
import {NodeSession} from '../src/node/NodeSession'
import {parseCommands} from '@threepipe/plugin-modelling'

const TRANSCRIPT = resolve(__dirname, '../../../examples/modelling-api/builds/eiffel-tower.transcript.json')

async function replay(): Promise<{glb: Uint8Array, scene: Uint8Array, failed: string[], objects: number}> {
    const s = new NodeSession({documentId: 'eiffel'})
    const failed: string[] = []
    for (const c of parseCommands(readFileSync(TRANSCRIPT, 'utf8'))) {
        const r = await s.run(c)
        if (!r.ok) failed.push(`${c.op}: ${r.error}`)
    }
    // A model file: no viewer config, no UUIDs - what the build produced and nothing about the page.
    const model = await s.run({op: 'export', viewerConfig: false, uuids: false, includeData: true})
    const glb = Buffer.from((model.data as {base64: string}).base64, 'base64')
    // The whole scene, for the document's own UUIDs.
    const scene = await s.exportGlb()
    const objects = s.modelling.document.size
    s.dispose()
    return {glb, scene, failed, objects}
}

function gltfJson(glb: Uint8Array): any {
    const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
    return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)))
}

const hash = (x: Uint8Array) => createHash('sha256').update(x).digest('hex')

describe('replay determinism', () => {
    it('replays the Eiffel transcript twice into byte-identical model GLBs', async() => {
        const a = await replay()
        const b = await replay()
        expect(a.failed).toEqual([])
        expect(a.objects).toBeGreaterThan(10)
        expect(a.glb.byteLength).toBeGreaterThan(10000)
        expect(b.glb.byteLength).toBe(a.glb.byteLength)
        expect(hash(b.glb)).toBe(hash(a.glb))

        // With UUIDs and viewer config on, every node, material and light the document made keeps the
        // same UUID too; what still differs is the page's own scene root and default camera, which the
        // viewer creates (issues/open/threepipe-viewer-random-uuids-in-export.md).
        const ja = gltfJson(a.scene)
        const jb = gltfJson(b.scene)
        const nodeIds = (j: any) => j.nodes.map((n: any) => `${n.name}:${n.extras?.gltfUUID}`)
        const materialIds = (j: any) => j.materials.map((m: any) => m.extras?.uuid)
        const sceneRoot = (x: string) => x.startsWith('Scene:')
        expect(nodeIds(ja).filter((x: string) => !sceneRoot(x)).length).toBeGreaterThan(10)
        expect(nodeIds(jb).filter((x: string) => !sceneRoot(x))).toEqual(nodeIds(ja).filter((x: string) => !sceneRoot(x)))
        expect(materialIds(jb)).toEqual(materialIds(ja))
        // geometry, the binary chunk, is identical even in the full scene export
        const bin = (glb: Uint8Array) => glb.subarray(20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))
        expect(hash(bin(b.scene))).toBe(hash(bin(a.scene)))
    }, 300000)
})
