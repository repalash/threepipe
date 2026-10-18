// The client side of a report, in Node: redaction (the same cases the worker checks), fingerprints and the
// toast caps, the log buffer around console and ThreeViewer.Console, and the payload and request the worker takes.
import {afterEach, describe, expect, test, vi} from 'vitest'
import {ThreeViewer} from 'threepipe'
import {
    buildRequest, checkPayload, fingerprint, formatArg, LIMITS, LogBuffer, normalizeMessage, ProblemGate, problemOf, redact,
    redactReport, ReportError, ReportPayload, sendReport, topFrame,
} from '../src'

describe('redaction', () => {
    test('the worker\'s cases', () => {
        const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlMTIz'
        const cases: [string, string][] = [
            ['GET https://cloud.threepipe.org/share/x?token=abc&x=1 404', 'GET https://cloud.threepipe.org/share/x 404'],
            ['load file:///Users/jane/Desktop/ring.glb?x=1 failed', 'load file:///Users/<user>/Desktop/ring.glb failed'],
            ['at /home/bob/dev/app.js:12:4', 'at /home/<user>/dev/app.js:12:4'],
            ['at f (http://localhost:9379/src/app.ts?t=1729:12:7)', 'at f (http://localhost:9379/src/app.ts:12:7)'],
            ['C:\\Users\\Bob\\AppData\\x.js', 'C:\\Users\\<user>\\AppData\\x.js'],
            [`auth ${jwtLike}`, 'auth <token>'],
            ['Authorization: Bearer abcdefghijkl123456', 'Authorization: Bearer <token>'],
            ['refresh_token=abcdef123456&x=1', 'refresh_token=<token>&x=1'],
            ['{"access_token":"abcdef123456"}', '{"access_token":"<token>"}'],
            ['cookie: session=abcdef123456; theme=dark', 'cookie: <token>; theme=dark'],
            ['api_key=sk_live_1234567890abcdef', 'api_key=<token>'],
            ['ghs_1234567890abcdefghij', '<token>'],
            ['key 0123456789abcdef0123456789abcdef!', 'key <token>!'],
            ['id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 kept', 'id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 kept'],
            ['password reset failed', 'password reset failed'],
            ['load logo@2x.png and env@1k.hdr', 'load logo@2x.png and env@1k.hdr'],
        ]
        for (const [input, out] of cases) expect(redact(input), input).toBe(out)
        expect(redact('mail a@b.example and Me@X.example', 'me@x.example')).toBe('mail <email> and Me@X.example')
    })

    test('a report: the text keeps links and emails and loses tokens; everything else gets the full pass', () => {
        const r = redactReport({
            type: 'bug', surface: 'modelling-editor', route: '/editor/?doc=secret#x', email: 'me@x.example',
            text: 'See https://example.com/p?x=1 and other@corp.example, key ghp_1234567890abcdefghijkl',
            cause: {kind: 'error', message: 'fetch https://a.example/x?sig=1 for other@corp.example failed', frame: 'at load (/Users/jane/app.js:1:2)'},
            environment: {'other@corp.example': 'https://a.example/?q=1'},
            context: {editor: {file: 'C:\\Users\\Jane\\a.glb', owner: 'me@x.example'}},
            log: Array.from({length: 600}, (_, i) => `${i} ` + 'x'.repeat(1200)),
        })
        expect(r.route).toBe('/editor/')
        expect(r.text).toBe('See https://example.com/p?x=1 and other@corp.example, key <token>')
        expect(r.cause).toEqual({kind: 'error', message: 'fetch https://a.example/x for <email> failed', frame: 'at load (/Users/<user>/app.js:1:2)'})
        expect(r.environment).toEqual({'<email>': 'https://a.example/'})
        expect(r.context).toEqual({editor: {file: 'C:\\Users\\<user>\\a.glb', owner: 'me@x.example'}})
        expect(r.log!.length).toBe(LIMITS.logLines)
        expect(r.log![0]).toMatch(/^100 /)
        expect(r.log![0].length).toBe(LIMITS.logLine)
    })
})

describe('problems', () => {
    test('a fingerprint names the same problem across numbers, quotes, paths and builds', () => {
        const a = problemOf('error', Object.assign(new TypeError('Cannot read properties of undefined (reading \'x\') at 12'), {stack: 'TypeError: …\n    at bevel (https://a.example/editor.js?v=1:120:7)'}))
        const b = problemOf('error', Object.assign(new TypeError('Cannot read properties of undefined (reading \'y\') at 99'), {stack: 'TypeError: …\n    at bevel (https://a.example/editor.4f3a.js:877:2)'}))
        const c = problemOf('error', Object.assign(new TypeError('Cannot read properties of undefined (reading \'x\') at 12'), {stack: 'TypeError: …\n    at extrude (https://a.example/editor.js:120:7)'}))
        expect(a.message).toBe('TypeError: Cannot read properties of undefined (reading \'x\') at 12')
        expect(a.frame).toBe('at bevel (https://a.example/editor.js:120:7)')
        expect(a.fingerprint).toBe(b.fingerprint)
        expect(a.fingerprint).not.toBe(c.fingerprint) // another function: another problem
        expect(problemOf('unhandled-rejection', 'x').fingerprint).not.toBe(problemOf('error', 'x').fingerprint)
        expect(fingerprint('operation', 'Bevel: 3 edges in /Users/a/x.glb')).toBe(fingerprint('operation', 'Bevel: 12 edges in /Users/b/y.glb'))
        expect(normalizeMessage('Load "ring.glb" failed at 3')).toBe('load failed at #')
        expect(topFrame('Error: x\n    at f (a.js:1:2)\n    at g (b.js:3:4)')).toBe('at f (a.js:1:2)')
        expect(topFrame('f@https://a.example/a.js:1:2\ng@b.js:3:4')).toBe('f@https://a.example/a.js:1:2')
        expect(problemOf('operation', {message: 'token=abcdef12345678 bad'}).message).toBe('token=<token> bad')
    })

    test('the gate: each problem is shown once, and five in a session at most', () => {
        const gate = new ProblemGate(5)
        const p = (m: string) => problemOf('error', m)
        expect(gate.admit(p('same'))).toBe(true)
        expect(gate.admit(p('same'))).toBe(false)
        for (const m of ['b', 'c', 'd', 'e']) expect(gate.admit(p(`other ${m} thing`))).toBe(true)
        expect(gate.admit(p('the sixth'))).toBe(false)
        expect(gate.shown).toBe(5)
    })
})

describe('the log buffer', () => {
    const buffers: LogBuffer[] = []
    afterEach(() => { for (const b of buffers.splice(0)) b.uninstall() })

    test('records console and ThreeViewer.Console warnings and errors, redacted, in a ring; uninstall restores', () => {
        const before = {warn: console.warn, error: console.error, tp: ThreeViewer.Console}
        const sink = vi.fn()
        console.warn = sink
        ThreeViewer.Console = {...before.tp, warn: sink, error: sink}
        const log = new LogBuffer(3)
        buffers.push(log)
        log.install()
        console.warn('loading https://a.example/x?token=1', {n: 1})
        ThreeViewer.Console.error(new Error('bad for jane@corp.example'))
        console.warn('three')
        console.warn('four')
        expect(sink).toHaveBeenCalledTimes(4) // passed on
        expect(log.lines.length).toBe(3)
        expect(log.lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} error: Error: bad for <email>/)
        expect(log.lines[2]).toMatch(/ warn: four$/)
        log.clear()
        console.warn('loading https://a.example/x?token=1', {n: 1})
        expect(log.lines[0]).toMatch(/warn: loading https:\/\/a\.example\/x \{"n":1\}$/)
        log.uninstall()
        expect(console.warn).toBe(sink)
        expect(ThreeViewer.Console.warn).toBe(sink)
        console.warn = before.warn
        ThreeViewer.Console = before.tp
    })

    test('formats what consoles get: errors, cycles, long objects', () => {
        const cyc: any = {}; cyc.self = cyc
        expect(formatArg(cyc)).toBe('[Object]')
        expect(formatArg({a: 'x'.repeat(400)}).length).toBe(301)
        expect(formatArg(Object.assign(new RangeError('r'), {stack: 'RangeError: r\n    at f (a.js:1:1)'}))).toBe('RangeError: r (at f (a.js:1:1))')
        expect(formatArg(12n as never)).toBe('12')
    })
})

describe('the payload and the request', () => {
    const base = (): ReportPayload => ({report: {type: 'bug', surface: 'modelling-editor', text: 'It broke.'}, files: []})

    test('checkPayload refuses what the worker refuses', () => {
        expect(checkPayload(base())).toBe(null)
        const p = base()
        expect(checkPayload({...p, report: {...p.report, type: 'rant' as never}})).toMatch(/type/)
        expect(checkPayload({...p, report: {...p.report, surface: 'Modelling Editor'}})).toMatch(/surface/)
        expect(checkPayload({...p, report: {...p.report, email: 'a?bcc=x@y.co'}})).toMatch(/email/)
        expect(checkPayload({...p, report: {...p.report, text: 'x'.repeat(10001)}})).toMatch(/text/)
        expect(checkPayload({...p, report: {...p.report, context: {x: 'y'.repeat(17000)}}})).toMatch(/context/)
        expect(checkPayload({...p, report: {...p.report, image: 'data:image/gif;base64,AAAA'}})).toMatch(/screenshot/)
        expect(checkPayload({...p, files: [1, 2, 3, 4].map(i => ({name: `${i}`, blob: new Blob(['x'])}))})).toMatch(/At most 3/)
        expect(checkPayload({...p, files: [{name: 'scene.glb', blob: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])}]})).toMatch(/MB together/)
    })

    test('JSON without files; multipart with `report` and the `file` parts; the key and the pass in headers', async() => {
        const json = buildRequest('https://cloud.example/', base(), {idempotencyKey: 'dialog-1234', turnstileToken: 'pass'})
        expect(json.url).toBe('https://cloud.example/reports')
        expect(json.init.headers).toEqual({'idempotency-key': 'dialog-1234', 'cf-turnstile-response': 'pass', 'content-type': 'application/json'})
        expect(JSON.parse(json.init.body as string)).toEqual(base().report)
        expect(json.init.credentials).toBe('omit')
        const multi = buildRequest('https://cloud.example', {...base(), files: [{name: 'transcript.json', blob: new Blob(['{}'])}]}, {idempotencyKey: 'dialog-1234'})
        const fd = multi.init.body as FormData
        expect(JSON.parse(fd.get('report') as string)).toEqual(base().report)
        expect((fd.getAll('file')[0] as File).name).toBe('transcript.json')
        expect((multi.init.headers as Record<string, string>)['content-type']).toBeUndefined() // the browser sets the boundary
    })

    test('sendReport: the id on success, the server\'s reason on a refusal, a clear message without an answer', async() => {
        const ok = vi.fn(async() => Response.json({id: 'R-7K3F9Q'}, {status: 201}))
        expect(await sendReport('https://c.example', base(), {idempotencyKey: 'dialog-1234', fetch: ok as never})).toEqual({id: 'R-7K3F9Q', repeat: undefined})
        const refused = vi.fn(async() => Response.json({error: 'too many reports today, try again tomorrow'}, {status: 429}))
        await expect(sendReport('https://c.example', base(), {idempotencyKey: 'dialog-1234', fetch: refused as never})).rejects.toThrow(/too many reports today/)
        const down = vi.fn(async() => { throw new TypeError('Failed to fetch') })
        const err = await sendReport('https://c.example', base(), {idempotencyKey: 'dialog-1234', fetch: down as never}).catch(e => e)
        expect(err).toBeInstanceOf(ReportError)
        expect(err.status).toBe(0)
        const bad = vi.fn()
        await expect(sendReport('https://c.example', {...base(), report: {...base().report, surface: 'X'}}, {idempotencyKey: 'k', fetch: bad as never})).rejects.toThrow(/surface/)
        expect(bad).not.toHaveBeenCalled()
    })
})
