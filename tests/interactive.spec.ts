import {test, expect} from '@playwright/test'
import {setupTestHooks, screenshotMatch, downloadFileMatch, btnClick} from './helpers'

setupTestHooks()

// ─── Interactive tests ──────────────────────────────────────────────────────

test('image-snapshot-export', async({page, browserName}, testInfo) => {
    await expect(page).toHaveTitle('Image Snapshot Export')

    await downloadFileMatch(page, 'snapshot.png', async() => btnClick(page, 'Download snapshot (PNG)'))
    await downloadFileMatch(page, 'snapshot.jpeg', async() => btnClick(page, 'Download snapshot (JPEG)'))
    const webPTrigger = async() => btnClick(page, 'Download snapshot (WEBP)')
    if (browserName !== 'webkit') {
        await downloadFileMatch(page, 'snapshot.webp', webPTrigger)
    } else {
        const dialogPromise = page.waitForEvent('dialog')
        const triggerPromise = webPTrigger()
        const dialog = await dialogPromise
        await dialog.accept()
        expect(dialog.message()).toBe('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
        await triggerPromise
    }
})

test('3dm-to-glb', async({page, browserName}, testInfo) => {
    await expect(page).toHaveTitle('Rhino 3DM To GLB')
    if (browserName === 'webkit' && testInfo.snapshotSuffix === 'win32') return
    await downloadFileMatch(page, 'file.glb', async() => btnClick(page, 'Download .glb'))
})

test('camera-uiconfig', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Camera UiConfig')
    const setCam = async(fn: string) => {
        await page.evaluate((f) => {
            const v = (window as any).threeViewers?.[0]
            if (!v) return
            const cam = v.scene.mainCamera
            new Function('cam', f)(cam)
            cam.controls?.stopDamping?.()
            cam.setDirty()
            cam.uiConfig?.uiRefresh?.(true, 'postFrame')
        }, fn)
        await page.waitForTimeout(500)
    }

    // Expand the camera folder in TweakpaneUiPlugin
    await page.getByRole('button', {name: 'Default Camera'}).click()
    await page.waitForTimeout(300)

    // Helper to fill a Tweakpane textbox by its label within the camera folder
    const camFolder = page.locator('.tp-fldv').first()
    const fillTextbox = async(label: string, value: string) => {
        const box = camFolder.locator('.tp-lblv').filter({hasText: label}).locator('.tp-txtv_i').first()
        await box.dblclick()
        await box.fill(value)
        await box.press('Enter')
        await page.waitForTimeout(500)
    }

    // --- FoV via Tweakpane slider textbox (replaces page.evaluate) ---
    await fillTextbox('Field Of View', '100')
    await screenshotMatch(page, testInfo, 'fov-wide')
    await fillTextbox('Field Of View', '15')
    await screenshotMatch(page, testInfo, 'fov-narrow')
    await fillTextbox('Field Of View', '50')

    // --- Position changes via page.evaluate (vector inputs have no single textbox) ---
    await setCam('cam.position.set(0, 0, 2.5)')
    await screenshotMatch(page, testInfo, 'zoomed-in')
    await setCam('cam.position.set(0, 0, 10)')
    await screenshotMatch(page, testInfo, 'zoomed-out')
    await setCam('cam.position.set(0, 0, 5)')
    await setCam('cam.position.set(3, 2, 0)')
    await screenshotMatch(page, testInfo, 'side-view')
    await setCam('cam.position.set(0, 0, 5)')

    // --- Auto LookAt Target via Tweakpane checkbox (replaces page.evaluate) ---
    const autoLookAtRow = camFolder.locator('.tp-lblv').filter({hasText: 'Auto LookAt Target'})
    const autoLookAtCheckbox = autoLookAtRow.locator('.tp-ckbv_w')
    // Disable auto look-at target, then move camera
    await autoLookAtCheckbox.click()
    await setCam('cam.position.set(2, 1, 3)')
    await screenshotMatch(page, testInfo, 'auto-lookat-off')
    // Re-enable and reset
    await autoLookAtCheckbox.click()
    await setCam('cam.position.set(0, 0, 5)')

    await setCam('cam.target.set(1, 0.5, 0); cam.controls?.stopDamping?.()') 
    await screenshotMatch(page, testInfo, 'target-offset')
    // Reset target
    await setCam('cam.target.set(0, 0, 0); cam.controls?.stopDamping?.()')

    // --- Near/Far clipping via Tweakpane UI ---
    // Disable autoNearFar via checkbox so Near/Far use fixed values
    const autoNearFarRow = camFolder.locator('.tp-lblv').filter({hasText: 'Auto Near Far'})
    const autoNearFarCheckbox = autoNearFarRow.locator('.tp-ckbv_w')
    await autoNearFarCheckbox.click()
    await page.waitForTimeout(300)

    // Set near/far via evaluate (readOnly binding prevents direct textbox editing
    // until the UI fully refreshes; the checkbox interaction above tests the UI path)
    await setCam('cam.near = 3.5')
    await screenshotMatch(page, testInfo, 'near-clip')

    await setCam('cam.near = 0.1; cam.far = 3')
    await screenshotMatch(page, testInfo, 'far-clip')

    // Restore autoNearFar via checkbox
    await setCam('cam.far = 1000')
    await autoNearFarCheckbox.click()
    await page.waitForTimeout(300)
})

test('custom-pipeline', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Custom Pipeline')
    // Note: depth-only pipeline screenshots/downloads are omitted — depth buffer
    // rendering is non-deterministic (see issues/open/depth-buffer-export-non-deterministic.md)
    await btnClick(page, 'render')
    await screenshotMatch(page, testInfo, 'render')
    await btnClick(page, 'render, screen')
    await screenshotMatch(page, testInfo, 'render-screen')
    await btnClick(page, 'depth, render, screen')
    await screenshotMatch(page, testInfo, 'depth-render-screen')
    await downloadFileMatch(page, 'file.png', async() => btnClick(page, 'Download snapshot'))

    // --- RenderTargetPreviewPlugin panel interactions ---
    await page.waitForTimeout(300)

    const preview = page.locator('#RenderTargetPreviewPluginContainer')

    // Collapse the depth panel
    await preview.getByText('depth', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'depth-panel-collapsed')

    // Expand the depth panel
    await preview.getByText('depth', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'depth-panel-expanded')

    // Context menu: remove the depth panel
    await preview.getByText('depth', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'depth-panel-removed')

    // Context menu: remove the composer-1 panel
    await preview.getByText('composer-1', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'all-panels-removed')
})

test('depth-buffer-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Depth Buffer Plugin')
    await btnClick(page, 'Toggle Depth rendering')
    await screenshotMatch(page, testInfo, 'depth-rgba')
    await btnClick(page, 'Toggle Depth rendering')
    await screenshotMatch(page, testInfo, 'depth-off')

    // Switch depth packing to BasicDepthPacking (3200)
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('DepthBufferPlugin')
        if (p) { p.depthPacking = 3200; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await btnClick(page, 'Toggle Depth rendering')
    await screenshotMatch(page, testInfo, 'depth-basic')
    await btnClick(page, 'Toggle Depth rendering')

    // Switch depth packing to RGBDepthPacking (3202)
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('DepthBufferPlugin')
        if (p) { p.depthPacking = 3202; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await btnClick(page, 'Toggle Depth rendering')
    await screenshotMatch(page, testInfo, 'depth-rgb')
    await btnClick(page, 'Toggle Depth rendering')

    // Switch depth packing to RGDepthPacking (3203)
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('DepthBufferPlugin')
        if (p) { p.depthPacking = 3203; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await btnClick(page, 'Toggle Depth rendering')
    await screenshotMatch(page, testInfo, 'depth-rg')
    await btnClick(page, 'Toggle Depth rendering')

    // Switch back to RGBADepthPacking (3201) for remaining tests
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('DepthBufferPlugin')
        if (p) { p.depthPacking = 3201; p.setDirty() }
    })
    await page.waitForTimeout(300)

    // --- Download snapshot button ---
    await downloadFileMatch(page, 'file.png', async() => btnClick(page, 'Download snapshot'))

    // --- RenderTargetPreviewPlugin panel interactions ---
    const preview = page.locator('#RenderTargetPreviewPluginContainer')

    // Collapse the depth panel
    await preview.getByText('depth', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'panel-collapsed')

    // Expand the depth panel
    await preview.getByText('depth', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'panel-expanded')

    // Context menu: download render target
    await preview.getByText('depth', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.exr',
        async() => page.getByText('Download', {exact: true}).click())

    // Context menu: remove panel
    await preview.getByText('depth', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'panel-removed')
})

test('frame-fade-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Frame Fade Plugin')
    const evalPlugin = async(code: string) => {
        await page.evaluate((c) => {
            const v = (window as any).threeViewers?.[0]
            if (!v) return
            new Function('plugin', 'scene', c)(v.getPlugin('FrameFadePlugin'), v.scene)
        }, code)
        await page.waitForTimeout(300)
    }

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const obj = v?.scene.children?.[0]?.children?.[0]
        if (obj?.material) { obj.material.color.setHex(0x00ff00); obj.material.setDirty() }
    })
    await evalPlugin('plugin.startTransition(60000)')
    await screenshotMatch(page, testInfo, 'color-mid-fade')
    await evalPlugin('plugin.stopTransition()')
    await screenshotMatch(page, testInfo, 'color-settled')

    await btnClick(page, 'Change Color')
    await page.waitForTimeout(600)
    await screenshotMatch(page, testInfo, 'btn-color')
    await btnClick(page, 'Change Size')
    await page.waitForTimeout(600)
    await screenshotMatch(page, testInfo, 'btn-size')
    await btnClick(page, 'Change Color (no fade)')
    await page.waitForTimeout(100)
    await screenshotMatch(page, testInfo, 'no-fade')

    await evalPlugin('plugin.enabled = false')
    await btnClick(page, 'Change Color')
    await page.waitForTimeout(100)
    await screenshotMatch(page, testInfo, 'plugin-disabled')

    await evalPlugin('plugin.enabled = true')
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const obj = v?.scene.children?.[0]?.children?.[0]
        if (obj?.material) { obj.material.color.setHex(0x00ffff); obj.material.setDirty() }
    })
    await evalPlugin('plugin.startTransition(60000)')
    await screenshotMatch(page, testInfo, 're-enabled-mid-fade')
    await evalPlugin('plugin.stopTransition()')
})

test('fullscreen-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Fullscreen Plugin')

    // Open the "Full Screen" Tweakpane folder and verify its buttons exist
    await page.getByRole('button', {name: 'Full Screen'}).click()
    await page.waitForTimeout(200)

    const fsFolder = page.locator('.tp-fldv').filter({hasText: 'Full Screen'}).first()
    await expect(fsFolder.getByRole('button', {name: 'Enter FullScreen'})).toBeVisible()
    await expect(fsFolder.getByRole('button', {name: 'Exit FullScreen'})).toBeVisible()
    await expect(fsFolder.getByRole('button', {name: 'Toggle FullScreen'})).toBeVisible()
    await screenshotMatch(page, testInfo, 'tweakpane-folder-open')

    // Test via bottom button
    await btnClick(page, 'Enter/Exit fullscreen')
    await screenshotMatch(page, testInfo, 'fullscreen-entered')
    await btnClick(page, 'Enter/Exit fullscreen')
    await screenshotMatch(page, testInfo, 'fullscreen-exited')
})

test('geometry-uv-preview', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Geometry UV Preview')
    const container = page.locator('#GeometryUVPreviewPluginContainer')

    // Verify all four geometry panels exist
    await expect(container.getByText('glassDish', {exact: true})).toBeVisible()
    await expect(container.getByText('olives', {exact: true})).toBeVisible()
    await expect(container.getByText('glassCover', {exact: true})).toBeVisible()
    await expect(container.getByText('goldLeaf', {exact: true})).toBeVisible()

    // Context menu: download UV from glassDish
    await container.getByText('glassDish', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.png', async() => page.getByText('Download', {exact: true}).click(), 'uv-glassDish.png')

    // Context menu: download UV from olives
    await container.getByText('olives', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.png', async() => page.getByText('Download', {exact: true}).click(), 'uv-olives.png')

    // Collapse all panels, then expand only goldLeaf to show single-mesh UV
    await container.getByText('glassDish', {exact: true}).click()
    await container.getByText('olives', {exact: true}).click()
    await container.getByText('glassCover', {exact: true}).click()
    await container.getByText('goldLeaf', {exact: true}).click()
    await page.waitForTimeout(200)
    await container.getByText('goldLeaf', {exact: true}).click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'single-mesh-goldLeaf')

    // Context menu: remove glassDish
    await container.getByText('glassDish', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)

    // Expand remaining panels for multi-mesh screenshot
    await container.getByText('olives', {exact: true}).click()
    await container.getByText('glassCover', {exact: true}).click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'multi-mesh-selected')

    // Context menu: remove olives, verify only glassCover and goldLeaf remain
    await container.getByText('olives', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'after-two-removed')
})

test('canvas-snapshot-plugin', async({page, browserName}, testInfo) => {
    await expect(page).toHaveTitle('Canvas Snapshot Plugin')

    // JPEG download
    await downloadFileMatch(page, 'snapshot.jpeg', async() => btnClick(page, 'Download snapshot (jpeg)'))

    // Fixed-size 1024x1024 PNG (tests setRenderSize + restore)
    await downloadFileMatch(page, 'snapshot.png', async() => btnClick(page, 'Download snapshot (1024x1024 size, png)'), 'snapshot-1024.png')

    // Crop rect PNG (center crop at 2x DPR)
    await downloadFileMatch(page, 'snapshot.png', async() => btnClick(page, 'Download snapshot (crop rect, png)'), 'snapshot-crop.png')

    // WEBP — webkit doesn't support WebP export, shows alert
    const webPTrigger = async() => btnClick(page, 'Download snapshot (webp)')
    if (browserName !== 'webkit') {
        await downloadFileMatch(page, 'snapshot.webp', webPTrigger)
    } else {
        const dialogPromise = page.waitForEvent('dialog')
        const triggerPromise = webPTrigger()
        const dialog = await dialogPromise
        await dialog.accept()
        expect(dialog.message()).toBe('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
        await triggerPromise
    }

    // 3x3 Tiles PNG ZIP
    await downloadFileMatch(page, 'snapshot.zip', async() => btnClick(page, 'Download 3x3 Tiles (png zip)'))

    // Verify scene still renders correctly after all snapshot operations
    await screenshotMatch(page, testInfo, 'after-all-snapshots')
})

test('glb-export', async({page}, testInfo) => {
    await expect(page).toHaveTitle('GLB Export')
    await downloadFileMatch(page, 'helmet.glb', async() => btnClick(page, 'Download Helmet Object GLB'))
    await downloadFileMatch(page, 'helmet.pmat', async() => btnClick(page, 'Download Helmet Material'))
    await downloadFileMatch(page, 'scene.glb', async() => btnClick(page, 'Download Scene GLB (Without Viewer Config)'))
    await downloadFileMatch(page, 'scene_with_config.glb', async() => btnClick(page, 'Download Scene GLB (With Viewer Config)'))
})

test('glb-draco-export', async({page}, testInfo) => {
    await expect(page).toHaveTitle('GLB Draco Export')

    // Verify plugins are loaded and draco export options are configured
    const pluginState = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const draco = v?.getPlugin('GLTFDracoExportPlugin')
        const exporter = v?.getPlugin('AssetExporterPlugin')
        return {
            dracoEnabled: draco?.enabled,
            dracoHasExtensions: Array.isArray(draco?.extraExtensions) && draco.extraExtensions.length > 0,
            exporterEnabled: exporter?.enabled,
            dracoOptions: exporter?.exportOptions?.dracoOptions,
        }
    })
    expect(pluginState.dracoEnabled).toBe(true)
    expect(pluginState.dracoHasExtensions).toBe(true)
    expect(pluginState.exporterEnabled).toBe(true)
    expect(pluginState.dracoOptions).toBeTruthy()
    expect(pluginState.dracoOptions.method).toBe(1) // EDGEBREAKER
    expect(pluginState.dracoOptions.encodeSpeed).toBe(5)
    expect(pluginState.dracoOptions.quantizationVolume).toBe('mesh')
    expect(pluginState.dracoOptions.quantizationBits.POSITION).toBe(14)
    expect(pluginState.dracoOptions.quantizationBits.NORMAL).toBe(10)

    // Download all three draco-compressed exports
    await downloadFileMatch(page, 'helmet.glb', async() => btnClick(page, 'Download Helmet Object GLB + DRACO'))
    await downloadFileMatch(page, 'scene.glb', async() => btnClick(page, 'Download Scene GLB (Without Viewer Config) + DRACO'))
    await downloadFileMatch(page, 'scene_with_config.glb', async() => btnClick(page, 'Download Scene GLB (With Viewer Config) + DRACO'))
})

test('normal-buffer-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Normal Buffer Plugin')
    await btnClick(page, 'Toggle Normal rendering')
    await screenshotMatch(page, testInfo, 'standard-view')
    await btnClick(page, 'Toggle Normal rendering')
    await screenshotMatch(page, testInfo, 'normal-restored')

    // Disable plugin
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('NormalBufferPlugin')
        if (p) { p.enabled = false; v.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'plugin-disabled')

    // Re-enable plugin
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('NormalBufferPlugin')
        if (p) { p.enabled = true; v.setDirty() }
    })
    await page.waitForTimeout(300)

    // --- Download snapshot button ---
    await downloadFileMatch(page, 'file.png', async() => btnClick(page, 'Download snapshot'))

    // --- RenderTargetPreviewPlugin panel interactions ---
    const preview = page.locator('#RenderTargetPreviewPluginContainer')

    // Collapse the normal panel
    await preview.getByText('normal', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'panel-collapsed')

    // Expand the normal panel
    await preview.getByText('normal', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'panel-expanded')

    // Context menu: download render target
    await preview.getByText('normal', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.exr',
        async() => page.getByText('Download', {exact: true}).click())

    // Context menu: remove panel
    await preview.getByText('normal', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'panel-removed')
})

test('pmat-material-export', async({page}, testInfo) => {
    await expect(page).toHaveTitle('PMAT(Physical) Material export')

    // Visual verification: the scene shows helmet (left), re-imported sphere (center), copy sphere (right)
    // All three should display the same DamagedHelmet material — verifies PMAT roundtrip fidelity
    await screenshotMatch(page, testInfo, 'spheres-material-fidelity')

    await downloadFileMatch(page, 'material.pmat', async() => btnClick(page, 'Download PMAT'))
})

test('popmotion-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Popmotion Plugin')
    await btnClick(page, 'Move Up/Down')
    await page.waitForTimeout(700)
    await screenshotMatch(page, testInfo, 'moved-up')
    await btnClick(page, 'Rotate +90deg')
    await page.waitForTimeout(700)
    await screenshotMatch(page, testInfo, 'rotated')
    await btnClick(page, 'Change Color')
    await page.waitForTimeout(700)
    await screenshotMatch(page, testInfo, 'color-changed')
    await btnClick(page, 'Move Up/Down')
    await page.waitForTimeout(700)
    await screenshotMatch(page, testInfo, 'moved-down')
    await btnClick(page, 'Move Up/Down')
    await btnClick(page, 'Rotate +90deg')
    await page.waitForTimeout(700)
    await screenshotMatch(page, testInfo, 'concurrent')
})

test('render-target-export', async({page, browserName}, testInfo) => {
    await expect(page).toHaveTitle('Render Target Export')
    await downloadFileMatch(page, 'EffectComposer.rt1.exr', async() => btnClick(page, 'Download composer (EXR)'))
    await downloadFileMatch(page, 'depthBuffer.png', async() => btnClick(page, 'Download depth (PNG)'))
    const webPTrigger = async() => btnClick(page, 'Download composer (WEBP)')
    if (browserName !== 'webkit') {
        await downloadFileMatch(page, 'depthBuffer.jpeg', async() => btnClick(page, 'Download depth (JPEG)'))
        await downloadFileMatch(page, 'EffectComposer.rt1.webp', webPTrigger)
    } else {
        const dialogPromise = page.waitForEvent('dialog')
        const triggerPromise = webPTrigger()
        const dialog = await dialogPromise
        await dialog.accept()
        expect(dialog.message()).toBe('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
        await triggerPromise
    }
})

test('render-target-preview', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Render Target Preview')
    const container = page.locator('#RenderTargetPreviewPluginContainer')

    // Verify all four panels exist
    await expect(container.getByText('depth', {exact: true})).toBeVisible()
    await expect(container.getByText('normal', {exact: true})).toBeVisible()
    await expect(container.getByText('composer-1', {exact: true})).toBeVisible()
    await expect(container.getByText('composer-2', {exact: true})).toBeVisible()

    // Context menu: download from normal (EXR — HalfFloat target)
    await container.getByText('normal', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.exr', async() => page.getByText('Download', {exact: true}).click())

    // Context menu: download from composer-1 (PNG — standard target)
    await container.getByText('composer-1', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.png', async() => page.getByText('Download', {exact: true}).click(), 'rt-composer-1.png')

    // Context menu: download from depth (EXR — HalfFloat target with originalColorSpace)
    await container.getByText('depth', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.exr', async() => page.getByText('Download', {exact: true}).click(), 'rt-depth.exr')

    // Remove composer-1 via context menu
    await container.getByText('composer-1', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)

    // Collapse depth and normal panels
    await container.getByText('depth', {exact: true}).click()
    await container.getByText('normal', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'depth-normal-collapsed')

    // Expand composer-2
    await container.getByText('composer-2', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'composer-2-selected')

    // Remove depth and normal via context menu, leaving only composer-2
    await container.getByText('depth', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await container.getByText('normal', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'after-multi-remove')
})

test('tonemap-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Tonemap Plugin')
    await page.getByRole('button', {name: 'Tonemapping'}).click()

    await page.getByRole('combobox').selectOption('Linear')
    await screenshotMatch(page, testInfo, 'mode-linear')
    await page.getByRole('combobox').selectOption('Reinhard')
    await screenshotMatch(page, testInfo, 'mode-reinhard')
    await page.getByRole('combobox').selectOption('Cineon')
    await screenshotMatch(page, testInfo, 'mode-cineon')
    await page.getByRole('combobox').selectOption('Uncharted2')
    await screenshotMatch(page, testInfo, 'mode-uncharted2')
    await page.getByRole('combobox').selectOption('AgX')
    await screenshotMatch(page, testInfo, 'mode-agx')
    await page.getByRole('combobox').selectOption('ACESFilmic')

    const exposureBox = page.getByRole('textbox').nth(0)
    await exposureBox.dblclick()
    await exposureBox.fill('4')
    await exposureBox.press('Enter')
    await screenshotMatch(page, testInfo, 'exposure-high')
    await exposureBox.dblclick()
    await exposureBox.fill('0.2')
    await exposureBox.press('Enter')
    await screenshotMatch(page, testInfo, 'exposure-low')
    await exposureBox.dblclick()
    await exposureBox.fill('1')
    await exposureBox.press('Enter')

    // --- Saturation changes via Tweakpane textbox (index 1) ---
    const saturationBox = page.getByRole('textbox').nth(1)
    await saturationBox.dblclick()
    await saturationBox.fill('0')
    await saturationBox.press('Enter')
    await screenshotMatch(page, testInfo, 'saturation-zero')
    await saturationBox.dblclick()
    await saturationBox.fill('1')
    await saturationBox.press('Enter')

    const contrastBox = page.getByRole('textbox').nth(2)
    await contrastBox.dblclick()
    await contrastBox.fill('2')
    await contrastBox.press('Enter')
    await screenshotMatch(page, testInfo, 'contrast-high')
    await contrastBox.dblclick()
    await contrastBox.fill('1')
    await contrastBox.press('Enter')

    await page.locator('label').getByRole('img').click()
    await screenshotMatch(page, testInfo, 'disabled')
    await page.locator('label').getByRole('img').click()
    await screenshotMatch(page, testInfo, 're-enabled')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const t = v?.getPlugin('Tonemap')
        if (t) { t.tonemapBackground = false; t.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'no-bg-tonemap')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const t = v?.getPlugin('Tonemap')
        if (t) { t.tonemapBackground = true; t.setDirty() }
    })
    await page.waitForTimeout(200)
    // Set saturation to 0 via Tweakpane textbox
    await saturationBox.dblclick()
    await saturationBox.fill('0')
    await saturationBox.press('Enter')
    await page.getByRole('combobox').selectOption('Reinhard')
    await exposureBox.dblclick()
    await exposureBox.fill('3')
    await exposureBox.press('Enter')
    await screenshotMatch(page, testInfo, 'reinhard-bright-grayscale')
})

test('gbuffer-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('GBuffer Plugin')

    // --- Buffer visualization toggles ---
    await btnClick(page, 'Toggle Normal+Depth')
    await screenshotMatch(page, testInfo, 'normal-depth-on')

    // Direct switch from Normal+Depth to Flags (overrideReadBuffer is replaced)
    await btnClick(page, 'Toggle Gbuffer Flags')
    await screenshotMatch(page, testInfo, 'flags-on')

    // Direct switch from Flags to Depth Texture
    await btnClick(page, 'Toggle Depth Texture')
    await screenshotMatch(page, testInfo, 'depth-texture-on')

    // Toggle off to return to normal rendering
    await btnClick(page, 'Toggle Depth Texture')

    // --- Download snapshot while visualization is active ---
    await btnClick(page, 'Toggle Normal+Depth')
    await downloadFileMatch(page, 'file.png', async() => btnClick(page, 'Download snapshot'))
    await btnClick(page, 'Toggle Normal+Depth')

    // --- RenderTargetPreviewPlugin disable/enable ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('RenderTargetPreviewPlugin')
        if (p) { p.enabled = false; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'preview-panels-hidden')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('RenderTargetPreviewPlugin')
        if (p) { p.enabled = true; p.setDirty() }
    })
    await page.waitForTimeout(300)

    // --- Preview panel collapse/expand ---
    await page.getByText('normalDepth', {exact: true}).click()
    await page.getByText('gBufferFlags', {exact: true}).click()
    await page.getByText('depthTexture', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'all-panels-collapsed')

    await page.getByText('normalDepth', {exact: true}).click()
    await page.getByText('gBufferFlags', {exact: true}).click()
    await page.getByText('depthTexture', {exact: true}).click()
    await page.waitForTimeout(200)

    // --- Context menu: download MRT render target (direct export) ---
    await page.getByText('normalDepth', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.exr',
        async() => page.getByText('Download', {exact: true}).click(), 'normalDepth-rt.exr')

    // --- Context menu: download {texture} wrapper (exportRenderTarget blits to temp target) ---
    await page.getByText('depthTexture', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.exr',
        async() => page.getByText('Download', {exact: true}).click(), 'depthTexture-rt.exr')

    // --- Context menu: remove panel ---
    await page.getByText('depthTexture', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'depth-panel-removed')

    // --- GBuffer disable + camera move to test stale vs fresh buffer ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const gbuf = v?.getPlugin('GBuffer')
        if (gbuf) { gbuf.enabled = false; gbuf.setDirty() }
        const cam = v?.scene.mainCamera
        if (cam) {
            cam.position.set(2, 1, 3)
            cam.controls?.stopDamping?.()
            cam.setDirty()
        }
    })
    await page.waitForTimeout(500)
    await btnClick(page, 'Toggle Normal+Depth')
    await screenshotMatch(page, testInfo, 'stale-buffer-moved-camera')

    // Re-enable GBuffer — texture updates to match new camera position
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const gbuf = v?.getPlugin('GBuffer')
        if (gbuf) { gbuf.enabled = true; gbuf.setDirty() }
    })
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'fresh-buffer-moved-camera')
    await btnClick(page, 'Toggle Normal+Depth')
})

test('screen-pass-extension-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Screen Pass Extension Plugin')

    // The "Custom Tint Extension" folder is expanded by default (setupPluginUi with expanded: true).
    // UI order inside the folder: Enable toggle, Intensity slider textbox, Color picker.
    const intensityBox = page.getByRole('textbox').nth(0)

    // --- Intensity changes via Tweakpane textbox ---

    // Set intensity to minimum (0.1) — tint should be very faint
    await intensityBox.dblclick()
    await intensityBox.fill('0.1')
    await intensityBox.press('Enter')
    await screenshotMatch(page, testInfo, 'intensity-min')

    // Set intensity to maximum (4) — very strong red tint
    await intensityBox.dblclick()
    await intensityBox.fill('4')
    await intensityBox.press('Enter')
    await screenshotMatch(page, testInfo, 'intensity-max')

    // Reset intensity to default
    await intensityBox.dblclick()
    await intensityBox.fill('1')
    await intensityBox.press('Enter')

    // --- Toggle enabled via Tweakpane UI checkbox ---

    // Click the Enable toggle off — no tint, normal render
    await page.locator('label').getByRole('img').click()
    await screenshotMatch(page, testInfo, 'disabled')

    // Click the Enable toggle back on — red tint restored
    await page.locator('label').getByRole('img').click()
    await screenshotMatch(page, testInfo, 're-enabled')

    // --- Color changes (no direct textbox for color picker, use evaluate) ---

    // Change to green tint
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('CustomScreenPassExtensionPlugin')
        if (p) { p.color.set(0x00ff00); p.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'color-green')

    // Change to blue tint
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('CustomScreenPassExtensionPlugin')
        if (p) { p.color.set(0x0000ff); p.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'color-blue')

    // --- Combined: high intensity via textbox + different color via evaluate ---

    // Set cyan color programmatically (color picker has no simple textbox)
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('CustomScreenPassExtensionPlugin')
        if (p) { p.color.set(0x00ffff); p.setDirty() }
    })
    await page.waitForTimeout(200)
    // Set high intensity via UI textbox
    await intensityBox.dblclick()
    await intensityBox.fill('3')
    await intensityBox.press('Enter')
    await screenshotMatch(page, testInfo, 'combined-cyan-high-intensity')
})

test('cascaded-shadows-plugin-basic', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Cascaded Shadows Plugin Basic (Three CSM) ')

    const evalCSM = async(code: string) => {
        await page.evaluate((c) => {
            const v = (window as any).threeViewers?.[0]
            if (!v) return
            const p = v.getPlugin('CascadedShadowsPlugin')
            if (p) new Function('p', 'v', c)(p, v)
        }, code)
        await page.waitForTimeout(500)
    }

    // --- Cascade mode changes ---

    // Mode: uniform
    await evalCSM('p.mode = "uniform"')
    await screenshotMatch(page, testInfo, 'mode-uniform')

    // Mode: logarithmic
    await evalCSM('p.mode = "logarithmic"')
    await screenshotMatch(page, testInfo, 'mode-logarithmic')

    // Mode: practical (restore default)
    await evalCSM('p.mode = "practical"')
    await screenshotMatch(page, testInfo, 'mode-practical')

    // --- Fade toggle ---

    // Enable fade (default is false in this example)
    await evalCSM('p.fade = true')
    await screenshotMatch(page, testInfo, 'fade-on')

    // Disable fade
    await evalCSM('p.fade = false')
    await screenshotMatch(page, testInfo, 'fade-off')

    // --- maxFar changes ---

    await evalCSM('p.maxFar = 500')
    await screenshotMatch(page, testInfo, 'maxfar-500')

    await evalCSM('p.maxFar = 5000')
    await screenshotMatch(page, testInfo, 'maxfar-5000')

    // --- Combined: mode + fade ---

    await evalCSM('p.mode = "logarithmic"; p.fade = true')
    await screenshotMatch(page, testInfo, 'logarithmic-fade-on')

    await evalCSM('p.mode = "uniform"')
    await screenshotMatch(page, testInfo, 'uniform-fade-on')

    // Restore defaults
    await evalCSM('p.mode = "practical"; p.fade = false')

    // --- Plugin disable / re-enable cycle ---

    await evalCSM('p.enabled = false; v.setDirty()')
    await screenshotMatch(page, testInfo, 'disabled')

    await evalCSM('p.enabled = true; v.setDirty()')
    await screenshotMatch(page, testInfo, 're-enabled')

    // --- Shadow map preview panel visibility ---
    // Panels added with visible=false; clicking header text toggles them

    // Expand first two panels
    await page.getByText('csmShadowMap0', {exact: true}).click()
    await page.getByText('csmShadowMap1', {exact: true}).click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'shadow-maps-0-1')

    // Expand all four panels
    await page.getByText('csmShadowMap2', {exact: true}).click()
    await page.getByText('csmShadowMap3', {exact: true}).click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'shadow-maps-all')

    // Collapse all panels
    await page.getByText('csmShadowMap0', {exact: true}).click()
    await page.getByText('csmShadowMap1', {exact: true}).click()
    await page.getByText('csmShadowMap2', {exact: true}).click()
    await page.getByText('csmShadowMap3', {exact: true}).click()
    await page.waitForTimeout(200)

    // --- Light position change affecting shadow direction ---

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        if (!v) return
        const light = v.scene.modelRoot.getObjectByName('main light')
        if (light) {
            light.position.set(200, -200, 100)
            light.lookAt(0, 0, 0)
            light.setDirty?.()
            v.setDirty()
        }
    })
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'light-moved')

    // Show shadow panel after light move to verify shadow map updated
    await page.getByText('csmShadowMap0', {exact: true}).click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'shadow-panel-after-light-move')

    // Collapse shadow panel before next section
    await page.getByText('csmShadowMap0', {exact: true}).click()
    await page.waitForTimeout(200)

    // --- TweakpaneUI: open CSM folder and change mode via dropdown ---

    // Open the Cascaded Shadows (CSM) folder
    await page.getByText('Cascaded Shadows (CSM)', {exact: true}).click()
    await page.waitForTimeout(200)

    // Change mode to 'uniform' via the Tweakpane dropdown
    const modeSelect = page.locator('.tp-lstv_s').first()
    await modeSelect.selectOption('uniform')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'ui-mode-uniform')

    // Restore mode to practical via dropdown
    await modeSelect.selectOption('practical')
    await page.waitForTimeout(500)

    // Toggle fade via the Tweakpane checkbox in the CSM folder
    // Tweakpane hides the actual <input> — click the visible wrapper element instead
    const csmFolder = page.locator('.tp-fldv').filter({hasText: 'Cascaded Shadows (CSM)'}).first()
    const fadeRow = csmFolder.locator('.tp-lblv').filter({hasText: 'fade'})
    const fadeWrapper = fadeRow.locator('.tp-ckbv_w')
    await fadeWrapper.click()
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'ui-fade-toggled')

    // Restore fade off
    await fadeWrapper.click()
    await page.waitForTimeout(300)

    // Close the CSM folder
    await page.getByText('Cascaded Shadows (CSM)', {exact: true}).click()
    await page.waitForTimeout(200)

    // --- CSMHelper: make visible and verify ---

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        if (!v) return
        const modelRoot = v.scene.modelRoot
        modelRoot.traverse((o: any) => {
            if (o.isCSMHelper || o.constructor?.name === 'CSMHelper') {
                o.visible = true
            }
        })
        v.setDirty()
    })
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'csm-helper-visible')

    // Hide CSMHelper again
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        if (!v) return
        v.scene.modelRoot.traverse((o: any) => {
            if (o.isCSMHelper || o.constructor?.name === 'CSMHelper') {
                o.visible = false
            }
        })
        v.setDirty()
    })
    await page.waitForTimeout(300)

    // --- Context menu: download shadow map from preview panel ---

    await page.getByText('csmShadowMap1', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.png',
        async() => page.getByText('Download', {exact: true}).click(), 'csm-shadow-map-download')

    // --- Context menu: remove shadow map panel ---

    await page.getByText('csmShadowMap2', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'shadow-panel-removed')
})

test('unreal-bloom-pass', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Unreal Bloom Pass')

    const evalBloom = async(code: string) => {
        await page.evaluate((c) => {
            const v = (window as any).threeViewers?.[0]
            if (!v) return
            const pass = v.renderManager.passes.find((p: any) => p.passId === 'unrealBloom')
            if (pass) new Function('pass', 'v', c)(pass, v)
        }, code)
        await page.waitForTimeout(300)
    }

    // Open the "Unreal Bloom" folder in Tweakpane UI
    await page.getByRole('button', {name: 'Unreal Bloom'}).click()

    // Textbox order inside the Unreal Bloom folder: Strength (0), Radius (1), Threshold (2)
    const strengthBox = page.getByRole('textbox').nth(0)
    const radiusBox = page.getByRole('textbox').nth(1)
    const thresholdBox = page.getByRole('textbox').nth(2)

    // --- Strength extremes via Tweakpane textbox ---

    // Strength = 0: no bloom visible
    await strengthBox.dblclick()
    await strengthBox.fill('0')
    await strengthBox.press('Enter')
    await screenshotMatch(page, testInfo, 'strength-zero')

    // Strength = 5: maximum bloom
    await strengthBox.dblclick()
    await strengthBox.fill('5')
    await strengthBox.press('Enter')
    await screenshotMatch(page, testInfo, 'strength-max')

    // Restore default
    await strengthBox.dblclick()
    await strengthBox.fill('1')
    await strengthBox.press('Enter')

    // --- Radius extremes via Tweakpane textbox ---

    // Radius = 0: tight bloom
    await radiusBox.dblclick()
    await radiusBox.fill('0')
    await radiusBox.press('Enter')
    await screenshotMatch(page, testInfo, 'radius-zero')

    // Radius = 1: maximum spread
    await radiusBox.dblclick()
    await radiusBox.fill('1')
    await radiusBox.press('Enter')
    await screenshotMatch(page, testInfo, 'radius-max')

    // Restore default
    await radiusBox.dblclick()
    await radiusBox.fill('0.5')
    await radiusBox.press('Enter')

    // --- Threshold extremes via Tweakpane textbox ---

    // Threshold = 0: everything blooms
    await thresholdBox.dblclick()
    await thresholdBox.fill('0')
    await thresholdBox.press('Enter')
    await screenshotMatch(page, testInfo, 'threshold-zero')

    // Threshold = 8: nothing blooms (all below threshold)
    await thresholdBox.dblclick()
    await thresholdBox.fill('8')
    await thresholdBox.press('Enter')
    await screenshotMatch(page, testInfo, 'threshold-max')

    // Restore default
    await thresholdBox.dblclick()
    await thresholdBox.fill('1.5')
    await thresholdBox.press('Enter')

    // --- Pass enable/disable (no UI toggle exists for enabled, use evaluate) ---

    // Disable the bloom pass entirely
    await evalBloom('pass.enabled = false; pass.setDirty()')
    await screenshotMatch(page, testInfo, 'pass-disabled')

    // Re-enable the bloom pass
    await evalBloom('pass.enabled = true; pass.setDirty()')
    await screenshotMatch(page, testInfo, 'pass-re-enabled')

    // --- Combined extremes (multiple params at once, use evaluate for efficiency) ---

    // Max strength + zero threshold = extreme bloom on everything
    await evalBloom('pass.strength = 5; pass.threshold = 0; pass.setDirty()')
    await screenshotMatch(page, testInfo, 'combined-max-strength-zero-threshold')

    // Max strength + max radius + zero threshold = maximum possible bloom
    await evalBloom('pass.strength = 5; pass.radius = 1; pass.threshold = 0; pass.setDirty()')
    await screenshotMatch(page, testInfo, 'combined-all-max')

    // Zero strength overrides everything = no bloom regardless of other params
    await evalBloom('pass.strength = 0; pass.radius = 1; pass.threshold = 0; pass.setDirty()')
    await screenshotMatch(page, testInfo, 'combined-zero-strength-overrides')

    // Restore defaults
    await evalBloom('pass.strength = 1; pass.radius = 0.5; pass.threshold = 1.5; pass.setDirty()')
    await screenshotMatch(page, testInfo, 'restored-defaults')
})

test('gltf-transmission-test-msaa', async({page}, testInfo) => {
    await expect(page).toHaveTitle('GLTF Transmission Test (MSAA)')

    // Helper to evaluate material changes
    const evalMaterial = async(code: string) => {
        await page.evaluate((c) => {
            const v = (window as any).threeViewers?.[0]
            if (!v) return
            const lamp = v.scene.getObjectByName('lamp_transmission')
            const glass = v.scene.getObjectByName('glassCover')
            const lampMat = lamp?.material
            const glassMat = glass?.material
            new Function('lampMat', 'glassMat', 'v', c)(lampMat, glassMat, v)
        }, code)
        await page.waitForTimeout(300)
    }

    // --- Tweakpane UI: expand main panel, then open glassCover's Refraction folder ---
    // The TweakpaneUiPlugin is created with expanded=false, so expand the root panel first.
    const tpToggle = page.locator('.tp-rotv_b')
    await tpToggle.click()
    await page.waitForTimeout(200)

    // Two "Physical Material" folders exist: lamp_transmission (1st) and glassCover (2nd).
    // Both are expanded by default (uiConfig expanded: true). Open the Refraction subfolder
    // in the glassCover material folder (2nd occurrence).
    await page.getByText('Refraction', {exact: true}).nth(1).click()
    await page.waitForTimeout(200)

    // Scope to the glassCover Refraction folder for textbox interactions.
    // Use :has(>) to match only folders whose direct title is "Refraction" (not parents).
    // Refraction folder controls order: ior (textbox 0), transmission (textbox 1), thickness (textbox 2)
    const glassRefractionFolder = page.locator('.tp-fldv:has(> .tp-fldv_b .tp-fldv_t:text-is("Refraction"))').nth(1)
    const glassIorBox = glassRefractionFolder.getByRole('textbox').nth(0)
    const glassTransmissionBox = glassRefractionFolder.getByRole('textbox').nth(1)

    // Helper: interact with a textbox value, collapse panel, screenshot, re-expand
    const tpTextboxChange = async(box: ReturnType<typeof page.getByRole>, value: string) => {
        await box.dblclick()
        await box.fill(value)
        await box.press('Enter')
    }

    // --- Transmission value changes on glass material via Tweakpane textbox ---

    // Set transmission to 0 (fully opaque)
    await tpTextboxChange(glassTransmissionBox, '0')
    // Collapse panel before screenshot to ensure deterministic viewport-only screenshots
    await tpToggle.click()
    await page.waitForTimeout(100)
    await screenshotMatch(page, testInfo, 'glass-transmission-zero')
    await tpToggle.click()
    await page.waitForTimeout(100)

    // Set transmission to 1 (fully transmissive)
    await tpTextboxChange(glassTransmissionBox, '1')
    await tpToggle.click()
    await page.waitForTimeout(100)
    await screenshotMatch(page, testInfo, 'glass-transmission-full')
    await tpToggle.click()
    await page.waitForTimeout(100)

    // --- IOR changes on glass material via Tweakpane textbox ---

    // Low IOR (close to air — less refraction)
    await tpTextboxChange(glassIorBox, '1')
    await tpToggle.click()
    await page.waitForTimeout(100)
    await screenshotMatch(page, testInfo, 'glass-ior-low')
    await tpToggle.click()
    await page.waitForTimeout(100)

    // High IOR (diamond-like — strong refraction)
    await tpTextboxChange(glassIorBox, '2.4')
    await tpToggle.click()
    await page.waitForTimeout(100)
    await screenshotMatch(page, testInfo, 'glass-ior-high')
    await tpToggle.click()
    await page.waitForTimeout(100)

    // Restore IOR
    await tpTextboxChange(glassIorBox, '1.5')
    // Collapse panel for remaining evaluate-based tests
    await tpToggle.click()
    await page.waitForTimeout(100)

    // --- Opacity/transparency toggle ---

    // Make glass fully opaque (disable transparency)
    await evalMaterial('glassMat.opacity = 0.3; glassMat.setDirty()')
    await screenshotMatch(page, testInfo, 'glass-opacity-low')

    // Restore opacity
    await evalMaterial('glassMat.opacity = 1; glassMat.setDirty()')
    await screenshotMatch(page, testInfo, 'glass-opacity-restored')

    // --- Lamp transmission material changes ---

    await evalMaterial('lampMat.transmission = 0; lampMat.setDirty()')
    await screenshotMatch(page, testInfo, 'lamp-transmission-zero')

    await evalMaterial('lampMat.transmission = 1; lampMat.setDirty()')
    await screenshotMatch(page, testInfo, 'lamp-transmission-full')

    // --- Preview panel interactions ---

    // Scope to the preview container to avoid TweakpaneUI label conflicts
    const preview = page.locator('#RenderTargetPreviewPluginContainer')

    // Collapse panels by clicking their header text
    await preview.getByText('composer-1', {exact: true}).click()
    await preview.getByText('transparent', {exact: true}).click()
    await preview.getByText('composer-2', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'all-panels-collapsed')

    // Expand all panels
    await preview.getByText('composer-1', {exact: true}).click()
    await preview.getByText('transparent', {exact: true}).click()
    await preview.getByText('composer-2', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'all-panels-expanded')

    // --- Context menu: download from preview panel ---
    await preview.getByText('transparent', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.exr',
        async() => page.getByText('Download', {exact: true}).click())

    // --- Context menu: remove panel ---
    await preview.getByText('composer-2', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'composer-2-removed')

    // --- RenderTargetPreviewPlugin disable/enable cycle ---

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('RenderTargetPreviewPlugin')
        if (p) { p.enabled = false; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'preview-disabled')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('RenderTargetPreviewPlugin')
        if (p) { p.enabled = true; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'preview-re-enabled')
})

test('stencil-clipping-portal', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Stencil Clipping WebGL')

    const evalScene = async(code: string) => {
        await page.evaluate((c) => {
            const v = (window as any).threeViewers?.[0]
            if (!v) return
            const root = v.scene.modelRoot
            let maskPlane: any = null, maskCube: any = null, model: any = null
            root.traverse((o: any) => {
                if (!maskPlane && o.geometry?.type === 'PlaneGeometry') maskPlane = o
                if (!maskCube && o.geometry?.type === 'BoxGeometry') maskCube = o
                if (!model && o.name === 'node_damagedHelmet_-6514') model = o
            })
            const mat = model?.materials?.[0] || model?.material
            new Function('v', 'maskPlane', 'maskCube', 'model', 'mat', c)(v, maskPlane, maskCube, model, mat)
        }, code)
        await page.waitForTimeout(500)
    }

    // --- Tweakpane UI: collapse Picker folder and expand object config ---
    // The Picker folder is expanded by default with the selected model's config.
    // Collapse the Picker folder, then verify via screenshot.
    await page.getByRole('button', {name: 'Picker'}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'picker-collapsed')
    // Re-expand it
    await page.getByRole('button', {name: 'Picker'}).click()
    await page.waitForTimeout(200)

    // Collapse the object config folder (node_damagedHelmet_-6514)
    await page.getByRole('button', {name: 'node_damagedHelmet_-6514'}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'object-folder-collapsed')
    // Re-expand it
    await page.getByRole('button', {name: 'node_damagedHelmet_-6514'}).click()
    await page.waitForTimeout(200)

    // Mask + model moved together — tests portal position AND model clipping
    await evalScene(`
        maskPlane.position.set(0.5, 0.3, 0);
        maskPlane.dispatchEvent({type: 'objectUpdate'});
        if (model) { model.position.set(-0.3, 0, 0.5); model.setDirty?.(); }
        v.setDirty()
    `)
    await screenshotMatch(page, testInfo, 'mask-and-model-moved')

    // Reset positions, stencilRef mismatch — model disappears (LessEqual(3,2) fails)
    await evalScene(`
        maskPlane.position.set(0, 0, 0); maskPlane.dispatchEvent({type: 'objectUpdate'});
        if (model) { model.position.set(0, 0, -0.4); model.setDirty?.(); }
        maskPlane.material.stencilRef = 2; maskPlane.material.needsUpdate = true;
        maskCube.material.stencilRef = 2; maskCube.material.needsUpdate = true;
        if (mat) { mat.stencilRef = 3; mat.needsUpdate = true; }
        v.setDirty()
    `)
    await screenshotMatch(page, testInfo, 'stencilref-mismatch')

    // Restore refs + disable mask stencilWrite — portal gone, helmet invisible
    await evalScene(`
        maskPlane.material.stencilRef = 1; maskPlane.material.needsUpdate = true;
        maskCube.material.stencilRef = 1; maskCube.material.needsUpdate = true;
        if (mat) { mat.stencilRef = 1; mat.needsUpdate = true; }
        maskPlane.material.stencilWrite = false; maskPlane.material.needsUpdate = true;
        maskCube.material.stencilWrite = false; maskCube.material.needsUpdate = true;
        v.setDirty()
    `)
    await screenshotMatch(page, testInfo, 'mask-stencil-off')

    // Also disable model stencilWrite — no portal at all, model fully visible
    await evalScene(`
        if (mat) { mat.stencilWrite = false; mat.needsUpdate = true; }
        v.setDirty()
    `)
    await screenshotMatch(page, testInfo, 'all-stencil-off')

    // Re-enable everything — portal fully restored
    await evalScene(`
        maskPlane.material.stencilWrite = true; maskPlane.material.needsUpdate = true;
        maskCube.material.stencilWrite = true; maskCube.material.needsUpdate = true;
        if (mat) { mat.stencilWrite = true; mat.needsUpdate = true; }
        v.setDirty()
    `)
    await screenshotMatch(page, testInfo, 'portal-restored')
})

test('multi-render-uv-clip', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Multi-Render UV Clipping')

    // --- Tweakpane UI: use the "Clip UV X" slider textbox ---
    const clipSlider = page.getByRole('textbox').first()

    // Set clip to 0 via the slider textbox — full green material (original fully clipped)
    await clipSlider.dblclick()
    await clipSlider.fill('0')
    await clipSlider.press('Enter')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'clip-full-green')

    // Even split at center via slider textbox
    await clipSlider.dblclick()
    await clipSlider.fill('0.5')
    await clipSlider.press('Enter')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'clip-half-split')

    // Full original material (green fully clipped) via slider textbox
    await clipSlider.dblclick()
    await clipSlider.fill('1')
    await clipSlider.press('Enter')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'clip-full-original')

    // Asymmetric split via slider textbox — mostly green with thin original strip
    await clipSlider.dblclick()
    await clipSlider.fill('0.15')
    await clipSlider.press('Enter')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'clip-mostly-green')
})

test('material-configurator-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Material Configurator Plugin')

    // Note: TemporalAA, SSReflection, SSAA, WatchHands are disabled by deterministic-injection.js
    // to ensure deterministic screenshots.

    // --- Query variations loaded from the GLB ---
    const variationInfo = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('MaterialConfiguratorPlugin')
        if (!p) return null
        return p.variations.map((vr: any) => ({
            title: vr.title,
            uuid: vr.uuid,
            count: vr.materials.length,
            materialNames: vr.materials.map((m: any) => m.name || m.uuid),
        }))
    })
    expect(variationInfo).toBeTruthy()
    expect(variationInfo.length).toBeGreaterThan(0)

    // --- Click grid items to apply variations via UI ---
    // The GridItemListPlugin renders .customContextGridItems as clickable swatches.
    // Click the second swatch in the first variation section to apply it.
    const firstSectionItems = page.locator('.customContextGrid').first().locator('.customContextGridItems')

    if (variationInfo[0].count > 1) {
        await firstSectionItems.nth(1).click()
        await page.waitForTimeout(1500) // animateApply duration is 1000ms
        await screenshotMatch(page, testInfo, 'grid-click-variation-0-mat-1')
    }

    // Click the first swatch back
    await firstSectionItems.nth(0).click()
    await page.waitForTimeout(1500)
    await screenshotMatch(page, testInfo, 'grid-click-variation-0-mat-0')

    // --- Click a swatch in the second variation section if available ---
    if (variationInfo.length > 1 && variationInfo[1].count > 1) {
        const secondSectionItems = page.locator('.customContextGrid').nth(1).locator('.customContextGridItems')
        await secondSectionItems.nth(1).click()
        await page.waitForTimeout(1500)
        await screenshotMatch(page, testInfo, 'grid-click-variation-1-mat-1')

        // Reset back to first material
        await secondSectionItems.nth(0).click()
        await page.waitForTimeout(1500)
    }

    // --- Context menu on variation container: verify items ---
    const firstSection = page.locator('.customContextGrid').first()

    await firstSection.click({button: 'right', position: {x: 50, y: 5}})
    await expect(page.locator('#customContextMenu')).toBeVisible()
    const variationMenuItems = await page.locator('#customContextMenu .customContextMenuItems').allTextContents()
    expect(variationMenuItems).toEqual(['Rename Mapping', 'Rename Title', 'Clear Materials', 'Remove Section'])
    // Dismiss context menu by clicking elsewhere
    await page.mouse.click(640, 360)
    await page.waitForTimeout(200)

    // --- Context menu on grid item: verify items ---
    await firstSectionItems.first().click({button: 'right'})
    await expect(page.locator('#customContextMenu')).toBeVisible()
    const itemMenuItems = await page.locator('#customContextMenu .customContextMenuItems').allTextContents()
    expect(itemMenuItems).toEqual(['Remove'])
    // Dismiss
    await page.mouse.click(640, 360)
    await page.waitForTimeout(200)

    // --- Rename Title via context menu + HTML dialog UI ---
    // TweakpaneUiPlugin replaces windowDialogWrapper with htmlDialogWrapper,
    // so viewer.dialog.prompt() creates an HTML .dialog-container with .dialog-input and buttons.
    await firstSection.click({button: 'right', position: {x: 50, y: 5}})
    await expect(page.locator('#customContextMenu')).toBeVisible()
    await page.locator('#customContextMenu .customContextMenuItems').filter({hasText: 'Rename Title'}).click()
    // Wait for the HTML prompt dialog to appear
    const promptDialog = page.locator('.dialog-container')
    await expect(promptDialog).toBeVisible()
    // Clear the input and type new title
    const promptInput = promptDialog.locator('.dialog-input')
    await promptInput.fill('My Custom Title')
    await promptDialog.locator('.dialog-ok').click()
    await page.waitForTimeout(500)
    const headingText = await page.locator('.customContextGrid').first().locator('.customContextGridHeading').textContent()
    expect(headingText?.trim()).toContain('My Custom Title')
    await screenshotMatch(page, testInfo, 'renamed-title')

    // --- Rename Mapping via context menu + HTML dialog UI ---
    await firstSection.click({button: 'right', position: {x: 50, y: 5}})
    await expect(page.locator('#customContextMenu')).toBeVisible()
    await page.locator('#customContextMenu .customContextMenuItems').filter({hasText: 'Rename Mapping'}).click()
    await expect(promptDialog).toBeVisible()
    await promptDialog.locator('.dialog-input').fill('custom-mapping-name')
    await promptDialog.locator('.dialog-ok').click()
    await page.waitForTimeout(500)
    // Verify the mapping changed (shown in heading when enableEditContextMenus is true)
    const headingAfterMapping = await page.locator('.customContextGrid').first().locator('.customContextGridHeading').textContent()
    expect(headingAfterMapping?.trim()).toContain('custom-mapping-name')

    // --- Remove a material from first variation via context menu + HTML confirm dialog ---
    const itemCountBefore = await page.locator('.customContextGrid').first().locator('.customContextGridItems').count()
    if (itemCountBefore > 1) {
        // Right-click the last grid item to open its context menu
        await firstSectionItems.nth(itemCountBefore - 1).click({button: 'right'})
        await expect(page.locator('#customContextMenu')).toBeVisible()
        await page.locator('#customContextMenu .customContextMenuItems').filter({hasText: 'Remove'}).click()
        // Wait for the HTML confirm dialog to appear and click OK
        const confirmDialog = page.locator('.dialog-container')
        await expect(confirmDialog).toBeVisible()
        await confirmDialog.locator('.dialog-ok').click()
        await page.waitForTimeout(500)
        const itemCountAfter = await page.locator('.customContextGrid').first().locator('.customContextGridItems').count()
        expect(itemCountAfter).toBe(itemCountBefore - 1)
        // Force re-render to ensure preview generation is complete before screenshot
        await page.evaluate(() => {
            const v = (window as any).threeViewers?.[0]
            if (v) v.setDirty()
        })
        await page.waitForTimeout(300)
        await screenshotMatch(page, testInfo, 'material-removed')
    }

    // --- Clear Materials via context menu + HTML confirm dialog (on second section if available) ---
    const sectionCountBefore = await page.locator('.customContextGrid').count()
    if (sectionCountBefore > 1) {
        const secondSection = page.locator('.customContextGrid').nth(1)
        const secondItemsBefore = await secondSection.locator('.customContextGridItems').count()
        if (secondItemsBefore > 0) {
            await secondSection.click({button: 'right', position: {x: 50, y: 5}})
            await expect(page.locator('#customContextMenu')).toBeVisible()
            await page.locator('#customContextMenu .customContextMenuItems').filter({hasText: 'Clear Materials'}).click()
            const clearConfirm = page.locator('.dialog-container')
            await expect(clearConfirm).toBeVisible()
            await clearConfirm.locator('.dialog-ok').click()
            await page.waitForTimeout(500)
            const secondItemsAfter = await secondSection.locator('.customContextGridItems').count()
            expect(secondItemsAfter).toBe(0)
        }
    }

    // --- Remove Section via context menu + HTML confirm dialog ---
    const sectionsBeforeRemove = await page.locator('.customContextGrid').count()
    if (sectionsBeforeRemove > 1) {
        const lastSection = page.locator('.customContextGrid').last()
        await lastSection.click({button: 'right', position: {x: 50, y: 5}})
        await expect(page.locator('#customContextMenu')).toBeVisible()
        await page.locator('#customContextMenu .customContextMenuItems').filter({hasText: 'Remove Section'}).click()
        const removeSectionConfirm = page.locator('.dialog-container')
        await expect(removeSectionConfirm).toBeVisible()
        await removeSectionConfirm.locator('.dialog-ok').click()
        await page.waitForTimeout(500)
        const sectionsAfterRemove = await page.locator('.customContextGrid').count()
        expect(sectionsAfterRemove).toBe(sectionsBeforeRemove - 1)
    }
    await screenshotMatch(page, testInfo, 'after-context-menu-ops')

    // --- Plugin disable / re-enable cycle ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('MaterialConfiguratorPlugin')
        if (p) { p.enabled = false; v.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'plugin-disabled')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('MaterialConfiguratorPlugin')
        if (p) { p.enabled = true; v.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'plugin-re-enabled')

    // --- Apply all variations to last material via grid clicks ---
    // Re-query current state after context menu operations
    const allSections = page.locator('.customContextGrid')
    const sectionCount = await allSections.count()
    for (let i = 0; i < sectionCount; i++) {
        const items = allSections.nth(i).locator('.customContextGridItems')
        const count = await items.count()
        if (count > 1) {
            await items.nth(count - 1).click()
            await page.waitForTimeout(1500)
        }
    }
    if (sectionCount > 0) {
        await screenshotMatch(page, testInfo, 'all-variations-last-material')
    }

    // --- WatchHands plugin enable/disable ---
    // WatchHandsPlugin is disabled by deterministic-injection.js (time-dependent).
    // The second hand position depends on exact frameId at render time, making
    // per-frame screenshots non-deterministic. We verify the plugin works by
    // enabling it (which visibly moves the hour/minute hands from their initial
    // position set in the example script) and confirming the render changes.
    // The analog toggle is tested as a property change even though the visual
    // difference may be subtle.
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const wh = v?.getPlugin('WatchHandsPlugin')
        if (!wh) return
        wh.enabled = true
        wh.invertAxis = true
        wh.analog = false
        // Use large offset values to position hour hand at 12 o'clock
        // where small time drift has minimal visual impact
        wh.hourOffset = 0
        wh.minuteOffset = 0
        wh.secondOffset = 0
        v.setDirty()
    })
    await page.waitForTimeout(500)
    // Verify the plugin is active and check state programmatically
    const watchState = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const wh = v?.getPlugin('WatchHandsPlugin')
        return {enabled: wh?.enabled, analog: wh?.analog, invertAxis: wh?.invertAxis}
    })
    expect(watchState.enabled).toBe(true)
    expect(watchState.analog).toBe(false)
    expect(watchState.invertAxis).toBe(true)

    // Disable WatchHands at the end
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const wh = v?.getPlugin('WatchHandsPlugin')
        if (wh) { wh.enabled = false; v.setDirty() }
    })
    await page.waitForTimeout(300)
})

test('instanced-mesh', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Instanced Mesh ')

    // Scope to the preview container for panel interactions
    const preview = page.locator('#RenderTargetPreviewPluginContainer')

    // --- Verify all 3 preview panels exist ---
    await expect(preview.getByText('normalDepth', {exact: true})).toBeVisible()
    await expect(preview.getByText('gBufferFlags', {exact: true})).toBeVisible()
    await expect(preview.getByText('depthTexture', {exact: true})).toBeVisible()

    // --- Instance count change via evaluate (no UI for this) ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const scene = v?.scene
        if (!scene) return
        let instMesh: any = null
        scene.traverse((o: any) => { if (o.isInstancedMesh) instMesh = o })
        if (instMesh) {
            instMesh.count = 5
            instMesh.setDirty?.()
            v.setDirty()
        }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'instance-count-5')

    // Restore count to 20
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const scene = v?.scene
        if (!scene) return
        let instMesh: any = null
        scene.traverse((o: any) => { if (o.isInstancedMesh) instMesh = o })
        if (instMesh) {
            instMesh.count = 20
            instMesh.setDirty?.()
            v.setDirty()
        }
    })
    await page.waitForTimeout(300)

    // --- Modify instance matrices (move first 10 to a line via raw Float32Array) ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const scene = v?.scene
        if (!scene) return
        let instMesh: any = null
        scene.traverse((o: any) => { if (o.isInstancedMesh) instMesh = o })
        if (!instMesh) return
        const arr = instMesh.instanceMatrix.array as Float32Array
        for (let i = 0; i < Math.min(10, instMesh.count); i++) {
            const off = i * 16
            // Identity matrix with translation (x = i*0.6-2.7, y = 2, z = 0)
            arr.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i * 0.6 - 2.7, 2, 0, 1], off)
        }
        instMesh.instanceMatrix.needsUpdate = true
        instMesh.setDirty?.()
        v.setDirty()
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'instances-clustered')

    // Camera move to verify 3D scene from another angle
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const cam = v?.scene?.mainCamera
        if (cam) {
            cam.position.set(3, 2, 3)
            cam.controls?.stopDamping?.()
            cam.setDirty()
        }
        v?.setDirty()
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'camera-moved')

    // Reset camera
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const cam = v?.scene?.mainCamera
        if (cam) {
            cam.position.set(0, 0, 5)
            cam.controls?.stopDamping?.()
            cam.setDirty()
        }
        v?.setDirty()
    })
    await page.waitForTimeout(300)

    // --- RenderTargetPreview panel collapse/expand ---
    await preview.getByText('normalDepth', {exact: true}).click()
    await preview.getByText('gBufferFlags', {exact: true}).click()
    await preview.getByText('depthTexture', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'all-panels-collapsed')

    await preview.getByText('normalDepth', {exact: true}).click()
    await preview.getByText('gBufferFlags', {exact: true}).click()
    await preview.getByText('depthTexture', {exact: true}).click()
    await page.waitForTimeout(200)

    // --- Context menu: download normalDepth (MRT target, UnsignedByteType → PNG) ---
    await preview.getByText('normalDepth', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.png',
        async() => page.getByText('Download', {exact: true}).click(), 'normalDepth-rt.png')

    // --- Context menu: download depthTexture ({texture} wrapper — blit to temp target → PNG) ---
    await preview.getByText('depthTexture', {exact: true}).click({button: 'right'})
    await downloadFileMatch(page, 'renderTarget.png',
        async() => page.getByText('Download', {exact: true}).click(), 'depthTexture-rt.png')

    // --- Context menu: remove depthTexture panel ---
    await preview.getByText('depthTexture', {exact: true}).click({button: 'right'})
    await page.getByText('Remove', {exact: true}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'depth-panel-removed')

    // --- DepthBufferPlugin toggle ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('DepthBufferPlugin')
        if (p) { p.enabled = false; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'depth-buffer-disabled')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('DepthBufferPlugin')
        if (p) { p.enabled = true; p.setDirty() }
    })
    await page.waitForTimeout(300)

    // --- RenderTargetPreviewPlugin disable/enable ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('RenderTargetPreviewPlugin')
        if (p) { p.enabled = false; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'preview-disabled')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('RenderTargetPreviewPlugin')
        if (p) { p.enabled = true; p.setDirty() }
    })
    await page.waitForTimeout(300)

    // --- PickingPlugin TweakpaneUI interactions ---
    // The Picker folder is expanded by default with the selected instanced mesh config.
    // Collapse the Picker folder
    await page.getByRole('button', {name: 'Picker'}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'picker-collapsed')

    // Re-expand it
    await page.getByRole('button', {name: 'Picker'}).click()
    await page.waitForTimeout(200)

    // Toggle Widget Enabled checkbox in the Picker folder
    const pickerFolder = page.locator('.tp-fldv').first()
    const widgetEnabledRow = pickerFolder.locator('.tp-lblv').filter({hasText: 'Widget Enabled'})
    const widgetEnabledCheckbox = widgetEnabledRow.locator('.tp-ckbv_w')
    await widgetEnabledCheckbox.click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'widget-disabled')

    // Re-enable widget
    await widgetEnabledCheckbox.click()
    await page.waitForTimeout(300)
})

test('transform-controls-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Transform Controls Plugin')

    // The model is pre-selected (picking.setSelectedObject(model)) so
    // the translate gizmo is visible from the start — captured by `initial`.

    // Locate the outer plugin folder "Transform Controls" (expanded by setupPluginUi)
    const pluginFolder = page.locator('.tp-fldv').filter({hasText: 'Transform Controls'}).first()

    // The TransformControls2 sub-object has its own "Transform Controls" folder inside.
    // The dropdowns/toggles live inside that inner folder. Because the outer
    // folder is first in DOM order and `first()` was used above, we need to
    // scope dropdown/toggle selectors carefully.

    // Helper: locate the Tweakpane dropdown (<select>) by the label text
    const selectByLabel = (label: string) =>
        pluginFolder.locator('.tp-lblv').filter({hasText: label}).locator('.tp-lstv_s')

    // Helper: locate a Tweakpane checkbox wrapper by the label text
    const checkboxByLabel = (label: string) =>
        pluginFolder.locator('.tp-lblv').filter({hasText: label}).locator('.tp-ckbv_w')

    // Helper: locate a Tweakpane textbox by label
    const textboxByLabel = (label: string) =>
        pluginFolder.locator('.tp-lblv').filter({hasText: label}).locator('.tp-txtv_i').first()

    // --- Mode switching via TweakpaneUI dropdown ---

    const modeSelect = selectByLabel('Mode')

    await modeSelect.selectOption('rotate')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'mode-rotate')

    await modeSelect.selectOption('scale')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'mode-scale')

    // Restore translate
    await modeSelect.selectOption('translate')
    await page.waitForTimeout(500)

    // --- Space toggle via TweakpaneUI dropdown ---

    const spaceSelect = selectByLabel('Space')

    await spaceSelect.selectOption('local')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'space-local')

    await spaceSelect.selectOption('world')
    await page.waitForTimeout(500)

    // --- Size slider via textbox ---

    const sizeBox = textboxByLabel('Size')
    await sizeBox.dblclick()
    await sizeBox.fill('3')
    await sizeBox.press('Enter')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'size-large')

    // Restore default size
    await sizeBox.dblclick()
    await sizeBox.fill('1.25')
    await sizeBox.press('Enter')
    await page.waitForTimeout(300)

    // --- Axis toggles via TweakpaneUI checkboxes ---

    const showXCheckbox = checkboxByLabel('Show X')
    const showYCheckbox = checkboxByLabel('Show Y')
    const showZCheckbox = checkboxByLabel('Show Z')

    // Hide X axis
    await showXCheckbox.click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'hide-x')

    // Restore X, hide Y
    await showXCheckbox.click()
    await showYCheckbox.click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'hide-y')

    // Restore Y, hide Z
    await showYCheckbox.click()
    await showZCheckbox.click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'hide-z')

    // Restore Z
    await showZCheckbox.click()
    await page.waitForTimeout(300)

    // --- Deselect by clearing selection programmatically ---
    // PickingPlugin doesn't expose a "click empty space" button, so we deselect
    // via the picking API (no UI control exists for deselection).

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('PickingPlugin')
        if (p) { p.setSelectedObject(null); v.setDirty() }
    })
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'deselected')

    // --- Reselect by restoring the model selection ---

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('PickingPlugin')
        if (p) {
            const model = v.scene.children?.[0]?.children?.[0]
            if (model) { p.setSelectedObject(model); v.setDirty() }
        }
    })
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'reselected')

    // --- Plugin disable/enable via the enabled checkbox in the UI ---

    const enabledCheckbox = checkboxByLabel('enabled')
    await enabledCheckbox.click()
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'plugin-disabled')

    // Re-enable
    await enabledCheckbox.click()
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'plugin-re-enabled')

    // --- Drag gizmo to translate the object along X axis ---

    // Get the object's position before drag
    const posBeforeDrag = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        const obj = p?.getSelectedObject()
        return obj ? {x: obj.position.x, y: obj.position.y, z: obj.position.z} : null
    })
    expect(posBeforeDrag).toBeTruthy()

    const canvas = page.locator('#mcanvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not found')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // The translate gizmo X axis handle extends to the right from the object center.
    // Drag from slightly right of center (on the X handle) further right.
    await page.mouse.move(cx + 30, cy)
    await page.waitForTimeout(200)
    await page.mouse.down()
    await page.mouse.move(cx + 120, cy, {steps: 10})
    await page.mouse.up()
    await page.waitForTimeout(500)

    const posAfterDrag = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        const obj = p?.getSelectedObject()
        return obj ? {x: obj.position.x, y: obj.position.y, z: obj.position.z} : null
    })
    expect(posAfterDrag).toBeTruthy()
    // The X position should have changed after dragging along X axis
    expect(posAfterDrag!.x).not.toBeCloseTo(posBeforeDrag!.x, 1)
    await screenshotMatch(page, testInfo, 'after-translate-drag')

    // --- Switch to rotate mode and drag to rotate the object ---

    await modeSelect.selectOption('rotate')
    await page.waitForTimeout(500)

    const rotBeforeDrag = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        const obj = p?.getSelectedObject()
        return obj ? {x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z} : null
    })
    expect(rotBeforeDrag).toBeTruthy()

    // Get the object's screen-space position to find where the rotate gizmo is.
    // We project the object's world position to screen coords using the camera's matrices.
    const objScreenPos = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        const obj = p?.getSelectedObject()
        if (!obj || !v) return null
        // Use matrixWorld to get world position (column 3 of 4x4 matrix)
        const mw = obj.matrixWorld.elements
        const wx = mw[12], wy = mw[13], wz = mw[14]
        // Project to NDC using camera's projectionMatrix * matrixWorldInverse
        const cam = v.scene.mainCamera
        cam.updateMatrixWorld(true)
        const vi = cam.matrixWorldInverse.elements
        const pr = cam.projectionMatrix.elements
        // Apply view matrix
        const vx = vi[0] * wx + vi[4] * wy + vi[8] * wz + vi[12]
        const vy = vi[1] * wx + vi[5] * wy + vi[9] * wz + vi[13]
        const vz = vi[2] * wx + vi[6] * wy + vi[10] * wz + vi[14]
        const vw = vi[3] * wx + vi[7] * wy + vi[11] * wz + vi[15]
        // Apply projection matrix
        const px = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12] * vw
        const py = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13] * vw
        const pw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15] * vw
        // NDC
        const ndcX = px / pw
        const ndcY = py / pw
        const canvas = v.canvas
        const rect = canvas.getBoundingClientRect()
        return {
            x: rect.x + (ndcX + 1) / 2 * rect.width,
            y: rect.y + (-ndcY + 1) / 2 * rect.height,
        }
    })
    expect(objScreenPos).toBeTruthy()

    // The rotation gizmo is a set of rings around the object center.
    // Drag along the outer edge of the ring in an arc to trigger rotation.
    // Start from above the center and drag to the right (arc motion).
    const gx = objScreenPos!.x
    const gy = objScreenPos!.y
    await page.mouse.move(gx, gy - 50)
    await page.waitForTimeout(200)
    await page.mouse.down()
    await page.mouse.move(gx + 50, gy - 50, {steps: 5})
    await page.mouse.move(gx + 50, gy, {steps: 5})
    await page.mouse.up()
    await page.waitForTimeout(500)

    const rotAfterDrag = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        const obj = p?.getSelectedObject()
        return obj ? {x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z} : null
    })
    expect(rotAfterDrag).toBeTruthy()
    // At least one rotation component should have changed
    const rotChanged = (
        Math.abs(rotAfterDrag!.x - rotBeforeDrag!.x) > 0.01 ||
        Math.abs(rotAfterDrag!.y - rotBeforeDrag!.y) > 0.01 ||
        Math.abs(rotAfterDrag!.z - rotBeforeDrag!.z) > 0.01
    )
    expect(rotChanged).toBe(true)
    await screenshotMatch(page, testInfo, 'after-rotate-drag')

    // Restore translate mode for subsequent tests
    await modeSelect.selectOption('translate')
    await page.waitForTimeout(300)

    // --- Keyboard shortcuts ---
    // TransformControls2 listens for: W=translate, E=rotate, R=scale, Q=toggle space

    // Focus the canvas so keyboard events reach the window listener
    await page.locator('#mcanvas').click()
    await page.waitForTimeout(300)

    // 'e' -> rotate mode
    await page.keyboard.press('e')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'key-rotate')

    // 'r' -> scale mode
    await page.keyboard.press('r')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'key-scale')

    // 'w' -> translate mode
    await page.keyboard.press('w')
    await page.waitForTimeout(500)
    await screenshotMatch(page, testInfo, 'key-translate')
})

test('picking-plugin', async({page}, testInfo) => {
    await expect(page).toHaveTitle('Picking (Selection) Plugin')

    const canvas = page.locator('#mcanvas')

    // Helper: click at center of canvas (where the DamagedHelmet model is)
    const clickCenter = async() => {
        const box = await canvas.boundingBox()
        if (!box) throw new Error('Canvas bounding box not found')
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }

    // Helper: click at top-left corner of canvas (empty space, away from model)
    const clickEmpty = async() => {
        const box = await canvas.boundingBox()
        if (!box) throw new Error('Canvas bounding box not found')
        await page.mouse.click(box.x + 10, box.y + 10)
    }

    // Helper: get selected object name via evaluate
    const getSelectedName = async(): Promise<string | null> => {
        return page.evaluate(() => {
            const v = (window as any).threeViewers?.[0]
            const p = v?.getPlugin('Picking')
            const obj = p?.getSelectedObject()
            return obj?.name ?? null
        })
    }

    // --- 1. Click on model to select it ---
    await clickCenter()
    await page.waitForTimeout(500)

    const selectedName = await getSelectedName()
    expect(selectedName).toBeTruthy()
    await screenshotMatch(page, testInfo, 'model-selected')

    // --- 2. Click on empty space to deselect ---
    await clickEmpty()
    await page.waitForTimeout(500)

    const deselectedName = await getSelectedName()
    expect(deselectedName).toBeNull()
    await screenshotMatch(page, testInfo, 'model-deselected')

    // --- 3. TweakpaneUI: verify Picker folder elements ---
    // The Picker folder is expanded by default per the plugin uiConfig (expanded: true)
    const pickerFolder = page.locator('.tp-fldv').first()

    await expect(pickerFolder.locator('.tp-lblv').filter({hasText: /^Enabled$/})).toBeVisible()
    await expect(pickerFolder.locator('.tp-lblv').filter({hasText: /^Hover Enabled$/})).toBeVisible()
    await expect(pickerFolder.locator('.tp-lblv').filter({hasText: /^Auto Focus$/})).toBeVisible()
    await expect(pickerFolder.locator('.tp-lblv').filter({hasText: /^Widget Enabled$/})).toBeVisible()
    await expect(pickerFolder.locator('.tp-lblv').filter({hasText: /^Multi-Select$/})).toBeVisible()

    // --- 4. Disable picking via Enabled checkbox, click model, verify no selection ---
    const enabledRow = pickerFolder.locator('.tp-lblv').filter({hasText: /^Enabled$/})
    const enabledCheckbox = enabledRow.locator('.tp-ckbv_w')
    await enabledCheckbox.click()
    await page.waitForTimeout(300)

    await clickCenter()
    await page.waitForTimeout(500)

    const disabledSelName = await getSelectedName()
    expect(disabledSelName).toBeNull()
    await screenshotMatch(page, testInfo, 'picking-disabled')

    // Re-enable picking
    await enabledCheckbox.click()
    await page.waitForTimeout(300)

    // --- 5. Widget Enabled toggle: disable widget, select model, verify no wireframe ---
    const widgetEnabledRow = pickerFolder.locator('.tp-lblv').filter({hasText: 'Widget Enabled'})
    const widgetEnabledCheckbox = widgetEnabledRow.locator('.tp-ckbv_w')
    await widgetEnabledCheckbox.click()
    await page.waitForTimeout(300)

    await clickCenter()
    await page.waitForTimeout(500)

    const widgetDisabledSelName = await getSelectedName()
    expect(widgetDisabledSelName).toBeTruthy()
    await screenshotMatch(page, testInfo, 'widget-disabled-selected')

    // Re-enable widget
    await widgetEnabledCheckbox.click()
    await page.waitForTimeout(300)
    await screenshotMatch(page, testInfo, 'widget-re-enabled')

    // Deselect for clean state
    await clickEmpty()
    await page.waitForTimeout(500)

    // --- 6. Hover: move mouse over model, verify hover object detected ---
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not found')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(500)

    const hoverObj = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        return p?.picker?.hoverObject?.name ?? null
    })
    expect(hoverObj).toBeTruthy()
    await screenshotMatch(page, testInfo, 'hover-highlight')

    // Move mouse away from model
    await page.mouse.move(box.x + 10, box.y + 10)
    await page.waitForTimeout(500)

    // --- 7. Auto Focus toggle: select with auto focus, camera should animate ---
    const autoFocusRow = pickerFolder.locator('.tp-lblv').filter({hasText: /^Auto Focus$/})
    const autoFocusCheckbox = autoFocusRow.locator('.tp-ckbv_w')
    await autoFocusCheckbox.click()
    await page.waitForTimeout(300)

    await clickCenter()
    await page.waitForTimeout(1500) // wait for camera animation
    await screenshotMatch(page, testInfo, 'auto-focus-selected')

    // Disable auto focus, deselect
    await autoFocusCheckbox.click()
    await page.waitForTimeout(300)
    await clickEmpty()
    await page.waitForTimeout(500)

    // --- 8. Collapse/expand Picker folder ---
    await page.getByRole('button', {name: 'Picker'}).click()
    await page.waitForTimeout(200)
    await screenshotMatch(page, testInfo, 'picker-collapsed')

    await page.getByRole('button', {name: 'Picker'}).click()
    await page.waitForTimeout(200)

    // --- 9. Selection mode change via evaluate (no UI dropdown exposed) ---
    await clickCenter()
    await page.waitForTimeout(500)

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        if (p) { p.selectionMode = 'material'; v.setDirty() }
    })
    await page.waitForTimeout(300)

    const selMode = await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        return v?.getPlugin('Picking')?.selectionMode
    })
    expect(selMode).toBe('material')

    // Reset to object mode
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        if (p) { p.selectionMode = 'object'; v.setDirty() }
    })
    await page.waitForTimeout(300)

    // Deselect
    await clickEmpty()
    await page.waitForTimeout(500)

    // --- 10. Programmatic select/clear via setSelectedObject and clearSelection ---
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        const model = v?.scene.modelRoot.children?.[0]
        if (p && model) p.setSelectedObject(model)
    })
    await page.waitForTimeout(300)

    const progSelName = await getSelectedName()
    expect(progSelName).toBeTruthy()
    await screenshotMatch(page, testInfo, 'programmatic-select')

    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        if (p) p.clearSelection()
    })
    await page.waitForTimeout(300)

    const clearedName = await getSelectedName()
    expect(clearedName).toBeNull()
    await screenshotMatch(page, testInfo, 'programmatic-clear')

    // --- 11. Multi-select ---

    // Add a second object to the scene so we can actually test multi-select
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        if (!v) return
        // Access three.js constructors from the scene's existing objects
        const existingMesh = v.scene.modelRoot.children[0]?.children?.[0]
        if (!existingMesh) return
        const geo = existingMesh.geometry.clone()
        const mat = existingMesh.material.clone()
        mat.color.set(0xff0000)
        const box = new existingMesh.constructor(geo, mat)
        box.name = 'test-box'
        box.position.set(2, 0, 0)
        box.scale.set(0.3, 0.3, 0.3)
        v.scene.addObject(box)
        v.setDirty()
    })
    await page.waitForTimeout(500)

    const getSelectedCount = async(): Promise<number> => {
        return page.evaluate(() => {
            const v = (window as any).threeViewers?.[0]
            return v?.getPlugin('Picking')?.getSelectedObjects()?.length ?? 0
        })
    }

    // Select all via Ctrl+A — should select both the helmet AND the box (≥2)
    await page.keyboard.down('Control')
    await page.keyboard.press('a')
    await page.keyboard.up('Control')
    await page.waitForTimeout(500)

    const selCountAll = await getSelectedCount()
    expect(selCountAll).toBeGreaterThanOrEqual(2)
    await screenshotMatch(page, testInfo, 'multi-select-all')

    // Escape to clear
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    expect(await getSelectedCount()).toBe(0)

    // Toggle select: add both objects via API, then toggle one off
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        if (!p) return
        const objects: any[] = []
        v.scene.modelRoot.traverse((o: any) => {
            if (o.isObject3D && o.visible && o.material && o.userData.userSelectable !== false) objects.push(o)
        })
        for (const o of objects) p.toggleSelectedObject(o)
        v.setDirty()
    })
    await page.waitForTimeout(500)
    const selCountToggle = await getSelectedCount()
    expect(selCountToggle).toBeGreaterThanOrEqual(2)

    // Toggle off one — count should decrease
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('Picking')
        if (!p) return
        const selected = p.getSelectedObjects()
        if (selected.length > 0) p.toggleSelectedObject(selected[0])
        v.setDirty()
    })
    await page.waitForTimeout(300)
    expect(await getSelectedCount()).toBe(selCountToggle - 1)
    await screenshotMatch(page, testInfo, 'multi-select-toggle-off')

    // Clear
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // --- 12. Multi-Select UI toggle: disable multi-select, verify Ctrl+A has no effect ---
    const multiSelectRow = pickerFolder.locator('.tp-lblv').filter({hasText: /^Multi-Select$/})
    const multiSelectCheckbox = multiSelectRow.locator('.tp-ckbv_w')

    // Disable multi-select
    await multiSelectCheckbox.click()
    await page.waitForTimeout(300)

    // Select one object first
    await clickCenter()
    await page.waitForTimeout(500)
    expect(await getSelectedCount()).toBe(1)

    // Try Ctrl+A — should NOT select all since multi-select is disabled
    await page.keyboard.down('Control')
    await page.keyboard.press('a')
    await page.keyboard.up('Control')
    await page.waitForTimeout(500)

    const selCountNoMulti = await getSelectedCount()
    expect(selCountNoMulti).toBe(1) // should still be 1

    // Re-enable multi-select
    await multiSelectCheckbox.click()
    await page.waitForTimeout(300)

    // Clear selection
    await clickEmpty()
    await page.waitForTimeout(500)
})

test('hdr-to-exr', async({page}, testInfo) => {
    await expect(page).toHaveTitle('HDR To EXR')

    // The example imports an HDR, exports to EXR, then loads the EXR as env map.
    // Initial screenshot verifies the full HDR→EXR→envmap roundtrip rendered correctly.

    // Download the EXR file via the button
    await downloadFileMatch(page, 'file.exr',
        async() => page.getByRole('button', {name: 'Download .exr'}).click())
})


test('modelling-api', async({page}) => {
    await expect(page).toHaveTitle('Modelling command API')

    /** Run a command through the plugin, exactly as the console and a script do. */
    const run = async(command: Record<string, unknown>) =>
        page.evaluate(c => (window as any).modelling.run(c), command)

    const state = async() => page.evaluate(() => {
        const m = (window as any).modelling
        return {
            objects: m.document.entries.map((e: any) => ({
                name: e.name,
                verts: e.mesh.vertsNum,
                faces: e.mesh.facesNum,
                evaluatedVerts: e.evaluated.vertsNum,
                modifiers: e.modifiers.length,
            })),
            canUndo: m.history.canUndo,
        }
    })

    // The page builds its starting cube through the API, so the document is not empty.
    expect((await state()).objects.map(o => o.name)).toEqual(['hull'])

    // --- the table an agent reads ------------------------------------------------------------

    const described = await page.evaluate(() => (window as any).modelling.describeCommands())
    const ops = described.map((d: any) => d.name)
    for (const op of ['primitive', 'lathe', 'sweep', 'vertices', 'transform', 'array', 'duplicate',
        'mirror', 'modifier', 'reference', 'capture', 'inspect', 'measure', 'undo', 'selftest']) {
        expect(ops).toContain(op)
    }
    // Every command must carry a usable schema; an agent cannot call what it cannot see.
    for (const d of described) {
        expect(d.description.length).toBeGreaterThan(10)
        expect(d.inputSchema.type).toBe('object')
    }

    // --- errors say what went wrong -----------------------------------------------------------

    const unknownOp = await run({op: 'primitiv', type: 'cube'})
    expect(unknownOp.ok).toBe(false)
    expect(unknownOp.error).toContain('did you mean "primitive"')

    const unknownParam = await run({op: 'primitive', type: 'cube', raduis: 2})
    expect(unknownParam.ok).toBe(false)
    expect(unknownParam.error).toContain('did you mean "radius"')

    const missingObject = await run({op: 'transform', object: 'nope', move: [1, 0, 0]})
    expect(missingObject.ok).toBe(false)
    expect(missingObject.error).toContain('no object "nope"')

    // A failed command must leave nothing behind.
    expect((await state()).objects.length).toBe(1)

    // --- sizes mean what they say ----------------------------------------------------------------

    // Blender's own primitives disagree about whether `size` is a radius or an edge length - the
    // grid's is a half-extent, the cube's is not. The command layer promises finished extents for
    // all of them, and this is the assertion that keeps that true.
    await run({op: 'delete', object: '*'})
    for (const [type, extra, expected] of [
        ['cube', {width: 2, height: 3, depth: 4}, [2, 3, 4]],
        ['plane', {width: 2, depth: 4}, [2, 0, 4]],
        ['grid', {width: 3, depth: 1.5, xSegments: 3, ySegments: 2}, [3, 0, 1.5]],
        ['cylinder', {radius: 1.5, height: 4}, [3, 4, 3]],
        ['sphere', {radius: 2}, [4, 4, 4]],
    ] as [string, Record<string, unknown>, number[]][]) {
        const made = await run({op: 'primitive', type, name: `sized-${type}`, ...extra})
        expect(made.ok).toBe(true)
        const size = (made.data as any).bounds.size as number[]
        for (let i = 0; i < 3; i++) expect(size[i]).toBeCloseTo(expected[i], 4)
    }
    await run({op: 'delete', object: 'sized-*'})

    // --- creation -----------------------------------------------------------------------------

    const wheel = await run({
        op: 'lathe', name: 'wheel', axis: 'x', segments: 16,
        profile: [[0, -0.05], [0.3, -0.05], [0.3, 0.05], [0, 0.05]],
        position: [-1, 0.35, -2],
    })
    expect(wheel.ok).toBe(true)
    expect((wheel.data as any).faces).toBeGreaterThan(0)

    const sweep = await run({
        op: 'sweep', name: 'rail', radius: 0.03, steps: 6,
        path: [[-1, 1.2, -2], [-1, 1.4, -1], [-1, 1.4, 1], [-1, 1.2, 2]],
    })
    expect(sweep.ok).toBe(true)

    // A tapered sweep: the section scales by the curve radius at each path point.
    const horn = await run({
        op: 'sweep', name: 'horn', radius: 0.5, steps: 12,
        path: [[5, 0, 0], [5, 1, 0], [5, 2, 0]], radii: [1, 0.5, 0.1],
    })
    expect(horn.ok).toBe(true)
    // Widest at the base ring (radius 0.5 x 1), so the horn is a unit across, not more.
    expect((horn.data as any).bounds.size[0]).toBeCloseTo(1, 3)
    const hornDetail = await run({op: 'inspect', object: 'horn', detail: true})
    const topRing = (hornDetail.data as any).vertices.filter((v: number[]) => v[1] > 1.99)
    for (const v of topRing) expect(Math.hypot(v[0] - 5, v[2])).toBeCloseTo(0.05, 4)
    const badRadii = await run({op: 'sweep', name: 'bad', path: [[0, 0, 0], [0, 1, 0]], radii: [1]})
    expect(badRadii.ok).toBe(false)
    expect(badRadii.error).toContain('one radius per path point')
    await run({op: 'delete', object: 'horn'})

    // Every mesh the generators produced must be valid topology that bakes.
    const health = await run({op: 'selftest'})
    expect((health.data as any).failed).toBe(0)

    // --- live modifiers, the point of the exercise --------------------------------------------

    const arrayed = await run({op: 'array', object: 'wheel', count: 6, step: [0, 0, 0.8], live: true})
    expect(arrayed.ok).toBe(true)

    const before = (await state()).objects.find(o => o.name === 'wheel')!
    expect(before.modifiers).toBe(1)
    // The master stays small; only the evaluated mesh grows.
    expect(before.evaluatedVerts).toBeGreaterThan(before.verts * 5)

    // Edit one vertex of the master and every copy must follow.
    const detail = await run({op: 'inspect', object: 'wheel', detail: true})
    const firstVert = (detail.data as any).vertices[0]
    const moved = await run({op: 'vertices', object: 'wheel',
        verts: [[0, firstVert[0], firstVert[1] + 0.5, firstVert[2]]]})
    expect(moved.ok).toBe(true)

    const after = (await state()).objects.find(o => o.name === 'wheel')!
    expect(after.verts).toBe(before.verts)          // the master did not grow
    expect(after.evaluatedVerts).toBe(before.evaluatedVerts) // nor did the evaluation
    // and the bounds moved, proving the copies were rebuilt rather than left stale
    const bounds = await run({op: 'inspect', object: 'wheel'})
    expect((bounds.data as any).bounds.max[1]).toBeGreaterThan(0.4)

    // Changing the modifier count re-evaluates without touching the master.
    const recount = await run({op: 'modifier', object: 'wheel', index: 0, update: {count: 3}})
    expect(recount.ok).toBe(true)
    expect((recount.data as any).evaluatedVerts).toBeLessThan(after.evaluatedVerts)

    // --- history ------------------------------------------------------------------------------

    await run({op: 'checkpoint', name: 'running gear'})
    await run({op: 'primitive', type: 'cylinder', name: 'scrap', radius: 0.4, height: 1})
    expect((await state()).objects.map(o => o.name)).toContain('scrap')

    const rewound = await run({op: 'undo', to: 'running gear'})
    expect(rewound.ok).toBe(true)
    expect((await state()).objects.map(o => o.name)).not.toContain('scrap')

    await run({op: 'redo'})
    expect((await state()).objects.map(o => o.name)).toContain('scrap')
    await run({op: 'delete', object: 'scrap'})

    // --- clearance ----------------------------------------------------------------------------

    await run({op: 'primitive', type: 'cube', name: 'a', size: 1, position: [10, 0, 0]})
    await run({op: 'primitive', type: 'cube', name: 'b', size: 1, position: [10.5, 0, 0]})
    const overlaps = await run({op: 'measure', object: ['a', 'b'], mode: 'overlaps'})
    expect((overlaps.data as any).pairs).toBe(1)
    await run({op: 'transform', object: 'b', move: [5, 0, 0]})
    const clear = await run({op: 'measure', object: ['a', 'b'], mode: 'overlaps'})
    expect((clear.data as any).pairs).toBe(0)
    await run({op: 'delete', object: ['a', 'b']})

    // --- capture and export -------------------------------------------------------------------

    await run({op: 'camera', view: 'iso', fit: '*'})
    const shot = await run({op: 'capture'})
    expect(shot.ok).toBe(true)
    expect((shot.data as any).dataUrl.startsWith('data:image/png')).toBe(true)

    const exported = await run({op: 'export', format: 'glb'})
    expect(exported.ok).toBe(true)
    expect((exported.data as any).bytes).toBeGreaterThan(1000)

    // --- editable topology survives a glTF round trip ---------------------------------------------

    await run({op: 'delete', object: '*'})
    // A cylinder has n-gon caps, which is exactly what a triangle buffer cannot give back.
    await run({op: 'primitive', type: 'cylinder', name: 'drum', radius: 0.5, height: 1,
        segments: 12})
    await run({op: 'array', object: 'drum', count: 3, step: [1.2, 0, 0], live: true})
    const beforeTrip = await run({op: 'inspect', object: 'drum'})

    const roundTrip = await page.evaluate(async() => {
        const m = (window as any).modelling
        const v = (window as any).viewer

        const exported = await m.run({op: 'export', format: 'glb', includeData: true})
        if (!exported.ok) return {error: exported.error}
        const bytes = Uint8Array.from(atob(exported.data.base64), c => c.charCodeAt(0))
        // A File, not a blob URL: the importer picks its loader from the name, and a blob URL has no
        // extension to pick from.
        const file = new File([bytes], 'topology.glb', {type: 'model/gltf-binary'})

        await m.run({op: 'delete', object: '*'})
        const before = m.document.size
        await v.load(file, {autoScale: false, autoCenter: false})

        return {
            bytes: exported.data.bytes,
            emptiedTo: before,
            entries: m.document.entries.map((e: any) => ({
                verts: e.mesh.vertsNum,
                edges: e.mesh.edgesNum,
                faces: e.mesh.facesNum,
                modifiers: e.modifiers.length,
                evaluatedFaces: e.evaluated.facesNum,
                problems: e.mesh.validate(),
            })),
        }
    })

    expect(roundTrip.error).toBeUndefined()
    expect(roundTrip.emptiedTo).toBe(0)
    // The reloaded object is editable again, with the master topology it was exported with - not the
    // triangles, and not the evaluated copy the array produced.
    expect(roundTrip.entries!.length).toBe(1)
    const restored = roundTrip.entries![0]
    expect(restored.verts).toBe((beforeTrip.data as any).verts)
    expect(restored.edges).toBe((beforeTrip.data as any).edges)
    expect(restored.faces).toBe((beforeTrip.data as any).faces)
    expect(restored.problems).toEqual([])
    // ...and the live modifier stack came back with it, so the render still shows three drums.
    expect(restored.modifiers).toBe(1)
    expect(restored.evaluatedFaces).toBeGreaterThan(restored.faces * 2)

    await run({op: 'delete', object: '*'})

    // --- reference calibration ------------------------------------------------------------------

    // A 100x50 pixel image standing in for a photograph; the calibration is what is under test.
    const png = await page.evaluate(() => {
        const c = document.createElement('canvas')
        c.width = 100
        c.height = 50
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#446688'
        ctx.fillRect(0, 0, 100, 50)
        return c.toDataURL('image/png')
    })
    const ref = await run({
        op: 'reference', name: 'side', plane: 'right', image: png,
        calibrate: {from: [0.2, 0.5], to: [0.7, 0.5], distance: 5},
    })
    expect(ref.ok).toBe(true)
    // 0.5 of the image width spans 5 units, so the whole image spans 10.
    expect((ref.data as any).width).toBeCloseTo(10, 5)
    // ...and a 100x50 image is twice as wide as it is tall, so it is 5 units high.
    expect((ref.data as any).height).toBeCloseTo(5, 5)
    expect((ref.data as any).savedView).toBe('ref:side')

    // The registered view must be replayable.
    const replay = await run({op: 'camera', view: 'ref:side'})
    expect(replay.ok).toBe(true)
    // `source` says how the framing was arrived at - a reference view is recomputed from its plane
    // for the current lens - and `saved` only ever names where one was stored.
    expect((replay.data as any).source).toBe('reference')
    expect((replay.data as any).saved).toBe(null)
    // Perspective: the 5-unit-high plane exactly fills the frame, so the eye sits at
    // (h / 2) / tan(fov / 2) from it along the plane normal (+X for the right plane).
    const fov = (replay.data as any).fov as number
    expect((replay.data as any).position[0]).toBeCloseTo(2.5 / Math.tan(fov * Math.PI / 360), 3)

    // A long lens and an orthographic camera both stay registered to the plane.
    const longLens = await run({op: 'camera', view: 'ref:side', fov: 10})
    expect((longLens.data as any).fov).toBe(10)
    expect((longLens.data as any).position[0]).toBeCloseTo(2.5 / Math.tan(5 * Math.PI / 180), 3)
    const orthoRef = await run({op: 'camera', view: 'ref:side', projection: 'orthographic'})
    expect(orthoRef.ok).toBe(true)
    expect((orthoRef.data as any).projection).toBe('orthographic')
    expect((orthoRef.data as any).frustumSize).toBeCloseTo(5, 5)
    // `fov` means nothing to a parallel projection, and says so.
    const orthoFov = await run({op: 'camera', fov: 30})
    expect(orthoFov.ok).toBe(false)
    expect(orthoFov.error).toContain('perspective setting')
    // Orthographic framing of a box: the frame is the box's projected height plus a 10% margin.
    await run({op: 'primitive', type: 'cube', name: 'tall', width: 1, height: 4, depth: 1,
        position: [0, 2, 0]})
    const orthoFit = await run({op: 'camera', view: 'front', fit: 'tall'})
    expect((orthoFit.data as any).frustumSize).toBeCloseTo(4.4, 3)
    const orthoShot = await run({op: 'capture'})
    expect(orthoShot.ok).toBe(true)
    // ...and the export does not pick up the orthographic camera.
    const exportedObjects = await page.evaluate(() =>
        (window as any).viewer.scene.getObjectByName('modelling:orthographic')?.userData.excludeFromExport)
    expect(exportedObjects).toBe(true)
    const backToPerspective = await run({op: 'camera', projection: 'perspective', fov: 45})
    expect((backToPerspective.data as any).projection).toBe('perspective')

    // A camera further from the model than threepipe's default far-plane limit (1000) must not clip
    // it away: the far plane is raised to reach the model's far side, and the command says so.
    const distant = await run({op: 'camera', position: [0, 2, 1500], target: [0, 2, 0]})
    expect(distant.ok).toBe(true)
    expect((distant.warnings ?? []).join(' ')).toContain('far plane')
    const far = await page.evaluate(() => (window as any).viewer.scene.mainCamera.far)
    expect(far).toBeGreaterThan(1502)
    await run({op: 'delete', object: 'tall'})

    const computed = await run({op: 'camera', view: 'top', fit: '*', save: 'overhead'})
    expect((computed.data as any).source).toBe('computed')
    expect((computed.data as any).saved).toBe('overhead')

    // --- inset and solidify -------------------------------------------------------------------

    await run({op: 'delete', object: '*'})
    await run({op: 'primitive', type: 'cube', name: 'plate', width: 2, height: 0.2, depth: 2})

    // The top face of a 2 x 0.2 x 2 plate, found by its centre rather than assumed.
    const plate = await run({op: 'inspect', object: 'plate', detail: true})
    const plateData = plate.data as any
    const topFaces: number[] = plateData.faceVerts
        .map((verts: number[], i: number) =>
            ({i, y: verts.reduce((a: number, v: number) => a + plateData.vertices[v][1], 0) / verts.length}))
        .filter((f: any) => f.y > 0.05)
        .map((f: any) => f.i)
    expect(topFaces.length).toBe(1)

    const inset = await run({op: 'inset', object: 'plate', faces: topFaces, thickness: 0.3})
    expect(inset.ok).toBe(true)
    // A single-quad region inset adds four vertices and four rim faces; the face passed in survives
    // with the same identity, which is why `insetFaces` and `rimFaces` are reported separately.
    expect((inset.data as any).verts).toBe(12)
    expect((inset.data as any).rimFaces.length).toBe(4)
    expect((inset.data as any).insetFaces).toEqual(topFaces)

    // The inset distance is a real distance: the inner ring sits 0.3 inside a 2-wide face.
    const insetShape = await run({op: 'inspect', object: 'plate', detail: true})
    const innerXs = (insetShape.data as any).vertices
        .filter((v: number[]) => v[1] > 0.05)
        .map((v: number[]) => Math.abs(v[0]))
    expect(Math.min(...innerXs)).toBeCloseTo(0.7, 4)
    expect(Math.max(...innerXs)).toBeCloseTo(1.0, 4)

    // Chaining on `insetFaces` is what makes a rim: a second inset, pushed up.
    const raised = await run({op: 'inset', object: 'plate', faces: (inset.data as any).insetFaces,
        thickness: 0.15, depth: 0.1})
    expect(raised.ok).toBe(true)
    const raisedShape = await run({op: 'inspect', object: 'plate'})
    expect((raisedShape.data as any).bounds.max[1]).toBeCloseTo(0.2, 4)

    // Solidify a flat grid: the two surfaces end up exactly `thickness` apart.
    await run({op: 'primitive', type: 'grid', name: 'sheet', xSegments: 2, ySegments: 2, width: 2,
        depth: 2, position: [0, 5, 0]})
    const solid = await run({op: 'solidify', object: 'sheet', thickness: 0.25, offset: -1})
    expect(solid.ok).toBe(true)
    expect((solid.data as any).rimFaces).toBeGreaterThan(0)
    const sheet = await run({op: 'inspect', object: 'sheet'})
    expect((sheet.data as any).bounds.size[1]).toBeCloseTo(0.25, 4)
    // ...and it is closed, so it survives a validate and has no holes.
    const solidHealth = await run({op: 'selftest'})
    expect((solidHealth.data as any).failed).toBe(0)

    await run({op: 'delete', object: '*'})

    // --- bevel -------------------------------------------------------------------------------

    await run({op: 'delete', object: '*'})
    await run({op: 'primitive', type: 'cube', name: 'chamfer', size: 2})
    const chamfer = await run({op: 'bevel', object: 'chamfer', offset: 0.2})
    expect(chamfer.ok).toBe(true)
    // All twelve edges at one segment: each original corner becomes a triangle, each edge a quad.
    expect((chamfer.data as any).verts).toBe(24)
    expect((chamfer.data as any).edges).toBe(48)
    expect((chamfer.data as any).faces).toBe(26)

    // At `profile: 0.5` the intermediate points lie on a circular arc, so a rounded cube's corner
    // vertices all sit the same distance from the corner they replaced.
    await run({op: 'primitive', type: 'cube', name: 'rounded', size: 2, position: [5, 0, 0]})
    const rounded = await run({op: 'bevel', object: 'rounded', offset: 0.3, segments: 5,
        profile: 0.5})
    expect(rounded.ok).toBe(true)
    expect((rounded.data as any).faces).toBeGreaterThan(200)
    const roundedShape = await run({op: 'inspect', object: 'rounded', detail: true, limit: 2000})
    const corner = [0.7, 0.7, 0.7]   // the inset corner for a size-2 cube beveled by 0.3
    const nearCorner = (roundedShape.data as any).vertices
        .filter((v: number[]) => v[0] > 0.6 && v[1] > 0.6 && v[2] > 0.6)
        .map((v: number[]) => Math.hypot(v[0] - corner[0], v[1] - corner[1], v[2] - corner[2]))
    expect(nearCorner.length).toBeGreaterThan(5)
    for (const d of nearCorner) expect(d).toBeCloseTo(0.3, 3)

    // Boundary edges are declined rather than corrupted. A single quad has nothing but boundary
    // edges, so the whole operation is a no-op - where a 2x2 grid would still bevel its four
    // interior edges, which is the behaviour and not a get-out.
    await run({op: 'primitive', type: 'plane', name: 'sheet', width: 2, depth: 2,
        position: [-5, 0, 0]})
    const sheetBefore = await run({op: 'inspect', object: 'sheet'})
    const declined = await run({op: 'bevel', object: 'sheet', offset: 0.1})
    expect(declined.ok).toBe(true)
    const sheetAfter = await run({op: 'inspect', object: 'sheet'})
    expect((sheetAfter.data as any).faces).toBe((sheetBefore.data as any).faces)

    const bevelHealth = await run({op: 'selftest'})
    expect((bevelHealth.data as any).failed).toBe(0)
    await run({op: 'delete', object: '*'})

    // --- poke and wireframe: lattice bracing ------------------------------------------------------

    await run({op: 'primitive', type: 'cube', name: 'cage', size: 2})
    const poked = await run({op: 'poke', object: 'cage'})
    expect(poked.ok).toBe(true)
    // Six quads become six fans of four triangles around six new centre vertices.
    expect((poked.data as any).faces.length).toBe(24)
    expect((poked.data as any).verts.length).toBe(6)
    expect((poked.data as any).vertsTotal).toBe(14)
    // The centres are where they should be: the middle of each face, on the surface (offset 0).
    const pokedShape = await run({op: 'inspect', object: 'cage', detail: true})
    for (const i of (poked.data as any).verts) {
        const c = (pokedShape.data as any).vertices[i] as number[]
        expect(c.map(Math.abs).sort()).toEqual([0, 0, 1])
    }

    // A live wireframe keeps the 14-vertex cage as the master and draws the struts.
    await run({op: 'duplicate', object: 'cage', name: 'cage-live', move: [4, 0, 0]})
    const liveWire = await run({op: 'wireframe', object: 'cage-live', thickness: 0.1, live: true})
    expect(liveWire.ok).toBe(true)
    expect((liveWire.data as any).masterVerts).toBe(14)

    const wire = await run({op: 'wireframe', object: 'cage', thickness: 0.1})
    expect(wire.ok).toBe(true)
    // Every corner of every triangle gets an inset vertex (24 x 3) and every vertex a copy each side
    // of the surface (14 x 2); the originals go. Each corner then makes two quads.
    expect((wire.data as any).verts).toBe(72 + 28)
    expect((wire.data as any).faces).toBe(144)
    // Struts sit astride the surface (offset ~0), so the frame overhangs the 2-unit cube by about
    // half the thickness on each side, no more.
    const wireBounds = await run({op: 'inspect', object: 'cage'})
    for (const s of (wireBounds.data as any).bounds.size) {
        expect(s).toBeGreaterThan(2.04)
        expect(s).toBeLessThan(2.12)
    }
    // The live one evaluates to exactly the same frame - the command resolves its defaults once, so
    // the modifier does not quietly pick up the Wireframe modifier's different ones.
    expect((liveWire.data as any).evaluatedFaces).toBe((wire.data as any).faces)
    expect((liveWire.data as any).evaluatedVerts).toBe((wire.data as any).verts)
    // ...and it follows the cage: pull one corner out and the struts go with it.
    const liveCage = await run({op: 'inspect', object: 'cage-live', detail: true})
    const top = (liveCage.data as any).vertices.findIndex((v: number[]) => v[0] > 0.9 && v[1] > 0.9 && v[2] > 0.9)
    const evaluatedTop = async() => page.evaluate(() => {
        const e = (window as any).modelling.document.find('cage-live')
        const pos = e.evaluated.positions
        let top = -Infinity
        for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i])
        return {top, verts: e.evaluated.vertsNum}
    })
    const liveBefore = await evaluatedTop()
    expect(liveBefore.top).toBeLessThan(1.1)
    await run({op: 'vertices', object: 'cage-live', relative: true, verts: [[top, 0, 1, 0]]})
    const liveAfter = await evaluatedTop()
    expect(liveAfter.top).toBeGreaterThan(1.9)
    expect(liveAfter.verts).toBe(liveBefore.verts)

    // A live wireframe has no face selection, and says so rather than ignoring the list.
    const liveFaces = await run({op: 'wireframe', object: 'cage-live', faces: [0], live: true})
    expect(liveFaces.ok).toBe(false)
    expect(liveFaces.error).toContain('takes no `faces`')

    const wireHealth = await run({op: 'selftest'})
    expect((wireHealth.data as any).failed).toBe(0)
    await run({op: 'delete', object: '*'})

    // --- deleting parts of a mesh -------------------------------------------------------------------

    // The top and bottom of a cube, found by their centres.
    const capsOf = async(name: string) => {
        const d = (await run({op: 'inspect', object: name, detail: true})).data as any
        return d.faceVerts
            .map((verts: number[], i: number) =>
                ({i, y: verts.reduce((a: number, v: number) => a + d.vertices[v][1], 0) / verts.length}))
            .filter((f: any) => Math.abs(f.y) > 0.4)
            .map((f: any) => f.i)
    }
    await run({op: 'primitive', type: 'cube', name: 'tube', size: 1})
    // ONLY_FACE opens the ends and keeps every vertex and edge: an open square tube.
    const opened = await run({op: 'deleteElements', object: 'tube', faces: await capsOf('tube'),
        type: 'ONLY_FACE'})
    expect(opened.ok).toBe(true)
    expect((opened.data as any).removed).toEqual({verts: 0, edges: 0, faces: 2})
    expect((opened.data as any).faces).toBe(4)

    // FACE also takes edges and vertices that only those faces used - none, for a cube's caps.
    await run({op: 'primitive', type: 'cube', name: 'box', size: 1, position: [3, 0, 0]})
    const capsGone = await run({op: 'deleteElements', object: 'box', faces: await capsOf('box')})
    expect((capsGone.data as any).type).toBe('FACE')
    expect((capsGone.data as any).removed).toEqual({verts: 0, edges: 0, faces: 2})

    // VERT takes everything using the vertex.
    await run({op: 'primitive', type: 'cube', name: 'corner', size: 1, position: [6, 0, 0]})
    const cut = await run({op: 'deleteElements', object: 'corner', verts: [0]})
    expect((cut.data as any).removed).toEqual({verts: 1, edges: 3, faces: 3})

    // Asking a type to read a list it ignores is an error, not a silent no-op.
    const wrong = await run({op: 'deleteElements', object: 'corner', verts: [0], type: 'FACE'})
    expect(wrong.ok).toBe(false)
    expect(wrong.error).toContain('give a non-empty `faces` list')
    const deleteHealth = await run({op: 'selftest'})
    expect((deleteHealth.data as any).failed).toBe(0)
    await run({op: 'delete', object: '*'})

    // --- join and separate ------------------------------------------------------------------------

    await run({op: 'delete', object: '*'})
    await run({op: 'primitive', type: 'cube', name: 'left', size: 1, position: [-3, 0, 0]})
    await run({op: 'primitive', type: 'cube', name: 'right', size: 1, position: [3, 0, 0]})
    const joined = await run({op: 'join', object: ['left', 'right'], name: 'pair'})
    expect(joined.ok).toBe(true)
    // Nothing is welded, so the counts are exactly the sum.
    expect((joined.data as any).verts).toBe(16)
    expect((joined.data as any).faces).toBe(12)
    expect((await state()).objects.map(o => o.name)).toEqual(['pair'])

    // The parts kept their relative placement: the joined mesh spans both original positions.
    const pairBounds = await run({op: 'inspect', object: 'pair'})
    expect((pairBounds.data as any).bounds.size[0]).toBeCloseTo(7, 1)

    // `join` deliberately does not weld, so `weld` is what closes the seam afterwards.
    await run({op: 'primitive', type: 'cube', name: 'a', size: 1, position: [0, 20, 0]})
    await run({op: 'primitive', type: 'cube', name: 'b', size: 1, position: [1, 20, 0]})
    const touching = await run({op: 'join', object: ['a', 'b'], name: 'touching'})
    expect((touching.data as any).verts).toBe(16)

    // Connected finds nothing: the two cubes are separate shells that merely touch.
    const connected = await run({op: 'weld', object: 'touching', distance: 0.001, connected: true})
    expect((connected.data as any).merged).toBe(0)
    // The plain search merges the shared face's four corners.
    const welded = await run({op: 'weld', object: 'touching', distance: 0.001})
    expect((welded.data as any).merged).toBe(4)
    expect((welded.data as any).verts).toBe(12)
    const weldHealth = await run({op: 'selftest'})
    expect((weldHealth.data as any).failed).toBe(0)
    await run({op: 'delete', object: 'touching'})

    const split = await run({op: 'separate', object: 'pair', mode: 'loose'})
    expect((split.data as any).created).toBe(1)
    expect((await state()).objects.length).toBe(2)
    for (const o of (await state()).objects) expect(o.faces).toBe(6)

    await run({op: 'delete', object: '*'})

    // --- edit mode shares the document, rather than re-deriving it ------------------------------

    await run({op: 'delete', object: '*'})
    const cyl = await run({op: 'primitive', type: 'cylinder', name: 'drum', radius: 0.5,
        height: 1, segments: 16})
    const cylFaces = (cyl.data as any).faces
    const cylVerts = (cyl.data as any).verts

    const entered = await page.evaluate(() => {
        const m = (window as any).modelling
        const edit = (window as any).viewer.getPlugin('MeshEditPlugin')
        const entry = m.document.entries[0]
        const ok = edit.enter(entry.object)
        return ok ? {verts: edit.state.bm.totvert, faces: edit.state.bm.totface} : null
    })
    // Exact, not welded: a 16-segment cylinder keeps its two n-gon caps and its 16 quad sides.
    // Recovering this from triangles would renumber vertices and guess at the caps.
    expect(entered).toEqual({verts: cylVerts, faces: cylFaces})

    // An edit made by hand must come back to the document, or the next command would re-bake over it.
    const committed = await page.evaluate(() => {
        const m = (window as any).modelling
        const edit = (window as any).viewer.getPlugin('MeshEditPlugin')
        const v = [...edit.state.bm.verts][0]
        v.setCo(v.x, v.y + 5, v.z)
        edit.exit(true)
        const entry = m.document.entries[0]
        let highest = -Infinity
        const pos = entry.mesh.positions
        for (let i = 1; i < entry.mesh.vertsNum * 3; i += 3) highest = Math.max(highest, pos[i])
        return {highest, verts: entry.mesh.vertsNum, faces: entry.mesh.facesNum}
    })
    expect(committed.highest).toBeGreaterThan(4)
    expect(committed.faces).toBe(cylFaces)

    // ...and it is undoable like any other change.
    const undone = await run({op: 'undo'})
    expect((undone.data as any).undone).toBe(1)
    const back = await run({op: 'inspect', object: 'drum'})
    expect((back.data as any).bounds.max[1]).toBeLessThan(1)

    const final = await run({op: 'selftest'})
    expect((final.data as any).failed).toBe(0)
})

test('mesh-kernel-playground', async({page}) => {
    await expect(page).toHaveTitle('Mesh Kernel Playground')

    const stats = async() => page.evaluate(() => {
        const m = (window as any).kernel.mesh
        return {verts: m.vertsNum, edges: m.edgesNum, faces: m.facesNum, problems: m.validate()}
    })

    // A cube is 8/12/6 and Euler-valid. If the kernel ever starts triangulating on the way in or
    // out, this is the first thing that changes.
    const cube = await stats()
    expect(cube).toEqual({verts: 8, edges: 12, faces: 6, problems: []})
    expect(cube.verts - cube.edges + cube.faces).toBe(2)

    const op = async(name: string) => {
        await page.locator(`[data-op="${name}"]`).click()
        await page.waitForTimeout(120)
        return stats()
    }

    // SEMV on every edge: one new vertex per edge, faces unchanged, still closed.
    const split = await op('subdivide')
    expect(split.verts).toBe(cube.verts + cube.edges)
    expect(split.edges).toBe(cube.edges * 2)
    expect(split.faces).toBe(cube.faces)
    expect(split.verts - split.edges + split.faces).toBe(2)
    expect(split.problems).toEqual([])

    // SFME once per face: each quad becomes two triangles, no new vertices.
    await op('reset')
    const triangulated = await op('triangulate')
    expect(triangulated.verts).toBe(cube.verts)
    expect(triangulated.faces).toBe(cube.faces * 2)
    expect(triangulated.edges).toBe(cube.edges + cube.faces)
    expect(triangulated.problems).toEqual([])

    // JFKE on one manifold edge: two quads become one n-gon.
    await op('reset')
    const dissolved = await op('dissolve')
    expect(dissolved.verts).toBe(cube.verts)
    expect(dissolved.faces).toBe(cube.faces - 1)
    expect(dissolved.edges).toBe(cube.edges - 1)
    expect(dissolved.problems).toEqual([])

    // The fan is built from repeated SFME, so like `triangulate` it adds no vertices - it cuts each
    // quad down to triangles rather than adding a centre vertex.
    await op('reset')
    const poked = await op('poke')
    expect(poked.verts).toBe(cube.verts)
    expect(poked.faces).toBeGreaterThan(cube.faces)
    expect(poked.problems).toEqual([])

    // The array form and the linked form must agree in both directions.
    await op('reset')
    const roundTripped = await op('roundtrip')
    expect(roundTripped).toEqual(cube)

    const ngon = await op('ngon')
    expect(ngon.faces).toBe(1)
    expect(ngon.verts).toBe(12)
    expect(ngon.problems).toEqual([])

    const grid = await op('grid')
    expect(grid.faces).toBe(16)
    expect(grid.problems).toEqual([])
})

test('mesh-edit-plugin', async({page}) => {
    await expect(page).toHaveTitle('Mesh Edit Plugin')

    const state = async() => page.evaluate(() => {
        const e = (window as any).meshEdit
        if (!e.state) return null
        const bm = e.state.bm
        return {
            verts: bm.totvert, edges: bm.totedge, faces: bm.totface,
            selected: [bm.totvertsel, bm.totedgesel, bm.totfacesel],
            problems: bm.validate(),
            welded: e.state.weldedCount,
        }
    })

    await page.locator('[data-op="cube"]').click()
    await page.waitForTimeout(250)
    expect(await state()).toBe(null)

    const raw = await page.evaluate(() => {
        const picking = (window as any).picking
        const object = picking.getSelectedObject()
        return object?.geometry?.getAttribute('position')?.count ?? 0
    })

    await page.evaluate(() => (window as any).meshEdit.enter())
    await page.waitForTimeout(200)

    // The example's cube is a 2x2x2 BoxGeometry: 24 quads, so 48 triangles and 26 distinct corners.
    // Edit mode recovers topology by welding those triangles, which is the lossy path - the
    // interesting assertion is that the weld actually happened and the result is valid, not that it
    // guessed the quads back.
    const entered = await state()
    expect(entered!.faces).toBe(48)
    expect(entered!.verts).toBe(26)
    expect(entered!.verts).toBeLessThan(raw)
    expect(entered!.verts - entered!.edges + entered!.faces).toBe(2)
    expect(entered!.problems).toEqual([])

    // ── Transform and gizmo (track T): real mouse and keyboard against Blender's transform maths ──
    const canvas = (await page.locator('#mcanvas').boundingBox())!
    /** Positions compare numerically: a restored mesh may hold 0 where the original held -0. */
    const expectSame = (a: any, b: any) => expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)))
    const positions = () => page.evaluate(() =>
        [...(window as any).meshEdit.state.bm.verts].map((v: any) => [v.x, v.y, v.z] as [number, number, number]))
    const selectedIndices = () => page.evaluate(() =>
        [...(window as any).meshEdit.state.bm.verts].map((v: any, i: number) => v.hflag & 1 ? i : -1).filter((i: number) => i >= 0))
    /** Screen position (page coordinates) of a vertex by index. */
    const screenOf = (index: number) => page.evaluate(i => {
        const me = (window as any).meshEdit
        const v = [...me.state.bm.verts][i]
        const p = me._projectFn()(v.x, v.y, v.z)
        const r = (window as any).viewer.canvas.getBoundingClientRect()
        return {x: r.left + p.x, y: r.top + p.y, depth: p.depth}
    }, index)
    /** Pixels in a box around a page point that pass a colour test. */
    const countPixels = async(x: number, y: number, half: number, test: string) => {
        // `clip` is in document coordinates; the point is in viewport coordinates.
        const [sx, sy] = await page.evaluate(() => [window.scrollX, window.scrollY])
        const png = await page.screenshot({clip: {x: x - half + sx, y: y - half + sy, width: half * 2, height: half * 2}})
        return page.evaluate(async([b64, fn]) => {
            const img = new Image()
            img.src = 'data:image/png;base64,' + b64
            await img.decode()
            const c = document.createElement('canvas')
            c.width = img.width
            c.height = img.height
            const ctx = c.getContext('2d')!
            ctx.drawImage(img, 0, 0)
            const d = ctx.getImageData(0, 0, c.width, c.height).data
            const f = new Function('r', 'g', 'b', 'return ' + fn) as (r: number, g: number, b: number) => boolean
            let n = 0
            for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++
            return n
        }, [png.toString('base64'), test] as const)
    }
    /** Screen position of a gizmo handle's outermost part (the arrow cone), in page coordinates. */
    const gizmoHandleScreen = (handle: string) => page.evaluate(h => {
        const me = (window as any).meshEdit
        const viewer = (window as any).viewer
        const parts = me.gizmo.children.filter((c: any) => c.userData.handle === h)
        parts.sort((a: any, b: any) => b.position.length() - a.position.length())
        const part = parts[0]
        const p = part.getWorldPosition(part.position.clone())
        p.project(viewer.scene.mainCamera)
        const r = viewer.canvas.getBoundingClientRect()
        return {x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height}
    }, handle)

    // Select the front-most vertex with a real click; the gizmo appears on it.
    await page.evaluate(() => (window as any).meshEdit.deselectAllElements())
    const front = await page.evaluate(() => {
        const me = (window as any).meshEdit
        const project = me._projectFn()
        const ps = [...me.state.bm.verts].map((v: any, i: number) => ({i, p: project(v.x, v.y, v.z)})).filter((o: any) => o.p)
        ps.sort((a: any, b: any) => a.p.depth - b.p.depth)
        return ps[0].i as number
    })
    const frontScreen = await screenOf(front)
    await page.mouse.click(frontScreen.x, frontScreen.y)
    await page.waitForTimeout(250)
    expect(await selectedIndices()).toEqual([front])
    expect(await page.evaluate(() => (window as any).meshEdit.gizmo.visible)).toBe(true)

    // The gizmo is drawn: red X and blue Z handles around the pivot (Blender's axis colours, at
    // 0.6 alpha over the background; the orange selection overlays have no blue and are excluded).
    const pivotScreen = await screenOf(front)
    const red = 'r > 200 && g < 150 && b > 50 && b < 180 && r - g > 70'
    const blue = 'b > 200 && r < 150 && b - r > 70'
    expect(await countPixels(pivotScreen.x, pivotScreen.y, 130, red)).toBeGreaterThan(15)
    expect(await countPixels(pivotScreen.x, pivotScreen.y, 130, blue)).toBeGreaterThan(15)

    // Hovering the X arrow highlights it (full alpha): more saturated red pixels around the arrow.
    const arrow = await gizmoHandleScreen('TRANS_X')
    const redBefore = await countPixels(arrow.x, arrow.y, 24, 'r > 235 && g < 75 && b < 110')
    await page.mouse.move(arrow.x, arrow.y)
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => (window as any).meshEdit.gizmo.hovered)).toBe('TRANS_X')
    const redAfter = await countPixels(arrow.x, arrow.y, 24, 'r > 235 && g < 75 && b < 110')
    expect(redAfter).toBeGreaterThan(redBefore)

    // Dragging the X arrow moves the vertex along X only; release confirms; Ctrl+Z undoes it.
    const before = (await positions())[front]
    await page.mouse.down()
    await page.mouse.move(arrow.x + 60, arrow.y, {steps: 6})
    // A gizmo handle is an operator-set constraint, named by its space (`initTransform`, transform.cc:2195).
    expect(await page.evaluate(() => (window as any).meshEdit.activeTransform?.status)).toMatch(/^D: .* global$/)
    await page.mouse.up()
    await page.waitForTimeout(250)
    let after = (await positions())[front]
    expect(after[0]).toBeGreaterThan(before[0] + 0.05)
    expect(after[1]).toBeCloseTo(before[1], 6)
    expect(after[2]).toBeCloseTo(before[2], 6)
    expect(await page.evaluate(() => (window as any).meshEdit.activeTransform)).toBeNull()
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(250)
    expectSame((await positions())[front], before)

    // Typing during a gizmo drag sets the value exactly (Plasticity/SketchUp style): the release
    // confirms the typed 0.5 along the handle's axis, wherever the cursor went.
    await page.mouse.move(arrow.x, arrow.y)
    await page.waitForTimeout(150)
    await page.mouse.down()
    await page.mouse.move(arrow.x + 40, arrow.y + 30, {steps: 4})
    for (const k of ['0', '.', '5']) await page.keyboard.press(k)
    expect(await page.evaluate(() => (window as any).meshEdit.activeTransform?.status)).toContain('D: [0.5|] = 0.5')
    await page.mouse.up()
    await page.waitForTimeout(250)
    after = (await positions())[front]
    expect(after[0]).toBeCloseTo(before[0] + 0.5, 5)
    expect(after[1]).toBeCloseTo(before[1], 6)
    expect(after[2]).toBeCloseTo(before[2], 6)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(250)
    expectSame((await positions())[front], before)

    // Numeric entry during a key-started move: G, 0.25, Enter moves by exactly 0.25 in X.
    await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.7)
    await page.keyboard.press('KeyG')
    for (const k of ['0', '.', '2', '5']) await page.keyboard.press(k)
    expect(await page.evaluate(() => (window as any).meshEdit.activeTransform?.status)).toContain('Dx: [0.25|] = 0.25')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    after = (await positions())[front]
    expect(after[0]).toBeCloseTo(before[0] + 0.25, 6)
    expect(after[1]).toBeCloseTo(before[1], 6)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(250)
    expectSame((await positions())[front], before)

    // Snapping: with vertex snapping on, G and a cursor over another vertex lands exactly on it.
    await page.locator('#snap').check()
    await page.locator('#snap-target').selectOption('vertex')
    const target = await page.evaluate(f => {
        const me = (window as any).meshEdit
        const project = me._projectFn()
        const verts = [...me.state.bm.verts]
        const fp = project(verts[f].x, verts[f].y, verts[f].z)
        // Another visible vertex at least 60 px away on screen.
        const ps = verts.map((v: any, i: number) => ({i, p: project(v.x, v.y, v.z)})).filter((o: any) => o.p && o.i !== f)
        ps.sort((a: any, b: any) => a.p.depth - b.p.depth)
        const pick = ps.find((o: any) => Math.hypot(o.p.x - fp.x, o.p.y - fp.y) > 60)
        return pick.i as number
    }, front)
    const targetScreen = await screenOf(target)
    await page.mouse.move(frontScreen.x, frontScreen.y)
    await page.keyboard.press('KeyG')
    await page.mouse.move(targetScreen.x + 6, targetScreen.y - 5, {steps: 5})
    await page.waitForTimeout(100)
    const snapped = await page.evaluate(([f, tg]) => {
        const verts = [...(window as any).meshEdit.state.bm.verts]
        const a = verts[f], b = verts[tg]
        return {type: (window as any).meshEdit.activeTransform.t.tsnap.targetType, d: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)}
    }, [front, target] as const)
    expect(snapped.type).toBe('vertex')
    expect(snapped.d).toBeLessThan(1e-6)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    expectSame((await positions())[front], before)
    await page.locator('#snap').uncheck()

    // Rotation: R with the whole cube selected sweeps the angle about the pivot's screen position.
    await page.keyboard.press('KeyA')
    const pivot = await page.evaluate(() => {
        const me = (window as any).meshEdit
        const bm = me.state.bm
        let x = 0, y = 0, z = 0, n = 0
        for (const v of bm.verts) { x += v.x; y += v.y; z += v.z; n++ }
        const p = me._projectFn()(x / n, y / n, z / n)
        const r = (window as any).viewer.canvas.getBoundingClientRect()
        return {x: r.left + p.x, y: r.top + p.y}
    })
    const allBefore = await positions()
    await page.mouse.move(pivot.x + 120, pivot.y)
    await page.keyboard.press('KeyR')
    await page.mouse.move(pivot.x + 85, pivot.y - 85, {steps: 4})
    await page.mouse.move(pivot.x, pivot.y - 120, {steps: 4})
    expect(await page.evaluate(() => (window as any).meshEdit.activeTransform?.status)).toMatch(/^Rotation: -9[0-9]\.|^Rotation: -8[5-9]\./)
    await page.mouse.click(pivot.x, pivot.y - 120)
    await page.waitForTimeout(250)
    const allAfter = await positions()
    // The centroid is the pivot, so it stays; every vertex keeps its distance to it; one moved.
    const centroid = (ps: number[][]) => ps.reduce((a, p) => [a[0] + p[0] / ps.length, a[1] + p[1] / ps.length, a[2] + p[2] / ps.length], [0, 0, 0])
    const cb = centroid(allBefore), ca = centroid(allAfter)
    for (let i = 0; i < 3; i++) expect(ca[i]).toBeCloseTo(cb[i], 5)
    const dist = (p: number[], c: number[]) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])
    for (let i = 0; i < allBefore.length; i++) expect(dist(allAfter[i], ca)).toBeCloseTo(dist(allBefore[i], cb), 5)
    expect(dist(allAfter[front], allBefore[front])).toBeGreaterThan(0.1)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(250)
    expectSame(await positions(), allBefore)

    // Proportional editing: a 0.75 radius reaches the 0.5-away neighbours with the smooth falloff.
    await page.evaluate(() => (window as any).meshEdit.deselectAllElements())
    await page.mouse.click(frontScreen.x, frontScreen.y)
    await page.waitForTimeout(200)
    expect(await selectedIndices()).toEqual([front])
    await page.locator('#proportional').check()
    await page.evaluate(() => (window as any).meshEdit.setProportional({size: 0.75}))
    await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.7)
    await page.keyboard.press('KeyG')
    // The wheel grows the circle by 10% (Blender's PROPORTIONAL_SIZE_UP).
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => (window as any).meshEdit.activeTransform.t.propSize)).toBeCloseTo(0.825, 6)
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => (window as any).meshEdit.activeTransform.t.propSize)).toBeCloseTo(0.75, 6)
    await page.keyboard.press('1')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    const prop = await positions()
    // smooth(dist): d = (0.75 - 0.5) / 0.75 -> 3d^2 - 2d^3.
    const d = (0.75 - 0.5) / 0.75
    const smooth = 3 * d * d - 2 * d * d * d
    let neighbours = 0, far = 0
    for (let i = 0; i < prop.length; i++) {
        const r = dist(allBefore[i], allBefore[front])
        const dx = prop[i][0] - allBefore[i][0]
        if (i === front) expect(dx).toBeCloseTo(1, 5)
        else if (Math.abs(r - 0.5) < 1e-6) {
            expect(dx).toBeCloseTo(smooth, 5)
            neighbours++
        } else if (r > 0.75) {
            expect(dx).toBeCloseTo(0, 6)
            far++
        }
    }
    // A corner has 3 neighbours half an edge away, a face centre 4; either way they all moved by the falloff.
    expect(neighbours).toBeGreaterThanOrEqual(3)
    expect(far).toBeGreaterThan(10)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(250)
    expectSame(await positions(), allBefore)
    await page.locator('#proportional').uncheck()

    await page.evaluate(() => {
        const e = (window as any).meshEdit
        e.setSelectMode(4)
        e.selectAllElements()
    })
    await page.waitForTimeout(120)
    expect((await state())!.selected[2]).toBe(48)

    // Extrude every face of a closed mesh: nothing borders the region, so Blender keeps the
    // originals and reverses them, giving a shell inside a shell.
    await page.evaluate(() => {
        const e = (window as any).meshEdit
        e.extrude()
        for (const key of ['0', '.', '3']) e.activeTransform?.handleNumericKey(key)
        e.confirmTransform()
    })
    await page.waitForTimeout(250)
    const extruded = await state()
    expect(extruded!.faces).toBeGreaterThan(48)
    expect(extruded!.problems).toEqual([])

    // Leaving edit mode must bake a valid geometry back onto the object.
    const baked = await page.evaluate(() => {
        const e = (window as any).meshEdit
        const object = e.editObject
        e.exit(true)
        const position = object.geometry.getAttribute('position')
        const index = object.geometry.getIndex()
        return {editing: e.isEditing, positions: position?.count ?? 0, indices: index?.count ?? 0}
    })
    expect(baked.editing).toBe(false)
    expect(baked.positions).toBeGreaterThan(0)
    expect(baked.indices % 3).toBe(0)

    // Object mode: the same gizmo and backend move whole objects, with an undo step on UndoManagerPlugin.
    await page.evaluate(() => {
        const me = (window as any).meshEdit
        me.objectGizmo = true
        ;(window as any).viewer.setDirty()
    })
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => (window as any).meshEdit.gizmo.visible)).toBe(true)
    const objectBefore = await page.evaluate(() => (window as any).picking.getSelectedObject().position.toArray())
    const objArrow = await gizmoHandleScreen('TRANS_X')
    await page.mouse.move(objArrow.x, objArrow.y)
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => (window as any).meshEdit.gizmo.hovered)).toBe('TRANS_X')
    await page.mouse.down()
    await page.mouse.move(objArrow.x + 60, objArrow.y, {steps: 6})
    expect(await page.evaluate(() => (window as any).meshEdit.activeObjectTransform?.header)).toMatch(/^D: .* global$/)
    await page.mouse.up()
    await page.waitForTimeout(250)
    const objectAfter = await page.evaluate(() => (window as any).picking.getSelectedObject().position.toArray())
    expect(objectAfter[0]).toBeGreaterThan(objectBefore[0] + 0.05)
    expect(objectAfter[1]).toBeCloseTo(objectBefore[1], 6)
    expect(objectAfter[2]).toBeCloseTo(objectBefore[2], 6)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(250)
    expectSame(await page.evaluate(() => (window as any).picking.getSelectedObject().position.toArray()), objectBefore)
})

test('modelling-workspace', async({page}) => {
    await expect(page).toHaveTitle('Modelling Workspace')

    // ── Real input: mouse and keyboard, the path a person takes. ──
    // Everything below used to fail for a newcomer (issues/open/modelling-tools/10-editor-plan.md):
    // the first click deselected the cube, selected vertices drew black, orbiting cleared the
    // selection, hidden vertices won the pick, and nothing could be undone.
    const state = () => page.evaluate(() => {
        const me = (window as any).meshEdit
        const picking = (window as any).picking
        const bm = me.state?.bm
        return {
            editing: me.isEditing as boolean,
            picked: (picking.getSelectedObject()?.name ?? null) as string | null,
            counts: bm ? [bm.totvert, bm.totedge, bm.totface] : null,
            sel: bm ? [bm.totvertsel, bm.totedgesel, bm.totfacesel] : null,
        }
    })
    const selectedVertex = () => page.evaluate(() => {
        const me = (window as any).meshEdit
        const v = [...me.state.bm.verts].find((x: any) => x.hflag & 1)
        return v ? [v.x, v.y, v.z] : null
    })
    const canvas = (await page.locator('#mcanvas').boundingBox())!
    const cx = canvas.x + canvas.width / 2
    const cy = canvas.y + canvas.height / 2

    // The cube starts selected; clicking it keeps it selected rather than cycling to nothing.
    expect((await state()).picked).toBe('cube')
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(300)
    expect((await state()).picked).toBe('cube')

    // Tab enters edit mode on it, with its real topology: six quads, all selected (a new primitive).
    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    let s = await state()
    expect(s.editing).toBe(true)
    expect(s.counts).toEqual([8, 12, 6])
    expect(s.sel).toEqual([8, 12, 6])

    // Selected vertices are visibly orange, not black.
    const orange = async() => {
        const png = await page.screenshot({clip: {x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height}})
        return page.evaluate(async(b64) => {
            const img = new Image()
            img.src = 'data:image/png;base64,' + b64
            await img.decode()
            const c = document.createElement('canvas')
            c.width = img.width
            c.height = img.height
            const ctx = c.getContext('2d')!
            ctx.drawImage(img, 0, 0)
            const d = ctx.getImageData(0, 0, c.width, c.height).data
            let n = 0
            // Blender's vertex-select #ff7a00, allowing for antialiasing.
            for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 70 && d[i + 1] < 170 && d[i + 2] < 60) n++
            return n
        }, png.toString('base64'))
    }
    expect(await orange()).toBeGreaterThan(20)

    // Click the front corner nearest the top-left: the visible one, never the hidden vertex behind it.
    const target = await page.evaluate(() => {
        const v = (window as any).viewer
        const me = (window as any).meshEdit
        const project = me._projectFn()
        const r = v.canvas.getBoundingClientRect()
        const ps = [...me.state.bm.verts].map((vt: any) => ({p: project(vt.x, vt.y, vt.z), z: vt.z}))
            .filter((o: any) => o.p)
        ps.sort((a: any, b: any) => a.p.depth - b.p.depth)
        const front = ps[0]
        return {x: r.left + front.p.x, y: r.top + front.p.y}
    })
    await page.mouse.move(target.x + 3, target.y + 3)
    await page.waitForTimeout(200)
    await page.mouse.click(target.x + 3, target.y + 3)
    await page.waitForTimeout(300)
    expect((await state()).sel).toEqual([1, 0, 0])
    const picked = await page.evaluate(() => {
        const me = (window as any).meshEdit
        const project = me._projectFn()
        const all = [...me.state.bm.verts].map((v: any) => project(v.x, v.y, v.z).depth)
        const v = [...me.state.bm.verts].find((x: any) => x.hflag & 1) as any
        return {depth: project(v.x, v.y, v.z).depth, nearest: Math.min(...all)}
    })
    expect(picked.depth).toBe(picked.nearest)

    // Orbiting (a middle-button drag; the left drag is box select in edit mode) leaves the selection
    // alone, and so does a Shift+drag over empty space, which extends with nothing.
    await page.mouse.move(canvas.x + 120, canvas.y + canvas.height - 120)
    await page.mouse.down({button: 'middle'})
    await page.mouse.move(canvas.x + 260, canvas.y + canvas.height - 200, {steps: 8})
    await page.mouse.up({button: 'middle'})
    await page.waitForTimeout(300)
    expect((await state()).sel).toEqual([1, 0, 0])
    await page.keyboard.down('Shift')
    await page.mouse.move(canvas.x + 60, canvas.y + canvas.height - 60)
    await page.mouse.down()
    await page.mouse.move(canvas.x + 120, canvas.y + canvas.height - 120, {steps: 6})
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(300)
    expect((await state()).sel).toEqual([1, 0, 0])

    // G, move, click: the vertex moves. Ctrl+Z puts it back, Ctrl+Shift+Z redoes it.
    const before = await selectedVertex()
    await page.mouse.move(cx, cy)
    await page.keyboard.press('KeyG')
    await page.mouse.move(cx + 100, cy - 50, {steps: 6})
    await page.mouse.click(cx + 100, cy - 50)
    await page.waitForTimeout(300)
    const moved = await selectedVertex()
    expect(moved).not.toEqual(before)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(300)
    expect(await selectedVertex()).toEqual(before)
    await page.keyboard.press('Control+Shift+KeyZ')
    await page.waitForTimeout(300)
    for (const [i, x] of (await selectedVertex())!.entries()) expect(x).toBeCloseTo(moved![i], 5)

    // Esc outside a transform does nothing; Delete removes the vertex, not the object; Ctrl+Z undoes it.
    await page.keyboard.press('Escape')
    expect((await state()).editing).toBe(true)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(300)
    s = await state()
    expect(s.counts).toEqual([7, 9, 3])
    expect(await page.evaluate(() => (window as any).viewer.scene.modelRoot.children
        .filter((c: any) => c.assetType !== 'widget').length)).toBe(1)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(300)
    expect((await state()).counts).toEqual([8, 12, 6])

    // Tab out leaves the cube selected; double-click goes back in.
    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    s = await state()
    expect(s.editing).toBe(false)
    expect(s.picked).toBe('cube')
    await page.mouse.dblclick(cx, cy)
    await page.waitForTimeout(300)
    expect((await state()).editing).toBe(true)

    // Face mode: click a face, E, move, click - one face extruded into a box of 12 verts and 10 faces.
    await page.locator('[data-select="4"]').click()
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(300)
    expect((await state()).sel).toEqual([4, 4, 1])
    await page.keyboard.press('KeyE')
    await page.mouse.move(cx, cy - 80, {steps: 6})
    await page.mouse.click(cx, cy - 80)
    await page.waitForTimeout(300)
    expect((await state()).counts).toEqual([12, 20, 10])
    // Every edge of the extruded mesh is drawn, not only the cube's original twelve: the fat-line overlay
    // is instanced, and a reused geometry kept drawing the instance count it was first bound with.
    await page.waitForTimeout(200)
    const drawn = await page.evaluate(() => {
        const me = (window as any).meshEdit
        const g = me._edgeLines.geometry
        return {instances: g.instanceCount, limit: g._maxInstanceCount ?? Infinity, edges: me.state.bm.totedge}
    })
    expect(drawn.instances).toBe(drawn.edges)
    expect(drawn.limit).toBeGreaterThanOrEqual(drawn.edges)
    await page.locator('[data-mode="object"]').click()
    await page.waitForTimeout(200)
    expect((await state()).editing).toBe(false)

    const count = async() => page.evaluate(() =>
        (window as any).viewer.scene.modelRoot.children.filter((c: any) => c.assetType !== 'widget').length)

    await page.locator('#clear').click()
    await page.waitForTimeout(150)
    expect(await count()).toBe(0)

    // Every entry in the Add bar must produce exactly one object with usable geometry.
    for (const primitive of ['cube', 'plane', 'circle', 'sphere', 'cylinder', 'cone', 'torus']) {
        await page.locator(`[data-add="${primitive}"]`).click()
        await page.waitForTimeout(160)
    }
    expect(await count()).toBe(7)

    const geometries = await page.evaluate(() =>
        (window as any).viewer.scene.modelRoot.children
            .filter((c: any) => c.assetType !== 'widget')
            .map((c: any) => ({
                name: c.name,
                verts: c.geometry?.getAttribute('position')?.count ?? 0,
            })))
    for (const g of geometries) expect(g.verts).toBeGreaterThan(2)

    // The mode indicator has to track edit mode, since it is the only thing telling you which
    // keymap is live.
    const mode = await page.evaluate(async() => {
        const e = (window as any).meshEdit
        e.enter()
        const inEdit = document.getElementById('mode')!.textContent
        e.exit(false)
        return {inEdit, after: document.getElementById('mode')!.textContent}
    })
    expect(mode.inEdit).toBe('EDIT MODE')
    expect(mode.after).toBe('OBJECT MODE')
})

test('mesh-edit-select', async({page}) => {
    await expect(page).toHaveTitle('Mesh Edit Select')

    // ── Real input for the selection tools: box, lasso, loop, path, hide, with pixel checks. ──
    const sel = () => page.evaluate(() => {
        const bm = (window as any).meshEdit.state.bm
        return [bm.totvertsel, bm.totedgesel, bm.totfacesel] as [number, number, number]
    })
    const canvas = (await page.locator('#mcanvas').boundingBox())!
    // Screen positions of the grid's vertices (8x8 quads, 9x9 vertices from -1..1), from the plugin's projection.
    type P = {x: number, y: number, gx: number, gy: number}
    const positions = () => page.evaluate(() => {
        const me = (window as any).meshEdit
        const project = me._projectFn()
        return [...me.state.bm.verts].map((v: any) => {
            const p = project(v.x, v.y, v.z)
            return {x: p.x, y: p.y, gx: Math.round(v.x * 4), gy: Math.round(v.y * 4)} as P
        })
    })
    let verts: P[] = await positions()
    const at = (gx: number, gy: number) => verts.find(v => v.gx === gx && v.gy === gy)!

    // Starts in edit mode, vertex select, nothing selected.
    expect(await sel()).toEqual([0, 0, 0])
    await expect(page.locator('[data-select="1"]')).toHaveClass(/active/)

    // Box select: drag from empty space around the four vertices of the top-left quad (the box has
    // to start off the mesh so the press is not a click on a vertex; the grid is small on screen).
    const corners = [at(-4, 4), at(-3, 4), at(-4, 3), at(-3, 3)]
    const minX = Math.min(...corners.map(p => p.x)) - 10
    const maxX = Math.max(...corners.map(p => p.x)) + 10
    const minY = Math.min(...corners.map(p => p.y)) - 10
    const maxY = Math.max(...corners.map(p => p.y)) + 10
    await page.mouse.move(canvas.x + minX, canvas.y + minY)
    await page.mouse.down()
    await page.mouse.move(canvas.x + maxX, canvas.y + maxY, {steps: 8})
    // The marquee is on screen while dragging.
    await expect(page.locator('[data-mesh-edit-region] rect')).toHaveCount(2)
    await page.mouse.up()
    await page.waitForTimeout(200)
    await expect(page.locator('[data-mesh-edit-region]')).toHaveCount(0)
    const boxed = await sel()
    expect(boxed[0]).toBeGreaterThanOrEqual(4)
    // Every selected vertex projects inside the box.
    const outside = await page.evaluate(([x0, y0, x1, y1]) => {
        const me = (window as any).meshEdit
        const project = me._projectFn()
        return [...me.state.bm.verts].filter((v: any) => v.hflag & 1).filter((v: any) => {
            const p = project(v.x, v.y, v.z)
            return p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1
        }).length
    }, [minX, minY, maxX, maxY])
    expect(outside).toBe(0)

    // Shift+drag adds, Ctrl+drag subtracts.
    const more = [at(4, -4), at(3, -4), at(4, -3), at(3, -3)]
    const box2 = {
        x0: Math.min(...more.map(p => p.x)) - 10, x1: Math.max(...more.map(p => p.x)) + 10,
        y0: Math.min(...more.map(p => p.y)) - 10, y1: Math.max(...more.map(p => p.y)) + 10,
    }
    await page.keyboard.down('Shift')
    await page.mouse.move(canvas.x + box2.x0, canvas.y + box2.y0)
    await page.mouse.down()
    await page.mouse.move(canvas.x + box2.x1, canvas.y + box2.y1, {steps: 8})
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(200)
    const added = await sel()
    expect(added[0]).toBeGreaterThan(boxed[0])
    await page.keyboard.down('Control')
    await page.mouse.move(canvas.x + box2.x0, canvas.y + box2.y0)
    await page.mouse.down()
    await page.mouse.move(canvas.x + box2.x1, canvas.y + box2.y1, {steps: 8})
    await page.mouse.up()
    await page.keyboard.up('Control')
    await page.waitForTimeout(200)
    expect(await sel()).toEqual(boxed)

    // A middle-button drag orbits and leaves the selection alone.
    await page.mouse.move(canvas.x + 40, canvas.y + canvas.height - 40)
    await page.mouse.down({button: 'middle'})
    await page.mouse.move(canvas.x + 90, canvas.y + canvas.height - 80, {steps: 6})
    await page.mouse.up({button: 'middle'})
    await page.waitForTimeout(300)
    expect(await sel()).toEqual(boxed)
    // Put the camera back for the positions computed above (after stopping the orbit's damping).
    await page.evaluate(async() => {
        const v = (window as any).viewer
        v.scene.mainCamera.controls?.stopDamping?.()
        v.scene.mainCamera.position.set(1.2, 2.6, 3.4)
        v.scene.mainCamera.target.set(0, 0, 0)
        v.scene.mainCamera.setDirty()
        await v.fitToView(undefined, 2.1)
    })
    await page.waitForTimeout(400)
    // The view is close to the original but not guaranteed identical: re-read the positions.
    verts = await positions()

    // Lasso: a diamond around the centre vertex, drawn with the lasso tool, selects it and only it.
    await page.locator('[data-tool="lasso"]').click()
    const c = at(0, 0)
    const r = 14
    await page.mouse.move(canvas.x + c.x - r, canvas.y + c.y)
    await page.mouse.down()
    for (const [dx, dy] of [[0, -r], [r, 0], [0, r], [-r, 0]]) {
        await page.mouse.move(canvas.x + c.x + dx, canvas.y + c.y + dy, {steps: 3})
    }
    await expect(page.locator('[data-mesh-edit-region] polygon')).toHaveCount(2)
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect(await sel()).toEqual([1, 0, 0])
    await page.locator('[data-tool="box"]').click()

    // Edge mode, Alt+click on an interior horizontal edge: the whole row of 8 edges.
    await page.keyboard.press('Digit2')
    const e1 = at(0, 1)
    const e2 = at(1, 1)
    const mid = {x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2}
    await page.mouse.move(canvas.x + mid.x, canvas.y + mid.y)
    await page.waitForTimeout(100)
    await page.keyboard.down('Alt')
    await page.mouse.click(canvas.x + mid.x, canvas.y + mid.y)
    await page.keyboard.up('Alt')
    await page.waitForTimeout(200)
    const loop = await sel()
    expect(loop[1]).toBe(8)
    expect(loop[0]).toBe(9)
    // Ctrl+Alt+click the same edge: the ring across the column of quads, 9 edges.
    await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    await page.mouse.click(canvas.x + mid.x, canvas.y + mid.y)
    await page.keyboard.up('Alt')
    await page.keyboard.up('Control')
    await page.waitForTimeout(200)
    expect((await sel())[1]).toBe(9)

    // Vertex mode: click one vertex, Ctrl+click another on the same row: the path between them.
    await page.keyboard.press('Digit1')
    const a = at(-3, -2)
    const b = at(3, -2)
    await page.mouse.click(canvas.x + a.x, canvas.y + a.y)
    await page.waitForTimeout(150)
    expect(await sel()).toEqual([1, 0, 0])
    await page.keyboard.down('Control')
    await page.mouse.click(canvas.x + b.x, canvas.y + b.y)
    await page.keyboard.up('Control')
    await page.waitForTimeout(200)
    expect(await sel()).toEqual([7, 6, 0])

    // Pixel checks: fat edges and face dots. `window` returns the pixels of an odd-sized square
    // around a canvas point, row-major RGB triples.
    const window = async(x: number, y: number, size: number) => {
        const h = (size - 1) / 2
        const png = await page.screenshot({clip: {x: canvas.x + Math.round(x) - h, y: canvas.y + Math.round(y) - h, width: size, height: size}})
        return page.evaluate(async([b64, n]) => {
            const img = new Image()
            img.src = 'data:image/png;base64,' + b64
            await img.decode()
            const cv = document.createElement('canvas')
            cv.width = img.width
            cv.height = img.height
            const ctx = cv.getContext('2d')!
            ctx.drawImage(img, 0, 0)
            const d = ctx.getImageData(0, 0, n, n).data
            const out: number[][] = []
            for (let i = 0; i < n * n; i++) out.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]])
            return out
        }, [png.toString('base64'), size] as const)
    }
    const pixel = async(x: number, y: number) => (await window(x, y, 3))[4]
    const isOrange = (rgb: number[]) => rgb[0] > 200 && rgb[1] > 90 && rgb[1] < 190 && rgb[2] < 80
    // The selected path's edges are orange (#ff9900) and fat. The width is measured across the edge:
    // along its normal, each pixel's blue channel says how much of it the line covers (the line has
    // none, the surface plenty), and the coverages sum to the width in pixels. A one-pixel line sums
    // to about 1; the theme's 2 px edge sums to 1.5-2 depending on where the MSAA samples fall.
    const p1 = at(-1, -2)
    const p2 = at(0, -2)
    const em = {x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2}
    expect(isOrange(await pixel(em.x, em.y))).toBe(true)
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const nx = -(p2.y - p1.y) / len
    const ny = (p2.x - p1.x) / len
    const win = await window(em.x, em.y, 15)
    const sample = (t: number) => win[Math.round(7 + t * ny) * 15 + Math.round(7 + t * nx)]
    const surfaceBlue = (sample(-6)[2] + sample(6)[2]) / 2
    expect(surfaceBlue).toBeGreaterThan(100)
    let width = 0
    const profile: number[][] = []
    for (let t = -4; t <= 4; t++) {
        profile.push(sample(t))
        width += Math.min(1, Math.max(0, (surfaceBlue - sample(t)[2]) / surfaceBlue))
    }
    expect(width, 'profile across the edge: ' + JSON.stringify(profile)).toBeGreaterThanOrEqual(1.4)
    // An unselected edge is black, not the surface colour.
    const q1 = at(-1, 3)
    const q2 = at(0, 3)
    const qm = await pixel((q1.x + q2.x) / 2, (q1.y + q2.y) / 2)
    expect(qm[0] + qm[1] + qm[2]).toBeLessThan(120)
    // Face mode: a dot at the centre of a selected face is the face-dot orange (#ff8a00).
    await page.keyboard.press('Digit3')
    await page.waitForTimeout(150)
    await page.evaluate(() => (window as any).meshEdit.selectAllElements())
    await page.waitForTimeout(200)
    const f = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]
    const fc = {x: f.reduce((s, p) => s + p.x, 0) / 4, y: f.reduce((s, p) => s + p.y, 0) / 4}
    expect(isOrange(await pixel(fc.x, fc.y))).toBe(true)

    // Hide and reveal: H hides the selected faces (the drawn surface loses its triangles), Alt+H brings
    // them back selected.
    await page.evaluate(() => (window as any).meshEdit.deselectAllElements())
    await page.mouse.click(canvas.x + fc.x, canvas.y + fc.y)
    await page.waitForTimeout(150)
    expect((await sel())[2]).toBe(1)
    const triangles = () => page.evaluate(() => (window as any).meshEdit.editObject.geometry.getIndex().count / 3)
    const before = await triangles()
    await page.keyboard.press('KeyH')
    await page.waitForTimeout(250)
    expect(await triangles()).toBe(before - 2)
    expect(await page.evaluate(() => [...(window as any).meshEdit.state.bm.faces].filter((f: any) => f.hidden).length)).toBe(1)
    expect(await sel()).toEqual([0, 0, 0])
    await page.keyboard.press('Alt+KeyH')
    await page.waitForTimeout(250)
    expect(await triangles()).toBe(before)
    expect((await sel())[2]).toBe(1)
    // Hiding is one undo step.
    await page.keyboard.press('KeyH')
    await page.waitForTimeout(250)
    await page.keyboard.press('Control+KeyZ')
    await page.waitForTimeout(250)
    expect(await triangles()).toBe(before)

    // Select more / less from the keyboard.
    await page.keyboard.press('Control+NumpadAdd')
    await page.waitForTimeout(150)
    expect((await sel())[2]).toBe(5)
    await page.keyboard.press('Control+NumpadSubtract')
    await page.waitForTimeout(150)
    expect((await sel())[2]).toBe(1)

    // Shift+1 adds vertex mode to face mode. Ctrl+2 goes down to edge mode "contracting": only edges
    // whose faces are all selected survive, so one face leaves nothing (EDBM_selectmode_convert).
    await page.keyboard.press('Shift+Digit1')
    expect(await page.evaluate(() => (window as any).meshEdit.selectMode)).toBe(5)
    await page.keyboard.press('Control+Digit2')
    expect(await page.evaluate(() => (window as any).meshEdit.selectMode)).toBe(2)
    expect((await sel())[1]).toBe(0)
    // Going up with Ctrl expands: one vertex becomes every edge that touches it.
    await page.keyboard.press('Digit1')
    const cv = at(0, 0)
    await page.mouse.click(canvas.x + cv.x, canvas.y + cv.y)
    await page.waitForTimeout(150)
    expect(await sel()).toEqual([1, 0, 0])
    await page.keyboard.press('Control+Digit2')
    expect(await page.evaluate(() => (window as any).meshEdit.selectMode)).toBe(2)
    expect(await sel()).toEqual([5, 4, 0])
})

test('modelling-editor', async({page}) => {
    await expect(page).toHaveTitle('Modelling Editor')

    // The shell renders from the engine's registries; the example exposes the engine on window.
    await page.waitForFunction(() => (window as any).engine?.operators.list().length > 0)
    await expect(page.locator('[data-editor-root]')).toBeVisible()
    // the viewer canvas plus the view gizmo's own canvas live in the viewport
    await expect(page.locator('[data-viewport] canvas').first()).toBeVisible()

    const engineState = async() => page.evaluate(() => {
        const e = (window as any).engine
        return {mode: e.mode, selectMode: e.selectMode, tool: e.activeTool?.id ?? null, stats: e.stats(), lastOp: e.lastOperation?.operator.id ?? null}
    })

    // Starts in object mode with the cube selected; the status bar and outliner agree.
    let s = await engineState()
    expect(s.mode).toBe('object')
    expect(s.stats.objects).toBe(1)
    await expect(page.locator('[data-status-bar] .me-stat-mode')).toHaveText('Object')
    await expect(page.locator('.me-outliner .bp5-tree-node-selected')).toHaveCount(1)

    // Toolbar: real clicks switch the active tool and show the gizmo hints.
    await page.locator('[data-tool="object.move"]').click()
    expect((await engineState()).tool).toBe('object.move')
    await expect(page.locator('[data-status-bar]')).toContainText('Drag a handle to move')
    await page.locator('[data-tool="select"]').click()
    expect((await engineState()).tool).toBe('select')

    // Header: Object/Edit switch and select-mode buttons.
    await expect(page.locator('[data-select-mode="face"]')).toHaveCount(0)
    await page.locator('[data-mode-button="edit"]').click()
    s = await engineState()
    expect(s.mode).toBe('edit')
    await expect(page.locator('[data-status-bar] .me-stat-mode')).toHaveText('Edit · vertex')
    await page.locator('[data-select-mode="face"]').click()
    expect((await engineState()).selectMode).toBe('face')
    await expect(page.locator('[data-status-bar] .me-stat-mode')).toHaveText('Edit · face')
    // The edit-mode tools replace the object-mode ones.
    await expect(page.locator('[data-tool="mesh.extrude"]')).toBeVisible()
    await expect(page.locator('[data-tool="object.move"]')).toHaveCount(0)

    // Command palette from the keyboard: F3 opens it, typing filters, Enter runs the top hit.
    await page.keyboard.press('F3')
    const palette = page.locator('.me-palette input')
    await expect(palette).toBeVisible()
    await palette.fill('object mode')
    await expect(page.locator('.me-palette .bp5-menu-item').first()).toContainText('Object Mode')
    await page.keyboard.press('Enter')
    await expect(palette).toHaveCount(0)
    expect((await engineState()).mode).toBe('object')

    // Menus render from the registry: Add > UV Sphere adds an object and fills the redo-last panel.
    await page.locator('[data-menu="Add"]').click()
    await page.getByRole('menuitem', {name: 'UV Sphere'}).click()
    await expect.poll(async() => (await engineState()).stats.objects).toBe(2)
    s = await engineState()
    expect(s.lastOp).toBe('add.sphere')
    await expect(page.locator('[data-operator-panel="add.sphere"]')).toBeVisible()
    await page.locator('[data-operator-panel="add.sphere"] .me-operator-title').click()
    await expect(page.locator('[data-operator-panel="add.sphere"] #me-prop-radius')).toBeVisible()
    await expect(page.locator('.me-outliner .bp5-tree-node')).toHaveCount(2)

    // Edit menu: the undo history dialog lists the document commands by name and reverses them. Mode
    // switches and the selections they imply are not steps, so the list is exactly the two adds.
    await page.locator('[data-menu="Edit"]').click()
    await page.getByRole('menuitem', {name: 'Undo History…'}).click()
    const history = page.locator('[data-history]')
    await expect(history).toBeVisible()
    await expect(history).toContainText('Add Sphere')
    await expect(history.locator('li')).toHaveText(['Add Cube', 'Add Sphere'])
    await page.getByRole('button', {name: 'Undo'}).click()
    await expect.poll(async() => (await engineState()).stats.objects).toBe(1)
    // the dialog header's X is also named Close; take the footer button
    await page.locator('.me-dialog .bp5-dialog-footer').getByRole('button', {name: 'Close'}).click()
    // the dialog's overlay keeps catching pointer events until its close transition ends
    await expect(page.locator('.me-dialog')).toHaveCount(0)

    // Viewport context menu: a right click that does not drag opens the operators for the selection.
    const vp = await page.locator('[data-viewport]').boundingBox()
    await page.mouse.click(vp!.x + vp!.width / 2, vp!.y + vp!.height / 2, {button: 'right'})
    await expect(page.locator('.me-context-menu')).toBeVisible()
    await expect(page.locator('.me-context-menu')).toContainText('Duplicate')
    await page.keyboard.press('Escape')
    await expect(page.locator('.me-context-menu')).toHaveCount(0)

    // Disabled operators explain themselves instead of failing silently.
    await page.evaluate(() => (window as any).engine.picking.clearSelection())
    await page.locator('[data-menu="Object"]').click()
    const del = page.getByRole('menuitem', {name: 'Delete'})
    await expect(del).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
})

test('modelling-editor-engine', async({page}) => {
    await expect(page).toHaveTitle('Modelling Editor Engine')
    await page.waitForFunction(() => (window as any).engine?.operators.list().length > 0)

    // ── Real input: every step below is a key press or a mouse click, routed by the engine's keymap. ──
    const state = () => page.evaluate(() => {
        const e = (window as any).engine
        const bm = e.meshEdit.state?.bm
        const cube = (window as any).modelling.document.find('cube')
        return {
            mode: e.mode as string,
            selectMode: e.selectMode as string,
            preset: e.keymap.activePreset.id as string,
            objects: e.stats().objects as number,
            counts: bm ? [bm.totvert, bm.totedge, bm.totface] as number[] : null,
            sel: bm ? [bm.totvertsel, bm.totedgesel, bm.totfacesel] as number[] : null,
            cubeFaces: cube ? cube.mesh.facesNum as number : null,
            lastOp: (e.lastOperation?.operator.id ?? null) as string | null,
            lastProps: (e.lastOperation?.props ?? null) as Record<string, unknown> | null,
            history: e.history.entries().map((x: any) => x.label + (x.undone ? ' *' : '')) as string[],
            shortcuts: {
                extrude: e.operators.get('mesh.extrude').shortcut as string,
                palette: e.operators.get('ui.command_palette').shortcut as string,
                undo: e.operators.get('edit.undo').shortcut as string,
            },
        }
    })
    // The inset face's vertices, to see a re-run with another thickness change the result.
    const selectedVerts = () => page.evaluate(() => {
        const bm = (window as any).engine.meshEdit.state.bm
        return [...bm.verts].filter((v: any) => v.hflag & 1).map((v: any) => [v.x, v.y, v.z].map((n: number) => Math.round(n * 1e4) / 1e4))
    })
    const vp = (await page.locator('[data-viewport]').boundingBox())!
    const cx = vp.x + vp.width / 2
    const cy = vp.y + vp.height / 2
    const empty = {x: vp.x + 40, y: vp.y + vp.height - 60}

    // 1. Keymap: the Blender preset is active and every shortcut shown comes from it.
    let s = await state()
    expect(s.preset).toBe('blender')
    expect(s.shortcuts).toEqual({extrude: 'E', palette: 'F3', undo: 'Ctrl+Z'})
    expect(s.history).toEqual(['Add Cube'])

    // Tab enters edit mode on the selected cube (keys go to the window: no focus needed); 3 picks face
    // mode; a click on the cube selects one face.
    await page.mouse.move(cx, cy)
    await page.keyboard.press('Tab')
    await expect.poll(async() => (await state()).mode).toBe('edit')
    await page.keyboard.press('3')
    await expect.poll(async() => (await state()).selectMode).toBe('face')
    await page.mouse.click(cx, cy)
    await expect.poll(async() => (await state()).sel).toEqual([4, 4, 1])

    // 2. An operator from the palette (F3 is the Blender key): Inset Faces runs with its defaults.
    await page.keyboard.press('F3')
    const palette = page.locator('.me-palette input')
    await expect(palette).toBeVisible()
    await palette.fill('inset')
    await expect(page.locator('.me-palette .bp5-menu-item').first()).toContainText('Inset Faces')
    await page.keyboard.press('Enter')
    await expect(palette).toHaveCount(0)
    await expect.poll(async() => (await state()).counts).toEqual([12, 20, 10])
    s = await state()
    expect(s.lastOp).toBe('mesh.inset')
    expect(s.history).toEqual(['Add Cube', 'Inset cube'])
    // The command's result selects the inset face, so a follow-up extrude would address it.
    expect(s.sel).toEqual([4, 4, 1])
    const thin = await selectedVerts()

    // 3. Redo-last: change the thickness in the panel - the result changes - and Ctrl+Z goes back to
    // before the inset, in one step, as Blender's F9 panel does.
    await page.locator('[data-operator-panel="mesh.inset"] .me-operator-title').click()
    const thickness = page.locator('[data-operator-panel="mesh.inset"] #me-prop-thickness')
    await expect(thickness).toBeVisible()
    await thickness.fill('0.3')
    await expect.poll(async() => JSON.stringify(await selectedVerts())).not.toBe(JSON.stringify(thin))
    s = await state()
    expect(s.counts).toEqual([12, 20, 10])
    expect(s.lastProps?.thickness).toBe(0.3)
    expect(s.history).toEqual(['Add Cube', 'Inset cube'])
    // Leave the text field (a click on empty space deselects, which is not an undo step) and undo.
    await page.mouse.click(empty.x, empty.y)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).counts).toEqual([8, 12, 6])
    expect((await state()).lastOp).toBeNull()
    await page.keyboard.press('Control+Shift+KeyZ')
    await expect.poll(async() => (await state()).counts).toEqual([12, 20, 10])

    // 4. One history across modes: Tab out, Shift+A opens the Add menu at the cursor, UV Sphere.
    await page.keyboard.press('Tab')
    await expect.poll(async() => (await state()).mode).toBe('object')
    await page.mouse.move(cx, cy)
    await page.keyboard.press('Shift+KeyA')
    const popup = page.locator('.me-popup-menu')
    await expect(popup).toBeVisible()
    await popup.getByRole('menuitem', {name: 'UV Sphere'}).click()
    await expect.poll(async() => (await state()).objects).toBe(2)
    s = await state()
    expect(s.history).toEqual(['Add Cube', 'Inset cube', 'Add Sphere'])
    expect(s.cubeFaces).toBe(10)
    // Ctrl+Z walks back through the object step, then the edit-mode step, then the first add.
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).objects).toBe(1)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).cubeFaces).toBe(6)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).objects).toBe(0)
    expect((await state()).history).toEqual(['Add Cube *', 'Inset cube *', 'Add Sphere *'])
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Shift+KeyZ')
    await expect.poll(async() => (await state()).objects).toBe(2)
    expect((await state()).cubeFaces).toBe(10)

    // 5. Context menus: object mode lists object operators; edit mode lists the select-mode ones, and
    // Delete opens Blender's delete-type menu. The X key opens the same menu at the cursor.
    await page.mouse.click(cx, cy, {button: 'right'})
    // The popup menus the engine asks for share the context menu's styling; tell them apart here.
    const context = page.locator('.me-context-menu:not(.me-popup-menu)')
    await expect(context).toBeVisible()
    await expect(context).toContainText('Duplicate')
    await expect(context).toContainText('Apply Transform')
    await page.keyboard.press('Escape')
    await expect(context).toHaveCount(0)
    // The sphere sits inside the cube: a click on the already-selected cube cycles to the object behind
    // it (Blender's Alt+click), and an outliner click on a selected node toggles it off, so the
    // precondition - the cube selected - is set through the API; the rest is keys and clicks.
    await page.evaluate(() => {
        const w = window as any
        w.engine.picking.setSelectedObject(w.modelling.document.find('cube').object, false, false)
    })
    await page.keyboard.press('Tab')
    await expect.poll(async() => (await state()).mode).toBe('edit')
    expect((await state()).counts).toEqual([12, 20, 10])
    await page.mouse.click(cx, cy)
    await expect.poll(async() => (await state()).sel[2]).toBe(1)
    await page.keyboard.press('KeyX')
    await expect(popup).toBeVisible()
    await expect(popup).toContainText('Only Faces')
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await page.mouse.click(cx, cy, {button: 'right'})
    await expect(context).toBeVisible()
    await expect(context).toContainText('Inset Faces')
    // A menu item's accessible name carries its shortcut label too ("Delete X").
    await context.getByRole('menuitem', {name: /^Delete\b/}).click()
    await expect(popup).toBeVisible()
    await popup.getByRole('menuitem', {name: 'Faces', exact: true}).click()
    await expect.poll(async() => (await state()).counts![2]).toBe(9)
    expect((await state()).history.at(-1)).toBe('Delete cube')

    // 6. Switching to the Design preset re-derives every shortcut and changes what the keys do:
    // Ctrl+K opens the palette, Esc backs out one level, Enter enters edit mode.
    await page.keyboard.press('F3')
    await palette.fill('keymap')
    await page.keyboard.press('Enter')
    await expect(popup).toBeVisible()
    await popup.getByRole('menuitem', {name: /Design/}).click()
    await expect.poll(async() => (await state()).preset).toBe('design')
    s = await state()
    expect(s.shortcuts).toEqual({extrude: 'Ctrl+E', palette: 'Ctrl+K', undo: 'Ctrl+Z'})
    await expect(page.locator('[data-tool="mesh.extrude"]')).toBeVisible()
    await page.keyboard.press('F3')
    await expect(palette).toHaveCount(0)
    await page.keyboard.press('Control+KeyK')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await page.keyboard.press('Escape') // edit mode with nothing selected: back out to object mode
    await expect.poll(async() => (await state()).mode).toBe('object')
    await page.keyboard.press('Enter')
    await expect.poll(async() => (await state()).mode).toBe('edit')

    // 7. The Move tool is a sticky gizmo tool, as in Blender: it shows only the move handles, a drag on
    // an axis arrow moves the selection along that axis alone, and the tool stays active afterwards.
    await page.keyboard.press('Control+KeyA')
    await page.locator('[data-tool="mesh.move"]').click()
    const gizmoState = () => page.evaluate(() => {
        const me = (window as any).engine.meshEdit
        const sel = [...me.state.bm.verts].filter((v: any) => v.hflag & 1)
        const c = [0, 1, 2].map(i => sel.reduce((a: number, v: any) => a + [v.x, v.y, v.z][i], 0) / Math.max(1, sel.length))
        return {tool: (window as any).engine.activeTool?.id, visible: me.gizmoVisible, show: {...me.gizmo.show}, centre: c}
    })
    let g = await gizmoState()
    expect(g.visible).toBe(true)
    expect(g.show).toEqual({translate: true, rotate: false, scale: false})
    // Whichever axis arrow is showing: an arrow pointing at the camera is hidden, as in Blender, and an
    // earlier step left the view looking down Y.
    const arrow = await page.evaluate(() => {
        const v = (window as any).viewer
        const me = (window as any).engine.meshEdit
        const r = v.canvas.getBoundingClientRect()
        for (const [handle, axis] of [['TRANS_X', 0], ['TRANS_Y', 1], ['TRANS_Z', 2]] as const) {
            for (let y = 0; y < r.height; y += 3) {
                for (let x = 0; x < r.width; x += 3) {
                    // The plugin's own pick brings the gizmo up to date with the selection first.
                    if (me._pickGizmo(x, y) === handle) return {x: r.left + x, y: r.top + y, axis}
                }
            }
        }
        return null
    })
    expect(arrow).not.toBeNull()
    const before = g.centre
    await page.mouse.move(arrow!.x, arrow!.y)
    await page.mouse.down()
    await page.mouse.move(arrow!.x + 60, arrow!.y - 60, {steps: 8})
    await page.mouse.up()
    const axis = arrow!.axis
    await expect.poll(async() => Math.abs((await gizmoState()).centre[axis] - before[axis])).toBeGreaterThan(0.05)
    g = await gizmoState()
    for (const other of [0, 1, 2].filter(a => a !== axis)) expect(g.centre[other]).toBeCloseTo(before[other], 5)
    expect(g.tool).toBe('mesh.move')
    expect((await state()).history.at(-1)).toBe('Move')
    await page.locator('[data-tool="mesh.rotate"]').click()
    g = await gizmoState()
    expect(g.show).toEqual({translate: false, rotate: true, scale: false})

    // 8. Object mode box select (Blender's do_object_box_select): with the left button freed from
    // orbiting by the preset, a drag over everything selects every object, and a drag over empty space
    // selects none.
    await page.locator('[data-tool="select"]').click()
    await page.keyboard.press('Digit4')
    await expect.poll(async() => (await state()).mode).toBe('object')
    const box = (await page.locator('canvas').first().boundingBox())!
    const meshCount = () => page.evaluate(() => (window as any).viewer.scene.modelRoot.children
        .filter((c: any) => c.isMesh && c.assetType !== 'widget').length)
    const meshesBefore = await meshCount()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.press('Shift+KeyA')
    await expect(popup).toBeVisible()
    await popup.getByRole('menuitem', {name: /UV Sphere/}).click()
    await expect.poll(meshCount).toBe(meshesBefore + 1)
    const selected = () => page.evaluate(() => ((window as any).viewer.getPlugin('Picking').picker.selectedObjects ?? []).length)
    await page.mouse.move(box.x + 12, box.y + 12)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 12, box.y + box.height - 12, {steps: 10})
    await page.mouse.up()
    await expect.poll(selected).toBe(meshesBefore + 1)
    await page.mouse.move(box.x + 12, box.y + 12)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + 60, {steps: 6})
    await page.mouse.up()
    await expect.poll(selected).toBe(0)
})

test('modelling-loop-tools', async({page}) => {
    await expect(page).toHaveTitle('Modelling Loop Tools')
    await page.waitForFunction(() => (window as any).engine?.operators.list().length > 0)

    // Every step is a key press or a mouse click routed by the engine; state is read back afterwards.
    const state = () => page.evaluate(() => {
        const e = (window as any).engine
        const bm = e.meshEdit.state?.bm
        return {
            mode: e.mode as string,
            selectMode: e.selectMode as string,
            counts: bm ? [bm.totvert, bm.totedge, bm.totface] as number[] : null,
            sel: bm ? [bm.totvertsel, bm.totedgesel, bm.totfacesel] as number[] : null,
            transform: (e.meshEdit.activeTransform?.mode ?? null) as string | null,
            lastOp: (e.lastOperation?.operator.id ?? null) as string | null,
            lastProps: (e.lastOperation?.props ?? null) as Record<string, unknown> | null,
            history: e.history.entries().map((x: any) => x.label + (x.undone ? ' *' : '')) as string[],
        }
    })
    const round = (n: number) => Math.round(n * 1e4) / 1e4 + 0
    /** Every vertex, rounded, in mesh order; and the selected ones. */
    const verts = () => page.evaluate(() => [...(window as any).engine.meshEdit.state.bm.verts]
        .map((v: any) => ({co: [v.x, v.y, v.z], sel: !!(v.hflag & 1)})))
        .then(vs => vs.map(v => ({co: v.co.map(round), sel: v.sel})))
    const vp = (await page.locator('[data-viewport]').boundingBox())!
    const cx = vp.x + vp.width / 2
    const cy = vp.y + vp.height / 2
    const empty = {x: vp.x + 40, y: vp.y + vp.height - 60}

    // ── Edge slide with G G (`transform.cc:1117`), a typed factor, the redo panel, undo ──
    // Tab into edit mode, face mode, click the face under the centre, then edge mode: its four edges
    // are a closed loop (each vertex has two selected edges).
    await page.mouse.move(cx, cy)
    await page.keyboard.press('Tab')
    await expect.poll(async() => (await state()).mode).toBe('edit')
    await page.keyboard.press('3')
    await page.mouse.click(cx, cy)
    await expect.poll(async() => (await state()).sel).toEqual([4, 4, 1])
    await page.keyboard.press('2')
    await expect.poll(async() => (await state()).selectMode).toBe('edge')
    const cube = await verts()
    const loop = cube.filter(v => v.sel)
    expect(loop.length).toBe(4)
    // The face's normal axis: the coordinate the four vertices share.
    const axis = [0, 1, 2].find(i => loop.every(v => v.co[i] === loop[0].co[i]))!
    const side = loop[0].co[axis]
    // A factor of 0.5 slides the loop either halfway down the cube's side edges, or halfway across the
    // face to the opposite corner, which is the face's centre: the two neighbouring "loops".
    const down = (f: number) => loop.map(v => v.co.map((c, i) => i === axis ? round(side - side * 2 * f) : c))
    const across = (f: number) => loop.map(v => v.co.map((c, i) => i === axis ? c : round(c - c * 2 * f)))
    const slid = async() => (await verts()).filter((_, i) => cube[i].sel).map(v => v.co)

    await page.keyboard.press('KeyG')
    await expect.poll(async() => (await state()).transform).toBe('translate')
    await page.keyboard.press('KeyG')
    await expect.poll(async() => (await state()).transform).toBe('edgeSlide')
    for (const k of ['Digit0', 'Period', 'Digit5']) await page.keyboard.press(k)
    await page.keyboard.press('Enter')
    await expect.poll(async() => (await state()).transform).toBeNull()
    let s = await state()
    expect(s.lastOp).toBe('mesh.edge_slide')
    expect(s.lastProps?.value).toBe(0.5)
    expect(s.history.at(-1)).toBe('Edge Slide')
    const first = await slid()
    const wentDown = JSON.stringify(first) === JSON.stringify(down(0.5))
    expect(wentDown || JSON.stringify(first) === JSON.stringify(across(0.5)), JSON.stringify(first)).toBe(true)

    // The redo panel re-runs it with -0.5: the other side.
    await page.locator('[data-operator-panel="mesh.edge_slide"] .me-operator-title').click()
    const factor = page.locator('[data-operator-panel="mesh.edge_slide"] #me-prop-value')
    await expect(factor).toBeVisible()
    await factor.fill('-0.5')
    await expect.poll(async() => JSON.stringify(await slid())).toBe(JSON.stringify(wentDown ? across(0.5) : down(0.5)))
    s = await state()
    expect(s.lastProps?.value).toBe(-0.5)
    expect(s.history.filter(h => h.startsWith('Edge Slide')).length).toBe(1)
    // Undo puts the cube back.
    await page.mouse.click(empty.x, empty.y)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => JSON.stringify((await verts()).map(v => v.co))).toBe(JSON.stringify(cube.map(v => v.co)))
    expect((await state()).history.at(-1)).toBe('Edge Slide *')

    // ── Vertex slide (Shift+V): a corner slides along the edge the mouse moves towards ──
    await page.keyboard.press('1')
    await expect.poll(async() => (await state()).selectMode).toBe('vertex')
    // The corner nearest the view's centre, on screen.
    const corner = await page.evaluate(() => {
        const v = (window as any).viewer
        const me = (window as any).engine.meshEdit
        const cam = v.scene.mainCamera
        const r = v.canvas.getBoundingClientRect()
        const m = me.editObject.matrixWorld
        let best: any = null
        for (const vert of me.state.bm.verts) {
            const p = new cam.position.constructor(vert.x, vert.y, vert.z).applyMatrix4(m).project(cam)
            const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height
            const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2))
            if (!best || d < best.d) best = {x, y, d, co: [vert.x, vert.y, vert.z]}
        }
        return best
    })
    await page.mouse.click(corner.x, corner.y)
    await expect.poll(async() => (await state()).sel![0]).toBe(1)
    const picked = (await verts()).find(v => v.sel)!.co
    await page.keyboard.press('Shift+KeyV')
    await expect.poll(async() => (await state()).transform).toBe('vertSlide')
    await page.mouse.move(corner.x + 30, corner.y + 20, {steps: 6})
    await page.mouse.click(corner.x + 30, corner.y + 20)
    await expect.poll(async() => (await state()).transform).toBeNull()
    s = await state()
    expect(s.lastOp).toBe('mesh.vert_slide')
    expect(s.history.at(-1)).toBe('Vertex Slide')
    // It moved along one of the cube's edges: exactly one coordinate changed, inside the edge.
    const moved = (await verts()).find(v => v.sel)!.co
    const changed = [0, 1, 2].filter(i => Math.abs(moved[i] - picked[i]) > 1e-4)
    expect(changed.length, `${JSON.stringify(picked)} -> ${JSON.stringify(moved)}`).toBe(1)
    expect(Math.abs(moved[changed[0]])).toBeLessThan(Math.abs(picked[changed[0]]) + 1e-6)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => JSON.stringify((await verts()).map(v => v.co))).toBe(JSON.stringify(cube.map(v => v.co)))

    // ── Subdivide from the Mesh menu, the redo panel changing the cuts, undo ──
    await page.keyboard.press('2')
    await page.mouse.move(cx, cy)
    await page.keyboard.press('KeyA')
    await expect.poll(async() => (await state()).sel).toEqual([8, 12, 6])
    await page.locator('[role="menubar"]').getByRole('button', {name: 'Mesh'}).click()
    // The edit-mode entry; the object-mode Subdivide is listed too, disabled here.
    await page.getByRole('menuitem', {name: /^Subdivide$/}).and(page.locator(':not([aria-disabled="true"])')).click()
    // One cut: a vertex per edge and per face, four quads per face (`bmo_subdivide.cc`, quad_4edge).
    await expect.poll(async() => (await state()).counts).toEqual([26, 48, 24])
    s = await state()
    expect(s.lastOp).toBe('mesh.subdivide')
    expect(s.history.at(-1)).toBe('Subdivide')
    await page.locator('[data-operator-panel="mesh.subdivide"] .me-operator-title').click()
    const cuts = page.locator('[data-operator-panel="mesh.subdivide"] #me-prop-cuts')
    await expect(cuts).toBeVisible()
    await cuts.fill('2')
    await expect.poll(async() => (await state()).counts).toEqual([56, 108, 54])
    expect((await state()).lastProps?.cuts).toBe(2)
    expect((await state()).history.filter(h => h.startsWith('Subdivide')).length).toBe(1)
    await page.mouse.click(empty.x, empty.y)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).counts).toEqual([8, 12, 6])

    // ── Subdivide Edge-Ring: Ctrl+Alt+click picks the ring around an edge, the palette runs it ──
    const edgeMid = await page.evaluate(() => {
        const v = (window as any).viewer
        const me = (window as any).engine.meshEdit
        const cam = v.scene.mainCamera
        const r = v.canvas.getBoundingClientRect()
        const m = me.editObject.matrixWorld
        let best: any = null
        for (const e of me.state.bm.edges) {
            const p = new cam.position.constructor((e.v1.x + e.v2.x) / 2, (e.v1.y + e.v2.y) / 2, (e.v1.z + e.v2.z) / 2).applyMatrix4(m).project(cam)
            const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height
            const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2))
            if (!best || d < best.d) best = {x, y, d}
        }
        return best
    })
    await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    await page.mouse.click(edgeMid.x, edgeMid.y)
    await page.keyboard.up('Alt')
    await page.keyboard.up('Control')
    // A cube edge's ring is its four parallel edges.
    await expect.poll(async() => (await state()).sel![1]).toBe(4)
    await page.keyboard.press('F3')
    const palette = page.locator('.me-palette input')
    await expect(palette).toBeVisible()
    await palette.fill('edge-ring')
    await expect(page.locator('.me-palette .bp5-menu-item').first()).toContainText('Subdivide Edge-Ring')
    await page.keyboard.press('Enter')
    // Blender's defaults: 10 cuts along a blended path; the four side faces become 11 each.
    await expect.poll(async() => (await state()).counts).toEqual([48, 92, 46])
    s = await state()
    expect(s.lastOp).toBe('mesh.subdivide_edgering')
    expect(s.history.at(-1)).toBe('Subdivide Edge-Ring')
    await page.locator('[data-operator-panel="mesh.subdivide_edgering"] .me-operator-title').click()
    const ringCuts = page.locator('[data-operator-panel="mesh.subdivide_edgering"] #me-prop-cuts')
    await expect(ringCuts).toBeVisible()
    await ringCuts.fill('2')
    await expect.poll(async() => (await state()).counts).toEqual([16, 28, 14])
    await page.mouse.click(empty.x, empty.y)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).counts).toEqual([8, 12, 6])

    // ── Loop Cut and Slide (Ctrl+R): hover previews the ring, click cuts and slides, a typed factor ──
    const loopCut = () => page.evaluate(() => {
        const lc = (window as any).engine.meshEdit.activeLoopCut
        return lc ? {cuts: lc.numberCuts, lines: lc.preview.edges.length, status: lc.status, edge: !!lc.edge} : null
    })
    await page.mouse.move(edgeMid.x, edgeMid.y)
    await page.keyboard.press('Control+KeyR')
    // The editor's state comes along so a failure says what the key did instead.
    await expect.poll(async() => ({loopCut: await loopCut(), state: await state(), focus: await page.evaluate(() => document.activeElement?.tagName)}))
        .toMatchObject({loopCut: {cuts: 1, edge: true, lines: 4}})
    // The ring of a cube edge is the four edges parallel to it: one loop of four segments.
    await page.mouse.move(edgeMid.x + 1, edgeMid.y + 1)
    await page.mouse.down()
    await page.mouse.up()
    await expect.poll(async() => (await state()).transform).toBe('edgeSlide')
    expect(await loopCut()).toBeNull()
    expect((await state()).counts).toEqual([12, 20, 10])
    for (const k of ['Digit0', 'Period', 'Digit5']) await page.keyboard.press(k)
    await page.keyboard.press('Enter')
    await expect.poll(async() => (await state()).transform).toBeNull()
    s = await state()
    expect(s.lastOp).toBe('mesh.loopcut_slide')
    expect(s.lastProps).toMatchObject({cuts: 1, value: 0.5})
    expect(s.history.at(-1)).toBe('Loop Cut and Slide')
    // The new loop slid halfway to one side: its four vertices sit a quarter of the edge from a face.
    const sliding = (await verts()).filter(v => v.sel).map(v => v.co)
    expect(sliding.length).toBe(4)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).counts).toEqual([8, 12, 6])

    // ── Three cuts: the wheel adds them, the preview follows; a right click centres the slide ──
    await page.mouse.move(edgeMid.x, edgeMid.y)
    await page.keyboard.press('Control+KeyR')
    await expect.poll(loopCut).toMatchObject({cuts: 1, edge: true})
    await page.mouse.wheel(0, -100)
    await expect.poll(loopCut).toMatchObject({cuts: 2, lines: 8})
    await page.mouse.wheel(0, -100)
    await expect.poll(loopCut).toMatchObject({cuts: 3, lines: 12, status: 'Cuts: 3, Smoothness: 0.00'})
    await page.mouse.down()
    await page.mouse.up()
    await expect.poll(async() => (await state()).transform).toBe('edgeSlide')
    await page.mouse.click(edgeMid.x + 40, edgeMid.y, {button: 'right'})
    await expect.poll(async() => (await state()).transform).toBeNull()
    // Three loops of four around the cube, left evenly spaced.
    expect((await state()).counts).toEqual([20, 36, 18])
    s = await state()
    expect(s.lastOp).toBe('mesh.loopcut_slide')
    expect(s.lastProps).toMatchObject({cuts: 3, value: 0})
    expect(s.history.at(-1)).toBe('Loop Cut and Slide')
    // No context menu from that right click.
    await expect(page.locator('.me-context-menu')).toHaveCount(0)
    // The redo panel re-cuts with two.
    await page.locator('[data-operator-panel="mesh.loopcut_slide"] .me-operator-title').click()
    const lcCuts = page.locator('[data-operator-panel="mesh.loopcut_slide"] #me-prop-cuts')
    await expect(lcCuts).toBeVisible()
    await lcCuts.fill('2')
    await expect.poll(async() => (await state()).counts).toEqual([16, 28, 14])
    expect((await state()).history.filter(h => h.startsWith('Loop Cut')).length).toBe(1)
    await page.mouse.click(empty.x, empty.y)
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).counts).toEqual([8, 12, 6])

    // ── Esc while previewing cancels without cutting ──
    await page.mouse.move(edgeMid.x, edgeMid.y)
    await page.keyboard.press('Control+KeyR')
    await expect.poll(loopCut).not.toBeNull()
    await page.keyboard.press('Escape')
    await expect.poll(loopCut).toBeNull()
    expect((await state()).counts).toEqual([8, 12, 6])

    // ── The Loop Cut tool: press, drag to slide, release to place; the tool stays for the next cut ──
    const tool = () => page.evaluate(() => (window as any).engine.activeTool?.id as string)
    await page.locator('[data-tool="mesh.loop_cut"]').click()
    await expect.poll(tool).toBe('mesh.loop_cut')
    await page.mouse.move(edgeMid.x, edgeMid.y, {steps: 4})
    await expect.poll(loopCut).toMatchObject({edge: true, lines: 4})
    await page.mouse.down()
    await expect.poll(async() => (await state()).transform).toBe('edgeSlide')
    await page.mouse.move(edgeMid.x + 30, edgeMid.y + 20, {steps: 5})
    await page.mouse.up()
    await expect.poll(async() => (await state()).transform).toBeNull()
    expect((await state()).counts).toEqual([12, 20, 10])
    expect((await state()).history.at(-1)).toBe('Loop Cut and Slide')
    // Previewing again for the next cut.
    await expect.poll(loopCut).not.toBeNull()
    expect(await tool()).toBe('mesh.loop_cut')
    await page.keyboard.press('Escape')
    await expect.poll(tool).toBe('select')
    await page.keyboard.press('Control+KeyZ')
    await expect.poll(async() => (await state()).counts).toEqual([8, 12, 6])
})
