import {
    _testFinish,
    DepthBufferPlugin,
    DropzonePlugin,
    FullScreenPlugin,
    HalfFloatType,
    IObject3D,
    NormalBufferPlugin,
    RenderTargetPreviewPlugin,
    SceneUiConfigPlugin,
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
        dropzone: {
            addOptions: {
                clearSceneObjects: false,
            },
        },
    })

    viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

    await viewer.addPlugins([
        new ViewerUiConfigPlugin(),
        // new SceneUiConfigPlugin(),
        new DepthBufferPlugin(HalfFloatType, true, true),
        new NormalBufferPlugin(HalfFloatType, false),
        new RenderTargetPreviewPlugin(false),
        new TonemapPlugin(),
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

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    // const model = result?.getObjectByName('node_damagedHelmet_-6514')
    // const config = model?.uiConfig
    // if (config) ui.appendChild(config)

}

init().then(_testFinish)

