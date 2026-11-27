import {
    _testFinish,
    _testStart,
    Box3,
    Color,
    IObject3D,
    ProgressivePlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {
    BLEND_THUMBNAIL_BYTES,
    BlendFile,
    BlendLoadPlugin,
    BlendThumbnail,
    blendThumbnailImageData,
    readBlendThumbnail,
} from '@threepipe/plugin-blend-importer'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'
import {
    BlenderDemoFile,
    blenderCameraView,
    blenderDemoFiles,
    creditLine,
    fitFov,
    mrElephantOriginal,
    sceneCameraName,
} from '../examples-utils/blender-demo-files.js'

// A big .blend takes a while to download and build. Its first few KB hold a preview image, so the page shows
// that at once, while the full load runs, and fades it out when the model is ready.

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    renderScale: 'auto',
    plugins: [ProgressivePlugin, SSAAPlugin, SSAOPlugin],
})
const blendLoader = viewer.addPluginSync(BlendLoadPlugin)
viewer.scene.backgroundColor = new Color(0xdde1e6)

const files: BlenderDemoFile[] = [mrElephantOriginal, ...blenderDemoFiles]
const state = {
    file: files.find(f => f.id === new URLSearchParams(location.search).get('file')) ?? mrElephantOriginal as BlenderDemoFile | undefined,
    loading: false,
    previewMs: 0,
    previewBytes: 0,
    hasPreview: false,
    modelMs: 0,
}

// ── Reading the preview ─────────────────────────────────────────────────────────────────────────────────────────────

// The start of the file at `url`, read until its preview is in it. One Range request for the first
// BLEND_THUMBNAIL_BYTES, read as a stream and cancelled as soon as readBlendThumbnail finds the preview: a few
// KB usually, and a server that ignores Range doesn't send the whole file.
async function previewFromUrl(url: string): Promise<{thumbnail: BlendThumbnail | null, bytes: number}> {
    const res = await fetch(url, {headers: {Range: `bytes=0-${BLEND_THUMBNAIL_BYTES - 1}`}})
    if (!res.ok || !res.body) return {thumbnail: null, bytes: 0}
    const reader = res.body.getReader()
    let start = new Uint8Array(0)
    let thumbnail: BlendThumbnail | null = null
    while (!thumbnail && start.length < BLEND_THUMBNAIL_BYTES) {
        const {done, value} = await reader.read()
        if (done || !value) break
        const more = new Uint8Array(start.length + value.length)
        more.set(start)
        more.set(value, start.length)
        start = more
        thumbnail = readBlendThumbnail(start)
    }
    reader.cancel().catch(() => undefined)
    return {thumbnail, bytes: start.length}
}

// A file from the disk: its first BLEND_THUMBNAIL_BYTES.
async function previewFromFile(file: Blob) {
    const start = await file.slice(0, BLEND_THUMBNAIL_BYTES).arrayBuffer()
    return {thumbnail: readBlendThumbnail(start), bytes: start.byteLength}
}

// ── The preview on screen ───────────────────────────────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    if (className) e.className = className
    return e
}
const stage = el('div', 'bp-stage')
const backdrop = el('div', 'bp-backdrop')
const frame = el('figure', 'bp-frame')
const thumbCanvas = el('canvas', 'bp-thumb')
const caption = el('figcaption')
const bar = el('div', 'bp-bar')
const barFill = el('div')
const status = el('p', 'bp-status')
bar.appendChild(barFill)
frame.append(thumbCanvas, caption)
stage.append(backdrop, frame, bar, status)
stage.setAttribute('role', 'status')
viewer.container.appendChild(stage)

function showStage(label: string) {
    stage.classList.remove('bp-hidden', 'bp-has-thumb')
    caption.textContent = label
    status.textContent = 'Reading the preview…'
    barFill.style.width = '0%'
    bar.classList.remove('bp-busy')
    backdrop.style.backgroundImage = ''
}

function showThumbnail(thumbnail: BlendThumbnail) {
    thumbCanvas.width = thumbnail.width
    thumbCanvas.height = thumbnail.height
    thumbCanvas.getContext('2d')!.putImageData(blendThumbnailImageData(thumbnail), 0, 0)
    backdrop.style.backgroundImage = `url(${thumbCanvas.toDataURL()})`
    stage.classList.add('bp-has-thumb')
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1)
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

// Download progress of the full load, from the asset importer
let loadingPath = ''
viewer.assetManager.importer.addEventListener('importFile', (e: any) => {
    if (!state.loading || e.path !== loadingPath) return
    if (e.state === 'downloading') {
        const progress = typeof e.progress === 'number' ? e.progress : 0
        barFill.style.width = `${Math.round(progress * 100)}%`
        const of = e.totalBytes ? ` of ${mb(e.totalBytes)} MB` : ''
        downloadText = progress < 1 ? `Downloading ${e.loadedBytes ? mb(e.loadedBytes) : '0.0'}${of}` : 'Building the scene…'
        if (progress >= 1) bar.classList.add('bp-busy')
        showStatus()
    }
})
let downloadText = ''
function showStatus() {
    const preview = state.hasPreview ? `Preview in ${state.previewMs} ms (${kb(state.previewBytes)} read)` : state.previewMs ? 'No preview in this file' : 'Reading the preview…'
    status.textContent = [preview, downloadText].filter(Boolean).join(' · ')
}

// ── Loading ─────────────────────────────────────────────────────────────────────────────────────────────────────────

let parsed: BlendFile | undefined
const onBlendLoad = (blend: BlendFile) => parsed = blend

// The preview and the full load start together; the preview is usually on screen long before the download ends.
async function load(source: BlenderDemoFile | File) {
    if (state.loading) return
    state.loading = true
    const isFile = source instanceof File
    state.file = isFile ? undefined : source
    state.hasPreview = false
    state.previewMs = state.previewBytes = state.modelMs = 0
    downloadText = ''
    parsed = undefined
    showStage(isFile ? source.name : source.label)
    credit.replaceChildren()
    const start = performance.now()

    loadingPath = isFile ? source.name : source.url
    const model = viewer.load<IObject3D>(isFile ? source : source.url, {
        disposeSceneObjects: true, autoCenter: false, autoScale: false, onBlendLoad,
    } as any)
    const preview = (isFile ? previewFromFile(source) : previewFromUrl(source.url)).then(({thumbnail, bytes}) => {
        state.previewMs = Math.round(performance.now() - start)
        state.previewBytes = bytes
        state.hasPreview = !!thumbnail
        if (thumbnail && state.loading) showThumbnail(thumbnail)
        showStatus()
    }).catch((e) => console.warn('No preview:', e))

    try {
        const root = await model
        state.modelMs = Math.round(performance.now() - start)
        await preview
        if (root) showModel(root)
        if (!isFile) credit.replaceChildren(creditLine(source))
    } finally {
        state.loading = false
        // the model's first frame, then the preview fades out
        requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('bp-hidden')))
    }
}

// Through the scene's Blender camera, as in Blender; Blender's lights off (the environment lights the scene)
function showModel(root: IObject3D) {
    root.traverse((o: any) => {
        if (o.isLight) o.visible = false
    })
    const center = new Box3().setFromObject(root).getCenter(new Vector3())
    const view = parsed && blenderCameraView(root, sceneCameraName(parsed), center)
    const camera = viewer.scene.mainCamera
    if (view) {
        camera.position.copy(view.position as Vector3)
        camera.target.copy(view.target as Vector3)
        camera.fov = fitFov(view, viewer.canvas.clientWidth / Math.max(viewer.canvas.clientHeight, 1))
        camera.setDirty()
    } else viewer.fitToView(root, 1.2)
}

// ── The card ────────────────────────────────────────────────────────────────────────────────────────────────────────

const credit = el('div')
const fileInput = el('input')
fileInput.type = 'file'
fileInput.accept = '.blend'
fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (f) load(f)
    fileInput.value = ''
})
viewer.container.addEventListener('dragover', (e) => e.preventDefault())
viewer.container.addEventListener('drop', (e) => {
    e.preventDefault()
    const f = [...e.dataTransfer?.files ?? []].find(x => /\.blend$/i.test(x.name))
    if (f) load(f)
})

async function init() {
    // not awaited: the file's preview and download start right away
    const environment = viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {setBackground: false})
    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'A .blend starts with a preview image. readBlendThumbnail reads it from the first few KB, so it shows at once while the whole file downloads and builds, and fades out when the model is ready. Mr Elephant is 66 MB.',
        actions: [
            {type: 'dropdown', label: 'File', icon: 'box',
                children: [...files.map(f => ({label: `${f.label} (${f.size})`, value: f.id})), {label: 'Your file', value: ''}],
                getValue: () => state.file?.id ?? '',
                setValue: (id: string) => {
                    const f = files.find(x => x.id === id)
                    if (f) load(f)
                },
                disabled: () => state.loading},
            {type: 'button', label: 'Load again', icon: 'refresh-cw', value: () => state.file && load(state.file), disabled: () => state.loading || !state.file},
            {type: 'button', label: 'Open .blend…', icon: 'file-code', value: () => fileInput.click(), disabled: () => state.loading},
            {type: 'dropdown', label: 'Textures', icon: 'image',
                children: [{label: 'As stored', value: 0}, {label: 'At most 2048 px', value: 2048}, {label: 'At most 1024 px', value: 1024}],
                getValue: () => blendLoader.maxTextureSize,
                setValue: (size: number) => {
                    blendLoader.maxTextureSize = +size
                    if (state.file) load(state.file)
                },
                disabled: () => state.loading || !state.file},
            {type: 'monitor', label: 'Preview', getValue: () => state.hasPreview ? `${state.previewMs} ms, ${kb(state.previewBytes)} read` : state.previewMs ? 'none' : '…'},
            {type: 'monitor', label: 'Model', getValue: () => state.modelMs ? `${(state.modelMs / 1000).toFixed(1)} s` : '…'},
            {type: 'monitor', label: 'Triangles', getValue: () => stats.triangles.toLocaleString()},
        ],
        content: [credit],
    })
    if (state.file) await load(state.file)
    await environment
}

const style = document.createElement('style')
style.textContent = `
.bp-stage { position: absolute; inset: 0; z-index: 200; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; background: #dde1e6; transition: opacity .7s ease, visibility .7s; font: 400 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2b2f36; }
.bp-stage.bp-hidden { opacity: 0; visibility: hidden; pointer-events: none; }
.bp-backdrop { position: absolute; inset: -40px; background: center / cover no-repeat; filter: blur(36px) saturate(1.2); opacity: 0; transition: opacity .5s; }
.bp-has-thumb .bp-backdrop { opacity: .55; }
.bp-frame { position: relative; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.bp-thumb { display: block; width: min(64vmin, 520px); height: auto; border-radius: 10px; background: rgba(255, 255, 255, .5);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .06), 0 18px 50px rgba(0, 0, 0, .25); opacity: 0; transform: scale(.97); transition: opacity .35s, transform .35s; }
.bp-has-thumb .bp-thumb { opacity: 1; transform: none; }
.bp-frame figcaption { font-weight: 600; font-size: 15px; }
.bp-bar { position: relative; width: min(64vmin, 520px); height: 4px; border-radius: 2px; background: rgba(0, 0, 0, .1); overflow: hidden; }
.bp-bar div { height: 100%; width: 0; background: #0d99ff; transition: width .2s; }
.bp-bar.bp-busy div { width: 100% !important; background: linear-gradient(90deg, #0d99ff 0%, #8fd0ff 50%, #0d99ff 100%) 0 0 / 200% 100%; animation: bp-busy 1.2s linear infinite; }
@keyframes bp-busy { to { background-position: -200% 0; } }
.bp-status { position: relative; margin: 0; color: #4b5260; font-variant-numeric: tabular-nums; text-align: center; padding: 0 16px; }
.blender-demo-credit { margin: 0 6px 4px !important; }
.blender-demo-credit a { color: inherit; }
@media (max-width: 640px) { .bp-stage { justify-content: flex-start; padding-top: 18vh; } .bp-thumb, .bp-bar { width: 84vw; } }
`
document.head.appendChild(style)

_testStart()
init().finally(_testFinish)
