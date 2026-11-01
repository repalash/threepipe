import {
    _testFinish, _testStart,
    BoxGeometry,
    ConeGeometry,
    CylinderGeometry,
    GPUPickingPlugin,
    Group,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    SphereGeometry,
    ThreeViewer,
    TorusKnotGeometry,
    UnlitMaterial,
    Vector3,
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

    // an arrow along the picked normal, from the picked point (+Y in the group), a tenth of the scene size long. It is
    // drawn over everything, so the surface does not hide its base.
    const arrowLength = viewer.scene.getBounds().getSize(new Vector3()).length() * 0.1
    const arrowMaterial = new UnlitMaterial({color: '#ffe14d', depthTest: false, depthWrite: false})
    const shaft = new Mesh(new CylinderGeometry(arrowLength * 0.025, arrowLength * 0.025, arrowLength * 0.75, 12), arrowMaterial)
    shaft.position.y = arrowLength * 0.375
    const head = new Mesh(new ConeGeometry(arrowLength * 0.08, arrowLength * 0.25, 16), arrowMaterial)
    head.position.y = arrowLength * 0.875
    const arrow = new Group()
    arrow.add(shaft, head)
    shaft.renderOrder = head.renderOrder = 10
    viewer.scene.addObject(arrow, {addToRoot: true})
    arrow.visible = false
    const up = new Vector3(0, 1, 0)

    const info = document.getElementById('pick-info') as HTMLDivElement
    viewer.canvas.addEventListener('pointermove', (ev) => {
        const rect = viewer.canvas.getBoundingClientRect()
        // CSS pixels from the top-left corner of the canvas
        const hit = gpuPicking.pick(ev.clientX - rect.left, ev.clientY - rect.top)
        marker.visible = arrow.visible = !!hit
        if (hit) {
            marker.position.copy(hit.point)
            arrow.position.copy(hit.point)
            arrow.quaternion.setFromUnitVectors(up, hit.normal)
        }
        marker.setDirty()
        info.textContent = hit ?
            `${hit.object.name}, distance ${hit.distance.toFixed(2)}, normal (${hit.normal.toArray().map(v => v.toFixed(2)).join(', ')}), ${gpuPicking.lastPickMs} ms` :
            `Nothing, ${gpuPicking.lastPickMs} ms`
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(GPUPickingPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
