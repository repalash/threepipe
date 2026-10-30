import {_testFinish, _testStart, ContactShadowGroundPlugin, LoadingScreenPlugin, OrbitControls3, ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorCameraPlugin} from '@threepipe/plugin-tweakpane-editor'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, UndoManagerPlugin, ContactShadowGroundPlugin],
    })

    // The start view (the scene's default camera) has the controls a visitor gets: damping and orbit limits.
    // The ground keeps it above the ground. The editor camera opts out (userData.disableGroundLimit).
    viewer.getPlugin(ContactShadowGroundPlugin)!.limitCameraAboveGround = true
    const startControls = viewer.scene.defaultCamera.controls as OrbitControls3
    startControls.enableDamping = true
    startControls.minDistance = 3
    startControls.maxDistance = 8
    startControls.minAzimuthAngle = -Math.PI / 3
    startControls.maxAzimuthAngle = Math.PI / 3

    // Edit looks through the editor camera: 1:1 with the pointer, no limits, never saved.
    // View looks through the start view. The C key switches them. Ctrl+Z undoes a change to the start view.
    const editorCamera = viewer.addPluginSync(EditorCameraPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true})

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(EditorCameraPlugin, {expanded: true})

    createSimpleButtons({
        ['Edit / View (C)']: () => {
            editorCamera.editing = !editorCamera.editing
        },
        ['Set start view to this view']: () => {
            editorCamera.setStartViewFromEditor()
        },
    })
}

_testStart()
init().finally(_testFinish)
