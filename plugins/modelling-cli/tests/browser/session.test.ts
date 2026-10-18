/**
 * The headless browser session: a page with `AgentSocketPlugin`, driven through the relay. Needs
 * Chromium (Playwright's) and the built page (`npm run build:page`). Run under the shared browser lock.
 */

import {describe, expect, it, afterAll, beforeAll} from 'vitest'
import {mkdtemp, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {BrowserSession} from '../../src/browser/BrowserSession'

let s: BrowserSession
let dir: string

beforeAll(async() => {
    dir = await mkdtemp(join(tmpdir(), 'tp-browser-session-'))
    s = await BrowserSession.start({documentId: 'browser-test', width: 800, height: 600})
}, 120000)

afterAll(async() => {
    await s?.close()
})

describe('BrowserSession', () => {
    it('runs commands in the page over the agent socket', async() => {
        const r = await s.run({op: 'primitive', type: 'cube', name: 'box', size: 2})
        expect(r.ok).toBe(true)
        expect(r.documentId).toBe('browser-test')
        expect(s.relay.pages()).toHaveLength(1)
        // the page records what the agent did
        const activity = await s.page!.evaluate(() => (window as any).agentSocket.activity.map((a: any) => `${a.agent}:${a.command.op}`))
        expect(activity).toEqual(['threepipe-modelling:primitive'])
    })

    it('looks, writing the image to a file and describing it', async() => {
        const path = join(dir, 'look.jpg')
        const r = await s.run({op: 'look', highlight: {object: 'box', faces: [0]}, path})
        expect(r.ok).toBe(true)
        const data = r.data as any
        expect(data.path).toBe(path)
        expect(data.image).toBeUndefined()
        expect(data.views.map((v: any) => v.name)).toEqual(['front', 'right', 'top', 'iso'])
        expect(data.views.every((v: any) => v.inFrame.includes('box'))).toBe(true)
        expect(data.highlight).toEqual({object: 'box', faces: 1, edges: 0, verts: 0})
        const bytes = await readFile(path)
        expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])) // JPEG
        expect(bytes.length).toBeGreaterThan(2000)
    })

    it('exports the same model file twice in one session, with a render between', async() => {
        // Model files only: a full export also carries the camera, which three's OrbitControls moves by
        // an ulp on the next rendered frame (issues/open/threepipe-orbit-controls-camera-drift.md).
        await s.run({op: 'camera', position: [6, 4, 6], target: [0, 0.5, 0]})
        const a = await s.run({op: 'export', includeData: true, viewerConfig: false, uuids: false})
        await s.run({op: 'look', view: 'iso'})
        const b = await s.run({op: 'export', includeData: true, viewerConfig: false, uuids: false})
        expect((b.data as any).bytes).toBe((a.data as any).bytes)
        expect((b.data as any).base64).toBe((a.data as any).base64)
    })
})
