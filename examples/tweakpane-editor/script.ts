import {
    _testFinish,
    CameraViewPlugin,
    DepthBufferPlugin,
    DropzonePlugin,
    FrameFadePlugin,
    FullScreenPlugin,
    GLTFAnimationPlugin,
    HalfFloatType,
    HDRiGroundPlugin,
    HemisphereLight,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    NormalBufferPlugin,
    PickingPlugin,
    PLYLoadPlugin,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    SceneUiConfigPlugin,
    STLLoadPlugin,
    ThreeViewer,
    TonemapPlugin,
    USDZLoadPlugin,
    ViewerUiConfigPlugin,
    VignettePlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'
import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'
import {extraImportPlugins} from '@threepipe/plugin-extra-importers'

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

    // @ts-expect-error unused
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

    await viewer.addPlugins([
        new ProgressivePlugin(),
        GLTFAnimationPlugin,
        PickingPlugin,
        CameraViewPlugin,
        ViewerUiConfigPlugin,
        // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
        new DepthBufferPlugin(HalfFloatType, true, true),
        new NormalBufferPlugin(HalfFloatType, false),
        new RenderTargetPreviewPlugin(false),
        new FrameFadePlugin(),
        new VignettePlugin(),
        new HDRiGroundPlugin(false, true),
        KTX2LoadPlugin,
        KTXLoadPlugin,
        PLYLoadPlugin,
        Rhino3dmLoadPlugin,
        STLLoadPlugin,
        USDZLoadPlugin,
        BlendLoadPlugin,
        ...extraImportPlugins,
    ])

    const rt = viewer.getOrAddPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(viewer.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
    rt.addTarget(viewer.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)

    editor.loadPlugins({
        ['Viewer']: [ViewerUiConfigPlugin, SceneUiConfigPlugin, DropzonePlugin, FullScreenPlugin],
        ['Interaction']: [PickingPlugin],
        ['GBuffer']: [DepthBufferPlugin, NormalBufferPlugin],
        ['Post-processing']: [TonemapPlugin, ProgressivePlugin, FrameFadePlugin, VignettePlugin],
        ['Animation']: [GLTFAnimationPlugin, CameraViewPlugin],
        ['Extras']: [HDRiGroundPlugin, Rhino3dmLoadPlugin],
        ['Debug']: [RenderTargetPreviewPlugin],
    })

    viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5))
    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    // const result = await viewer.load<IObject3D>('https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Blender-Exporter@master/polly/project_polly.gltf', {
    //     autoCenter: true,
    //     autoScale: true,
    // })
    //
    // const model = result?.getObjectByName('Correction__MovingCamera')
    // const config = model?.uiConfig
    // console.log(model, config, result)
    // if (config) ui.appendChild(config)

}

init().then(_testFinish)

