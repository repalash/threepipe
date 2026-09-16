import {chromium} from 'playwright'
import {readFileSync} from 'node:fs'

const OUT = '/Users/palash/Projects/threepipe/tmp/demo-recording'
const URL = 'http://127.0.0.1:9231/examples/modelling-workspace/index.html'

const buildSrc = readFileSync(
  '/Users/palash/Projects/threepipe/.repos/threepipe-modelling/examples/modelling-workspace/demo-build.mjs', 'utf8')

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'],
})
const context = await browser.newContext({
  viewport: {width: 1280, height: 720},
  recordVideo: {dir: OUT, size: {width: 1280, height: 720}},
  deviceScaleFactor: 1,
})
const page = await context.newPage()
const errs = []
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

// `networkidle` never settles: the viewer renders continuously.
await page.goto(URL, {waitUntil: 'domcontentloaded', timeout: 60000})

// Wait for the environment map and the first real frame, or the recording opens on a loading screen.
await page.waitForFunction(() => {
  const v = window.viewer
  return v && v.scene && v.scene.environment && !document.querySelector('.loading-screen:not([style*="none"])')
}, {timeout: 90000}).catch(() => {})
await page.waitForTimeout(6000)

// A caption line so the recording explains itself.
await page.evaluate(() => {
  const el = document.createElement('div')
  el.id = 'build-log'
  Object.assign(el.style, {
    position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)',
    padding: '7px 16px', borderRadius: '6px', background: 'rgba(18,18,22,0.92)',
    color: '#e6e6ea', font: '13px ui-monospace, Menlo, monospace', zIndex: '20',
    letterSpacing: '.02em',
  })
  el.textContent = 'starting…'
  document.body.appendChild(el)

  // Chrome for the recording: the settings panel and the code-preview button are noise here.
  for (const sel of ['#tweakpaneUiContainer', '.code-preview', '#example-code-preview', '#example-code-btn']) {
    document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
  }
  const v = window.viewer
  // A mid grey reads far better than the blown-out default for a light-coloured model.
  v.scene.setBackgroundColor?.('#5a6270')
  v.scene.backgroundIntensity = 0.6
  v.setDirty()

  // Clear the starting cube; the build makes its own.
  document.getElementById('clear')?.click()
})

const result = await page.evaluate(async (src) => {
  const mod = await import('data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(src))))
  return await mod.buildDemo({
    viewer: window.viewer,
    picking: window.picking,
    meshEdit: window.meshEdit,
    generators: window.generators,
  })
}, buildSrc)

console.log('BUILD:', JSON.stringify(result))
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none')

await page.waitForTimeout(1200)
const video = page.video()
await context.close()
await browser.close()
const path = video ? await video.path() : null
console.log('VIDEO:', path)
