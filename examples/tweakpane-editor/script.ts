import {
    _testFinish,
    DepthBufferPlugin,
    DropzonePlugin,
    FullScreenPlugin,
    HalfFloatType,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    NormalBufferPlugin,
    PLYLoadPlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    SceneUiConfigPlugin,
    STLLoadPlugin,
    ThreeViewer,
    TonemapPlugin,
    ViewerUiConfigPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        zPrepass: false, // set it to true if you only have opaque objects in the scene to get better performance.
        dropzone: {
            addOptions: {
                clearSceneObjects: false, // clear the scene before adding new objects on drop.
            },
        },
    })

    viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

    await viewer.addPlugins([
        new ViewerUiConfigPlugin(),
        // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
        new DepthBufferPlugin(HalfFloatType, true, true),
        new NormalBufferPlugin(HalfFloatType, false),
        new RenderTargetPreviewPlugin(false),
        new KTX2LoadPlugin(),
        new KTXLoadPlugin(),
        new PLYLoadPlugin(),
        new Rhino3dmLoadPlugin(),
        new STLLoadPlugin(),
    ])

    const rt = viewer.getOrAddPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(viewer.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
    rt.addTarget(viewer.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)

    editor.loadPlugins({
        ['Viewer']: [ViewerUiConfigPlugin, SceneUiConfigPlugin, DropzonePlugin, FullScreenPlugin],
        ['GBuffer']: [DepthBufferPlugin, NormalBufferPlugin],
        ['Post-processing']: [TonemapPlugin],
        ['Debug']: [RenderTargetPreviewPlugin],
    })

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    // await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    //     autoCenter: true,
    //     autoScale: true,
    // })

    // const model = result?.getObjectByName('node_damagedHelmet_-6514')
    // const config = model?.uiConfig
    // if (config) ui.appendChild(config)

}

init().then(_testFinish)

