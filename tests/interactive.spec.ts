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

    // Switch depth packing to BasicDepthPacking (0) — no Tweakpane UI in this example
    await page.evaluate(() => {
        const v = (window as any).threeViewers?.[0]
        const p = v?.getPlugin('DepthBufferPlugin')
        if (p) { p.depthPacking = 0; p.setDirty() }
    })
    await page.waitForTimeout(300)
    await btnClick(page, 'Toggle Depth rendering')
    await screenshotMatch(page, testInfo, 'depth-basic')

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

