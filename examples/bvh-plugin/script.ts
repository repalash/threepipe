import {
    _testFinish, _testStart,
    BVHPlugin,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PickingPlugin,
    Raycaster,
    ThreeViewer,
    TorusKnotGeometry,
    Vector2,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    // threepipe does not depend on three-mesh-bvh: install it and give the plugin a loader.
    // A bundler puts three-mesh-bvh in its own chunk, loaded when the plugin is added.
    const bvh = viewer.addPluginSync(new BVHPlugin(true, {load: async() => import('three-mesh-bvh')}))
    bvh.addEventListener('bvhBuilt', (e) => {
        console.log('BVH built in', e.ms.toFixed(1), 'ms', e.geometry)
    })

    const picking = viewer.addPluginSync(PickingPlugin)
    picking.hoverEnabled = true

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // a mesh with a million triangles: without a BVH, every raycast (click, hover) tests all of them
    const knot = new Mesh(new TorusKnotGeometry(1, 0.3, 2500, 200), new PhysicalMaterial({
        color: '#d8b46a',
        metalness: 1,
        roughness: 0.25,
    }))
    knot.name = 'Torus knot (1M triangles)'
    viewer.scene.addObject(knot)

    // the time of a raycast under the pointer, like the one of the hover
    const info = document.getElementById('raycast-info') as HTMLDivElement
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    viewer.canvas.addEventListener('pointermove', (ev) => {
        const rect = viewer.canvas.getBoundingClientRect()
        pointer.set((ev.clientX - rect.left) / rect.width * 2 - 1, -(ev.clientY - rect.top) / rect.height * 2 + 1)
        raycaster.setFromCamera(pointer, viewer.scene.mainCamera)
        const start = performance.now()
        const hits = raycaster.intersectObject(viewer.scene.modelRoot, true)
        const ms = performance.now() - start
        info.textContent = `Raycast: ${ms.toFixed(2)} ms, ${hits.length} hits, BVH ${bvh.enabled && bvh.builtCount ? 'on' : 'off'}`
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(BVHPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)
