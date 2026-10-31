import {
    _testFinish, _testStart,
    BoxGeometry,
    GPUPickingPlugin,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    SphereGeometry,
    ThreeViewer,
    TorusKnotGeometry,
    UnlitMaterial,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const gpuPicking = viewer.addPluginSync(GPUPickingPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // a few meshes in a row; the knot has 400k triangles, the pick costs the same for all of them
    const knot = new Mesh(new TorusKnotGeometry(0.7, 0.22, 1000, 200), new PhysicalMaterial({color: '#d8b46a', metalness: 1, roughness: 0.25}))
    knot.name = 'Torus knot'
    const box = new Mesh(new BoxGeometry(1.2, 1.2, 1.2), new PhysicalMaterial({color: '#4f86c6', roughness: 0.5}))
    box.name = 'Box'
    box.position.set(-2.2, 0, 0)
    const sphere = new Mesh(new SphereGeometry(0.7, 64, 32), new PhysicalMaterial({color: '#c64f6d', roughness: 0.3}))
    sphere.name = 'Sphere'
    sphere.position.set(2.2, 0, 0)
    viewer.scene.addObject(knot)
    viewer.scene.addObject(box)
    viewer.scene.addObject(sphere)

    // a marker at the picked point, outside the model root so it is not picked
    const marker = viewer.scene.addObject(new Mesh(new SphereGeometry(0.04, 16, 8), new UnlitMaterial({color: '#ffffff'})), {addToRoot: true})
    marker.visible = false

    const info = document.getElementById('pick-info') as HTMLDivElement
    viewer.canvas.addEventListener('pointermove', (ev) => {
        const rect = viewer.canvas.getBoundingClientRect()
        // CSS pixels from the top-left corner of the canvas
        const hit = gpuPicking.pick(ev.clientX - rect.left, ev.clientY - rect.top)
        marker.visible = !!hit
        if (hit) marker.position.copy(hit.point)
        marker.setDirty()
        info.textContent = hit ?
            `${hit.object.name}, distance ${hit.distance.toFixed(2)}, ${gpuPicking.lastPickMs} ms` :
            `Nothing, ${gpuPicking.lastPickMs} ms`
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(GPUPickingPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
