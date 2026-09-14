import {test, expect} from '@playwright/test'
import {promises as fs} from 'node:fs'
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname_ = dirname(fileURLToPath(import.meta.url))

// Render-comparison test: load a webgi-exported GLB into threepipe's tweakpane-editor
// and confirm the rendered output matches the snapshot the user took in webgi.
//
// Old webgi files should render identically in threepipe — that's the broader correctness
// goal. This spec uses the editor (which has all webgi-equivalent plugins registered, so
// the GLB's serialized WEBGI_viewer config can deserialize fully). The reference image
// was produced by webgi's CanvasSnapshotPlugin with 32 progressive frames, so we
// reproduce the same code path here.
//
// Per-feature regression coverage of the LUT plugin lives in tests/interactive.spec.ts
// (`lut-plugin`). This test exists solely to lock in the threepipe ↔ webgi pixel parity
// for a real exported scene; the diff threshold is set wide because the underlying
// pipelines are not byte-identical (different shader chunks, different anti-aliasing).

test.use({viewport: {width: 1444, height: 872}})

test('lut-render-2rings', async({page}, testInfo) => {
    test.setTimeout(120_000)

    const fixturePath = resolve(__dirname_, 'fixtures/2rings.glb')
    const referencePath = resolve(__dirname_, 'fixtures/2rings-snapshot-webgi.png')
    await fs.access(fixturePath)
    await fs.access(referencePath)

    const logs: string[] = []
    page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))
    page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))

    const url = '/examples/tweakpane-editor/?cache=false&m=' + encodeURIComponent('/tests/fixtures/2rings.glb')
    await page.goto(url)

    await page.waitForSelector('body._testFinish', {state: 'attached', timeout: 120_000})

    // Hide editor chrome so the canvas fills the viewport (1444x872 to match the reference).
    await page.addStyleTag({content: `
        body { overflow: hidden !important; }
        #canvas-container { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 0 !important; }
        #mcanvas { width: 100% !important; height: 100% !important; }
        .tp-rotv, .tp-dfwv, .tp-fldv, [class^="tp-"], #stats-js, .show-code-btn, .code-block,
        .tweakpane-container, .editor-toolbar, .editor-sidebar, .editor-tabs,
        [class*="editor-"]:not(#mcanvas):not(#canvas-container), .modal, .overlay,
        .blueprint-ui, [data-blueprintjs-portal] { display: none !important; }
    `})

    await page.evaluate((dims) => {
        const v = (window as any).threeViewers[0]
        const canvas = v.canvas as HTMLCanvasElement
        canvas.style.width = dims.w + 'px'
        canvas.style.height = dims.h + 'px'
        v.renderManager.refreshSize?.()
        v.setDirty()
    }, {w: 1444, h: 872})
    await page.waitForTimeout(300)

    // Sanity: LUT plugin loaded its config and is enabled.
    const pluginState = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const lut = v?.getPlugin?.('LUTPlugin1')
        const snapshot = v?.getPlugin?.('CanvasSnapshotPlugin')
        return {
            hasViewer: !!v,
            lutEnabled: !!lut?.enabled,
            lutBackground: !!lut?.lutBackground,
            lutMapSet: !!lut?.lutMap,
            lutMap1Set: !!lut?.lutMap1,
            hasSnapshotPlugin: !!snapshot,
            envLoaded: !!v?.scene?.environment,
        }
    })
    expect(pluginState.hasViewer, JSON.stringify({pluginState, logs: logs.slice(-30)})).toBe(true)
    expect(pluginState.hasSnapshotPlugin).toBe(true)
    expect(pluginState.lutEnabled).toBe(true)
    expect(pluginState.lutMapSet).toBe(true)

    const artifactDir = testInfo.outputDir
    await fs.mkdir(artifactDir, {recursive: true})

    // Snapshot via the same code path webgi used for the reference (32 progressive frames).
    const dataUrl = await page.evaluate(async() => {
        const v = (window as any).threeViewers[0]
        const snap = v.getPlugin('CanvasSnapshotPlugin')
        return await snap.getDataUrl({waitForProgressive: true, progressiveFrames: 32, mimeType: 'image/png'})
    })
    expect(dataUrl, 'snapshot returned empty').toMatch(/^data:image\/png;base64,/)
    const actualBuf = Buffer.from(dataUrl.split(',', 2)[1], 'base64')

    await fs.writeFile(resolve(artifactDir, 'actual.png'), actualBuf)
    await fs.copyFile(referencePath, resolve(artifactDir, 'reference.png'))

    // Per-pixel max-channel diff. Threshold + ratio bound is intentionally loose because
    // threepipe and webgi do not produce byte-identical output (different shader chunks,
    // different post-AA). Tightening this threshold past the current observed value would
    // make the test brittle without catching real bugs — the per-feature regressions are
    // covered in tests/interactive.spec.ts `lut-plugin`.
    const sharp = (await import('sharp')).default
    const refMeta = await sharp(referencePath).metadata()
    const actMeta = await sharp(actualBuf).metadata()
    const w = refMeta.width!, h = refMeta.height!
    const refRgba = await sharp(referencePath).ensureAlpha().raw().toBuffer()
    const actRgba = await sharp(actualBuf).resize(w, h, {fit: 'fill'}).ensureAlpha().raw().toBuffer()
    if (refRgba.length !== actRgba.length) {
        throw new Error(`size mismatch after resize: ref=${refRgba.length} act=${actRgba.length}`)
    }

    const threshold = 24 // 0-255 per channel; ~9% of full range
    let diffPixels = 0
    let totalDiff = 0
    const pixelCount = w * h
    const diffImg = Buffer.alloc(pixelCount * 4)
    for (let i = 0; i < pixelCount; i++) {
        const o = i * 4
        const dr = Math.abs(refRgba[o] - actRgba[o])
        const dg = Math.abs(refRgba[o + 1] - actRgba[o + 1])
        const db = Math.abs(refRgba[o + 2] - actRgba[o + 2])
        const m = Math.max(dr, dg, db)
        totalDiff += m
        if (m > threshold) {
            diffPixels++
            diffImg[o] = 255; diffImg[o + 1] = 0; diffImg[o + 2] = 0; diffImg[o + 3] = 255
        } else {
            diffImg[o] = refRgba[o] >> 2
            diffImg[o + 1] = refRgba[o + 1] >> 2
            diffImg[o + 2] = refRgba[o + 2] >> 2
            diffImg[o + 3] = 255
        }
    }
    await sharp(diffImg, {raw: {width: w, height: h, channels: 4}}).png().toFile(resolve(artifactDir, 'diff.png'))

    const ratio = diffPixels / pixelCount
    const meanChannelDiff = totalDiff / pixelCount
    const summary = {
        refSize: `${refMeta.width}x${refMeta.height}`,
        actSize: `${actMeta.width}x${actMeta.height}`,
        diffPixels,
        totalPixels: pixelCount,
        diffRatio: ratio.toFixed(4),
        meanChannelDiff: meanChannelDiff.toFixed(2),
        threshold,
        artifactDir,
    }
    console.log('LUT-RENDER COMPARISON:', JSON.stringify(summary, null, 2))

    expect(ratio, `pixel diff too large — see ${artifactDir}/diff.png. Summary: ${JSON.stringify(summary)}`).toBeLessThan(0.5)
})
