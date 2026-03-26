import {test, expect, Page, TestInfo} from '@playwright/test'
import {existsSync, promises, readFileSync, writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {basename} from 'node:path'
// @ts-expect-error no ts
import hexdump from 'hexer'
import {lock} from 'proper-lockfile'
import type {ThreeViewer} from '../src'


// @ts-expect-error not in node
declare const window: Window & {
    threeViewers: ThreeViewer[]
}

// async function waitForWindowEvent(page: Page, ev: string) {
//     await page.evaluate(async() => new Promise<void>(resolve => {
//         console.log('evaluating')
//         console.log(window)
//         window.addEventListener(ev, ()=>{
//             console.log('event')
//             resolve()
//         })
//     }))
// }

const basePath = 'examples/'
const downloadFileHashesPath = './tests/download-file-hashes.json'
// const downloadFileHashesLockfilePath = './tests/download-file-hashes.json.lock'

const screenshotMatch = async(page: Page, testInfo: TestInfo, name: string, animated = true) => {
    await page.evaluate(async()=> {
        const viewer = window.threeViewers ? window.threeViewers[0] : null
        if (!viewer) return
        const gltfAnim = viewer.getPlugin('GLTFAnimation')
        gltfAnim && gltfAnim.pauseAnimation()

        const progressivePlugin = viewer.getPlugin('ProgressivePlugin')
        if (progressivePlugin) await progressivePlugin.convergedPromise
        else await new Promise<void>(resolve => {viewer.doOnce('postFrame', ()=>resolve())})
    })
    await expect(page).toHaveScreenshot((testInfo.project.use.headless === false ? '.headed.' : '') + testInfo.title + '-' + name + '.png', {animations: animated ? 'allow' : 'disabled'})
    await page.evaluate(async()=> {
        const viewer = window.threeViewers ? window.threeViewers[0] : null
        if (!viewer) return
        const gltfAnim = viewer.getPlugin('GLTFAnimation')
        gltfAnim && gltfAnim.playAnimation()
    })
}

test.beforeEach(async({page}, testInfo) => {
    await page.addInitScript({path: './tests/deterministic-injection.js'})

    await page.goto(basePath + testInfo.title + '/')

    // await waitForWindowEvent(page, 'threepipe-test-started')
    await page.waitForSelector('body._testFinish', {state: 'attached', timeout: 120000}) // timeout of 2min because of model download. todo: use local models.

    await page.evaluate(async()=> {
        const viewer = window.threeViewers ? window.threeViewers[0] : null
        if (!viewer) return
        const gltfAnim = viewer.getPlugin('GLTFAnimation')
        gltfAnim && gltfAnim.setTime(0)
    })

    await page.addStyleTag({content: '#stats-js {display: none !important;} .show-code-btn {display: none !important;} .code-block {display: none !important;};'})

    await page.waitForTimeout(1000)

    await screenshotMatch(page, testInfo, 'initial')

})

test.afterEach(async({page: _page}, testInfo) => {
    // console.log(page.url())
    let dlFileErrors = ''
    testInfo.annotations.forEach(a=>{
        if (a.type === 'download_file') {
            dlFileErrors += a.description + '\n'
        }
    })
    if (dlFileErrors.length > 0) throw new Error(dlFileErrors)
    expect(dlFileErrors.length).toBe(0)
})

async function downloadFileMatch(page: Page, testInfo: TestInfo, name: string, trigger: ()=>Promise<void>, prefix?: boolean | string) {
    const downloadPromise = page.waitForEvent('download')
    await trigger()
    const download = await downloadPromise
    if (download.suggestedFilename() !== name) {
        await download.saveAs(testInfo.outputPath(name + '_' + download.suggestedFilename()))
        // throw new Error('downloaded file name mismatch: ' + download.suggestedFilename() + ', ' + name)
        expect(download.suggestedFilename()).toBe(name)
    }

    const path = await download.path()
    if (path === null) throw new Error('path is null')
    const contents = await promises.readFile(path)
    const hash = createHash('sha256').update(contents).digest('hex')

    const downloadsDir = testInfo.file + '-downloads/'
    await promises.mkdir(downloadsDir, {recursive: true})

    // snapshotSuffix is like `win32` etc
    const outputFilename = prefix ?
        (typeof prefix === 'boolean' ?
            (testInfo.project.use.headless === false ? '.headed.' : '')
            + testInfo.project.name + '-' + testInfo.snapshotSuffix : prefix) + '-' + name
        : name
    const downloadsPath = downloadsDir + testInfo.title + '-' + outputFilename
    const hasOldFile = existsSync(downloadsPath)

    let result = true

    // Create a lock file
    const releaseLock = await lock(downloadFileHashesPath)

    let downloadHash = hash

    try {
        const downloadsHashes = JSON.parse(readFileSync(downloadFileHashesPath, 'utf8'))
        const testFilename = basename(testInfo.file)
        if (!downloadsHashes[testFilename]) downloadsHashes[testFilename] = {}
        const examplesHashes = downloadsHashes[testFilename]
        if (!examplesHashes[testInfo.title]) examplesHashes[testInfo.title] = {}
        const exampleHashes = examplesHashes[testInfo.title]

        if (!exampleHashes[outputFilename] || !hasOldFile) {
            exampleHashes[outputFilename] = hash
            // not writing hash when in headed mode
            if (testInfo.project.use.headless !== false) writeFileSync(downloadFileHashesPath, JSON.stringify(downloadsHashes, null, 2))
            console.error('hash not found for ' + outputFilename + ', writing file and hash...')
            await download.saveAs(downloadsPath)
            result = false
        }
        downloadHash = exampleHashes[outputFilename]

    } finally {
        await releaseLock()
    }


    if (hash !== downloadHash) {
        if (!hasOldFile) throw new Error('old file not found, when hash mismatch: ' + downloadsPath)

        const output = testInfo.outputPath(name)
        await download.saveAs(output + '.new')
        await promises.copyFile(downloadsPath, output + '.old')

        // save hex dump of both files as txt
        const newContents = await promises.readFile(output + '.new')
        const oldContents = await promises.readFile(output + '.old')
        await promises.writeFile(output + '.new.txt', hexdump(newContents))
        await promises.writeFile(output + '.old.txt', hexdump(oldContents))

        throw new Error('hash mismatch for ' + outputFilename + `, writing files: 
        ${output}.new: ${hash}
        ${output}.old: ${downloadHash}
        `)
    }

    if (!result) {
        testInfo.annotations.push({
            type: 'download_file',
            description: `The file ${outputFilename} was not found in the downloads directory, so it was saved there along with the hash. These files need to be committed.
        ${downloadsPath}
        ${downloadFileHashesPath}
        `})
    }
    return result
}

const btn = (page: Page, name: string) => page.getByRole('button', {name, exact: true})
const btnClick = async(page: Page, name: string) => btn(page, name).click()

test('image-snapshot-export', async({page, browserName}, testInfo) => {
    await expect(page).toHaveTitle(/Image Snapshot Export/)

    await downloadFileMatch(page, testInfo, 'snapshot.png', async()=> btnClick(page, 'Download snapshot (PNG)'), true)
    await downloadFileMatch(page, testInfo, 'snapshot.jpeg', async()=> btnClick(page, 'Download snapshot (JPEG)'), true)
    const webPTrigger = async()=> btnClick(page, 'Download snapshot (WEBP)')
    if (browserName !== 'webkit') {
        await downloadFileMatch(page, testInfo, 'snapshot.webp', webPTrigger, true)
    } else {
        const dialogPromise = page.waitForEvent('dialog')
        const triggerPromise = webPTrigger() // no await here because the dialog is blocking.
        const dialog = await dialogPromise
        await dialog.accept()
        expect(dialog.message()).toBe('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
        await triggerPromise
    }

    // await page.pause()
})

test('3dm-to-glb', async({page, browserName}, testInfo) => {
    await expect(page).toHaveTitle(/Rhino 3DM To GLB/)

    // webassembly is not supported on webkit on windows: https://bugs.webkit.org/show_bug.cgi?id=222315
    if (browserName === 'webkit' && testInfo.snapshotSuffix === 'win32') return

    await downloadFileMatch(page, testInfo, 'file.glb', async()=> btnClick(page, 'Download .glb'), true)
})

test('camera-uiconfig', async({page}, testInfo) => {

    await expect(page).toHaveTitle(/Camera UiConfig/)

    await btnClick(page, 'Default Camera')
    const e = page.locator('.tp-sldtxtv_t > .tp-txtv > .tp-txtv_i').first()
    await e.click()
    await e.press('Control+a')
    await e.fill('100')
    await e.press('Enter')

    await btnClick(page, 'Orbit Controls')
    await page.locator('div:nth-child(3) > .tp-lblv_v > .tp-ckbv > .tp-ckbv_l > .tp-ckbv_w > svg').click()

    await btnClick(page, 'Zoom in')
    await btnClick(page, 'Zoom in')
    await btnClick(page, 'Zoom in')
    await btnClick(page, 'Zoom in')
    await btnClick(page, 'Zoom in')

    await page.waitForTimeout(500)

    await screenshotMatch(page, testInfo, '0')

})

test('custom-pipeline', async({page}, testInfo) => {

    await expect(page).toHaveTitle(/Custom Pipeline/)

    await btnClick(page, 'depth')
    await screenshotMatch(page, testInfo, 'depth')
    await btnClick(page, 'render')
    await screenshotMatch(page, testInfo, 'render')
    await btnClick(page, 'render, screen')
    await screenshotMatch(page, testInfo, 'render-screen')
    await btnClick(page, 'depth, render, screen')
    await screenshotMatch(page, testInfo, 'depth-render-screen')

    await btnClick(page, 'depth')
    await downloadFileMatch(page, testInfo, 'file.png', async()=> btnClick(page, 'Download snapshot'), true)

})

test('depth-buffer-plugin', async({page}, testInfo) => {

    await expect(page).toHaveTitle(/Depth Buffer Plugin/)

    await btnClick(page, 'Toggle Depth rendering')
    await screenshotMatch(page, testInfo, 'depth')

})

test('directional-light', async({page})=> expect(page).toHaveTitle('Directional Light'))
test('drc-load', async({page})=> expect(page).toHaveTitle('DRACO(DRC) Load'))
test('dropzone-plugin', async({page})=> expect(page).toHaveTitle('Dropzone Plugin')) // todo
test('exr-load', async({page})=> expect(page).toHaveTitle('EXR Load'))
test('extra-importer-plugins', async({page})=> expect(page).toHaveTitle('Extra Importer Plugins'))
test('fbx-load', async({page})=> expect(page).toHaveTitle('FBX Load'))
test('frame-fade-plugin', async({page}, testInfo)=> {
    await expect(page).toHaveTitle('Frame Fade Plugin')

    // todo this doesnt actually test for fading, for that it needs to stop in between animations.
    //  To test the test, try version 0.0.30 where FrameFadePlugin is broken.

    await btnClick(page, 'Change Color')
    await page.waitForTimeout(1000)
    await screenshotMatch(page, testInfo, '0')

    await btnClick(page, 'Change Size')
    await page.waitForTimeout(1000)
    await screenshotMatch(page, testInfo, '1')

    await btnClick(page, 'Change Color (no fade)')
    await page.waitForTimeout(10)
    await screenshotMatch(page, testInfo, '2')

})
test('fullscreen-plugin', async({page}, testInfo)=> {
    await expect(page).toHaveTitle('Fullscreen Plugin')

    await page.getByRole('button', {name: 'Full Screen'}).click()
    await btnClick(page, 'Enter/Exit fullscreen')
    await screenshotMatch(page, testInfo, '0')
    await btnClick(page, 'Enter/Exit fullscreen')
    await screenshotMatch(page, testInfo, '1')

})
test('geometry-uv-preview', async({page}, testInfo)=> {
    await expect(page).toHaveTitle('Geometry UV Preview')

    await page.getByText('glassDish', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, testInfo, 'renderTarget.png', async()=> page.getByText('Download', {exact: true}).click(), true)
    await page.getByText('glassDish', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()

    await page.getByText('olives', {exact: true}).click()
    await page.getByText('glassCover', {exact: true}).click()
    await page.getByText('goldLeaf', {exact: true}).click()

    await screenshotMatch(page, testInfo, '0')
})
test('glb-export', async({page}, testInfo) => {
    await expect(page).toHaveTitle('GLB Export')

    await downloadFileMatch(page, testInfo, 'helmet.glb', async()=> btnClick(page, 'Download Helmet Object GLB'), true)
    await downloadFileMatch(page, testInfo, 'helmet.pmat', async()=> btnClick(page, 'Download Helmet Material'), true)
    await downloadFileMatch(page, testInfo, 'scene.glb', async()=> btnClick(page, 'Download Scene GLB (Without Viewer Config)'), true)
    await downloadFileMatch(page, testInfo, 'scene_with_config.glb', async()=> btnClick(page, 'Download Scene GLB (With Viewer Config)'), true)

})
test('gltf-animation-page-scroll', async({page})=> expect(page).toHaveTitle('GLTF Animation Page Scroll')) // todo
test('gltf-animation-plugin', async({page})=> expect(page).toHaveTitle('GLTF Animation Plugin'))
test('gltf-camera-animation', async({page})=> expect(page).toHaveTitle('GLTF Camera Animation')) // todo
test('gltf-load', async({page})=> expect(page).toHaveTitle('GLTF Load'))
test('gltf-transmission-test', async({page})=> expect(page).toHaveTitle('GLTF Transmission Test'))
test('half-float-hdr-test', async({page})=> expect(page).toHaveTitle('Half float HDR Test'))
test('hdr-load', async({page})=> expect(page).toHaveTitle('HDR Load'))
test('hdr-to-exr', async({page})=> expect(page).toHaveTitle('HDR To EXR'))
test('image-load', async({page})=> expect(page).toHaveTitle('Image Load')) // todo: drop image
test('import-test', async({page})=> expect(page).toHaveTitle('Basic Lib Import Test'))
test('ktx-load', async({page})=> expect(page).toHaveTitle('KTX Texture Load'))
test('ktx2-load', async({page})=> expect(page).toHaveTitle('KTX2 Texture Load'))
test('material-uiconfig', async({page})=> expect(page).toHaveTitle('Material UiConfig'))
test('normal-buffer-plugin', async({page}, testInfo) => {

    await expect(page).toHaveTitle('Normal Buffer Plugin')

    await btnClick(page, 'Toggle Normal rendering')
    await screenshotMatch(page, testInfo, 'normal')

})
test('obj-mtl-load', async({page})=> expect(page).toHaveTitle('OBJ MTL Load')) // todo: materials not loading, some race condition
test('obj-to-glb', async({page})=> expect(page).toHaveTitle('OBJ To GLB'))
test('object-uiconfig', async({page})=> expect(page).toHaveTitle('Object UiConfig'))
test('parallel-asset-import', async({page})=> expect(page).toHaveTitle('Parallel Asset Import/Download'))
test('ply-load', async({page})=> expect(page).toHaveTitle('PLY Load'))
test('pmat-material-export', async({page}, testInfo) => {
    await expect(page).toHaveTitle('PMAT(Physical) Material export')

    await downloadFileMatch(page, testInfo, 'material.pmat', async()=> btnClick(page, 'Download PMAT'), true)

    console.log(testInfo.expectedStatus)
    console.log(testInfo.expectedStatus)
    console.log(testInfo.expectedStatus)
})
test('popmotion-plugin', async({page}, testInfo)=> {
    await expect(page).toHaveTitle('Popmotion Plugin')

    await btnClick(page, 'Move Up/Down')
    await page.waitForTimeout(600)
    await screenshotMatch(page, testInfo, '0')

    await btnClick(page, 'Rotate +90deg')
    await page.waitForTimeout(600)
    await screenshotMatch(page, testInfo, '1', true)

    await btnClick(page, 'Change Color')
    await page.waitForTimeout(600)
    await screenshotMatch(page, testInfo, '2')

})
test('progressive-plugin', async({page})=> expect(page).toHaveTitle('Progressive Plugin'))
test('render-target-export', async({page, browserName}, testInfo) => {
    await expect(page).toHaveTitle('Render Target Export')

    await downloadFileMatch(page, testInfo, 'EffectComposer.rt1.exr', async()=> btnClick(page, 'Download composer (EXR)'), true)
    await downloadFileMatch(page, testInfo, 'depthBuffer.png', async()=> btnClick(page, 'Download depth (PNG)'), true)
    const webPTrigger = async()=> btnClick(page, 'Download composer (WEBP)')
    if (browserName !== 'webkit') {
        await downloadFileMatch(page, testInfo, 'depthBuffer.jpeg', async()=> btnClick(page, 'Download depth (JPEG)'), true) // todo: this saves a png for some reason in webkit
        await downloadFileMatch(page, testInfo, 'EffectComposer.rt1.webp', webPTrigger, true)
    } else {
        const dialogPromise = page.waitForEvent('dialog')
        const triggerPromise = webPTrigger() // no await here because the dialog is blocking.
        const dialog = await dialogPromise
        await dialog.accept()
        expect(dialog.message()).toBe('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
        await triggerPromise
    }

    // await page.pause()
})
test('render-target-preview', async({page}, testInfo)=> {
    await expect(page).toHaveTitle('Render Target Preview')

    await page.getByText('normal', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, testInfo, 'renderTarget.exr', async()=> page.getByText('Download', {exact: true}).click(), true)

    await page.getByText('composer-1', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, testInfo, 'renderTarget.png', async()=> page.getByText('Download', {exact: true}).click(), true)

    await page.getByText('composer-1', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()

    await page.getByText('depth', {exact: true}).click()
    await page.getByText('normal', {exact: true}).click()

    await screenshotMatch(page, testInfo, '0')

    await page.getByText('composer-2', {exact: true}).click()

    await screenshotMatch(page, testInfo, '1')
})
test('rhino3dm-load', async({page})=> expect(page).toHaveTitle('Rhino 3DM Load'))
test('scene-uiconfig', async({page})=> expect(page).toHaveTitle('Scene UiConfig'))
test('sphere-half-float-test', async({page})=> expect(page).toHaveTitle('Half float render pipeline test'))
test('sphere-msaa-test', async({page})=> expect(page).toHaveTitle('MSAA Test'))
test('sphere-rgbm-test', async({page})=> expect(page).toHaveTitle('RGBM Render pipeline test'))
test('stl-load', async({page})=> expect(page).toHaveTitle('STL Load'))
test('tonemap-plugin', async({page}, testInfo)=> {
    await expect(page).toHaveTitle('Tonemap Plugin')

    await page.getByRole('button', {name: 'Tonemapping'}).click()

    await page.locator('div:nth-child(3) > .tp-lblv_v > .tp-ckbv > .tp-ckbv_l > .tp-ckbv_w').click()
    await page.getByRole('textbox').first().click()
    await page.getByRole('textbox').first().press('Control+a')
    await page.getByRole('textbox').first().fill('2')
    await page.getByRole('textbox').first().press('Enter')
    await page.getByRole('textbox').nth(1).click()
    await page.getByRole('textbox').nth(1).press('Control+a')
    await page.getByRole('textbox').nth(1).fill('1.5')
    await page.getByRole('textbox').nth(1).press('Enter')
    await page.getByRole('textbox').nth(2).click()
    await page.getByRole('textbox').nth(2).press('Control+a')
    await page.getByRole('textbox').nth(2).fill('1.2')
    await page.getByRole('textbox').nth(2).press('Enter')

    await screenshotMatch(page, testInfo, '0')
    await page.getByRole('combobox').selectOption('1')
    await screenshotMatch(page, testInfo, '1')
    await page.getByRole('combobox').selectOption('2')
    await screenshotMatch(page, testInfo, '2')
    await page.getByRole('combobox').selectOption('3')
    await screenshotMatch(page, testInfo, '3')
    await page.getByRole('combobox').selectOption('5')
    await screenshotMatch(page, testInfo, '4')

})
test('tweakpane-editor', async({page})=> expect(page).toHaveTitle('Tweakpane Editor'))
test('uint8-rgbm-hdr-test', async({page})=> expect(page).toHaveTitle('Uint8 RGBM HDR Test'))
test('usdz-load', async({page})=> expect(page).toHaveTitle('USDZ / USDA Load'))
test('viewer-uiconfig', async({page})=> expect(page).toHaveTitle('Viewer UiConfig'))
test('z-prepass', async({page})=> expect(page).toHaveTitle('Z-Prepass test'))

// for (const [name, title] of Object.entries(otherExamples)) {
//     test(name, async({page}, _) => {
//         await expect(page).toHaveTitle(title)
//     })
// }
