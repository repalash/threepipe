#!/usr/bin/env node
/**
 * house-walkthrough: a low-poly house built in threepipe's modelling editor through its UI only -
 * keyboard, mouse and clicks on real toolbar/menu/panel elements, driven by Playwright - once with the
 * Blender keymap and once with the Design (Figma/trackpad) keymap, from one storyboard.
 *
 * Every piece of geometry comes from a UI action. `page.evaluate` is used only to
 * - read state, to verify a step and to know where things are on screen (where a person would look:
 *   a vertex, an edge's middle, a face's centre, a gizmo handle),
 * - draw the demo overlays (cursor dot, key chips, title cards), which are not part of the editor.
 *
 * Usage:
 *   node demos/house-walkthrough/drive.mjs [--keymap blender|design|both] [--base http://127.0.0.1:9374]
 *        [--ws <playwright ws endpoint>] [--out demos/house-walkthrough] [--no-video] [--until <step id>]
 *        [--pace <multiplier>]
 *
 * Writes into --out: video-<keymap>.mp4 (H.264 from a CDP screencast, holds over 1.5 s cut; not committed), shots/<keymap>-NN-<step>.jpg,
 * run-<keymap>.json (each step: keys, checks, timings, toasts, errors) and house-<keymap>.glb (the saved
 * file, re-opened at the end).
 */

import {chromium} from 'playwright'
import {startScreencast, encodeScreencast} from '../shared/screencast.mjs'
import {mkdirSync, writeFileSync, renameSync, existsSync, rmSync, readdirSync, statSync} from 'node:fs'
import {join, resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

// ── options ──────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, def) => {
    const i = argv.indexOf('--' + name)
    if (i < 0) return def
    const v = argv[i + 1]
    return v === undefined || v.startsWith('--') ? true : v
}
const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(arg('out', here))
const BASE = String(arg('base', 'http://127.0.0.1:9374')).replace(/\/$/, '')
const WS = arg('ws', null)
const VIDEO = !argv.includes('--no-video')
const UNTIL = arg('until', null)
const PACE = Number(arg('pace', 1))
const KEYMAPS = (() => {
    const k = arg('keymap', 'both')
    return k === 'both' ? ['blender', 'design'] : [k]
})()
const URL = BASE + '/examples/modelling-editor/'
const W = 1280, H = 720

mkdirSync(join(OUT, 'shots'), {recursive: true})
const rawVideoDir = join(OUT, '.video-raw')

const sleep = ms => new Promise(r => setTimeout(r, ms * PACE))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a)

// ── demo overlays (not part of the editor): cursor dot, pressed keys, title card ────────────────
function overlayInit() {
    const css = `
    #demo-cursor { position: fixed; left: 0; top: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
        border: 2px solid #fff; background: rgba(255, 80, 60, .55); box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.5);
        pointer-events: none; z-index: 2147483647; transition: transform .08s, background .08s; }
    #demo-cursor.down { transform: scale(.7); background: rgba(255, 200, 40, .9); }
    #demo-cursor.right { background: rgba(80, 160, 255, .9); }
    #demo-cursor.middle { background: rgba(120, 255, 140, .9); }
    #demo-keys { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); display: flex; gap: 6px;
        pointer-events: none; z-index: 2147483646; }
    #demo-keys kbd { font: 600 18px/1 system-ui, sans-serif; color: #111; background: #f4f4f4; border-radius: 6px;
        padding: 7px 11px; box-shadow: 0 2px 0 #999, 0 4px 12px rgba(0,0,0,.5); opacity: 1; transition: opacity .5s; }
    #demo-keys kbd.fade { opacity: 0; }
    #demo-card { position: fixed; left: 50%; top: 52px; transform: translateX(-50%); max-width: 760px; pointer-events: none;
        z-index: 2147483645; background: rgba(18, 20, 26, .92); color: #eee; border: 1px solid #3a7bd5; border-radius: 10px;
        padding: 10px 16px; font: 15px/1.35 system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
    #demo-card .n { color: #7fb2ff; font-weight: 700; margin-right: 8px; }
    #demo-card .t { font-weight: 700; font-size: 17px; }
    #demo-card .k { margin-top: 4px; color: #ffd36b; font-family: ui-monospace, monospace; font-size: 14px; }
    #demo-card .note { margin-top: 4px; color: #aab; font-size: 13px; }
    #demo-card.finding { border-color: #e5534b; }
    #demo-card.finding .note { color: #ffb4ae; }
    #demo-card.hidden { display: none; }
    .show-code-btn, .code-preview-container { display: none !important; }`
    const install = () => {
        if (document.getElementById('demo-cursor')) return
        const st = document.createElement('style')
        st.textContent = css
        document.head.appendChild(st)
        const c = document.createElement('div'); c.id = 'demo-cursor'; document.body.appendChild(c)
        const k = document.createElement('div'); k.id = 'demo-keys'; document.body.appendChild(k)
        const card = document.createElement('div'); card.id = 'demo-card'; card.className = 'hidden'; document.body.appendChild(card)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
    else install()
    const cursor = () => document.getElementById('demo-cursor')
    addEventListener('pointermove', e => { const c = cursor(); if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' } }, true)
    addEventListener('pointerdown', e => { const c = cursor(); if (c) c.className = 'down' + (e.button === 2 ? ' right' : e.button === 1 ? ' middle' : '') }, true)
    addEventListener('pointerup', () => { const c = cursor(); if (c) c.className = '' }, true)
    const names = {Control: 'Ctrl', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Enter: 'Enter ↵', NumpadDecimal: 'Numpad .', Delete: 'Del'}
    addEventListener('keydown', e => {
        const k = document.getElementById('demo-keys')
        if (!k || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
        const parts = []
        if (e.ctrlKey) parts.push('Ctrl')
        if (e.altKey) parts.push('Alt')
        if (e.shiftKey && e.key.length !== 1) parts.push('Shift')
        else if (e.shiftKey && /[A-Z]/.test(e.key)) parts.push('Shift')
        let key = e.code.startsWith('Numpad') ? 'Numpad ' + (e.key === '.' ? '.' : e.key) : (names[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key))
        parts.push(key)
        const el = document.createElement('kbd')
        el.textContent = parts.join('+')
        k.appendChild(el)
        while (k.children.length > 8) k.firstChild.remove()
        setTimeout(() => el.classList.add('fade'), 1600)
        setTimeout(() => el.remove(), 2200)
    }, true)
    window.__demoCard = (c) => {
        const card = document.getElementById('demo-card')
        if (!card) return
        if (!c) { card.className = 'hidden'; return }
        card.className = c.finding ? 'finding' : ''
        card.innerHTML = ''
        const t = document.createElement('div')
        if (c.n) { const n = document.createElement('span'); n.className = 'n'; n.textContent = c.n; t.appendChild(n) }
        const tt = document.createElement('span'); tt.className = 't'; tt.textContent = c.title; t.appendChild(tt)
        card.appendChild(t)
        if (c.keys) { const k = document.createElement('div'); k.className = 'k'; k.textContent = c.keys; card.appendChild(k) }
        if (c.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = c.note; card.appendChild(n) }
    }
    // Toasts the editor shows, collected per step for the report.
    window.__demoToasts = []
    const seen = new WeakSet()
    const note = t => { if (!seen.has(t)) { seen.add(t); window.__demoToasts.push(t.textContent) } }
    const observe = () => new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.classList?.contains('bp5-toast')) note(n)
            else if (n.nodeType === 1) n.querySelectorAll?.('.bp5-toast').forEach(note)
        }
    }).observe(document.documentElement, {childList: true, subtree: true})
    if (document.documentElement) observe()
    else document.addEventListener('DOMContentLoaded', observe)
}

// ── page helpers: read state, find things on screen ─────────────────────────────────────────────
function installReaders() {
    const w = window
    w.__h = {
        cam() { const c = w.viewer.scene.mainCamera; c.updateMatrixWorld(); return c },
        rect() { return w.viewer.canvas.getBoundingClientRect() },
        screen(p) {
            const me = w.engine.meshEdit
            const cam = this.cam()
            const V = cam.position.constructor
            const v = new V(p[0], p[1], p[2])
            const obj = me.editObject ?? w.engine.modelObjects()[0]
            if (obj) v.applyMatrix4(obj.matrixWorld)
            const q = v.project(cam)
            const r = this.rect()
            return {x: r.left + (q.x * .5 + .5) * r.width, y: r.top + (-q.y * .5 + .5) * r.height}
        },
        bm() { return w.engine.meshEdit.state?.bm },
        verts() { return [...this.bm().verts].map(v => [v.x, v.y, v.z]) },
        edges() { return [...this.bm().edges].map(e => ({a: [e.v1.x, e.v1.y, e.v1.z], b: [e.v2.x, e.v2.y, e.v2.z], m: [(e.v1.x + e.v2.x) / 2, (e.v1.y + e.v2.y) / 2, (e.v1.z + e.v2.z) / 2]})) },
        faces() {
            return [...this.bm().faces].map(f => {
                const vs = f.verts()
                const c = [0, 1, 2].map(k => vs.reduce((s, v) => s + [v.x, v.y, v.z][k], 0) / vs.length)
                return {c, n: vs.length, sel: !!(f.hflag & 1), vs: vs.map(v => [v.x, v.y, v.z])}
            })
        },
        // the gizmo handle under a canvas point, through the plugin's own hover test
        findHandle(name) {
            const me = w.engine.meshEdit
            const r = this.rect()
            let best = null
            for (let y = 0; y < r.height; y += 3) for (let x = 0; x < r.width; x += 3) {
                if (me._pickGizmo(x, y) === name) {
                    // prefer the point farthest along the handle (its tip), away from the centre's overlaps
                    if (!best) best = {x, y, n: 0}
                    best.n++
                    best.sx = (best.sx ?? 0) + x; best.sy = (best.sy ?? 0) + y
                }
            }
            return best ? {x: r.left + best.sx / best.n, y: r.top + best.sy / best.n} : null
        },
        state() {
            const e = w.engine
            const bm = this.bm()
            return {
                mode: e.mode, selectMode: e.selectMode, tool: e.activeTool?.id ?? null, preset: e.keymap.activePreset.id,
                counts: bm ? [bm.totvert, bm.totedge, bm.totface] : null,
                sel: bm ? [bm.totvertsel, bm.totedgesel, bm.totfacesel] : null,
                modal: !!(e.meshEdit.isModal || e.propDrag),
                lastOp: e.lastOperation?.operator.id ?? null,
                lastProps: e.lastOperation?.props ?? null,
                history: e.history.entries().map(x => x.label + (x.undone ? ' *' : '')),
                objects: e.modelObjects().map(o => o.name),
                selectedObjects: e.picking.getSelectedObjects().map(o => o.name),
                status: document.querySelector('[data-status-bar]')?.innerText.replace(/\s*\n\s*/g, ' · ') ?? '',
                fileName: e.file.name, dirty: e.file.dirty,
            }
        },
    }
}

// ── the storyboard ───────────────────────────────────────────────────────────────────────────────
/** Per-keymap keys and gestures. */
const KM = {
    blender: {
        label: 'Blender keymap', welcome: 'blender', device: 'Mouse',
        edit: 'Tab', objectMode: 'Tab', selectAll: 'KeyA', deselectAll: 'Alt+KeyA', frameSel: 'NumpadDecimal', frameAll: 'Home',
        rightView: 'Numpad3', extrude: 'KeyE', inset: 'KeyI', bevel: 'Control+KeyB', knife: 'KeyK', palette: 'F3',
    },
    design: {
        label: 'Design keymap (Figma / trackpad)', welcome: 'design', device: 'Trackpad',
        edit: 'Enter', objectMode: 'Escape', selectAll: 'Control+KeyA', deselectAll: 'Control+Shift+KeyA', frameSel: 'KeyF', frameAll: 'KeyA',
        rightView: 'F2', extrude: 'Control+KeyE', inset: 'KeyI', bevel: 'Control+KeyB', knife: 'KeyK', palette: 'Control+KeyK',
    },
}
const keyLabel = k => k.replace(/Key([A-Z])/g, '$1').replace(/Digit(\d)/g, '$1').replace('Control', 'Ctrl').replace('NumpadDecimal', 'Numpad .').replace('Numpad3', 'Numpad 3')

async function runKeymap(browser, keymap) {
    const K = KM[keymap]
    const contextOpts = {viewport: {width: W, height: H}, acceptDownloads: true, deviceScaleFactor: 1}
    // The film is a CDP screencast started once the editor has loaded (see below), encoded to H.264 at the end.
    let screencast = null
    const context = await browser.newContext(contextOpts)
    await context.addInitScript(overlayInit)
    const page = await context.newPage()
    page.setDefaultTimeout(180000)
    const result = {keymap, url: URL, started: new Date().toISOString(), steps: [], errors: [], crashed: false}
    page.on('pageerror', e => result.errors.push('pageerror: ' + e.message))
    page.on('console', m => { if (m.type() === 'error') result.errors.push('console: ' + m.text().slice(0, 300)) })
    page.on('crash', () => { result.crashed = true; log('PAGE CRASHED') })

    const st = () => page.evaluate(() => window.__h.state())
    const card = (c) => page.evaluate(c => window.__demoCard(c), c)
    const press = async(k, wait = 350) => { await page.keyboard.press(k); await sleep(wait) }
    const type = async(s, wait = 300) => { await page.keyboard.type(s, {delay: 90}); await sleep(wait) }
    const moveTo = async(p, steps = 12) => { await page.mouse.move(p.x, p.y, {steps}) }
    const clickAt = async(p, opts = {}) => { await moveTo(p); await sleep(150); await page.mouse.click(p.x, p.y, opts); await sleep(300) }
    const shiftClick = async(p) => { await moveTo(p); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); await sleep(250) }
    const waitFor = async(what, pred, timeout = 60000) => {
        const end = Date.now() + timeout
        let s
        while (Date.now() < end) {
            s = await st()
            if (pred(s)) return s
            await new Promise(r => setTimeout(r, 250))
        }
        throw new Error(`timed out waiting for ${what}; state: ${JSON.stringify({counts: s?.counts, sel: s?.sel, mode: s?.mode, lastOp: s?.lastOp, tool: s?.tool, status: s?.status})}`)
    }
    const faceAt = (src) => page.evaluate(src => {
        const f = window.__h.faces().find(new Function('f', 'return ' + src))
        return f ? window.__h.screen(f.c) : null
    }, src)
    const edgesAt = (src) => page.evaluate(src => window.__h.edges().filter(new Function('e', 'return ' + src)).sort((p, q) => p.m[0] - q.m[0]).map(e => window.__h.screen(e.m)), src)
    const at = (p) => page.evaluate(p => window.__h.screen(p), p)
    const openPanel = async() => {
        const title = page.locator('.me-operator-panel .me-operator-title')
        if (await title.getAttribute('data-open') !== 'true') { await title.click(); await sleep(300) }
    }
    const panelField = async(prop, value) => {
        await openPanel()
        const f = page.locator(`.me-operator-panel #me-prop-${prop}`)
        await f.click(); await page.keyboard.press('Control+KeyA'); await type(String(value)); await press('Enter', 600)
    }
    const panelVec = async(index, value) => {
        await openPanel()
        const f = page.locator('.me-operator-panel .me-vec3 input').nth(index)
        await f.click(); await page.keyboard.press('Control+KeyA'); await type(String(value)); await press('Enter', 600)
    }
    const dragHandle = async(handle, dx, dy) => {
        const p = await page.evaluate(h => window.__h.findHandle(h), handle)
        if (!p) throw new Error('gizmo handle not found: ' + handle)
        await moveTo(p); await sleep(200)
        await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, {steps: 14}); await page.mouse.up()
        await sleep(500)
    }
    const centre = () => ({x: (W - 280) / 2 + 40, y: H / 2})

    let n = 0
    const shots = []
    const step = async(id, title, keysText, fn, opts = {}) => {
        n++
        const label = String(n).padStart(2, '0')
        const rec = {n, id, title, keys: keysText, note: opts.note ?? null, finding: opts.finding ?? null, ok: false}
        log(`${keymap} ${label} ${id}: ${title}`)
        if (result.crashed) { rec.error = 'page crashed earlier'; result.steps.push(rec); return rec }
        await page.evaluate(() => { window.__demoToasts.length = 0 })
        await card({n: label, title, keys: keysText, note: opts.note, finding: !!opts.finding})
        await sleep(opts.cardMs ?? 1400)
        const started = Date.now()
        try {
            const check = await fn()
            rec.ok = true
            if (check !== undefined) rec.check = check
        } catch (e) {
            rec.error = String(e?.message ?? e).slice(0, 600)
            log('  step failed:', rec.error)
        }
        rec.ms = Date.now() - started
        try {
            rec.state = await st()
            rec.toasts = await page.evaluate(() => [...window.__demoToasts])
            await sleep(opts.afterMs ?? 900)
            const shot = `shots/${keymap}-${label}-${id}.jpg`
            await page.screenshot({path: join(OUT, shot), type: 'jpeg', quality: 72, timeout: 120000})
            rec.shot = shot
            shots.push(shot)
        } catch (e) {
            rec.error = (rec.error ? rec.error + ' | ' : '') + 'after: ' + String(e?.message ?? e).slice(0, 300)
        }
        result.steps.push(rec)
        if (UNTIL && id === UNTIL) throw Object.assign(new Error('until ' + UNTIL), {until: true})
        return rec
    }

    try {
        log(`${keymap}: opening ${URL}`)
        await page.goto(URL, {waitUntil: 'domcontentloaded', timeout: 600000})
        await page.waitForFunction(() => window.engine?.operators.list().length > 0, null, {timeout: 600000})
        await page.evaluate(installReaders)
        result.renderer = await page.evaluate(() => {
            const gl = window.viewer.renderManager.renderer.getContext()
            const ext = gl.getExtension('WEBGL_debug_renderer_info')
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
        })
        log(`${keymap}: renderer ${result.renderer}`)
        if (VIDEO) screencast = await startScreencast(page, join(rawVideoDir, keymap))
        await sleep(1500)

        // ── 1. first run ──
        await step('welcome', 'First run: the welcome asks "Have you used Blender?"', keymap === 'blender' ? 'click: Yes, I have used Blender · Mouse' : 'click: No, or I know Figma · Trackpad', async() => {
            await page.locator('.me-welcome').waitFor({timeout: 120000})
            await sleep(1500)
            await page.locator(`[data-preset-choice="${K.welcome}"]`).hover(); await sleep(400)
            await page.locator(`[data-preset-choice="${K.welcome}"]`).click(); await sleep(1200)
            await page.locator('[data-device-choice]').getByText(K.device, {exact: true}).click(); await sleep(1800)
        }, {cardMs: 600, afterMs: 200})
        await step('move-around', 'How to move around, drawn for the preset and the device', 'click: Start modelling', async() => {
            await page.locator('[data-welcome-done]').click(); await sleep(800)
            const s = await st()
            if (s.preset !== keymap) throw new Error('preset is ' + s.preset)
            return {preset: s.preset}
        })

        // ── 2. select the cube, edit mode ──
        await step('select-cube', 'Click the cube to select it', 'click', async() => {
            const p = await page.evaluate(() => { const o = window.engine.modelObjects()[0]; const v = o.getWorldPosition(o.position.clone()).project(window.viewer.scene.mainCamera); const r = window.viewer.canvas.getBoundingClientRect(); return {x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height} })
            await clickAt(p)
            await waitFor('cube selected', s => s.selectedObjects.length === 1)
        })
        await step('edit-mode', 'Edit mode', keyLabel(K.edit), async() => {
            await press(K.edit, 800)
            const s = await waitFor('edit mode', s => s.mode === 'edit')
            return {counts: s.counts}
        })

        // ── 3. walls: scale the cube into a footprint ──
        if (keymap === 'blender') {
            await step('walls', 'Scale the cube into a house footprint: 2 wide, 1.4 deep', 'A · S X 2 ↵ · S Z 1.4 ↵', async() => {
                await moveTo(centre())
                await press(K.selectAll)
                await press('KeyS'); await press('KeyX'); await type('2'); await press('Enter', 500)
                await press('KeyS'); await press('KeyZ'); await type('1.4'); await press('Enter', 500)
                const s = await waitFor('scaled', s => JSON.stringify(s.history.filter(h => h === 'Scale').length) === '2')
                return {history: s.history.slice(-2)}
            }, {note: 'Up is Y here (the view gizmo says so); Blender users will reach for Z.'})
        } else {
            await step('walls', 'Scale with the gizmo, then type exact values in the redo panel', 'Ctrl+A · R (Scale tool) · drag the X handle · panel X = 2 ↵ · drag Z · panel Z = 1.4 ↵', async() => {
                await moveTo(centre())
                await press(K.selectAll)
                await press('KeyR', 600)
                await dragHandle('SCALE_X', 60, 0)
                await panelVec(0, 2)
                await moveTo(centre())
                await dragHandle('SCALE_Z', -40, 30)
                await panelVec(2, 1.4)
                await moveTo(centre())
                await press('KeyQ')
                const s = await st()
                return {history: s.history.slice(-2), lastProps: s.lastProps}
            }, {note: 'Typed values go in the redo panel; Enter applies them.'})
        }
        await step('frame', 'Zoom in: the wheel does nothing, so frame the selection', (keymap === 'blender' ? 'wheel ×3 · ' : 'pinch (Ctrl+wheel) ×3 · ') + keyLabel(K.frameSel), async() => {
            await moveTo(centre())
            const dist = () => page.evaluate(() => window.viewer.scene.mainCamera.controls?.getDistance?.())
            const before = await dist()
            if (keymap === 'design') await page.keyboard.down('Control')
            for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, keymap === 'blender' ? -100 : -8); await sleep(350) }
            if (keymap === 'design') await page.keyboard.up('Control')
            const afterWheel = await dist()
            await press(K.frameSel, 1500)
            return {distanceBefore: before, afterWheel, afterFrame: await dist()}
        }, {note: 'Wheel and pinch zoom are dead (three-modded OrbitControls.js:422, fix awaiting a release); there are no zoom keys or View > Zoom either. Framing is the only zoom.', finding: true})

        // ── 4. roof: two loop cuts, then lift the ridge ──
        const xEdgeTopFront = 'Math.abs(e.a[2]-0.7)<1e-3 && Math.abs(e.b[2]-0.7)<1e-3 && e.a[1]>0.4 && e.b[1]>0.4'
        const zEdgeTopLeft = 'Math.abs(e.a[0]+1)<1e-3 && Math.abs(e.b[0]+1)<1e-3 && e.a[1]>0.4 && e.b[1]>0.4 && Math.abs(e.a[2]-e.b[2])>1.3'
        const loopCut = async(edgeSrc, cuts) => {
            const [e] = await edgesAt(edgeSrc)
            if (!e) throw new Error('edge not found for loop cut')
            await moveTo({x: e.x, y: e.y + 4})
            if (keymap === 'blender') await press('Control+KeyR', 300)
            await moveTo(e, 4); await sleep(500)
            for (let i = 1; i < cuts; i++) { await page.mouse.wheel(0, -100); await sleep(450) }
            const before = (await st()).counts
            await page.mouse.down(); await sleep(150); await page.mouse.up(); await sleep(400)
            // Blender: the click cuts and starts the edge slide; a right click leaves the cut centred.
            if (keymap === 'blender') { await page.mouse.click(e.x + 8, e.y, {button: 'right'}); await sleep(400) }
            await waitFor('loop cut', s => s.counts[0] > before[0])
        }
        await step('loopcut-walls', 'Loop cut: two cuts across the front, for a door and two windows', keymap === 'blender' ? 'Ctrl+R · hover the top front edge · wheel ↑ (2 cuts) · click · right-click (keep centred)' : 'Loop Cut tool · hover the top front edge · wheel ↑ (2 cuts) · click', async() => {
            if (keymap === 'design') { await page.locator('[data-tool="mesh.loop_cut"]').click(); await sleep(500) }
            await loopCut(xEdgeTopFront, 2)
            return {counts: (await st()).counts}
        })
        await step('loopcut-ridge', 'Loop cut along the length: the roof ridge', keymap === 'blender' ? 'Ctrl+R · hover the top side edge · click · right-click' : 'hover the top side edge · click · Q (back to Select)', async() => {
            await loopCut(zEdgeTopLeft, 1)
            if (keymap === 'design') { await page.locator('[data-tool="select"]').click(); await sleep(400) }
            return {counts: (await st()).counts}
        })
        await step('ridge', 'Lift the ridge: select its three edges and move them up', keymap === 'blender' ? '2 (edges) · Alt+A · click · Shift+click ×2 · G Y 0.7 ↵' : '2 (edges) · click · Shift+click ×2 · W (Move tool) · drag the Y arrow · panel Y = 0.7 ↵', async() => {
            await press('Digit2')
            if (keymap === 'blender') await press(K.deselectAll)
            const ridge = await edgesAt('Math.abs(e.a[2])<1e-3 && Math.abs(e.b[2])<1e-3 && e.a[1]>0.4 && e.b[1]>0.4')
            if (ridge.length !== 3) throw new Error('expected 3 ridge edges, found ' + ridge.length)
            await clickAt(ridge[0]); await shiftClick(ridge[1]); await shiftClick(ridge[2])
            await waitFor('ridge selected', s => s.sel[1] === 3)
            if (keymap === 'blender') {
                await moveTo(centre())
                await press('KeyG'); await press('KeyY'); await type('0.7'); await press('Enter', 600)
            } else {
                await press('KeyW', 600)
                await dragHandle('TRANS_Y', 0, -60)
                await panelVec(1, 0.7)
                await moveTo(centre())
                await press('KeyQ')
            }
            const s = await waitFor('ridge up', s => s.lastOp === 'mesh.move' && Math.abs((s.lastProps?.value?.[1] ?? 0) - 0.7) < 1e-6)
            return {lastProps: s.lastProps}
        })
        await step('frame-all', 'Frame everything again', keyLabel(K.frameAll), async() => { await moveTo(centre()); await press(K.frameAll, 1500) })

        // ── 5. door and windows ──
        const front = (cond) => faceAt(`Math.abs(f.c[2]-0.7)<1e-3 && ${cond}`)
        await step('door', 'Door, by keys: inset the middle front face, narrow it, push it in', keymap === 'blender' ? '3 (faces) · click · I 0.1 ↵ · S X 0.6 ↵ · E -0.1 ↵' : '3 (faces) · click · I 0.1 ↵ · R · drag X · panel X = 0.6 ↵ · Ctrl+E -0.1 ↵', async() => {
            await press('Digit3')
            const p = await front('Math.abs(f.c[0])<0.1')
            await clickAt(p)
            await waitFor('door face', s => s.sel[2] === 1)
            await moveTo({x: p.x + 90, y: p.y + 60})
            await press(K.inset, 500); await type('0.1'); await press('Enter', 700)
            await waitFor('inset', s => s.lastOp === 'mesh.inset' && !s.modal)
            if (keymap === 'blender') {
                await press('KeyS'); await press('KeyX'); await type('0.6'); await press('Enter', 600)
            } else {
                await press('KeyR', 500)
                await dragHandle('SCALE_X', -30, 0)
                await panelVec(0, 0.6)
                await moveTo({x: p.x + 90, y: p.y + 60})
                await press('KeyQ')
            }
            await press(K.extrude, 500); await type('-0.1'); await press('Enter', 700)
            const s = await waitFor('door extruded', s => s.lastOp === 'mesh.extrude' && !s.modal)
            return {counts: s.counts, lastProps: s.lastProps}
        })
        await step('window-context', 'Window 1, from the right-click Face menu', 'right-click · Inset Faces · panel Thickness 0.15 ↵ · right-click · Extrude · -0.05 ↵', async() => {
            const p = await front('f.c[0]<-0.6')
            await clickAt(p)
            await clickAt(p, {button: 'right'}); await sleep(700)
            await page.locator('.me-context-menu').getByRole('menuitem', {name: /^Inset Faces/}).click(); await sleep(700)
            await panelField('thickness', 0.15)
            // the inset face stays selected: right-click it
            const q = await faceAt('f.sel')
            await clickAt(q ?? p, {button: 'right'}); await sleep(700)
            // by operator id: the Face menu now has three Extrude entries (faces, along normals, individual)
            await page.locator('.me-context-menu [data-menu-item="mesh.extrude"]').click(); await sleep(500)
            await type('-0.05'); await press('Enter', 700)
            const s = await waitFor('window 1', s => s.lastOp === 'mesh.extrude' && !s.modal)
            return {counts: s.counts}
        })
        await step('window-keys', 'Window 2, by keys', keymap === 'blender' ? 'click · I 0.15 ↵ · E -0.05 ↵' : 'click · I 0.15 ↵ · Ctrl+E -0.05 ↵', async() => {
            const p = await front('f.c[0]>0.6')
            await clickAt(p)
            await moveTo({x: p.x + 80, y: p.y + 50})
            await press(K.inset, 500); await type('0.15'); await press('Enter', 700)
            await waitFor('inset', s => s.lastOp === 'mesh.inset' && !s.modal)
            await press(K.extrude, 500); await type('-0.05'); await press('Enter', 700)
            const s = await waitFor('window 2', s => s.lastOp === 'mesh.extrude' && !s.modal)
            return {counts: s.counts}
        })

        // ── 6. side view: a window from the tool shelf, the porch with the knife ──
        await step('side-view', 'Side view, to work on the gable end', keyLabel(K.rightView) + ' · ' + keyLabel(K.frameAll), async() => {
            await moveTo(centre()); await press(K.rightView, 1500); await press(K.frameAll, 1500)
        })
        await step('window-toolbar', 'Window 3, from the tool shelf: Inset Faces, then Extrude', 'click · Inset Faces tool · drag towards the centre · Extrude tool · move · click · panel Z = -0.05 ↵', async() => {
            const p = await faceAt('Math.abs(f.c[0]-1)<1e-3 && f.c[2]<-0.1 && f.n===4')
            if (!p) throw new Error('gable face not found')
            await clickAt(p)
            await page.locator('[data-tool="mesh.inset"]').hover(); await sleep(900)
            await page.locator('[data-tool="mesh.inset"]').click(); await sleep(400)
            // Blender's tool: press in the viewport, drag towards the face's centre, release.
            await page.mouse.move(p.x + 70, p.y + 10, {steps: 12}); await sleep(300)
            await page.mouse.down(); await sleep(200)
            await page.mouse.move(p.x + 52, p.y + 8, {steps: 16}); await sleep(600)
            await page.mouse.up(); await sleep(600)
            const s1 = await waitFor('inset by tool', s => s.lastOp === 'mesh.inset' && !s.modal)
            await page.locator('[data-tool="mesh.extrude"]').click(); await sleep(400)
            await page.mouse.move(p.x + 60, p.y + 10, {steps: 6}); await sleep(200)
            await page.mouse.move(p.x + 30, p.y + 10, {steps: 12}); await sleep(500)
            await page.mouse.click(p.x + 30, p.y + 10); await sleep(600)
            const byMouse = (await waitFor('extruded by tool', s => s.lastOp === 'mesh.extrude' && !s.modal)).lastProps?.value
            // the depth the mouse gave is whatever it was: set it exactly in the redo panel
            await panelVec(2, -0.05)
            const s = await waitFor('extrude depth', s => s.lastOp === 'mesh.extrude' && Math.abs((s.lastProps?.value?.[2] ?? 0) + 0.05) < 1e-6)
            return {insetThickness: s1.lastProps?.thickness, extrudeByMouse: byMouse, extrude: s.lastProps?.value}
        })
        await step('knife-porch', 'Knife the porch outline on the gable wall', keymap === 'blender' ? 'K · click 4 points · ↵' : 'K (Knife tool) · click 4 points · ↵ · Q', async() => {
            const a = await at([1, -0.5, 0.58]), b = await at([1, -0.22, 0.58]), c = await at([1, -0.22, 0.12]), d = await at([1, -0.5, 0.12])
            await moveTo(a)
            const before = (await st()).counts
            await press(K.knife, 400)
            for (const p of [a, b, c, d]) { await clickAt(p) }
            await press('Enter', 800)
            if (keymap === 'design') await press('KeyQ')
            const s = await waitFor('knife', s => s.counts[2] > before[2] && !s.modal)
            return {before, after: s.counts}
        })
        await step('porch', 'Extrude the porch out of the wall', keymap === 'blender' ? '3 · click the new face · E 0.4 ↵' : '3 · click the new face · Ctrl+E 0.4 ↵', async() => {
            await press('Digit3')
            const p = await faceAt('Math.abs(f.c[0]-1)<1e-3 && f.c[1]<-0.3 && f.c[2]>0.2 && f.c[2]<0.5')
            if (!p) throw new Error('porch face not found')
            await clickAt(p)
            await moveTo({x: p.x - 60, y: p.y - 40})
            await press(K.extrude, 500); await type('0.4'); await press('Enter', 700)
            const s = await waitFor('porch', s => s.lastOp === 'mesh.extrude' && !s.modal)
            return {counts: s.counts}
        })

        // ── 7. back to 3/4: orbit, chimney, bevel ──
        await step('orbit-back', 'Orbit back to a three-quarter view', keymap === 'blender' ? 'middle-drag' : 'Shift + two-finger scroll', async() => {
            const c = centre()
            await moveTo(c)
            if (keymap === 'blender') {
                await page.mouse.down({button: 'middle'})
                await page.mouse.move(c.x + 150, c.y + 60, {steps: 24}); await page.mouse.up({button: 'middle'})
            } else {
                await page.keyboard.down('Shift')
                for (let i = 0; i < 30; i++) { await page.mouse.wheel(5.5, 1.1); await sleep(30) }
                await page.keyboard.up('Shift')
            }
            await sleep(600); await press(K.frameAll, 1500)
            return {camera: await page.evaluate(() => window.viewer.scene.mainCamera.position.toArray().map(n => Math.round(n * 100) / 100))}
        })
        await step('chimney', 'Chimney: inset a roof face, extrude it straight up', keymap === 'blender' ? 'click · I 0.22 ↵ · E Y 0.5 ↵' : 'click · I 0.22 ↵ · Ctrl+E Y 0.5 ↵', async() => {
            const p = await faceAt('f.c[1]>0.6 && f.c[2]>0.1 && f.c[0]>0.4')
            await clickAt(p)
            await moveTo({x: p.x + 80, y: p.y + 50})
            await press(K.inset, 500); await type('0.22'); await press('Enter', 700)
            await waitFor('inset', s => s.lastOp === 'mesh.inset' && !s.modal)
            await press(K.extrude, 400); await press('KeyY', 300); await type('0.5'); await press('Enter', 700)
            const s = await waitFor('chimney', s => s.lastOp === 'mesh.extrude' && !s.modal)
            return {counts: s.counts, lastProps: s.lastProps}
        }, {note: 'Y locks the axis while extruding: the status strip lists X / Y / Z.'})
        await step('bevel', 'Bevel the ridge, then add segments in the redo panel', '2 · click the ridge edges · Ctrl+B 0.06 ↵ · panel Segments = 3 ↵', async() => {
            await press('Digit2')
            await press(K.deselectAll)
            const ridge = await edgesAt('Math.abs(e.a[2])<1e-3 && Math.abs(e.b[2])<1e-3 && e.a[1]>1.1 && e.b[1]>1.1')
            if (!ridge.length) throw new Error('ridge edges not found')
            await clickAt(ridge[0]); for (const r of ridge.slice(1)) await shiftClick(r)
            await moveTo({x: ridge[0].x + 60, y: ridge[0].y + 80})
            await press(K.bevel, 500); await type('0.06'); await press('Enter', 800)
            await waitFor('bevel', s => s.lastOp === 'mesh.bevel' && !s.modal)
            await panelField('segments', 3)
            await moveTo(centre())
            const s = await waitFor('bevel segments', s => s.lastOp === 'mesh.bevel' && s.lastProps?.segments === 3)
            return {ridgeEdges: ridge.length, counts: s.counts, lastProps: s.lastProps}
        })

        // ── 8. undo / redo, history ──
        await step('undo-redo', 'Undo three steps, redo them, in the History tab', 'History tab · Ctrl+Z ×3 · Ctrl+Shift+Z ×3', async() => {
            await page.locator('[data-side-tab="history"]').click(); await sleep(800)
            await moveTo(centre())
            const before = (await st()).counts
            for (let i = 0; i < 3; i++) await press('Control+KeyZ', 700)
            const undone = (await st()).history.filter(h => h.endsWith('*')).length
            for (let i = 0; i < 3; i++) await press('Control+Shift+KeyZ', 700)
            const s = await waitFor('redo', s => JSON.stringify(s.counts) === JSON.stringify(before))
            await sleep(600)
            await page.locator('[data-side-tab="outliner"]').click(); await sleep(300)
            return {undone, counts: s.counts}
        })

        // ── 9. shading ──
        await step('shade-smooth', 'Shade Smooth / Flat? Search for it', `${keyLabel(K.palette)} · "smooth"`, async() => {
            await moveTo(centre())
            await press(K.palette, 600)
            await type('smooth', 900)
            const items = await page.locator('.me-palette .bp5-menu-item').allTextContents()
            await sleep(900)
            await press('Escape', 400)
            return {paletteResults: items}
        }, {note: 'No Shade Smooth/Flat operator exists (Blender: Face menu, context menu).', finding: true})

        // ── 10. object mode, save, reopen ──
        let finalCounts = null
        await step('object-mode', 'Back to Object mode', keyLabel(K.objectMode), async() => {
            finalCounts = (await st()).counts
            await moveTo(centre())
            await press(K.deselectAll, 300)
            await press(K.objectMode, 900)
            if (keymap === 'design' && (await st()).mode === 'edit') await press(K.objectMode, 900)
            await waitFor('object mode', s => s.mode === 'object')
            return {finalCounts}
        })
        const glbPath = join(OUT, `house-${keymap}.glb`)
        await step('save', 'File > Save As… house.glb', 'File menu · Save As… · name · Save', async() => {
            await page.locator('[data-menu="File"]').click(); await sleep(600)
            await page.getByRole('menuitem', {name: 'Save As…'}).click(); await sleep(600)
            const input = page.locator('#dialog-prompt-text-input')
            await input.waitFor()
            await input.click(); await page.keyboard.press('Control+KeyA'); await type(`house-${keymap}`)
            const dl = page.waitForEvent('download', {timeout: 120000})
            await page.locator('[data-dialog-submit]').click()
            const d = await dl
            await d.saveAs(glbPath)
            await sleep(800)
            return {file: d.suggestedFilename(), bytes: statSync(glbPath).size}
        })
        await step('reopen', 'File > Open… the saved .glb: the house comes back editable', 'File menu · Open… · pick house.glb · Tab', async() => {
            await page.locator('[data-menu="File"]').click(); await sleep(600)
            const chooser = page.waitForEvent('filechooser', {timeout: 120000})
            await page.getByRole('menuitem', {name: 'Open…'}).click()
            const confirm = page.locator('.bp5-dialog', {hasText: 'Unsaved changes are lost'})
            await Promise.race([chooser, confirm.waitFor({timeout: 5000}).then(() => confirm.locator('[data-dialog-submit]').click()).catch(() => {})])
            await (await chooser).setFiles(glbPath)
            await waitFor('reopened', s => s.objects.length === 1 && s.fileName === `house-${keymap}`, 120000)
            await sleep(800)
            await moveTo(centre())
            await press(K.edit, 900)
            const s = await waitFor('edit reopened', s => s.mode === 'edit')
            const same = JSON.stringify(s.counts) === JSON.stringify(finalCounts)
            if (!same) throw new Error(`reopened counts ${JSON.stringify(s.counts)} differ from saved ${JSON.stringify(finalCounts)}`)
            result.roundTrip = {saved: finalCounts, reopened: s.counts, same}
            await press(K.objectMode, 800)
            if (keymap === 'design' && (await st()).mode === 'edit') await press(K.objectMode, 800)
            return result.roundTrip
        })

        // ── 11. final orbit ──
        await step('final-orbit', 'The house', keymap === 'blender' ? 'middle-drag to orbit' : 'Shift + two-finger scroll to orbit', async() => {
            await card(null)
            const c = centre()
            await moveTo(c)
            await press(K.frameAll, 1200)
            if (keymap === 'blender') {
                for (let i = 0; i < 3; i++) {
                    await page.mouse.down({button: 'middle'}); await page.mouse.move(c.x + 140, c.y, {steps: 30}); await page.mouse.up({button: 'middle'})
                    await page.mouse.move(c.x, c.y, {steps: 4})
                }
            } else {
                await page.keyboard.down('Shift')
                for (let i = 0; i < 90; i++) { await page.mouse.wheel(4.5, 0.3); await sleep(25) }
                await page.keyboard.up('Shift')
            }
            await sleep(800)
        }, {cardMs: 1200})
        result.finalCounts = finalCounts
    } catch (e) {
        if (!e.until) {
            result.fatal = String(e?.message ?? e)
            log('FATAL', result.fatal)
        }
    }
    await card(null).catch(() => {})
    result.finished = new Date().toISOString()
    result.seconds = Math.round((Date.now() - Date.parse(result.started)) / 1000)
    if (screencast) {
        try {
            const frames = await screencast.stop()
            const enc = encodeScreencast(frames, join(OUT, `video-${keymap}.mp4`), {maxHold: 1.5})
            result.video = `video-${keymap}.mp4`
            result.videoInfo = {...enc, wallSeconds: +frames.wallSeconds.toFixed(1)}
            log(`${keymap}: video ${JSON.stringify(result.videoInfo)}`)
        } catch (e) { result.videoError = String(e) }
    }
    await context.close()
    writeFileSync(join(OUT, `run-${keymap}.json`), JSON.stringify(result, null, 2))
    const failed = result.steps.filter(s => !s.ok)
    log(`${keymap}: ${result.steps.length} steps, ${failed.length} failed${failed.length ? ': ' + failed.map(s => s.id).join(', ') : ''}; final ${JSON.stringify(result.finalCounts)}; round trip ${JSON.stringify(result.roundTrip)}`)
    return result
}

// macOS (the GPU VM): full Chromium on ANGLE/Metal; elsewhere SwiftShader.
const browser = WS ? await chromium.connect(String(WS)) : await chromium.launch(process.platform === 'darwin'
    ? {channel: 'chromium', args: ['--use-angle=metal', '--hide-scrollbars']}
    : {args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
const results = []
for (const k of KEYMAPS) results.push(await runKeymap(browser, k))
await browser.close()
rmSync(rawVideoDir, {recursive: true, force: true})
const bad = results.some(r => r.fatal || r.crashed || r.steps.some(s => !s.ok))
process.exit(bad ? 1 : 0)
