import {
    _testFinish,
    _testStart,
    BoxGeometry,
    Color,
    IMaterial,
    LoadingScreenPlugin,
    MaterialPreviewGenerator,
    MaterialPreviewHandle,
    materialPreviewOptionsFromViewer,
    MaterialPreviewPlugin,
    MaterialPreviewShape,
    Mesh,
    PhysicalMaterial,
    SphereGeometry,
    ThreeViewer,
    TorusKnotGeometry,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Live material previews for an inspector panel: MaterialPreviewPlugin renders a small offscreen preview with the
// viewer's environment map and tone mapping in the next frame after a change, and at most every dragInterval ms during
// a drag of a slider or an animation. The panel shows the previews; the Tweakpane UI has the plugin settings and the materials.

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin, MaterialPreviewPlugin],
})

const previews = viewer.getPlugin(MaterialPreviewPlugin)!
let shape: MaterialPreviewShape = 'sphere'

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: false,
    })

    const meshes = [
        new Mesh(new TorusKnotGeometry(0.6, 0.22, 160, 24), new PhysicalMaterial({name: 'Gold', color: new Color(1, 0.78, 0.35), metalness: 1, roughness: 0.25})),
        new Mesh(new SphereGeometry(1, 64, 32), new PhysicalMaterial({name: 'Red plastic', color: new Color(0.8, 0.05, 0.05), metalness: 0, roughness: 0.4})),
        new Mesh(new BoxGeometry(1.4, 1.4, 1.4), new PhysicalMaterial({name: 'Blue rough', color: new Color(0.1, 0.25, 0.7), metalness: 0.2, roughness: 0.8})),
    ]
    meshes.forEach((m, i) => {
        m.position.set((i - 1) * 2.6, 0, 0)
        viewer.scene.addObject(m)
    })
    viewer.scene.mainCamera.position.set(0, 0, 8)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    const list = document.getElementById('materials')!
    for (const mesh of meshes) list.appendChild(materialRow(mesh))

    document.querySelectorAll<HTMLButtonElement>('#preview-panel .shapes button').forEach(b => b.onclick = () => {
        shape = b.dataset.shape as MaterialPreviewShape
        document.querySelectorAll('#preview-panel .shapes button').forEach(x => x.classList.toggle('on', x === b))
        refreshAll.forEach(f => f())
    })
    document.getElementById('benchmark')!.onclick = () => benchmark(meshes[1].material as IMaterial)

    // the plugin settings (drag interval, max per frame, size, cache size), and the materials: a change of a material in
    // the UI sends materialUpdate events with `last` (false while a slider moves), and its preview follows
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(MaterialPreviewPlugin)
    for (const mesh of meshes) ui.appendChild((mesh.material as PhysicalMaterial).uiConfig)
}

const refreshAll: (() => void)[] = []

function materialRow(mesh: Mesh) {
    const material = mesh.material as PhysicalMaterial
    const row = document.createElement('div')
    row.className = 'material'
    const canvas = document.createElement('canvas')
    canvas.className = 'preview'
    canvas.width = canvas.height = previews.size
    canvas.dataset.material = material.name
    const ctx = canvas.getContext('2d')!
    const controls = document.createElement('div')
    controls.className = 'controls'
    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = '...'

    // request a preview on every change: the plugin renders it in the next frame, at most every dragInterval ms during a drag or an animation
    let handle: MaterialPreviewHandle | undefined
    const refresh = () => {
        handle?.cancel()
        handle = previews.request(material, {shape, geometry: mesh.geometry, size: previews.size}, p => {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(p.canvas, 0, 0, canvas.width, canvas.height)
            time.textContent = p.renderTime.toFixed(1) + ' ms (' + p.size + 'px)'
        })
    }
    material.addEventListener('materialUpdate', refresh)
    refreshAll.push(refresh)

    const name = document.createElement('b')
    name.textContent = material.name
    controls.append(name, time)
    row.append(canvas, controls)
    refresh()
    return row
}

// Time per preview: the offscreen render (256px) and the old full canvas snapshot (render to the canvas, toDataURL of the canvas).
function benchmark(material: IMaterial) {
    const out = document.getElementById('benchmark-result')!
    out.textContent = 'running...'
    const renderer = viewer.renderManager.renderer
    const generator = new MaterialPreviewGenerator()
    const options = materialPreviewOptionsFromViewer(viewer, material)
    const runs = 10
    const time = (f: () => void) => {
        f(); f() // warm up: shader compile
        const start = performance.now()
        for (let i = 0; i < runs; i++) f()
        return (performance.now() - start) / runs
    }
    viewer.doOnce('preFrame', () => {
        const canvas = document.createElement('canvas')
        const offscreen = time(() => generator.renderToCanvas(material, renderer, {...options, size: 256}, canvas))
        const offscreenUrl = time(() => generator.renderToCanvas(material, renderer, {...options, size: 256}, canvas).toDataURL('image/png'))
        const fullCanvas = time(() => generator.generate(material, renderer, options.environment, 'sphere'))
        // the two images: the full canvas snapshot has no tone mapping and is stretched to the canvas aspect
        const images = document.getElementById('benchmark-images')!
        images.innerHTML = ''
        for (const [title, src] of [
            ['offscreen', canvas.toDataURL('image/png')],
            ['full canvas', generator.generate(material, renderer, options.environment, 'sphere')],
        ]) {
            const img = document.createElement('img')
            img.src = src
            img.title = title
            img.dataset.kind = title
            images.append(img)
        }
        generator.dispose()
        viewer.setDirty() // the full canvas snapshots drew on the canvas
        const c = renderer.domElement
        out.textContent = [
            `offscreen 256px, canvas: ${offscreen.toFixed(2)} ms`,
            `offscreen 256px, data url: ${offscreenUrl.toFixed(2)} ms`,
            `full canvas ${c.width}x${c.height}, data url: ${fullCanvas.toFixed(2)} ms`,
        ].join('\n')
        out.dataset.offscreen = String(offscreen)
        out.dataset.offscreenUrl = String(offscreenUrl)
        out.dataset.fullCanvas = String(fullCanvas)
    })
}

_testStart()
init().finally(_testFinish)
