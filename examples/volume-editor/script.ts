import {
    _testFinish,
    _testStart,
    AgXToneMapping,
    DirectionalLight2,
    LoadingScreenPlugin,
    ProgressivePlugin,
    ThreeViewer,
    TonemapPlugin,
    UiObjectConfig,
    UndoManagerPlugin,
    VignettePlugin,
} from 'threepipe'
import {NRRDLoadPlugin, VolumeObject, VolumeShading} from '@threepipe/plugin-volume'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    renderScale: window.TESTING ? 0.5 : 'auto',
    // UndoManagerPlugin: each drag in the editor is one undo step (ctrl/cmd+z)
    plugins: [LoadingScreenPlugin, ProgressivePlugin, NRRDLoadPlugin, UndoManagerPlugin, VignettePlugin],
})

const state = {shading: 'hybrid' as VolumeShading}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/studio_small_09_1k.hdr', {setBackground: false})
    viewer.scene.environmentIntensity = 0.3
    viewer.scene.setBackgroundColor('#0b0c10')
    viewer.getPlugin(TonemapPlugin)!.toneMapping = AgXToneMapping
    const key = new DirectionalLight2('#fff1e0', 5)
    key.castShadow = true
    key.position.set(-2.5, 2.5, 2)
    key.lookAt(0, 0, 0)
    viewer.scene.addObject(key)

    // CT angiography of the head and neck (VolView sample data, Hounsfield units), hosted on threepipe cloud
    const scan = (await viewer.load<VolumeObject>('https://files.threepipe.org/p/volume-samples/cta-head-neck.nrrd', {autoCenter: true, autoScale: true}))!
    if (!scan) throw new Error('The volume did not load')
    scan.rotation.x = -Math.PI / 2 // LPS to Y up, the face toward +z
    scan.setDirty({change: 'rotation'})
    const m = scan.material
    m.cropMin.set(0.16, 0, 0) // the head holder of the scanner
    m.cropMax.set(0.82, 0.88, 1)
    m.setPreset('CT-Bone')
    m.shading = state.shading
    m.shadows = true
    m.ambientOcclusion = true
    m.samplingRate = 1.5

    viewer.scene.mainCamera.position.set(1.4, 0.5, 2.5)
    viewer.scene.mainCamera.target.set(0, 0.35, 0)
    viewer.scene.mainCamera.setDirty()

    // The editor of the material: the opacity curve over the histogram of the scan, the colour strip, and the window
    // over the value range. It also shows in Tweakpane, in the "Transfer Function" folder of material.uiConfig.
    const editor = m.transferFunctionEditor

    const actions: UiObjectConfig[] = [
        {type: 'dropdown', label: 'Shading', property: [state, 'shading'], children: ['none', 'surface', 'volume', 'hybrid'].map(label => ({label})), onChange: () => {
            m.shading = state.shading
            viewer.setDirty()
        }},
        {type: 'button', label: 'Undo', icon: 'undo-2', value: () => viewer.getPlugin(UndoManagerPlugin)?.undoManager?.undo()},
        {type: 'button', label: 'Redo', icon: 'redo-2', value: () => viewer.getPlugin(UndoManagerPlugin)?.undoManager?.redo()},
    ]
    createExampleCard(viewer, {
        description: 'Edit the look of a CT scan by hand. Drag the points of the opacity curve over the histogram (click to add, double-click to remove), drag or tap the colour stops, and drag the window bar to change which values show. Start from a preset, or load a .clut colour table.',
        actions,
        content: editor.element,
    })
    editor.draw()
}

_testStart()
init().finally(_testFinish)
