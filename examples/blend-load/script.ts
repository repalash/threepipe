import {
    _testFinish,
    _testStart,
    Box3,
    Color,
    DropzonePlugin,
    IObject3D,
    LoadingScreenPlugin,
    ProgressivePlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {BlendFile, BlendLoadPlugin} from '@threepipe/plugin-blend-importer'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'
import {
    BlenderDemoFile,
    blenderCameraView,
    blenderDemoFiles,
    CameraView,
    creditLine,
    fitFov,
    demoFileFromQuery,
    sceneCameraName,
} from '../examples-utils/blender-demo-files.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    renderScale: 'auto',
    dropzone: {
        allowedExtensions: ['blend'],
        // a dropped file replaces the scene and keeps Blender's units and placement, like the samples
        addOptions: {disposeSceneObjects: true, autoCenter: false, autoScale: false},
    },
    plugins: [LoadingScreenPlugin, ProgressivePlugin, SSAAPlugin, SSAOPlugin],
})
const blendLoader = viewer.addPluginSync(BlendLoadPlugin)
const dropzone = viewer.getPlugin(DropzonePlugin)!

// The loader's notes (unsupported modifiers, missing images...) for the card, collected per load.
const notes: string[] = []
const warn = console.warn
console.warn = (...args: any[]) => {
    const text = args.map(String).join(' ')
    if (/^BlendLoad(er|Plugin)/.test(text)) notes.push(text.replace(/^BlendLoad(er|Plugin)\s*[-:]\s*/, ''))
    warn.apply(console, args)
}

let parsed: BlendFile | undefined // set by onBlendLoad, for the scene camera
const onBlendLoad = (blend: BlendFile) => parsed = blend
dropzone.importOptions = {...dropzone.importOptions, onBlendLoad} as typeof dropzone.importOptions

const state = {
    file: demoFileFromQuery() as BlenderDemoFile | undefined, // undefined for a dropped or opened file
    loading: false,
    loadMs: 0,
    blenderLights: false,
}
let view: CameraView | undefined // the Blender camera's view of the current scene

function setLights(root: IObject3D, on: boolean) {
    root.traverse((o) => {
        if ((o as any).isLight) o.visible = on
    })
}

// Look through the scene's Blender camera, and orbit around a point in front of it.
function showBlenderView() {
    const camera = viewer.scene.mainCamera
    if (view) {
        camera.position.copy(view.position as Vector3)
        camera.target.copy(view.target as Vector3)
        const canvas = viewer.canvas
        camera.fov = fitFov(view, canvas.clientWidth / Math.max(canvas.clientHeight, 1))
    } else { // no camera in the file: frame the whole scene
        const box = new Box3().setFromObject(viewer.scene.modelRoot)
        const center = box.getCenter(new Vector3())
        camera.position.copy(center).add(new Vector3(0.6, 0.4, 1).normalize().multiplyScalar(box.getSize(new Vector3()).length() * 0.8))
        camera.target.copy(center)
        camera.fov = 40
    }
    camera.setDirty()
}

// After a .blend is in the scene: Blender's camera, its lights off (environment lighting), the card's values.
function onLoaded(root: IObject3D | undefined, start: number) {
    state.loadMs = Math.round(performance.now() - start)
    if (!root) return
    setLights(root, state.blenderLights)
    const center = new Box3().setFromObject(root).getCenter(new Vector3())
    view = blenderCameraView(root, parsed ? sceneCameraName(parsed) : undefined, center)
    showBlenderView()
    credit.replaceChildren(...state.file ? [creditLine(state.file)] : [])
    showNotes()
}

async function loadDemo(file: BlenderDemoFile) {
    if (state.loading) return
    state.loading = true
    state.file = file
    notes.length = 0
    parsed = undefined
    const start = performance.now()
    try {
        const root = await viewer.load<IObject3D>(file.url, {disposeSceneObjects: true, autoCenter: false, autoScale: false, onBlendLoad} as any)
        onLoaded(root, start)
    } finally {
        state.loading = false
    }
}

let dropStart = 0
dropzone.addEventListener('drop', (e: any) => {
    const root = (e.assets as any[] | undefined)?.find(a => a?.isObject3D)
    if (!root) return
    state.file = undefined
    onLoaded(root, dropStart || performance.now())
    notes.length = 0
})
// a dropped file's load time is counted from when it was dropped
viewer.container.addEventListener('drop', () => {
    dropStart = performance.now()
    notes.length = 0
    parsed = undefined
}, true)

viewer.scene.backgroundColor = new Color(0xdde1e6)
const credit = document.createElement('div')
const notesEl = document.createElement('details')
notesEl.className = 'blend-notes'
function showNotes() {
    const lines = [...new Set(notes)]
    notesEl.hidden = !lines.length
    notesEl.replaceChildren()
    const summary = document.createElement('summary')
    summary.textContent = `${lines.length} note${lines.length === 1 ? '' : 's'} from the importer`
    const list = document.createElement('ul')
    for (const line of lines) {
        const li = document.createElement('li')
        li.textContent = line
        list.appendChild(li)
    }
    notesEl.append(summary, list)
}
notesEl.hidden = true

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {setBackground: false})
    if (state.file) await loadDemo(state.file)

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'Blender\'s demo files, read straight from .blend by BlendLoadPlugin: meshes with Blender\'s shading, materials and packed textures, modifiers, and the scene\'s camera. Pick a scene, orbit around, or drop your own .blend.',
        actions: [
            {type: 'dropdown', label: 'Scene', icon: 'box',
                children: [...blenderDemoFiles.map(f => ({label: f.label, value: f.id})), {label: 'Your file', value: ''}],
                getValue: () => state.file?.id ?? '',
                setValue: (id: string) => {
                    const file = blenderDemoFiles.find(f => f.id === id)
                    if (file) loadDemo(file)
                },
                disabled: () => state.loading},
            {type: 'button', label: 'Open .blend…', icon: 'file-code', value: () => dropzone.promptForFile()},
            {type: 'button', label: 'Blender camera', icon: 'camera', value: showBlenderView},
            {type: 'dropdown', label: 'Modifiers', icon: 'layers',
                children: [{label: 'Viewport', value: 'viewport'}, {label: 'Render', value: 'render'}],
                getValue: () => blendLoader.evaluationMode,
                setValue: (mode: 'viewport' | 'render') => {
                    blendLoader.evaluationMode = mode
                    if (state.file) loadDemo(state.file)
                },
                disabled: () => state.loading || !state.file},
            {type: 'checkbox', label: 'Blender lights', icon: 'lightbulb',
                getValue: () => state.blenderLights,
                setValue: (on: boolean) => {
                    state.blenderLights = on
                    setLights(viewer.scene.modelRoot, on)
                }},
            {type: 'monitor', label: 'Meshes', getValue: () => stats.meshes.toLocaleString()},
            {type: 'monitor', label: 'Triangles', getValue: () => stats.triangles.toLocaleString()},
            {type: 'monitor', label: 'Load time', getValue: () => state.loading ? '…' : `${(state.loadMs / 1000).toFixed(1)} s`},
        ],
        content: [credit, notesEl],
    })
}

_testStart()
init().finally(_testFinish)
