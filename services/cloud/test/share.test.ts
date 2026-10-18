// /share and the shared files: tokens and owners, named slugs, write-once assets, ranges, markdown pages.
// The routes are the essentials of ijewel-mono services/share-worker @ 54d43285 (see src/routes/share.ts).
import {afterEach, expect, test} from 'vitest'
import {Harness, startWorker} from './harness.ts'
import {parseRange} from '../src/routes/share.ts'

let w: Harness
afterEach(async() => { const x = w; w = undefined as never; await x?.dispose() })

const PAT = 'share-token-pat-0001'
const ADMIN = 'share-token-admin-01'
async function share(files: Record<string, string | Uint8Array>, fields: Record<string, string> = {}, token: string | null = PAT) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    for (const [name, body] of Object.entries(files)) fd.append('file', new Blob([body]), name)
    const encoded = new Response(fd)
    const headers: Record<string, string> = {'content-type': encoded.headers.get('content-type')!}
    if (token) headers.authorization = `Bearer ${token}`
    const res = await w.fetch('/share', {method: 'POST', headers, body: new Uint8Array(await encoded.arrayBuffer())})
    return {status: res.status, json: await res.json() as any}
}
const get = (path: string, headers: Record<string, string> = {}) => w.fetch(path, {headers, redirect: 'manual'})
const pathOf = (u: string) => new URL(u).pathname

test('an upload needs a share token; a share gets a random slug and serves its file', async() => {
    w = await startWorker()
    expect((await share({'a.txt': 'hi'}, {}, null)).status).toBe(401)
    expect((await share({'a.txt': 'hi'}, {}, 'not-a-token-at-all-000')).status).toBe(401)
    const r = await share({'notes.txt': 'hello'})
    expect(r.status).toBe(200)
    expect(r.json.slug).toMatch(/^[0-9a-f]{10}$/)
    expect(pathOf(r.json.url)).toBe(`/${r.json.slug}/notes.txt`)
    expect(r.json.owner).toBe('pat')
    const res = await get(`/${r.json.slug}/notes.txt`)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('hello')
    // the share root redirects to its one file; the meta file is never served
    expect((await get(`/${r.json.slug}/`)).headers.get('location')).toMatch(new RegExp(`/${r.json.slug}/notes.txt$`))
    expect((await get(`/${r.json.slug}/.meta.json`)).status).toBe(404)
})

test('a named slug updates in place for its owner (and admin), not for another token; reserved names are refused', async() => {
    w = await startWorker({SHARE_TOKENS: `pat=${PAT},sam=share-token-sam-0002,admin=${ADMIN}`})
    const first = await share({'index.html': '<h1>v1</h1>', 'img/a.png': new Uint8Array([0x89, 0x50, 0x4E, 0x47])}, {slug: 'demo-page'})
    expect(first.status).toBe(200)
    expect(pathOf(first.json.url)).toBe('/demo-page/')
    expect(await (await get('/demo-page/')).text()).toBe('<h1>v1</h1>')
    expect((await get('/demo-page/img/a.png')).headers.get('content-type')).toBe('image/png')
    expect((await share({'index.html': 'x'}, {slug: 'demo-page'}, 'share-token-sam-0002')).status).toBe(403)
    expect((await share({'index.html': '<h1>v2</h1>'}, {slug: 'demo-page'})).status).toBe(200)
    expect(await (await get('/demo-page/')).text()).toBe('<h1>v2</h1>')
    expect((await share({'index.html': '<h1>v3</h1>'}, {slug: 'demo-page'}, ADMIN)).status).toBe(200)
    for (const slug of ['staff', 'reports', 'share', 'x', 'bad slug']) expect((await share({'a.txt': 'x'}, {slug})).status).toBe(400)
    expect((await share({'../evil.txt': 'x'})).status).toBe(400)
    expect((await share({'.hidden': 'x'})).status).toBe(400)
})

test('delete: the owner removes a share; others may not', async() => {
    w = await startWorker({SHARE_TOKENS: `pat=${PAT},sam=share-token-sam-0002`})
    await share({'a.txt': 'x', 'b.txt': 'y'}, {slug: 'tmp-share'})
    const del = (token: string) => w.fetch('/share/tmp-share', {method: 'DELETE', headers: {authorization: `Bearer ${token}`}})
    expect((await del('share-token-sam-0002')).status).toBe(403)
    const ok = await del(PAT)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({deleted: 'tmp-share', files: 3})
    expect((await get('/tmp-share/a.txt')).status).toBe(404)
    expect((await del(PAT)).status).toBe(404)
})

test('assets are write-once and content-addressed: the same bytes give the same URL, ranges are honoured', async() => {
    w = await startWorker()
    const video = new Uint8Array(1000).map((_, i) => i % 251)
    const a = await share({'walkthrough.mp4': video}, {asset: '1'})
    expect(a.status).toBe(200)
    const [asset] = a.json.assets
    expect(asset).toMatchObject({name: 'walkthrough.mp4', size: 1000, existed: false})
    expect(pathOf(asset.url)).toMatch(/^\/a\/[0-9a-f]{4}-[0-9a-f]{8}\/walkthrough\.mp4$/)
    const again = await share({'walkthrough.mp4': video}, {asset: '1'}, ADMIN)
    expect(again.json.assets[0]).toMatchObject({url: asset.url, existed: true})
    const full = await get(pathOf(asset.url))
    expect(full.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect((await full.arrayBuffer()).byteLength).toBe(1000)
    const part = await get(pathOf(asset.url), {range: 'bytes=10-19'})
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([...video.slice(10, 20)])
    expect((await get(pathOf(asset.url), {range: 'bytes=2000-'})).status).toBe(416)
    expect(parseRange('bytes=-100', 1000)).toEqual({offset: 900, length: 100})
    expect(parseRange('bytes=0-0,5-6', 1000)).toBe(null)
})

test('a .md file renders to a page for a browser and stays raw for curl', async() => {
    w = await startWorker()
    await share({'README.md': '# Title\n\nSome <script>alert(1)</script> text.\n'}, {slug: 'md-doc'})
    const page = await get('/md-doc/README.md', {'sec-fetch-dest': 'document'})
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'none'/)
    const body = await page.text()
    expect(body).toContain('<h1 id="title">Title')
    expect(body).toContain('<title>Title</title>')
    const raw = await get('/md-doc/README.md')
    expect(raw.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await raw.text()).toBe('# Title\n\nSome <script>alert(1)</script> text.\n')
    expect(await (await get('/md-doc/README.md?raw=1', {'sec-fetch-dest': 'document'})).text()).toContain('# Title')
})

test('the landing page, unknown paths and methods', async() => {
    w = await startWorker()
    expect(await (await get('/')).text()).toContain('threepipe-cloud')
    expect((await get('/no-such-share/x')).status).toBe(404)
    expect((await w.fetch('/something', {method: 'POST'})).status).toBe(405)
    expect((await w.fetch('/share', {method: 'GET', headers: {authorization: `Bearer ${PAT}`}})).status).toBe(405)
})
