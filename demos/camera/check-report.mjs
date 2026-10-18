/**
 * Load the report page and fail on any missing image, 404 or console error.
 *
 *     node demos/camera/check-report.mjs [--url http://127.0.0.1:9372/demos/camera/] [--ws <endpoint>]
 */
import {chromium} from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const url = flag('url', 'http://127.0.0.1:9372/demos/camera/')
const ws = flag('ws', null)
const browser = ws ? await chromium.connect(ws) : await chromium.launch({args: ['--no-sandbox']})
const page = await browser.newPage({viewport: {width: 1440, height: 900}})
const problems = []
page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`) })
page.on('requestfailed', r => problems.push(`failed ${r.url()} ${r.failure()?.errorText}`))
page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
await page.goto(url, {waitUntil: 'load', timeout: 120000})
// Lazy images: scroll the page through so every one is requested.
await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)) }
    await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r })))
})
const images = await page.evaluate(() => [...document.images].map(i => ({src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0})))
const bad = images.filter(i => !i.ok)
const video = await page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return null
    return new Promise(r => {
        if (v.readyState >= 1) r({duration: v.duration, w: v.videoWidth, h: v.videoHeight})
        v.addEventListener('loadedmetadata', () => r({duration: v.duration, w: v.videoWidth, h: v.videoHeight}))
        v.addEventListener('error', () => r({error: v.error?.code}))
        // Only kick it if nothing is loading: load() aborts an in-flight request, which reads as a failure.
        if (v.networkState === v.NETWORK_EMPTY) v.load()
    })
})
await page.evaluate(() => window.scrollTo(0, 0))
// Chromium fetches media in ranges and aborts its first request once it has the header; that shows
// up as ERR_ABORTED on the video. It is not a failure if the video's metadata did load.
if (video?.duration > 0) {
    for (let i = problems.length - 1; i >= 0; i--) {
        if (/\.webm net::ERR_ABORTED$/.test(problems[i])) problems.splice(i, 1)
    }
}
await page.screenshot({path: 'tmp/camera-report-check.png', fullPage: false})
await browser.close()
console.log(JSON.stringify({url, images: images.length, broken: bad.map(b => b.src), video, problems}, null, 2))
process.exit(bad.length || problems.length ? 1 : 0)
