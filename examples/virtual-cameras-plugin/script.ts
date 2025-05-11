import {
    _testFinish, _testStart,
    HemisphereLight,
    IObject3D,
    LoadingScreenPlugin,
    PerspectiveCamera2,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
    Vector3,
    VirtualCamerasPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        debug: true,
        plugins: [new ProgressivePlugin(16), SSAAPlugin, LoadingScreenPlugin],
    })
    const virtualCameras = viewer.addPluginSync(VirtualCamerasPlugin)

    viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 10))
    await viewer.load<IObject3D>('https://threejs.org/examples/models/fbx/Samba Dancing.fbx', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.scene.mainCamera.position.set(5, 5, 5)
    viewer.scene.mainCamera.target.set(0, 0.25, 0)
    viewer.scene.mainCamera.setDirty()

    const views = [
        [new Vector3(5, 0, 0), 'right'],
        [new Vector3(0, 5, 0), 'top'],
        [new Vector3(0, 0, 5), 'front'],
    ] as const

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.appendChild(viewer.scene.mainCamera.uiConfig)

    for (const [view, name] of views) {
        const camera = new PerspectiveCamera2('', viewer.canvas, false, 45, 1)
        camera.name = name
        camera.position.copy(view)
        camera.target.set(0, 0.25, 0)
        camera.userData.autoLookAtTarget = true
        camera.setDirty()
        camera.addEventListener('update', ()=>{
            viewer.setDirty() // since the camera is not added to the scene it wont update automatically when setDirty is called(like from the UI)
        })

        viewer.scene.mainCamera.addEventListener('update', ()=>{
            camera.target.copy(viewer.scene.mainCamera.target) // sync the lookAt target of all the cameras
            camera.setDirty()
        })

        const vCam = virtualCameras.addCamera(camera)

        rt.addTarget(()=>vCam.target, name, false, false, true)

        ui.appendChild(camera.uiConfig)
    }

}

_testStart()
init().finally(_testFinish)
