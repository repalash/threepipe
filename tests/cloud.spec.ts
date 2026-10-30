import {expect, test} from '@playwright/test'
import {setupTestHooks} from './helpers'

setupTestHooks()

// ─── threepipe-cloud (plugins/cloud + services/cloud) ───────────────────────────

test('cloud-feedback', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Cloud Feedback')
    // A local threepipe-cloud worker (services/cloud, `wrangler dev --local`: workerd with a local D1 and R2), on a
    // free port with its own store, started through the package's dev script. Turnstile's test secret passes offline.
    const {spawn} = await import('node:child_process')
    const net = await import('node:net')
    const fs = await import('node:fs')
    const port = await new Promise<number>(resolve => {
        const srv = net.createServer().listen(0, '127.0.0.1', () => { const p = (srv.address() as any).port; srv.close(() => resolve(p)) })
    })
    const persist = fs.mkdtempSync('/tmp/threepipe-cloud-e2e-')
    const worker = spawn('npm', ['run', 'dev', '--prefix', 'services/cloud'], {env: {...process.env, PORT: String(port), PERSIST: persist}, detached: true, stdio: ['ignore', 'pipe', 'pipe']})
    let out = ''
    worker.stdout!.on('data', d => (out += d))
    worker.stderr!.on('data', d => (out += d))
    const cloud = `http://127.0.0.1:${port}`
    const staff = async(path: string) => {
        const res = await fetch(cloud + '/staff' + path, {headers: {authorization: 'Bearer dev-staff-token-local'}})
        return res.headers.get('content-type')?.includes('json') ? res.json() : new Uint8Array(await res.arrayBuffer())
    }
    // Until the worker answers; its output goes into the error (a poll's `message` is read once, before the server
    // has written anything).
    const workerReady = async() => {
        const t0 = Date.now()
        for (;;) {
            if (worker.exitCode !== null || worker.signalCode !== null) throw new Error(`the cloud worker exited (${worker.exitCode ?? worker.signalCode}) before answering on ${cloud}:\n${out}`)
            if ((await fetch(cloud + '/').catch(() => null))?.status === 200) return
            if (Date.now() - t0 > 90000) throw new Error(`the cloud worker did not answer on ${cloud} in 90 s:\n${out}`)
            await new Promise(r => setTimeout(r, 250))
        }
    }
    try {
        await workerReady()

        // Turnstile's script comes from Cloudflare; here a stub answers as the test site key does (a pass at once).
        await page.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({contentType: 'text/javascript', body:
            `window.turnstile = {render(el, o) { el.textContent = 'Turnstile (stub)'; setTimeout(() => o.callback('XXXX.DUMMY.TOKEN.XXXX'), 50); return 'w1' }, reset() {}, remove() {}}`}))
        await page.goto(`${page.url().split('?')[0]}?cloud=${encodeURIComponent(cloud)}`)
        await page.waitForFunction(() => (window as any).cloud?.feedback, null, {timeout: 60000})

        // Something for the log: a warning with a token in a URL and someone else's email, which must not leave the page.
        await page.evaluate(() => console.warn('fetch https://api.example.com/x?token=SECRET123456 for someone@corp.example failed'))

        // The page's button opens the dialog; type, attach the scene, Send.
        await page.locator('#report-problem').click()
        const dialog = page.locator('[data-tpc-dialog]')
        await expect(dialog).toBeVisible()
        await expect(dialog.locator('[data-tpc-type="bug"]')).toHaveAttribute('aria-pressed', 'true')
        await dialog.locator('[data-tpc-text]').click()
        await page.keyboard.type('The cube went black. Write to me at me@example.com')
        await dialog.locator('[data-tpc-email]').click()
        await page.keyboard.type('me@example.com')
        await dialog.locator('[data-tpc-attach="scene"]').check()
        await expect(dialog.locator('[data-tpc-note="scene"]')).toHaveText(/\d+(\.\d)? (KB|MB)/)
        await expect(dialog.locator('[data-tpc-turnstile]')).toHaveText('Turnstile (stub)')
        await dialog.locator('[data-tpc-preview] summary').click()
        await expect(dialog.locator('[data-tpc-preview-json]')).toContainText('"surface": "cloud-feedback-example"')
        await expect(dialog.locator('[data-tpc-send]')).toBeEnabled()
        await dialog.locator('[data-tpc-send]').click()
        const idEl = dialog.locator('[data-tpc-id]')
        await expect(idEl).toHaveText(/^R-[0-9A-HJKMNP-TV-Z]{6}$/)
        const id = (await idEl.textContent())!
        await dialog.locator('[data-tpc-close]').click()
        await expect(dialog).toHaveCount(0)

        // What arrived: the row, the document, the screenshot and the scene, redacted.
        const got = await staff(`/reports/${id}`) as any
        expect(got.row).toMatchObject({id, type: 'bug', surface: 'cloud-feedback-example', env: 'local', email: 'me@example.com', has_image: true, files_count: 1})
        const r = got.report
        expect(r.text).toBe('The cube went black. Write to me at me@example.com')
        expect(r.versions).toMatchObject({app: '0.1.0'})
        expect(r.versions.threepipe).toMatch(/^\d+\.\d+\.\d+/)
        expect(r.log.join('\n')).toContain('fetch https://api.example.com/x for <email> failed')
        expect(JSON.stringify(r)).not.toContain('SECRET123456')
        expect(JSON.stringify(r)).not.toContain('someone@corp.example')
        expect(r.environment.webgl.renderer).toBeTruthy()
        expect(r.environment.plugins).toContain('ThreepipeCloudPlugin')
        expect(r.context.app).toMatchObject({objects: 1, selected: 'Cube'})
        expect(got.files.map((f: any) => [f.name, f.state])).toEqual([['scene.glb', 'done']])
        const image = await staff(`/reports/${id}/image`) as Uint8Array
        expect([image[0], image[1]]).toEqual([0xFF, 0xD8]) // a JPEG
        const glb = await staff(`/reports/${id}/files/0`) as Uint8Array
        expect(new TextDecoder().decode(glb.slice(0, 4))).toBe('glTF')

        // An uncaught error: the plugin's own toast says so once, and its Report opens the dialog about it.
        await page.evaluate(() => { setTimeout(() => { throw new Error('boom in step 12') }) })
        const toast = page.locator('[data-tpc-toast]', {hasText: 'Something went wrong: boom in step 12'})
        await expect(toast).toBeVisible()
        await toast.getByRole('button', {name: 'Report'}).click()
        await expect(dialog.locator('[data-tpc-cause]')).toHaveText('About: boom in step 12')
        await dialog.locator('[data-tpc-text]').click()
        await page.keyboard.type('It happened after I clicked around.')
        await dialog.locator('[data-tpc-send]').click()
        await expect(dialog.locator('[data-tpc-id]')).toHaveText(/^R-/)
        const id2 = (await dialog.locator('[data-tpc-id]').textContent())!
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        const second = await staff(`/reports/${id2}`) as any
        expect(second.report.cause).toMatchObject({kind: 'error', message: 'boom in step 12'})
        expect(second.report.cause.frame).toBeTruthy()

        // Send feedback opens the idea type; Cancel closes it without sending.
        await page.locator('#send-feedback').click()
        await expect(dialog.locator('[data-tpc-type="idea"]')).toHaveAttribute('aria-pressed', 'true')
        await dialog.locator('[data-tpc-cancel]').click()
        await expect(dialog).toHaveCount(0)
        const list = await staff('/reports') as any
        expect(list.rows.map((x: any) => x.id).sort()).toEqual([id, id2].sort())
    } finally {
        try { process.kill(-worker.pid!, 'SIGTERM') } catch { /* already gone */ }
        fs.rmSync(persist, {recursive: true, force: true})
        await testInfo.attach('cloud-worker.log', {body: out, contentType: 'text/plain'})
    }
})
