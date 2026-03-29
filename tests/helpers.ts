/**
 * Shared test helpers for threepipe e2e tests.
 * Used by both interactive.spec.ts and extras.spec.ts (smoke).
 */
import {test, expect, Page, TestInfo} from '@playwright/test'
import {existsSync, readFileSync, writeFileSync, promises, mkdirSync} from 'node:fs'
import {resolve} from 'node:path'

export const basePath = 'examples/'

// ─── Terminal formatting ─────────────────────────────────────────────────────
export const c = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
}
let _loggedThisTest = false
function _pad(fn: (...args: any[]) => void, msg: string) {
    if (!_loggedThisTest) { process.stdout.write('\n'); _loggedThisTest = true }
    fn(msg)
}
export const log = {
    info: (msg: string) => _pad(console.log, `    ${c.cyan}›${c.reset} ${msg}`),
    ok: (msg: string) => _pad(console.log, `    ${c.green}✓${c.reset} ${msg}`),
    warn: (msg: string) => _pad(console.warn, `    ${c.yellow}⚠${c.reset} ${msg}`),
    error: (msg: string) => _pad(console.error, `    ${c.red}✘${c.reset} ${msg}`),
    dim: (msg: string) => _pad(console.log, `    ${c.dim}  ${msg}${c.reset}`),
}
export function resetLogState() { _loggedThisTest = false }

export function platformId(testInfo: TestInfo): string {
    return testInfo.project.name + '-' + process.platform
}

export function snapshotDir(testInfo: TestInfo): string {
    return `./tests/snapshots/${platformId(testInfo)}/${testInfo.title}/`
}

// ─── Remote cache ────────────────────────────────────────────────────────────

const cacheDir = './node_modules/.cache/test-cdn/'
const memCache: Map<string, Buffer> = new Map()

const cachedHosts = [
    'https://unpkg.com/', 'https://esm.sh/',
    'https://samples.threepipe.org/', 'https://threejs.org/examples/',
    'https://cdn.jsdelivr.net/', 'https://raw.githubusercontent.com/',
    'https://demo-assets.pixotronics.com/', 'https://dist.pixotronics.com/',
    'https://dl.polyhaven.org/',
]

function cacheKey(url: string) { return url.replace(/[^a-zA-Z0-9._-]/g, '_') }
function isCached(url: string) { return cachedHosts.some(h => url.startsWith(h)) }

function mimeForUrl(url: string): string | undefined {
    const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
    if (!ext) return undefined
    const m: Record<string, string> = {
        js: 'application/javascript', mjs: 'application/javascript', css: 'text/css',
        json: 'application/json', wasm: 'application/wasm',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
        svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
    }
    if (m[ext]) return m[ext]
    // esm.sh and similar CDNs use extensionless URLs for JS modules (e.g. /react@19)
    if (url.startsWith('https://esm.sh/')) return 'application/javascript'
    return undefined
}

export async function setupRemoteCache(page: Page) {
    mkdirSync(cacheDir, {recursive: true})
    await page.route(url => isCached(url.toString()), async(route) => {
        const url = route.request().url()
        const contentType = mimeForUrl(url)
        const opts = contentType ? {contentType} : {}

        if (memCache.has(url)) return route.fulfill({body: memCache.get(url)!, ...opts})

        const file = cacheDir + cacheKey(url)
        if (existsSync(file)) {
            const buf = readFileSync(file)
            memCache.set(url, buf)
            return route.fulfill({body: buf, ...opts})
        }

        try {
            const resp = await fetch(url)
            if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer())
                writeFileSync(file, buf)
                memCache.set(url, buf)
                log.dim(`Cached: ${url.split('/').slice(3).join('/')} (${(buf.length / 1024).toFixed(0)}KB)`)
                return route.fulfill({body: buf, ...opts})
            }
        } catch { /* fall through */ }

        log.warn(`Cache miss, using network: ${url.split('/').slice(3, 6).join('/')}`)
        return route.continue()
    })
}

// ─── Screenshot helpers ─────────────────────────────────────────────────────

export interface ScreenshotOptions {
    pauseGltf?: boolean
    stopPopmotion?: boolean
    waitConvergence?: boolean
}

export const screenshotMatch = async(page: Page, _: TestInfo, name: string, opts: ScreenshotOptions = {}) => {
    if (opts.pauseGltf || opts.stopPopmotion || opts.waitConvergence) {
        await page.evaluate(async(o) => {
            const viewer = (window as any).threeViewers?.[0]
            if (!viewer) return
            if (o.pauseGltf) {
                const gltfAnim = viewer.getPlugin('GLTFAnimation')
                if (gltfAnim) gltfAnim.pauseAnimation()
            }
            if (o.stopPopmotion) {
                const popmotion = viewer.getPlugin('PopmotionPlugin')
                if (popmotion?.animations) {
                    for (const a of Object.values(popmotion.animations)) (a as any).stop?.()
                }
            }
            if (o.waitConvergence) {
                const timeout = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
                const progressive = viewer.getPlugin('ProgressivePlugin')
                if (progressive?.convergedPromise) {
                    await Promise.race([progressive.convergedPromise, timeout(5000)])
                } else {
                    await Promise.race([
                        new Promise<void>(r => viewer.doOnce('postFrame', () => r())),
                        timeout(500),
                    ])
                }
            }
        }, opts)
    }
    await expect(page).toHaveScreenshot(name + '.png')
    if (opts.pauseGltf) {
        await page.evaluate(() => {
            const viewer = (window as any).threeViewers?.[0]
            if (!viewer) return
            const gltfAnim = viewer.getPlugin('GLTFAnimation')
            if (gltfAnim) gltfAnim.playAnimation()
        })
    }
}

// ─── EXR pixel comparison ───────────────────────────────────────────────────

// Polyfills needed for three.js EXRLoader in Node
if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
        data: Uint8ClampedArray; width: number; height: number
        constructor(data: any, w: number, h?: number) {
            if (typeof data === 'number') { this.width = data; this.height = w; this.data = new Uint8ClampedArray(data * w * 4) }
            else { this.data = data; this.width = w; this.height = h! }
        }
    } as any
}
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {createElementNS: () => ({})} as any
}

let _exrLoader: any = null
async function getExrLoader() {
    if (!_exrLoader) {
        const {EXRLoader} = await import('three/examples/jsm/loaders/EXRLoader.js')
        _exrLoader = new EXRLoader()
    }
    return _exrLoader
}

async function compareExrPixels(actual: Buffer, expected: Buffer, tolerance = 0.001): Promise<{match: boolean, diffCount: number, totalPixels: number, maxDiff: number}> {
    const loader = await getExrLoader()
    const toAB = (buf: Buffer) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const a = loader.parse(toAB(actual))
    const b = loader.parse(toAB(expected))

    if (a.width !== b.width || a.height !== b.height) {
        return {match: false, diffCount: a.width * a.height, totalPixels: a.width * a.height, maxDiff: Infinity}
    }

    const {DataUtils} = await import('three')
    const isHalf = a.data instanceof Uint16Array
    const toFloat = isHalf ? (v: number) => DataUtils.fromHalfFloat(v) : (v: number) => v

    let diffCount = 0, maxDiff = 0
    for (let i = 0; i < a.data.length; i++) {
        const diff = Math.abs(toFloat(a.data[i]) - toFloat(b.data[i]))
        if (diff > tolerance) { diffCount++; if (diff > maxDiff) maxDiff = diff }
    }

    const totalPixels = a.width * a.height
    return {match: diffCount === 0, diffCount, totalPixels, maxDiff}
}

// ─── WEBP → PNG conversion for snapshot comparison ─────────────────────────

// TODO: Remove webpToPng conversion when Playwright adds WEBP support to toMatchSnapshot
// (currently only PNG/JPEG get visual diff — WEBP falls through to exact byte comparison)
async function webpToPng(buf: Buffer): Promise<Buffer> {
    const sharp = (await import('sharp')).default
    return sharp(buf).png().toBuffer()
}

function needsPixelCompare(name: string): boolean {
    return name.endsWith('.exr')
}

// ─── Download helpers ───────────────────────────────────────────────────────

export async function downloadFileMatch(page: Page, name: string, trigger: () => Promise<void>, snapshotLabel?: string) {
    const downloadPromise = page.waitForEvent('download', {timeout: 60000})
    await trigger()
    const download = await downloadPromise
    if (download.suggestedFilename() !== name) {
        expect(download.suggestedFilename()).toBe(name)
    }

    const dlPath = await download.path()
    if (dlPath === null) throw new Error('Download path is null')
    const contents = await promises.readFile(dlPath)

    if (needsPixelCompare(name)) {
        // EXR: byte-level compression is non-deterministic, compare decoded pixel values
        const snapshotName = 'dl-' + (snapshotLabel ?? name)
        const snapshotPath = (test.info() as any)._resolveSnapshotPaths('snapshot', snapshotName, 'updateSnapshotIndex').absoluteSnapshotPath
        const updateMode = (test.info().config as any).updateSnapshots

        if (!existsSync(snapshotPath) || updateMode === 'all') {
            await promises.mkdir(resolve(snapshotPath, '..'), {recursive: true})
            writeFileSync(snapshotPath, contents)
            log.ok(`New baseline: ${c.cyan}${snapshotName}${c.reset}`)
            return
        }

        const expected = readFileSync(snapshotPath)
        const result = await compareExrPixels(contents, expected)
        if (!result.match) {
            if (updateMode === 'changed') {
                writeFileSync(snapshotPath, contents)
                log.info(`Updated baseline: ${c.cyan}${snapshotName}${c.reset}`)
                return
            }
            const actualPath = snapshotPath.replace(/(\.[^.]+)$/, '-actual$1')
            writeFileSync(actualPath, contents)
            throw new Error(
                `EXR pixel mismatch: ${c.cyan}${name}${c.reset}\n` +
                `    ${result.diffCount} differing values / ${result.totalPixels * 4}, max diff: ${result.maxDiff.toFixed(6)}\n` +
                `    ${c.dim}Actual: ${resolve(actualPath)}${c.reset}`,
            )
        }
    } else {
        let snapshotBuf = contents
        let snapshotName = 'dl-' + (snapshotLabel ?? name)

        // TODO: Remove WEBP→PNG conversion when Playwright adds WEBP visual diff support
        // to toMatchSnapshot (currently only PNG/JPEG get pixel comparison)
        if (name.endsWith('.webp')) {
            snapshotBuf = await webpToPng(contents)
            snapshotName = 'dl-' + name.replace(/\.webp$/, '.png')
        }

        // For render target PNGs (depth/normal buffers), allow higher tolerance
        // since packed float→RGBA encoding amplifies tiny GPU differences
        // Packed float→RGBA encoding (depth/normal buffers) amplifies tiny GPU
        // scheduling differences into large pixel value changes
        const isRenderTarget = /depth|normal/i.test(name) && name.endsWith('.png')
        const opts = isRenderTarget ? {maxDiffPixelRatio: 0.03} : {}
        expect(snapshotBuf).toMatchSnapshot(snapshotName, opts)
    }
}

// ─── Console log capture ────────────────────────────────────────────────────

export interface ConsoleLine {
    type: string
    text: string
    location?: string
}

export const testConsoleLogs: ConsoleLine[] = []

export function formatConsoleLogs(logs: ConsoleLine[]): string {
    return logs.map(l => `[${l.type}] ${l.text}${l.location ? ` (${l.location})` : ''}`).join('\n')
}

// ─── Shared beforeEach / afterEach setup ────────────────────────────────────

export function setupTestHooks() {
    test.beforeEach(async({page}, testInfo) => {
        testConsoleLogs.length = 0
        resetLogState()

        page.on('console', msg => {
            testConsoleLogs.push({
                type: msg.type(),
                text: msg.text(),
                location: msg.location()?.url ? `${msg.location().url}:${msg.location().lineNumber}` : undefined,
            })
        })
        page.on('pageerror', err => {
            testConsoleLogs.push({
                type: 'pageerror',
                text: err.message + (err.stack ? '\n' + err.stack : ''),
            })
        })

        await page.addInitScript({path: './tests/deterministic-injection.js'})
        await setupRemoteCache(page)
        await page.goto(basePath + testInfo.title + '/')

        const testFinishTimeout = 120000
        const snapDir = snapshotDir(testInfo)
        let timedOut = false
        try {
            await page.waitForSelector('body._testFinish', {state: 'attached', timeout: testFinishTimeout})
        } catch {
            timedOut = true
            await promises.mkdir(snapDir, {recursive: true})
            await page.screenshot({path: snapDir + 'timeout-state.png'})
        }

        await page.evaluate(async() => {
            const viewer = (window as any).threeViewers?.[0]
            if (!viewer) return
            const gltfAnim = viewer.getPlugin('GLTFAnimation')
            gltfAnim && gltfAnim.setTime(0)
        })

        await page.addStyleTag({content: '#stats-js {display: none !important;} .show-code-btn {display: none !important;} .code-block {display: none !important;}'})

        if (timedOut) {
            const screenshotPath = resolve(snapDir + 'timeout-state.png')
            log.error(`Timed out waiting for _testFinish (${testFinishTimeout / 1000}s)`)
            log.dim(`Screenshot: ${screenshotPath}`)
            throw new Error(`"${testInfo.title}" did not reach _testFinish within ${testFinishTimeout / 1000}s`)
        }

        await page.waitForTimeout(1000)

        await screenshotMatch(page, testInfo, 'initial', {
            pauseGltf: true, stopPopmotion: true, waitConvergence: true,
        })
    })

    test.afterEach(async({page: _page}, testInfo) => {
        if (testConsoleLogs.length > 0) {
            const logDir = snapshotDir(testInfo)
            await promises.mkdir(logDir, {recursive: true})
            const logPath = logDir + 'console.log'
            await promises.writeFile(logPath, formatConsoleLogs(testConsoleLogs))
            if (testInfo.status !== 'passed') log.dim(`Console log: ${resolve(logPath)}`)
        }

        const pageErrors = testConsoleLogs.filter(l => l.type === 'pageerror')
        if (pageErrors.length > 0) {
            const summary = pageErrors.map(e => e.text.split('\n')[0]).join('; ')
            log.warn(`${pageErrors.length} page error(s): ${c.dim}${summary.substring(0, 120)}${c.reset}`)
            testInfo.annotations.push({type: 'page_errors', description: summary})
        }
    })
}

export const btn = (page: Page, name: string) => page.getByRole('button', {name, exact: true})
export const btnClick = async(page: Page, name: string) => btn(page, name).click()
