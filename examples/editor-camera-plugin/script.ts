import {_testFinish, _testStart, ContactShadowGroundPlugin, LoadingScreenPlugin, OrbitControls3, ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorCameraPlugin} from '@threepipe/plugin-tweakpane-editor'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
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
    // View looks through a preview of the start view, with its controls: a move there changes the start view as it
    // happens (syncStartView, on by default); with Sync off it is a preview, kept with Save. The C key switches Edit
    // and View. Ctrl+Z undoes a change to the start view.
    const editorCamera = viewer.addPluginSync(EditorCameraPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true})

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(EditorCameraPlugin, {expanded: true})

    // a checkbox is a toggle button in the card, pressed while the value is true
    createExampleCard(viewer, {
        description: 'Edit with a free editor camera, or View through the start view that a visitor gets. With sync on, a move in View changes the start view. C switches, Ctrl+Z undoes.',
        actions: [
            {type: 'checkbox', label: 'Edit / View (C)', icon: 'square-pen', property: [editorCamera, 'editing']},
            {type: 'folder', label: 'Start view', children: [
                {type: 'button', label: 'Set start view to this view', icon: 'house', value: () => editorCamera.setStartViewFromEditor()},
                {type: 'button', label: 'Save start view (in View)', icon: 'save', value: () => editorCamera.saveStartView()},
                {type: 'checkbox', label: 'Sync start view on / off', icon: 'link', property: [editorCamera, 'syncStartView']},
            ]},
        ],
    })
}

_testStart()
init().finally(_testFinish)
