import {
    _testFinish,
    _testStart,
    Color,
    FloatType,
    GBufferPlugin,
    LoadingScreenPlugin,
    ThreeViewer,
    UiObjectConfig,
    Vector2,
    WebGLRenderTarget,
} from 'threepipe'
import {NRRDLoadPlugin, VolumeData, VolumeObject, VolumePlugin, VolumeRenderMode} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    // no ProgressivePlugin: every frame is a full frame, timed on its own
    plugins: [LoadingScreenPlugin, GBufferPlugin, NRRDLoadPlugin],
})

type Dataset = 'stent' | 'blobs' | 'fog'

const state = {
    dataset: 'stent' as Dataset,
    mode: 'composite' as VolumeRenderMode,
    frames: 30,
    status: 'Pick a dataset and a mode, then run.',
}

let volume: VolumeObject | undefined
const cache: Partial<Record<Dataset, VolumeData>> = {}

// Sparse data: a few soft blobs in empty space, 256³ bytes
function makeBlobs(): VolumeData {
    const n = 256
    const data = new Uint8Array(n ** 3)
    const blobs = [[0.3, 0.3, 0.4, 0.12], [0.7, 0.4, 0.6, 0.09], [0.5, 0.75, 0.3, 0.07], [0.35, 0.65, 0.75, 0.1]]
    for (const [cx, cy, cz, r] of blobs) {
        const lo = (c: number) => Math.max(0, Math.floor((c - r) * n))
        const hi = (c: number) => Math.min(n - 1, Math.ceil((c + r) * n))
        for (let z = lo(cz); z <= hi(cz); z++) for (let y = lo(cy); y <= hi(cy); y++) for (let x = lo(cx); x <= hi(cx); x++) {
            const d = Math.hypot(x / n - cx, y / n - cy, z / n - cz) / r
            if (d < 1) data[(z * n + y) * n + x] = Math.max(data[(z * n + y) * n + x], Math.round(255 * (1 - d * d)))
        }
    }
    return new VolumeData({data, size: [n, n, n], spacing: [1, 1, 1], name: 'blobs', valueRange: [0, 255]})
}

// Dense data: a smooth pattern with values everywhere, 256³ bytes; nothing to skip
function makeFog(): VolumeData {
    const n = 256
    const data = new Uint8Array(n ** 3)
    let i = 0
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        data[i++] = Math.round(127.5 + 127.5 * Math.sin(x * 0.09) * Math.sin(y * 0.11 + 1) * Math.sin(z * 0.07 + 2))
    return new VolumeData({data, size: [n, n, n], spacing: [1, 1, 1], name: 'fog', valueRange: [0, 255]})
}

async function getData(name: Dataset): Promise<VolumeData> {
    if (cache[name]) return cache[name]!
    let d: VolumeData
    if (name === 'stent') {
        const v = await viewer.load<VolumeObject>('https://threejs.org/examples/models/nrrd/stent.nrrd', {autoScale: false, autoCenter: false})
        if (!v?.data) throw new Error('The volume did not load')
        d = v.data
        v.removeFromParent()
    } else {
        d = name === 'blobs' ? makeBlobs() : makeFog()
    }
    cache[name] = d
    return d
}

async function showDataset(name: Dataset) {
    const data = await getData(name)
    if (!volume) {
        volume = new VolumeObject(data)
        viewer.scene.addObject(volume)
    } else if (volume.data !== data) {
        volume.addField(data)
        volume.activeField = data.name
    }
    const m = volume.material
    m.setPreset('colormap:inferno')
    if (name === 'stent') m.range.set(0.1, 1)
    else m.range.set(40, 255)
    m.isoValue = name === 'stent' ? 0.35 : 128
    m.density = 2
    m.mode = state.mode
    // fit the box in a unit cube at the origin
    const box = volume.geometry.boundingBox!
    volume.scale.setScalar(1 / Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z))
    volume.position.set(0, 0, 0)
    volume.setDirty({change: 'transform'})
    viewer.setDirty()
}

function frame() {
    return new Promise<void>(resolve => {
        viewer.setDirty()
        viewer.doOnce('postFrame', () => resolve())
    })
}

/**
 * Milliseconds per frame over `n` frames: GPU time from a timer query where the browser has one
 * (EXT_disjoint_timer_query_webgl2), else the time to the end of each frame on the GPU (a 1-pixel read waits for it).
 */
async function timeFrames(n: number): Promise<{ms: number, gpu: boolean}> {
    const gl = viewer.renderManager.webglRenderer.getContext() as WebGL2RenderingContext
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    if (ext) {
        const queries: WebGLQuery[] = []
        const begin = () => {
            const q = gl.createQuery()!
            gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
            queries.push(q)
        }
        const end = () => gl.endQuery(ext.TIME_ELAPSED_EXT)
        viewer.addEventListener('preRender', begin)
        viewer.addEventListener('postRender', end)
        for (let i = 0; i < n; i++) await frame()
        viewer.removeEventListener('preRender', begin)
        viewer.removeEventListener('postRender', end)
        const times: number[] = []
        for (let tries = 0; tries < 120 && times.length < queries.length; tries++) {
            await new Promise(r => requestAnimationFrame(r))
            if (gl.getParameter(ext.GPU_DISJOINT_EXT)) break
            while (times.length < queries.length && gl.getQueryParameter(queries[times.length], gl.QUERY_RESULT_AVAILABLE))
                times.push(gl.getQueryParameter(queries[times.length], gl.QUERY_RESULT) / 1e6)
        }
        queries.forEach(q => gl.deleteQuery(q))
        if (times.length) return {ms: times.reduce((a, b) => a + b, 0) / times.length, gpu: true}
    }
    const px = new Uint8Array(4)
    const t0 = performance.now()
    for (let i = 0; i < n; i++) {
        await frame()
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    }
    return {ms: (performance.now() - t0) / n, gpu: false}
}

/**
 * Samples read per pixel of the volume, from the debug output of the material (VolumeMaterial.debugSteps), drawn
 * into a float target so the counts are exact (the canvas is tone mapped and sRGB). Undefined without float targets.
 */
async function samplesPerPixel(): Promise<{samples: number, full: number} | undefined> {
    const renderer = viewer.renderManager.webglRenderer
    if (!renderer.extensions.has('EXT_color_buffer_float')) return undefined
    const m = volume!.material
    const size = renderer.getDrawingBufferSize(new Vector2())
    const target = new WebGLRenderTarget(size.x, size.y, {type: FloatType, depthBuffer: false})
    const prevTarget = renderer.getRenderTarget()
    const prevClear = renderer.getClearColor(new Color())
    const prevAlpha = renderer.getClearAlpha()
    m.debugSteps = true
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(volume!, viewer.scene.mainCamera)
    const px = new Float32Array(size.x * size.y * 4)
    renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, px)
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevClear, prevAlpha)
    target.dispose()
    m.debugSteps = false
    let count = 0, samples = 0, full = 0
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 2] <= 0) continue // no ray here
        count++
        samples += px[i] * 512
        full += px[i + 2] * 512
    }
    return {samples: count ? samples / count : 0, full: count ? full / count : 0}
}

const results = document.createElement('table')
results.className = 'volume-benchmark-results'
results.style.cssText = 'width:100%;border-collapse:collapse;font:11px/1.5 ui-monospace,monospace;margin-top:6px'

function addRow(cells: string[], head = false) {
    const tr = document.createElement('tr')
    for (const c of cells) {
        const td = document.createElement(head ? 'th' : 'td')
        td.textContent = c
        td.style.cssText = 'text-align:left;padding:1px 6px 1px 0'
        tr.appendChild(td)
    }
    results.appendChild(tr)
}
addRow(['Data', 'Mode', 'Skip', 'ms', 'Samples'], true)

let running = false
async function runBenchmark() {
    if (running || !volume) return
    running = true
    const plugin = viewer.getPlugin(VolumePlugin)!
    const m = volume.material
    const prevQuality = plugin.interactiveQuality
    const prevSkip = m.emptySpaceSkipping
    // every frame here starts from a reset: keep the full sampling rate
    plugin.interactiveQuality = false
    m.jitter = false
    try {
        for (const skip of [false, true]) {
            state.status = `Running: skip ${skip ? 'on' : 'off'}...`
            m.emptySpaceSkipping = skip
            for (let i = 0; i < 300 && m.derivedPending; i++) await frame()
            for (let i = 0; i < 3; i++) await frame() // compile and warm up
            const t = await timeFrames(state.frames)
            const s = await samplesPerPixel()
            addRow([state.dataset, state.mode, skip ? 'on' : 'off', t.ms.toFixed(1) + (t.gpu ? ' gpu' : ''), s ? `${s.samples.toFixed(0)}/${s.full.toFixed(0)}` : '-'])
        }
        state.status = 'Done. ms: per frame ("gpu": by a GPU timer query). Samples: read per pixel / without skipping.'
    } finally {
        m.emptySpaceSkipping = prevSkip
        m.jitter = true
        plugin.interactiveQuality = prevQuality
        running = false
        viewer.setDirty()
    }
}

async function init() {
    viewer.scene.setBackgroundColor('#111318')
    viewer.scene.mainCamera.position.set(1.1, 0.5, 1.4)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()
    await showDataset(state.dataset)

    const actions: UiObjectConfig[] = [
        {
            type: 'dropdown', label: 'Data', property: [state, 'dataset'],
            children: [['stent', 'Stent scan, 128×128×256'], ['blobs', 'Sparse blobs, 256³'], ['fog', 'Dense pattern, 256³']]
                .map(([value, label]) => ({label, value})),
            onChange: () => showDataset(state.dataset),
        },
        {
            type: 'dropdown', label: 'Mode', property: [state, 'mode'],
            children: ['composite', 'iso', 'mip', 'minip', 'xray', 'average'].map(label => ({label})),
            onChange: () => {
                if (volume) volume.material.mode = state.mode
                viewer.setDirty()
            },
        },
        {type: 'slider', label: 'Frames', property: [state, 'frames'], bounds: [5, 120], stepSize: 1},
        {type: 'button', label: 'Run benchmark', icon: 'timer', value: runBenchmark},
        {type: 'checkbox', label: 'Show samples per pixel', property: [{get v() {return volume?.material.debugSteps ?? false}, set v(x: boolean) {if (volume) volume.material.debugSteps = x; viewer.setDirty()}}, 'v']},
        {type: 'monitor', label: 'Status', property: [state, 'status']},
    ]
    createExampleCard(viewer, {
        description: 'Frame time and samples per pixel with empty space skipping off and on. The image is the same either way; skipping only leaves out samples that add nothing. Run it on the device you care about.',
        actions,
        content: results,
    })
}

_testStart()
init().finally(_testFinish)
