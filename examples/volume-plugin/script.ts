import {_testFinish, _testStart, GBufferPlugin, LoadingScreenPlugin, PhysicalMaterial, ProgressivePlugin, SphereGeometry, Mesh, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {NRRDLoadPlugin, VolumeObject, VolumePlugin} from '@threepipe/plugin-volume'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    renderScale: 'auto',
    // ProgressivePlugin averages the jittered frames once the camera stops; GBufferPlugin gives the scene depth,
    // so the volume stops at opaque meshes inside it
    plugins: [LoadingScreenPlugin, ProgressivePlugin, GBufferPlugin, NRRDLoadPlugin],
})

async function init() {
    viewer.scene.setBackgroundColor('#111318')

    // A scan of a stent (128 x 128 x 256 voxels, float values from 0 to 1), from the three.js examples
    const volume = await viewer.load<VolumeObject>('https://threejs.org/examples/models/nrrd/stent.nrrd', {
        autoCenter: true,
        autoScale: true,
    })
    if (!volume) throw new Error('The volume did not load')

    // a relative preset stretches over the value range of the data; hide the lowest 10% (the background)
    volume.material.setPreset('colormap:inferno')
    volume.material.range.set(0.1, 1)
    volume.material.density = 2

    // an opaque sphere inside the volume: the ray stops at it
    const sphere = new Mesh(new SphereGeometry(0.15, 32, 16), new PhysicalMaterial({color: '#4aa3ff', roughness: 0.4}))
    sphere.position.set(0.1, 0, 0)
    viewer.scene.addObject(sphere)

    viewer.scene.mainCamera.position.set(2.2, 1.0, 2.8)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    const ui = viewer.addPluginSync(TweakpaneUiPlugin)
    ui.appendChild(volume.material.uiConfig, {expanded: true})
    ui.setupPluginUi(VolumePlugin)
    ui.setupPluginUi(ProgressivePlugin)
}

_testStart()
init().finally(_testFinish)
