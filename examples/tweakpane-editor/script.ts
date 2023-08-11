import {
    _testFinish,
    AViewerPluginSync,
    DepthBufferPlugin,
    DropzonePlugin,
    FullScreenPlugin,
    HalfFloatType,
    IObject3D,
    NormalBufferPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
    TweakpaneUiPlugin,
    UnsignedByteType,
} from 'threepipe'
import {TweakpaneEditorPlugin} from '@threepipe/plugins/ui/tweakpane-editor'

class ViewerUiConfig extends AViewerPluginSync<''> {
    static readonly PluginType = 'ViewerUiConfig'
    enabled = true
    toJSON: any = undefined
    constructor(viewer: ThreeViewer) {
        super()
        this._viewer = viewer
        this.uiConfig = viewer.uiConfig
    }
}
async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        dropzone: {
            addOptions: {
                clearSceneObjects: false,
            },
        },
    })

    viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

    await viewer.addPlugins([
        new ViewerUiConfig(viewer),
        new DepthBufferPlugin(UnsignedByteType, false, false),
        new NormalBufferPlugin(HalfFloatType, false),
        new RenderTargetPreviewPlugin(false),
    ])

    const rt = viewer.getOrAddPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(viewer.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
    rt.addTarget(viewer.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)

    editor.loadPlugins({
        ['Viewer']: [ViewerUiConfig, DropzonePlugin, FullScreenPlugin],
        ['GBuffer']: [DepthBufferPlugin, NormalBufferPlugin],
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
