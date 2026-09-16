/**
 * Record a real modelling session.
 *
 * Everything here goes through actual input: `page.mouse` clicks and drags on the canvas,
 * `page.keyboard` presses for the keymap. Nothing calls the plugin API to make a change happen. The
 * only thing computed in the page is *where* to click - projecting an element to screen coordinates -
 * after which the click is a real click at those pixels, and the app has no idea it did not come from
 * a hand.
 *
 * That distinction is the whole point of this recording. A script that positions primitives proves the
 * scene graph works; it does not prove the tools work.
 */

import {chromium} from 'playwright'

const OUT = '/Users/palash/Projects/threepipe/tmp/demo-recording'
const URL = 'http://127.0.0.1:9231/examples/modelling-workspace/index.html'
const W = 1280
const H = 720

const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'],
})
const context = await browser.newContext({
    viewport: {width: W, height: H},
    recordVideo: {dir: OUT, size: {width: W, height: H}},
})
const page = await context.newPage()
const errs = []
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 200)))
page.on('console', m => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 200))
})

const sleep = ms => new Promise(r => setTimeout(r, ms))

await page.goto(URL, {waitUntil: 'domcontentloaded', timeout: 60000})
await page.waitForFunction(() => window.viewer && window.viewer.scene && window.viewer.scene.environment,
    {timeout: 90000}).catch(() => {})
await sleep(6000)

// --- chrome for the recording ---------------------------------------------------------------

await page.evaluate(() => {
    for (const sel of ['#tweakpaneUiContainer', '.code-preview', '#example-code-preview', '#example-code-btn']) {
        document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
    }
    const v = window.viewer
    v.scene.setBackgroundColor?.('#5a6270')
    v.scene.backgroundIntensity = 0.6
    v.setDirty()

    // Playwright drives real input but the OS cursor is not captured, so mirror it.
    const cur = document.createElement('div')
    cur.id = 'fake-cursor'
    Object.assign(cur.style, {
        position: 'fixed', width: '16px', height: '16px', borderRadius: '50%',
        border: '2px solid #fff', background: 'rgba(255,255,255,0.35)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.6)', pointerEvents: 'none', zIndex: '9999',
        transform: 'translate(-50%,-50%)', left: '-50px', top: '-50px',
        transition: 'width .08s, height .08s, background .08s',
    })
    document.body.appendChild(cur)
    addEventListener('pointermove', e => {
        cur.style.left = e.clientX + 'px'
        cur.style.top = e.clientY + 'px'
    }, true)
    addEventListener('pointerdown', () => {
        cur.style.width = '10px'
        cur.style.height = '10px'
        cur.style.background = 'rgba(255,190,60,0.9)'
    }, true)
    addEventListener('pointerup', () => {
        cur.style.width = '16px'
        cur.style.height = '16px'
        cur.style.background = 'rgba(255,255,255,0.35)'
    }, true)

    const cap = document.createElement('div')
    cap.id = 'build-log'
    Object.assign(cap.style, {
        position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)',
        padding: '7px 16px', borderRadius: '6px', background: 'rgba(18,18,22,0.92)',
        color: '#e6e6ea', font: '13px ui-monospace, Menlo, monospace', zIndex: '20',
    })
    cap.textContent = 'ready'
    document.body.appendChild(cap)

    document.getElementById('clear')?.click()
})

const say = async (text, ms = 700) => {
    await page.evaluate(t => {
        const el = document.getElementById('build-log')
        if (el) el.textContent = t
    }, text)
    await sleep(ms)
}

/** Move the real mouse in steps, so the cursor reads as a movement rather than a teleport. */
async function glide(x, y, steps = 18) {
    await page.mouse.move(x, y, {steps})
    await sleep(90)
}

async function clickAt(x, y, opts = {}) {
    await glide(x, y)
    await page.mouse.down(opts)
    await sleep(70)
    await page.mouse.up(opts)
    await sleep(160)
}

async function dragFromTo(x1, y1, x2, y2, steps = 26) {
    await glide(x1, y1)
    await page.mouse.down()
    await sleep(110)
    await page.mouse.move(x2, y2, {steps})
    await sleep(110)
    await page.mouse.up()
    await sleep(200)
}

async function key(k, ms = 240) {
    await page.keyboard.press(k)
    await sleep(ms)
}

async function type(text, ms = 110) {
    for (const ch of text) {
        await page.keyboard.press(ch)
        await sleep(ms)
    }
}

/** Screen position of a face centre in the mesh currently being edited. */
const faceScreen = (predicate) => page.evaluate((predSrc) => {
    const pred = new Function('c', 'return (' + predSrc + ')(c)')
    const me = window.meshEdit
    if (!me?.state) return null
    const v = window.viewer
    const obj = me.editObject
    obj.updateWorldMatrix(true, false)
    const cam = v.scene.mainCamera
    const rect = v.canvas.getBoundingClientRect()
    const THREE_V = window.viewer.scene.mainCamera.position.constructor

    let best = null
    for (const f of me.state.bm.faces) {
        const vs = [...f.eachLoop()].map(l => l.v)
        const c = vs.reduce((a, x) => [a[0] + x.x, a[1] + x.y, a[2] + x.z], [0, 0, 0]).map(x => x / vs.length)
        if (!pred(c)) continue
        const p = new THREE_V(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld).project(cam)
        if (p.z > 1) continue
        const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width
        const sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height
        if (!best || p.z < best.depth) best = {x: sx, y: sy, depth: p.z}
    }
    return best
}, predicate)

/** Screen position of the selection's median, for aiming at the gizmo. */
const selectionScreen = () => page.evaluate(() => {
    const v = window.viewer
    const picking = window.picking
    const obj = picking.getSelectedObject()
    if (!obj) return null
    obj.updateWorldMatrix(true, false)
    const cam = v.scene.mainCamera
    const rect = v.canvas.getBoundingClientRect()
    const P = cam.position.constructor
    const p = new P().setFromMatrixPosition(obj.matrixWorld).project(cam)
    return {
        x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
    }
})

/**
 * Frame the current object. Camera work only - this changes nothing about the mesh. Every operation
 * that edits geometry below goes through real mouse and keyboard input.
 */
async function frame(distance = 4.2, azimuth = 0.9, elevation = 0.42) {
    await page.evaluate(({d, a, e}) => {
        const v = window.viewer
        const cam = v.scene.mainCamera
        const obj = window.picking.getSelectedObject() || window.meshEdit.editObject
        let cx = 0, cy = 0, cz = 0
        if (obj) {
            obj.updateWorldMatrix(true, false)
            const P = cam.position.constructor
            const c = new P().setFromMatrixPosition(obj.matrixWorld)
            cx = c.x; cy = c.y; cz = c.z
        }
        cam.position.set(
            cx + Math.cos(e) * Math.sin(a) * d,
            cy + Math.sin(e) * d,
            cz + Math.cos(e) * Math.cos(a) * d)
        cam.target.set(cx, cy, cz)
        cam.setDirty?.()
        v.setDirty()
    }, {d: distance, a: azimuth, e: elevation})
    await sleep(320)
}

/** Orbit the camera with a real right-drag on the canvas. */
async function orbit(dx, dy) {
    const cx = W / 2
    const cy = H / 2
    await glide(cx, cy)
    await page.mouse.down({button: 'left'})
    await page.mouse.move(cx + dx, cy + dy, {steps: 30})
    await page.mouse.up({button: 'left'})
    await sleep(260)
}

const addButton = async (name) => {
    const box = await page.locator(`[data-add="${name}"]`).boundingBox()
    await clickAt(box.x + box.width / 2, box.y + box.height / 2)
}

// =============================================================================================
// the session
// =============================================================================================

await say('Add a cube', 800)
await addButton('box')
await sleep(500)
await frame(4.2)

await say('Tab into edit mode', 1000)
await key('Tab', 700)

await say('A selects everything, S X 3 stretches it into a hull', 1600)
await key('KeyA', 500)
await key('KeyS', 400)
await key('KeyX', 350)
await type('3')
await key('Enter', 800)
await frame(7.0)

await say('S Z 1.4 for the beam', 1300)
await key('KeyS', 400)
await key('KeyZ', 350)
await type('1.4')
await key('Enter', 800)
await frame(7.4)

await say('3 for face select. Click the underside', 1400)
await key('Digit3', 600)
await frame(7.4, 2.0, -0.25)
let target = await faceScreen('c => c[1] < -0.4')
if (target) await clickAt(target.x, target.y)
await sleep(500)

await say('E 0.35 then S 0.6  ->  a keel', 1400)
await key('KeyE', 500)
await type('0.35')
await key('Enter', 700)
await key('KeyS', 400)
await type('0.6')
await key('Enter', 800)
await frame(7.4, 1.6, 0.3)

await say('Now the deck. Click the top face', 1300)
target = await faceScreen('c => c[1] > 0.4')
if (target) await clickAt(target.x, target.y)
await sleep(500)

await say('S 0.55 narrows it to the cabin footprint', 1400)
await key('KeyS', 400)
await type('0.55')
await key('Enter', 800)

await say('E 1.1 raises the cabin walls', 1300)
await key('KeyE', 500)
await type('1.1')
await key('Enter', 800)
await frame(8.0, 1.6, 0.34)

await say('S 1.5 flares the eaves out', 1300)
await key('KeyS', 400)
await type('1.5')
await key('Enter', 800)

await say('E 0.14  ->  the roof', 1200)
await key('KeyE', 500)
await type('0.14')
await key('Enter', 900)
await frame(8.4, 2.1, 0.3)

await say('Tab back to object mode', 1000)
await key('Tab', 800)

await say('Add a cylinder for a mooring post', 1200)
await addButton('cylinder')
await sleep(500)
let sel = await selectionScreen()
if (sel) await dragFromTo(sel.x, sel.y, sel.x + 150, sel.y + 40)

await say('Orbit around the hull', 1100)
await orbit(260, -30)
await sleep(350)
await orbit(-420, 55)
await sleep(400)

await say('Every edit above was a real click or keypress', 2200)

const summary = await page.evaluate(() => ({
    objects: window.viewer.scene.modelRoot.children.filter(c => c.assetType !== 'widget').length,
    editing: window.meshEdit.isEditing,
}))

console.log('SESSION:', JSON.stringify(summary))
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none')

await sleep(900)
const video = page.video()
await context.close()
await browser.close()
console.log('VIDEO:', video ? await video.path() : null)
