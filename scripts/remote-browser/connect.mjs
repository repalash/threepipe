// Connect to the Playwright browser server on the host machine (real GPU) from the aibox container.
// Why and the server's quirks: README.md beside this file.
//
//   import {connectHostBrowser} from '../scripts/remote-browser/connect.mjs'
//   const browser = await connectHostBrowser()
//   try { const context = await browser.newContext(); … } finally { await browser.close() }
//
//   node scripts/remote-browser/connect.mjs      prints the browser version and the WebGL renderer
//
// Env: PW_HOST_WS      server address without a path (default ws://host.docker.internal:3145)
//      PW_HOST_CLIENT  a Playwright install of exactly the server's version
//                      (default /tmp/pw/node_modules/playwright; make it with
//                      `npm i --prefix /tmp/pw playwright@<version>`, never inside a project)
import http from 'node:http'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)

// The server answers only when the Host header names its own loopback address.
const hostHeader = (ws) => `127.0.0.1:${new URL(ws).port}`

// The server picks a new ws path on every start and tells the current one at /json.
// node:http, because fetch does not let the Host header be set.
function endpoint(ws) {
    return new Promise((resolve, reject) => {
        http.get(ws.replace(/^ws/, 'http') + '/json', {headers: {Host: hostHeader(ws)}}, (res) => {
            let body = ''
            res.on('data', (d) => { body += d })
            res.on('end', () => {
                try { resolve(ws + JSON.parse(body).wsEndpointPath) } catch (e) { reject(e) }
            })
        }).on('error', reject)
    })
}

export async function connectHostBrowser({
    ws = process.env.PW_HOST_WS || 'ws://host.docker.internal:3145',
    client = process.env.PW_HOST_CLIENT || '/tmp/pw/node_modules/playwright',
    tries = 20,
} = {}) {
    const {chromium} = require(client)
    let last
    // The server is down for a few seconds after any client's browser ends (see README).
    for (let i = 0; i < tries; i++) {
        try {
            return await chromium.connect(await endpoint(ws), {headers: {Host: hostHeader(ws)}, timeout: 30000})
        } catch (e) {
            last = e
            await new Promise((r) => setTimeout(r, 3000))
        }
    }
    throw last
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const browser = await connectHostBrowser()
    try {
        const page = await (await browser.newContext()).newPage()
        const renderer = await page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl2')
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info')
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no WebGL'
        })
        console.log(`browser ${browser.version()} — ${renderer}`)
    } finally {
        await browser.close() // ends the server's browser for everyone; it comes back within seconds
    }
}
