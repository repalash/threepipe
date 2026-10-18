// Copied from ijewel-mono services/ops-worker/test/support.test.mjs @ 54d43285 (IJ-564), adapted: Miniflare (workerd
// with a local D1 and R2) in place of the node:sqlite and Map fakes, guests only, files sent with the report.
//
// /reports and /staff: the Turnstile gate, validation and redaction, idempotency and the caps, the Discord
// card, the files, and the staff side. siteverify and Discord are stubs (test/harness.ts).
import {afterEach, describe, expect, test} from 'vitest'
import {Harness, startWorker} from './harness.ts'
import {card, ipSender, normalizeReportId, redact, sizeLabel} from '../src/reports.ts'

let w: Harness
// A test that restarts the worker disposes the old one itself; this disposes the last one, once.
afterEach(async() => { const x = w; w = undefined as never; await x?.dispose() })

let keys = 0
interface ReportOpts {origin?: string | null, key?: string, turnstile?: string | null, ip?: string, files?: {name: string, bytes: Uint8Array}[], raw?: BodyInit, headers?: Record<string, string>}
async function report(body: Record<string, unknown> = {}, o: ReportOpts = {}) {
    const h: Record<string, string> = {...o.headers}
    const origin = o.origin === undefined ? 'https://threepipe.org' : o.origin
    if (origin) h.origin = origin
    const key = o.key === undefined ? `dialog-${++keys}` : o.key
    if (key) h['idempotency-key'] = key
    const t = o.turnstile === undefined ? 'XXXX.DUMMY.TOKEN.XXXX' : o.turnstile
    if (t) h['cf-turnstile-response'] = t
    h['cf-connecting-ip'] = o.ip || '203.0.113.9'
    const json = {type: 'bug', surface: 'modelling-editor', text: 'It shows nothing.', ...body}
    let payload: BodyInit
    if (o.raw !== undefined) payload = o.raw
    else if (o.files) {
        const fd = new FormData()
        fd.set('report', JSON.stringify(json))
        for (const f of o.files) fd.append('file', new Blob([f.bytes]), f.name)
        // Serialised here: Miniflare's fetch does not take this Node's FormData as a body.
        const encoded = new Response(fd)
        h['content-type'] = encoded.headers.get('content-type')!
        payload = new Uint8Array(await encoded.arrayBuffer())
    } else {
        h['content-type'] = 'application/json'
        payload = JSON.stringify(json)
    }
    const res = await w.fetch('/reports', {method: 'POST', headers: h, body: payload})
    return {status: res.status, json: await res.json().catch(() => null) as any, headers: res.headers}
}
async function staff(path: string, {method = 'GET', token = 'staff-token-ana-0001', body}: {method?: string, token?: string | null, body?: unknown} = {}) {
    const headers: Record<string, string> = {}
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await w.fetch(`/staff${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)})
    const ct = res.headers.get('content-type') || ''
    return {status: res.status, json: ct.includes('json') ? await res.json() as any : null, bytes: ct.includes('json') ? null : new Uint8Array(await res.arrayBuffer()), headers: res.headers}
}
const rows = () => w.sql('SELECT * FROM reports ORDER BY created_at')
const doc = async(key: string) => JSON.parse((await w.r2Text(`reports/${key}/report.json`))!)
const cards = () => w.calls.filter(c => c.url.startsWith('https://discord.com/')).map(c => JSON.parse(c.body))
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).toString('base64')
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill)

describe('intake', () => {
    test('a report with a Turnstile pass is stored, and the card carries no user text', async() => {
        w = await startWorker()
        const r = await report({email: 'Guest@Example.com', image: JPEG, cause: {kind: 'operation', message: 'Bevel failed on hull.glb at 12 edges', ext: 'glb'},
            versions: {threepipe: '0.5.3', app: '0.1.0', 'plugin-modelling': '0.1.0', bad: '<b>x</b>', 'Bad Key': '1.0'}})
        expect(r.status).toBe(201)
        expect(r.json.id).toMatch(/^R-[0-9A-HJKMNP-TV-Z]{6}$/)
        expect(r.headers.get('access-control-allow-origin')).toBe('https://threepipe.org')
        const [row] = await rows()
        expect(row).toMatchObject({id: r.json.id, email: 'guest@example.com', env: 'prod', has_image: 1, discord_state: 'sent', cause: 'operation'})
        expect(row.rate_key).toMatch(/^[0-9a-f]{32}$/)
        expect(JSON.parse(row.versions_json)).toEqual({threepipe: '0.5.3', app: '0.1.0', 'plugin-modelling': '0.1.0'})
        expect((await doc(row.key)).text).toBe('It shows nothing.')
        const keysNow = await w.r2Keys()
        expect(keysNow).toContain(`reports/${row.key}/image.jpg`)
        expect(keysNow.some(k => k.includes(r.json.id))).toBe(false) // R2 keys never use the public id

        const [c] = cards()
        expect(c.allowed_mentions).toEqual({parse: []})
        expect(c.embeds[0].title).toBe(`${r.json.id} · bug · modelling-editor`)
        const text = JSON.stringify(c)
        for (const secret of ['guest@example.com', 'Guest@Example.com', 'It shows nothing', 'Bevel failed', 'hull', '203.0.113.9']) expect(text).not.toContain(secret)
        expect(text).toContain('operation (.glb)')
        expect(text).toContain('threepipe 0.5.3 · app 0.1.0')
        expect(text).not.toContain('plugin-modelling')
    })

    test('the gate: no pass, a failed test secret, the real siteverify with another hostname or action, no secret', async() => {
        w = await startWorker()
        expect((await report({}, {turnstile: null})).status).toBe(401)
        expect(w.calls.length).toBe(0) // the test secret answers offline
        await w.dispose()

        w = await startWorker({TURNSTILE_SECRET: '2x0000000000000000000000000000000AA'})
        expect((await report()).status).toBe(403)
        await w.dispose()

        w = await startWorker({TURNSTILE_SECRET: 'real-secret', TURNSTILE_HOSTNAMES: 'threepipe.org'})
        w.stub.siteverify = {success: true, hostname: 'threepipe.org', action: 'threepipe-report'}
        expect((await report()).status).toBe(201)
        const verify = w.calls.find(c => c.url.includes('siteverify'))!
        expect(verify.body).toContain('real-secret')
        expect(verify.body).toContain('XXXX.DUMMY.TOKEN.XXXX')
        w.stub.siteverify = {success: true, hostname: 'evil.example', action: 'threepipe-report'}
        expect((await report()).status).toBe(403)
        w.stub.siteverify = {success: true, hostname: 'threepipe.org', action: 'contact-form'}
        expect((await report()).status).toBe(403)
        w.stub.siteverify = {success: false}
        expect((await report()).status).toBe(403)
        expect((await rows()).length).toBe(1)
        await w.dispose()

        w = await startWorker({TURNSTILE_SECRET: ''})
        expect((await report()).status).toBe(503)
    })

    test('the user\'s own text keeps its words, links and emails and loses tokens; every other string is redacted, keys too', async() => {
        w = await startWorker()
        await report({
            email: 'me@x.example',
            text: 'See https://example.com/page?x=1, mail me at me@x.example, key sk_live_1234567890abcdef',
            environment: {'victim@corp.example': 1, ok: 'https://threepipe.org/editor?q=secret', path: '/Users/jane/Downloads/ring.glb'},
            context: {transcript: 'loaded C:\\Users\\Jane\\Desktop\\a.glb for me@x.example'},
            log: ['GET https://api.example.com/x?token=abc 404', 'mail other@corp.example', 'me@x.example opened it'],
        })
        const [row] = await rows()
        const d = await doc(row.key)
        expect(d.text).toBe('See https://example.com/page?x=1, mail me at me@x.example, key <token>')
        expect(d.environment).toEqual({'<email>': 1, ok: 'https://threepipe.org/editor', path: '/Users/<user>/Downloads/ring.glb'})
        expect(d.context.transcript).toBe('loaded C:\\Users\\<user>\\Desktop\\a.glb for me@x.example')
        expect(d.log).toEqual(['GET https://api.example.com/x 404', 'mail <email>', 'me@x.example opened it'])
        expect(row.summary).not.toContain('1234567890abcdef')
    })

    test('validation: type, surface, image bytes, email, files, sizes, origin, Idempotency-Key, a body without Content-Length', async() => {
        w = await startWorker()
        expect((await report({type: 'rant'})).status).toBe(400)
        expect((await report({surface: 'Modelling Editor'})).status).toBe(400)
        expect((await report({image: 'data:image/jpeg;base64,' + Buffer.from('not a jpeg').toString('base64')})).json.field).toBe('image')
        expect((await report({email: 'a?bcc=evil@x.co'})).json.field).toBe('email') // no mailto: header tricks
        expect((await report({log: 'not a list'})).status).toBe(400)
        expect((await report({context: {big: 'x'.repeat(20000)}})).status).toBe(413)
        expect((await report({}, {files: Array.from({length: 4}, (_, i) => ({name: `${i}.txt`, bytes: bytes(1)}))})).json.field).toBe('files')
        expect((await report({}, {files: [{name: 'scene.glb', bytes: bytes(10 * 1024 * 1024 + 1)}]})).status).toBe(413)
        expect((await report({}, {key: ''})).status).toBe(400)
        expect((await report({}, {origin: 'https://evil.example'})).status).toBe(403)
        // A chunked body has no Content-Length; the read stops at the cap.
        const big = new ReadableStream({start(c) { for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(1024 * 1024).fill(32)); c.close() }})
        expect((await report({}, {raw: big, headers: {'content-type': 'application/json'}})).status).toBe(413)
        expect((await rows()).length).toBe(0)
        // A long log keeps its last lines, each cut to 1000 characters.
        expect((await report({log: Array.from({length: 600}, (_, i) => `line ${i} ` + 'x'.repeat(2000))})).status).toBe(201)
        const d = await doc((await rows())[0].key)
        expect(d.log.length).toBe(500)
        expect(d.log[0]).toMatch(/^line 100 /)
        expect(d.log[0].length).toBe(1000)
    })

    test('a repeated Idempotency-Key returns the same report, and only to the same sender', async() => {
        w = await startWorker()
        const a = await report({}, {key: 'dialog-same'})
        const b = await report({text: 'again'}, {key: 'dialog-same'})
        expect(b.status).toBe(200)
        expect(b.json).toEqual({id: a.json.id, repeat: true})
        expect((await report({}, {key: 'dialog-same', ip: '198.51.100.1'})).status).toBe(409)
        expect((await rows()).length).toBe(1)
    })

    test('the caps: per sender (IPv6 by /64), all reports, attached bytes', async() => {
        w = await startWorker({REPORTS_DAILY_CAP: '2', REPORTS_DAILY_CAP_ALL: '3', REPORTS_DAILY_FILE_BYTES_ALL: '150'})
        expect((await report({}, {ip: '2001:db8:1:2:aaaa::1'})).status).toBe(201)
        expect((await report({}, {ip: '2001:db8:1:2:bbbb::9'})).status).toBe(201)
        expect((await report({}, {ip: '2001:0db8:0001:0002::5'})).status).toBe(429) // the same /64 is the same sender
        expect((await report({}, {ip: '198.51.100.2', files: [{name: 'a.glb', bytes: bytes(100)}]})).status).toBe(201)
        expect((await report({}, {ip: '198.51.100.3'})).status).toBe(429) // the cap for all reports
        await w.dispose()
        w = await startWorker({REPORTS_DAILY_FILE_BYTES_ALL: '150'})
        expect((await report({}, {files: [{name: 'a.glb', bytes: bytes(100)}]})).status).toBe(201)
        const over = await report({}, {ip: '198.51.100.7', files: [{name: 'b.glb', bytes: bytes(100)}]})
        expect(over.status).toBe(429)
        expect(over.json.error).toMatch(/without the files/)
        expect((await report({}, {ip: '198.51.100.7'})).status).toBe(201) // a report without files still goes
        expect(ipSender('2001:db8::1')).toBe('2001:db8:0:0::/64')
        expect(ipSender('203.0.113.9')).toBe('203.0.113.9')
    })

    test('CORS: a preflight from an allowed or local origin, nothing for another one; other methods and paths are 404', async() => {
        w = await startWorker()
        const pre = (origin: string) => w.fetch('/reports', {method: 'OPTIONS', headers: {origin}})
        const ok = await pre('https://dev.threepipe.org')
        expect(ok.status).toBe(204)
        expect(ok.headers.get('access-control-allow-origin')).toBe('https://dev.threepipe.org')
        expect(ok.headers.get('access-control-allow-headers')).toMatch(/cf-turnstile-response/)
        expect((await pre('http://9379.threepipe.aibox.localhost')).headers.get('access-control-allow-origin')).toBe('http://9379.threepipe.aibox.localhost')
        expect((await pre('https://evil.example')).headers.get('access-control-allow-origin')).toBe(null)
        expect((await w.fetch('/reports', {method: 'GET'})).status).toBe(404)
    })

    test('a dev report is tagged, and its card says so; a failed card does not fail the report; no webhook, no card', async() => {
        w = await startWorker()
        w.stub.discordStatus = 500
        const r = await report({}, {origin: 'https://dev.threepipe.org'})
        expect(r.status).toBe(201)
        const [row] = await rows()
        expect(row.env).toBe('dev')
        expect(row.discord_state).toBe('failed')
        expect(cards()[0].embeds[0].title).toMatch(/^\[dev\] R-/)
        await w.dispose()
        w = await startWorker({DISCORD_WEBHOOK: ''})
        expect((await report()).status).toBe(201)
        expect((await rows())[0].discord_state).toBe('off')
        expect(cards().length).toBe(0)
    })

    test('files come with the report in one multipart request; staff download them under a safe name', async() => {
        w = await startWorker()
        const transcript = new TextEncoder().encode(JSON.stringify({operations: [{command: {op: 'primitive', type: 'cube'}}]}))
        const r = await report({}, {files: [{name: '../scene "final".glb', bytes: bytes(1000, 9)}, {name: 'transcript.json', bytes: transcript}]})
        expect(r.status).toBe(201)
        const [row] = await rows()
        expect(row).toMatchObject({files_count: 2, files_bytes: 1000 + transcript.byteLength})
        expect((await w.sql('SELECT idx, name, size, state FROM report_files ORDER BY idx'))).toEqual([
            // A browser's multipart encoding writes '"' in a file name as %22 (the HTML spec); Node's FormData does the same.
            {idx: 0, name: '../scene %22final%22.glb', size: 1000, state: 'done'},
            {idx: 1, name: 'transcript.json', size: transcript.byteLength, state: 'done'},
        ])
        expect((await w.r2Keys()).filter(k => k.includes('/files/'))).toEqual([
            `reports/${row.key}/files/0-_scene _22final_22.glb`, `reports/${row.key}/files/1-transcript.json`,
        ])
        const file = await staff(`/reports/${r.json.id}/files/0`)
        expect(file.status).toBe(200)
        expect(file.bytes!.byteLength).toBe(1000)
        expect(file.headers.get('content-disposition')).toBe('attachment; filename="_scene _22final_22.glb"')
        expect(file.headers.get('x-content-type-options')).toBe('nosniff')
        expect(new TextDecoder().decode((await staff(`/reports/${r.json.id}/files/1`)).bytes!)).toContain('"primitive"')
        expect(cards()[0].embeds[0].fields.find((f: any) => f.name === 'attached').value).toBe('2 files, 1 KB')
    })
})

describe('staff', () => {
    test('list, read, change status and note, delete to a tombstone; other tokens and paths get nothing', async() => {
        w = await startWorker()
        const a = await report({cause: {kind: 'error', message: 'x is undefined'}, image: JPEG, email: 'jane@acme.example'}, {files: [{name: 'scene.glb', bytes: bytes(5)}]})
        await report({type: 'idea', text: 'dark mode'}, {ip: '198.51.100.4'})
        await report({type: 'question', text: 'how?'}, {ip: '198.51.100.5'})
        expect((await staff('/reports', {token: 'wrong-token-000000000'})).status).toBe(401)
        expect((await staff('/reports', {token: null})).status).toBe(401)
        expect((await staff('/other')).status).toBe(404)
        expect((await staff('/reports/%E0%A4%A')).status).toBe(400) // a bad escape is a 400, not a 500
        expect((await staff('/reports', {method: 'POST'})).status).toBe(404)

        const list = await staff('/reports')
        expect(list.status).toBe(200)
        expect(list.json.rows.length).toBe(3)
        for (const hidden of ['rate_key', 'key', 'client_key']) expect(hidden in list.json.rows[0]).toBe(false)
        expect((await staff('/reports?type=idea')).json.rows.length).toBe(1)
        expect((await staff('/reports?q=jane@acme.example')).json.rows.length).toBe(1)
        expect((await staff(`/reports?q=${a.json.id.toLowerCase().replace('-', '')}`)).json.rows[0].id).toBe(a.json.id)
        const page = await staff('/reports?limit=2')
        expect(page.json.rows.length).toBe(2)
        expect((await staff(`/reports?limit=2&before=${encodeURIComponent(page.json.next)}`)).json.rows.length).toBe(1)

        const one = await staff(`/reports/${a.json.id}`)
        expect(one.json.report.text).toBe('It shows nothing.')
        expect(one.json.files.map((f: any) => [f.idx, f.name, f.state])).toEqual([[0, 'scene.glb', 'done']])
        const img = await staff(`/reports/${a.json.id}/image`)
        expect(img.headers.get('content-type')).toBe('image/jpeg')
        expect(img.headers.get('cache-control')).toBe('private, no-store')
        const changed = await staff(`/reports/${a.json.id}`, {method: 'PATCH', body: {status: 'in_progress', note: 'asked for the file', status_by: 'mallory'}})
        expect(changed.json.row).toMatchObject({status: 'in_progress', status_by: 'ana', note: 'asked for the file'})
        expect((await staff(`/reports/${a.json.id}`, {method: 'PATCH', body: {status: 'done'}})).status).toBe(400)
        expect((await staff(`/reports/${a.json.id}`, {method: 'PATCH', body: {status: 'closed'}, token: 'staff-token-ben-0002'})).json.row.status_by).toBe('ben')

        const rateKey = (await rows()).find(x => x.id === a.json.id).rate_key
        const del = await staff(`/reports/${a.json.id}`, {method: 'DELETE'})
        expect(del.status).toBe(200)
        const row = (await rows()).find(x => x.id === a.json.id)
        expect(row).toMatchObject({deleted_by: 'ana', email: null, summary: null, note: null, has_image: 0, rate_key: rateKey})
        expect((await w.sql('SELECT name, state FROM report_files'))).toEqual([{name: null, state: 'deleted'}])
        expect((await w.r2Keys()).some(k => k.includes(row.key))).toBe(false) // the document, the image and the file are gone
        expect((await staff('/reports')).json.rows.length).toBe(2)
        expect((await staff('/reports?deleted=1')).json.rows.length).toBe(3)
        expect((await staff(`/reports/${a.json.id}`)).json.report).toBe(null)
        expect((await staff(`/reports/${a.json.id}/files/0`)).status).toBe(404)
    })

    test('the staff page and its script are served without data and with a strict CSP', async() => {
        w = await startWorker()
        const page = await w.fetch('/staff')
        expect(page.status).toBe(200)
        expect(page.headers.get('content-security-policy')).toMatch(/script-src 'self'/)
        const htmlText = await page.text()
        expect(htmlText).toContain('<script src="/staff/page.js" defer></script>')
        const js = await w.fetch('/staff/page.js')
        expect(js.headers.get('content-type')).toMatch(/javascript/)
        expect(await js.text()).toContain('function repRow')
    })
})

describe('pure parts', () => {
    test('server-side redaction', () => {
        const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlMTIz'
        const cases: [string, string][] = [
            ['GET https://cloud.threepipe.org/share/x?token=abc&x=1 404', 'GET https://cloud.threepipe.org/share/x 404'],
            ['load file:///Users/jane/Desktop/ring.glb?x=1 failed', 'load file:///Users/<user>/Desktop/ring.glb failed'],
            ['at /home/bob/dev/app.js:12:4', 'at /home/<user>/dev/app.js:12:4'],
            ['C:\\Users\\Bob\\AppData\\x.js', 'C:\\Users\\<user>\\AppData\\x.js'],
            [`auth ${jwtLike}`, 'auth <token>'],
            ['Authorization: Bearer abcdefghijkl123456', 'Authorization: Bearer <token>'],
            ['refresh_token=abcdef123456&x=1', 'refresh_token=<token>&x=1'],
            ['{"access_token":"abcdef123456"}', '{"access_token":"<token>"}'],
            ['cookie: session=abcdef123456; theme=dark', 'cookie: <token>; theme=dark'],
            ['api_key=sk_live_1234567890abcdef', 'api_key=<token>'],
            ['ghs_1234567890abcdefghij', '<token>'],
            [`key AIza${'x'.repeat(35)}`, 'key <token>'],
            ['key 0123456789abcdef0123456789abcdef!', 'key <token>!'],
            ['id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 kept', 'id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 kept'],
            ['password reset failed', 'password reset failed'],
            ['load logo@2x.png and env@1k.hdr', 'load logo@2x.png and env@1k.hdr'],
            ['blob:http://localhost:9379/3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'blob:http://localhost:9379/3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
        ]
        for (const [input, out] of cases) expect(redact(input), input).toBe(out)
        expect(redact('mail a@b.example and me@x.example', 'me@x.example')).toBe('mail <email> and me@x.example')
    })

    test('report ids: Crockford base32, read back from what users type', () => {
        expect(normalizeReportId('r7k3f9q')).toBe('R-7K3F9Q')
        expect(normalizeReportId('R-7K3F9O')).toBe('R-7K3F90')
        expect(normalizeReportId('R 7k3-f9q')).toBe('R-7K3F9Q')
        expect(normalizeReportId('R-7K3F9U')).toBe(null)
        expect(normalizeReportId('nonsense')).toBe(null)
    })

    test('the card: sizes in B and KB, "nothing" and "log only"', () => {
        expect(sizeLabel(21)).toBe('21 B')
        expect(sizeLabel(2400)).toBe('2 KB')
        expect(sizeLabel(73400320)).toBe('73 MB')
        const row = {id: 'R-TEST01', env: 'prod', type: 'question', surface: 'examples', cause: null, ext: null,
            versions: {}, files_count: 0, files_bytes: 0, has_image: false, log_lines: 0}
        const attached = (r: typeof row) => (card({} as never, r) as any).embeds[0].fields.find((f: any) => f.name === 'attached').value
        expect(attached(row)).toBe('nothing')
        expect(attached({...row, log_lines: 12})).toBe('log only')
        expect(attached({...row, files_count: 1, files_bytes: 21})).toBe('1 file, 21 B')
    })
})
