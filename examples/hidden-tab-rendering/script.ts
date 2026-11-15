import {_testFinish, _testStart, LoadingScreenPlugin, Mesh, PhysicalMaterial, ThreeViewer, TorusKnotGeometry} from 'threepipe'

// A browser stops requestAnimationFrame in a hidden tab, so the viewer stops rendering there. While a key holds it,
// renderManager.keepRenderingWhenHidden keeps the frames coming from a worker clock, about 60 a second, until the tab
// is visible again. Hold it only for a task that needs it: rendering in the background uses the CPU and GPU.
// CanvasRecorderPlugin holds it while it records, so a recording finishes in a hidden tab.

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const mesh = viewer.scene.addObject(new Mesh(
        new TorusKnotGeometry(0.6, 0.2, 128, 32),
        new PhysicalMaterial({color: 0x4488ff, roughness: 0.2, metalness: 0.5}),
    ))

    // a quarter turn a second, by the frame time: each frame drawn moves it on
    viewer.addEventListener('preFrame', (e) => {
        mesh.rotation.y += (e.deltaTime || 0) / 1000 * Math.PI / 2
        mesh.setDirty?.()
    })

    const checkbox = document.getElementById('keep-rendering') as HTMLInputElement
    checkbox.onchange = () => {
        if (checkbox.checked) viewer.renderManager.keepRenderingWhenHidden('hidden-tab-example')
        else viewer.renderManager.stopRenderingWhenHidden('hidden-tab-example')
    }

    // count the frames drawn while the tab is hidden, and show them when it is visible again
    const results = document.getElementById('hidden-results') as HTMLOListElement
    let hiddenAt = 0
    let frames = 0
    let keeping = false
    viewer.addEventListener('postRender', () => {
        if (document.visibilityState === 'hidden') frames++
    })
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            hiddenAt = performance.now()
            frames = 0
            keeping = checkbox.checked
            return
        }
        const seconds = (performance.now() - hiddenAt) / 1000
        const item = document.createElement('li')
        item.innerHTML = `${frames} frames in ${seconds.toFixed(1)} s hidden <span>· ${(frames / seconds).toFixed(0)} a second, ${keeping ? 'switch on' : 'switch off'}</span>`
        results.prepend(item)
    })

}

_testStart()
init().finally(_testFinish)
