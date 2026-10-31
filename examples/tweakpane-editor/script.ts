import {_testFinish, _testStart, DropzonePlugin, getUrlQueryParam, HemisphereLight, ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {TransfrSharePlugin} from '@threepipe/plugin-network'
import {EditorPageLayout, EditorSplash, EditorSplashSample, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'
import {ThreeEditor} from './ThreeEditor'

/** The icons of the sample cards: 24 px, a 1.4 px line in the current colour */
const sampleIcon = (d: string) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const SAMPLE_ICONS = {
    helmet: sampleIcon('<path d="M4 14a8 8 0 0 1 16 0v3H4z"/><path d="M8 17v-3h8v3M12 6v4"/>'),
    watch: sampleIcon('<circle cx="12" cy="12" r="5"/><path d="M9 7.5L9.6 3h4.8l.6 4.5M9 16.5l.6 4.5h4.8l.6-4.5M12 9.5V12l1.6 1"/>'),
    horse: sampleIcon('<path d="M7 20v-6l-2-3 3-5 2-2 1 2 4 1 3 4-2 1-3-1v3l3 6"/><circle cx="10.5" cy="7.5" r=".6" fill="currentColor"/>'),
    shoe: sampleIcon('<path d="M3 17v-6l3-1 2 2 4-3 3 4 5 1.5V17z"/><path d="M3 17h17M8 12l1.5 1.5M11 10.5l1.5 1.5"/>'),
}

async function init() {

    const viewer = new ThreeEditor({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: checkQuery('msaa', true),
        rgbm: checkQuery('rgbm', true),
        debug: checkQuery('debug', false),
        assetManager: {
            storage: checkQuery('cache', true),
        },
        // set it to true if you only have opaque objects in the scene to get better performance.
        zPrepass: checkQuery('depthPrepass', checkQuery('zPrepass', false)),
        modelRootScale: parseFloat(getUrlQueryParam('modelRootScale', '1')!),
        dropzone: {
            autoImport: true,
            autoAdd: true,
            addOptions: {
                autoScale: checkQuery('autoScale', true),
                autoCenter: checkQuery('autoCenter', true),
                autoScaleRadius: parseFloat(getUrlQueryParam('autoScaleRadius', '2')!),
                clearSceneObjects: checkQuery('clearSceneObjectsOnDrop', false), // clear the scene before adding new objects on drop.
                license: getUrlQueryParam('licenseText') ?? undefined, // Any license to set on imported objects
            },
        },
    })
    await viewer.init()

    // ?layout=titlebar | statusbar | floating | classic: the page layout (TweakpaneEditorPlugin.layout), for this visit
    // only (a layout set from code is not kept). Without it, the layout picked last in the layout menu or the UI, else
    // the title bar.
    const layout = getUrlQueryParam('layout') as EditorPageLayout | null
    const editor = viewer.getPlugin(TweakpaneEditorPlugin)
    if (layout && editor) editor.layout = layout

    // for fat lines
    // GLTFLoader2.UseMeshLines = true
    // LineGeometryGenerator.UseMeshLines = true

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    const model = getUrlQueryParam('m') || getUrlQueryParam('model')

    // the start screen: New, Open file…, the recent samples and the samples. It opens with the page unless its "Show at
    // startup" box is off, or the URL has ?nosplash or a model; Ctrl+O (Cmd+O) opens it again.
    const dropzone = viewer.getPlugin(DropzonePlugin)
    const newScene = () => {
        viewer.scene.disposeSceneModels()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.reset()
        if (editor) editor.documentName = 'Untitled' // the next loaded file names the document
    }
    const sample = (title: string, text: string, icon: string, url: string): EditorSplashSample => ({title, text, icon, load: async() => {
        newScene()
        if (!await viewer.load(url, {autoScale: true, autoCenter: true})) throw new Error('Could not load ' + url) // the splash stays open
    }})
    const splash = new EditorSplash({
        title: 'threepipe Editor',
        version: 'v' + ThreeViewer.VERSION,
        samples: [
            sample('Damaged helmet', 'The glTF sample with PBR textures', SAMPLE_ICONS.helmet, 'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'),
            sample('Classic watch', 'A detailed model with camera views', SAMPLE_ICONS.watch, 'https://samples.threepipe.org/demos/classic-watch.glb'),
            sample('Horse', 'An animated model', SAMPLE_ICONS.horse, 'https://samples.threepipe.org/minimal/Horse.glb'),
            sample('Variants shoe', 'Material variants (Configurator mode)', SAMPLE_ICONS.shoe, 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/MaterialsVariantsShoe/glTF/MaterialsVariantsShoe.gltf'),
        ],
        onNew: newScene,
        // as a drop on the canvas, with the options of the DropzonePlugin (a .gltf with its .bin and textures together)
        onFiles: async files => {
            newScene()
            const imported = await viewer.assetManager.importer.importFiles(new Map(files.map(f => [f.name, f])), dropzone?.importOptions)
            await viewer.assetManager.loadImported([...imported.values()].flat(2).filter(Boolean), dropzone?.addOptions)
        },
    })
    if (splash.showAtStartup && !model && !new URLSearchParams(location.search).has('nosplash')) splash.open()

    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const transfr = viewer.getPlugin(TransfrSharePlugin)
    transfr && (transfr.queryParam = 'm')

    if (model) {
        const ext = getUrlQueryParam('ext') || getUrlQueryParam('model-extension') || undefined
        const loader = viewer.getPlugin(DropzonePlugin) ?? viewer
        const obj = await loader.load(model, {fileExtension: ext})
        console.log(obj)
    }

}

_testStart()
init().finally(_testFinish)

function checkQuery(key: string, def = true) {
    return !['false', 'no', 'f', '0'].includes(getUrlQueryParam(key, def ? 'yes' : 'no')!.toLowerCase())
}
