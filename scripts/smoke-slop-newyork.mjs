import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import assert from 'node:assert/strict'
import path from 'node:path'

const server = await createServer({
    configFile: path.resolve('vite.slop-newyork.config.js'),
    server: {host: '127.0.0.1', port: 0, hmr: false, watch: {ignored: ['**/*']}},
})
await server.listen()
const port = server.httpServer.address().port
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const errors = []
const timer = setTimeout(() => { console.error('City smoke timed out'); process.exit(1) }, 300000)
try {
    const page = await browser.newPage({viewport: {width: 960, height: 540}})
    // No external assets are needed to render the city. Avoid waiting on fonts in offline CI.
    await page.route('https://fonts.googleapis.com/**', route => route.abort())
    await page.route('https://fonts.gstatic.com/**', route => route.abort())
    page.on('pageerror', error => errors.push(error.stack || String(error)))
    page.on('console', message => {
        const text = message.text()
        if (/Shader Error|THREE.WebGLProgram|Unable to start/.test(text)) errors.push(text)
        if (text.includes('[init]')) console.log(text)
    })
    const query = process.env.SLOP_QUERY || 'scale=0.5&shadows=off&debug=1'
    await page.goto(`http://127.0.0.1:${port}/examples/slop-newyork/?${query}`, {waitUntil: 'domcontentloaded'})
    await page.waitForFunction(() => window.__NYC_APP?.ready || window.__NYC_ERROR, null, {timeout: 240000})
    const result = await page.evaluate(() => {
        const app = window.__NYC_APP
        if (window.__NYC_ERROR) throw new Error(window.__NYC_ERROR)
        // Keep the last frame available while checking controls and taking the optional screenshot.
        app.viewer.renderEnabled = false
        const modes = ['person', 'car', 'cyclist', 'helicopter'].map(mode => {
            app.selectMode(mode)
            return app.controllerManager.activeMode
        })
        app.selectMode('car')
        const effects = Object.fromEntries(Object.entries(app.viewer.cityEffects).map(([key, plugin]) => [key, plugin.enabled]))
        let meshes = 0
        app.scene.traverse(object => { if (object.isMesh) meshes++ })
        return {ready: app.ready, modes, effects, meshes, webgl: app.renderer.isWebGLRenderer,
            camera: app.cameraSystem.camera.position.toArray(), player: app.controllerManager.getActiveEntity().position.toArray()}
    })
    console.log('City initialized', JSON.stringify(result))
    assert.equal(result.webgl, true)
    assert.equal(result.ready, true)
    assert.deepEqual(result.modes, ['person', 'car', 'cyclist', 'helicopter'])
    assert.ok(result.meshes > 500, `Expected a city, found ${result.meshes} meshes`)
    assert.ok(result.effects.gi && result.effects.ssr && result.effects.taa)
    await page.click('#btn-open-map')
    await page.locator('#fullmap-modal').waitFor({state: 'visible', timeout: 5000})
    assert.ok(await page.evaluate(() => window.__NYC_APP.mapSystem.isFullMapOpen))
    await page.keyboard.press('Escape')
    await page.locator('#fullmap-modal').waitFor({state: 'hidden', timeout: 5000})
    if (process.env.SLOP_SCREENSHOT) await page.screenshot({path: process.env.SLOP_SCREENSHOT, timeout: 60000})
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ok: true, ...result}, null, 2))
} finally {
    clearTimeout(timer)
    await browser.close()
    await server.close()
}
