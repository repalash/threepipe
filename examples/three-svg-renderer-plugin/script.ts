import {
    _testFinish,
    EditorViewWidgetPlugin,
    GBufferPlugin,
    GLTFAnimationPlugin,
    IObject3D,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {ThreeSVGRendererPlugin} from '@threepipe/plugin-svg-renderer'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        rgbm: false,
        // zPrepass: true,
        tonemap: false,
        plugins: [GBufferPlugin, PickingPlugin, TransformControlsPlugin], /* TransformControlsPlugin */ // todo: transform controls doesnt work when selected object is in a parent.
    })
    viewer.addPluginSync(new EditorViewWidgetPlugin('bottom-left', 128))

    viewer.renderEnabled = false

    viewer.addPluginSync(new ThreeSVGRendererPlugin(true))
    viewer.addPluginSync(GLTFAnimationPlugin)// .autoplayOnLoad = true

    // viewer.scene.addObject(new DirectionalLight2(0xffffff, 1).rotateZ(0.5).rotateX(0.5))
    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    const models = [
        // working/sort of working
        'https://threejs.org/examples/models/gltf/Horse.glb',
        'https://demo-assets.pixotronics.com/pixo/gltf/jewlr1.glb',
        'https://demo-assets.pixotronics.com/pixo/gltf/engagement_ring.glb',
        'https://threejs.org/examples/models/gltf/Flamingo.glb',
        'https://threejs.org/examples/models/gltf/ShadowmappableMesh.glb',
        'https://threejs.org/examples/models/gltf/BoomBox.glb',
        'https://cdn.jsdelivr.net/gh/LokiResearch/three-svg-renderer/resources/pig.gltf',
        'https://cdn.jsdelivr.net/gh/LokiResearch/three-svg-renderer/resources/vincent.gltf', // https://studio.blender.org/characters/5718a967c379cf04929a4247/v1/
        'https://threejs.org/examples/models/fbx/Samba Dancing.fbx',
        'https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf',
        'https://threejs.org/examples/models/obj/male02/male02.obj',
        'https://threejs.org/examples/models/gltf/kira.glb', // slow

        // not working/very slow
        'https://threejs.org/examples/models/gltf/Soldier.glb',
        'https://threejs.org/examples/models/gltf/LittlestTokyo.glb',
        'https://threejs.org/examples/models/gltf/ferrari.glb',
    ]

    await viewer.load<IObject3D>(models[0], {
        autoCenter: true,
        autoScale: true,
    })

    viewer.scene.backgroundColor = null
    viewer.scene.background = null

    viewer.scene.mainCamera.controls!.enableDamping = false

    viewer.renderEnabled = true

    // waiting because we need to render pipeline once to autoscale?
    await viewer.doOnce('postFrame')

    // optionally disable rendering. but its required if drawImageFills option is enabled
    // viewer.renderManager.autoBuildPipeline = false
    // viewer.renderManager.pipeline = [] // this will disable main viewer rendering
    // make canvas transparent to hide it. We still need pointer events so dont set display to none
    // viewer.canvas.style.opacity = '0'

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPlugins(ThreeSVGRendererPlugin)
    ui.setupPlugins(GLTFAnimationPlugin)
    ui.setupPlugins(PickingPlugin)
}

init().finally(_testFinish)
