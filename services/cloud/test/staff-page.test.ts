// The staff page (src/staff/page.client.js) in a VM with a small fake DOM, on a fake fetch that answers as
// src/routes/staff.ts does. Adapted from ijewel-mono crm/test/page-reports.test.mjs @ 54d43285. What must hold:
// every API string is escaped; no API string lands in an attribute that runs code; the token goes in the
// Authorization header and never into a URL; status changes send the right PATCH.
import {expect, test} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'

const SCRIPT = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/staff/page.client.js'), 'utf8')
const EVIL = '<img src=x onerror=alert(1)>"\'<script>alert(2)</script>'

function evilRow(i: number) {
    return {id: `R-ABCDE${i}`, created_at: '2026-10-18T10:00:00.000Z', env: '"><svg onload=alert(3)>', type: 'bug', surface: EVIL, email: EVIL + '@x.example',
        summary: EVIL, cause: EVIL, versions: {[EVIL]: EVIL}, has_image: false, files_count: 1, files_bytes: 10, status: 'new', note: EVIL, status_by: EVIL}
}
function evilReport() {
    return {row: evilRow(1), files: [{idx: 0, name: EVIL, size: 10, state: 'done'}],
        report: {text: EVIL, email: EVIL, route: EVIL, origin: EVIL, cause: {kind: 'error', message: EVIL, frame: EVIL},
            environment: {[EVIL]: EVIL, gpu: {renderer: EVIL}}, context: {[EVIL]: [EVIL]}, log: [EVIL, "');alert(9);//"],
            request: {ray: EVIL, country: EVIL, user_agent: EVIL}}}
}

function page() {
    const nodes: Record<string, any> = {}
    const node = (id: string) => (nodes[id] ??= {id, innerHTML: '', textContent: '', hidden: false, value: ''})
    const listeners: Record<string, ((e: any) => void)[]> = {}
    const calls: {url: string, init: any}[] = []
    const store = new Map<string, string>()
    const ctx: any = {
        document: {getElementById: node, addEventListener: (t: string, f: any) => (listeners[t] ??= []).push(f), createElement: () => ({click() {}, remove() {}})},
        window: {addEventListener: (t: string, f: any) => (listeners['w:' + t] ??= []).push(f)},
        sessionStorage: {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k)},
        URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}},
        Blob, encodeURIComponent, alert() {}, confirm: () => true, setTimeout,
        fetch: async(url: string, init: any) => {
            calls.push({url, init})
            const body = url.startsWith('/staff/reports?') ? {rows: [evilRow(1), evilRow(2)], next: null}
                : init?.method === 'PATCH' ? {...evilReport(), row: {...evilRow(1), status: JSON.parse(init.body).status}}
                    : evilReport()
            return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})
        },
    }
    vm.createContext(ctx)
    vm.runInContext(SCRIPT + '\n;globalThis.__S = S; globalThis.__open = openReport; globalThis.__patch = repPatch;', ctx)
    return {ctx, nodes, listeners, calls, store}
}

const flush = () => new Promise(r => setTimeout(r, 0))

test('the list and a report escape every API string, and the token stays out of URLs', async() => {
    const p = page()
    p.store.set('threepipeStaffToken', 'tok-123-secret-abcdef')
    p.listeners['w:DOMContentLoaded'][0]({})
    await flush(); await flush()
    const list = p.nodes.list.innerHTML
    expect(list).toContain('data-open="R-ABCDE1"')
    await p.ctx.__open('R-ABCDE1')
    await flush()
    const drawer = p.nodes.drawer.innerHTML
    for (const html of [list, drawer, p.nodes.filters.innerHTML]) {
        expect(html).not.toMatch(/<script|<img|<svg/i)
        expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i) // an event handler inside a real tag
    }
    expect(drawer).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    for (const c of p.calls) {
        expect(c.url).not.toContain('tok-123')
        expect(c.init.headers.authorization).toBe('Bearer tok-123-secret-abcdef')
    }
    await p.ctx.__patch({status: 'closed'})
    const patch = p.calls.find(c => c.init?.method === 'PATCH')!
    expect(patch.url).toBe('/staff/reports/R-ABCDE1')
    expect(JSON.parse(patch.init.body)).toEqual({status: 'closed'})
})

test('an id that is not a report id opens nothing', async() => {
    const p = page()
    await p.ctx.__open('../../share/x')
    expect(p.calls.length).toBe(0)
})
