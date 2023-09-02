import {_testFinish, GeometryUVPreviewPlugin, IObject3D, ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    rgbm: true,
})

async function init() {

    const uvPreview = viewer.addPluginSync(GeometryUVPreviewPlugin)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/IridescentDishWithOlives.glb', {
        autoCenter: true,
        autoScale: true,
    })

    const added = false

    result?.traverse((obj) => {
        if (obj.geometry && !added) {
            // added = true
            uvPreview.addGeometry(obj.geometry, obj.name)
        }
    })


    // uvPreview.add(()=>depth.target, 'depth', false, true)
    // uvPreview.add(()=>normal.target, 'normal', false, false)
    // uvPreview.add(()=>viewer.renderManager.composerTarget, 'composer-1', false, false)
    // uvPreview.add(()=>viewer.renderManager.composerTarget2, 'composer-2', false, false)

}

init().then(_testFinish)
