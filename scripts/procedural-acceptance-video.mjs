#!/usr/bin/env node
/**
 * procedural-acceptance-video.mjs - a directed recording of the three geometry-nodes acceptance assets in the modelling
 * editor (`examples/procedural-editor-assets`), with metrics and screenshots, for the acceptance report.
 *
 * Usage: `npm run procedural:acceptance-video -- <base url> <out dir>` with a dev server already running
 * (`npm run vite -- --port <p>`). Meant for the GPU VM (tpvm): Chromium with `--use-angle=metal`; set
 * ACCEPTANCE_ANGLE=swiftshader to run it elsewhere. Writes `<out>/video/*.webm`, `<out>/<asset>.png`, `<out>/metrics.json`.
 *
 * Each asset: load the page (the `blendAsset` / `nodeGroup` + `modifier` commands run there), open Properties >
 * Modifiers, edit one input in the panel as a user does, turn the camera, then time a few more input changes through
 * the same `modifier update` command (eval ms, cold and warm).
 */
import {chromium} from '@playwright/test'
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const [base = 'http://127.0.0.1:9377', out = 'tmp/acceptance'] = process.argv.slice(2)
const angle = process.env.ACCEPTANCE_ANGLE || 'metal'
mkdirSync(join(out, 'video'), {recursive: true})

/** Per asset: the object, a field to edit in the panel with its new value, and inputs to time programmatically. */
const ASSETS = [
    {asset: 'terrain', object: 'terrain', field: 'Height', value: '8', title: 'Terrain - a DSL geometry-nodes group',
        timed: [{Resolution: 140}, {Resolution: 96}, {Seed: 12}, {Seed: 0}]},
    {asset: 'buildify', object: 'building_base', field: 'Max number of floors', value: '12', title: 'Buildify 1.0 - building_base (Blender file)',
        timed: [{Input_6: 8, Input_7: 12}, {Input_6: 4, Input_7: 6}, {Input_3: 4}, {Input_3: 3}]},
    {asset: 'flowers', object: 'EN-ground_plane_NEW', field: 'Flower Density', value: '0.4', title: 'Flower field - flower_scattering.blend',
        timed: [{Input_17: 3}, {Input_17: 0}, {Input_5: 2}, {Input_5: 3}]},
]

const browser = await chromium.launch({
    channel: 'chromium',
    args: angle === 'metal' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({viewport: {width: 1280, height: 720}, recordVideo: {dir: join(out, 'video'), size: {width: 1280, height: 720}}})
const page = await context.newPage()
const metrics = {renderer: '', assets: {}}

/** A caption over the editor (the directed part of the video). */
const caption = (text) => page.evaluate(t => {
    let el = document.getElementById('acceptance-caption')
    if (!el) {
        el = document.createElement('div')
        el.id = 'acceptance-caption'
        el.style.cssText = 'position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:9999;padding:8px 16px;'
            + 'background:rgba(16,16,20,.85);color:#fff;font:600 16px/1.4 system-ui,sans-serif;border-radius:6px;pointer-events:none'
        document.body.appendChild(el)
    }
    el.textContent = t
}, text)

const wait = ms => page.waitForTimeout(ms)

for (const a of ASSETS) {
    const started = Date.now()
    await page.goto(`${base}/examples/procedural-editor-assets/?asset=${a.asset}`)
    await page.waitForSelector('body._testFinish', {state: 'attached', timeout: 300000})
    const pageMs = Date.now() - started
    if (!metrics.renderer) {
        metrics.renderer = await page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl2')
            const ext = gl?.getExtension('WEBGL_debug_renderer_info')
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
        })
        console.log('renderer:', metrics.renderer)
    }
    await caption(a.title)
    await wait(1500)
    await page.getByRole('tab', {name: 'Modifiers'}).click()
    await wait(1200)

    // A user edit in the panel.
    await caption(`${a.title}: editing "${a.field}" in Properties > Modifiers`)
    const field = page.locator('.me-modifier[data-modifier-index="0"]').locator(`[id="me-prop-${a.field}"]`)
    await field.click()
    await wait(400)
    await field.fill('')
    await field.type(a.value, {delay: 120})
    await field.press('Enter')
    await wait(2500)

    // The camera turns around the result.
    await caption(`${a.title}: the geometry-nodes modifier re-ran in the browser`)
    await page.evaluate(async() => {
        const cam = window.viewer.scene.mainCamera
        const target = cam.target.clone()
        const off = cam.position.clone().sub(target)
        const r = Math.hypot(off.x, off.z), y = off.y, a0 = Math.atan2(off.z, off.x)
        for (let i = 0; i <= 90; i++) {
            const t = a0 + (i / 90) * Math.PI * 0.6
            cam.position.set(target.x + r * Math.cos(t), target.y + y, target.z + r * Math.sin(t))
            cam.setDirty()
            await new Promise(res => requestAnimationFrame(res))
        }
    })
    await wait(800)
    await page.screenshot({path: join(out, `${a.asset}.png`)})

    // Timed input changes through the same command (each one undoable, re-running only what the input reaches).
    const info = await page.evaluate(async({object, timed}) => {
        const m = window.modelling
        const entry = m.document.find(object)
        const runs = []
        for (const inputs of timed) {
            const spec = entry.modifiers[0]
            const r = await m.run({op: 'modifier', object, index: 0, update: {inputs: {...spec.inputs, ...inputs}}})
            runs.push({inputs, ok: r.ok, ms: r.ms})
        }
        const drawn = window.procedural.drawn(object)
        return {loadMs: window.acceptance.loadMs, runs, verts: entry.evaluated.vertsNum, faces: entry.evaluated.facesNum, drawn}
    }, {object: a.object, timed: a.timed})
    metrics.assets[a.asset] = {pageMs, ...info}
    console.log(a.asset, JSON.stringify(metrics.assets[a.asset]))
    await caption(`${a.title}: done`)
    await wait(1000)
}

await caption('threepipe geometry nodes - Blender 5.2.2 ports, evaluated in TypeScript')
await wait(2000)
await context.close()
await browser.close()
writeFileSync(join(out, 'metrics.json'), JSON.stringify(metrics, null, 1))
console.log('done', out)
