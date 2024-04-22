import {
    _testFinish,
    CameraViewPlugin,
    CanvasSnapshotPlugin,
    ChromaticAberrationPlugin,
    ClearcoatTintPlugin,
    ContactShadowGroundPlugin,
    CustomBumpMapPlugin,
    DepthBufferPlugin,
    DeviceOrientationControlsPlugin,
    DropzonePlugin,
    EditorViewWidgetPlugin,
    FilmicGrainPlugin,
    FragmentClippingExtensionPlugin,
    FrameFadePlugin,
    FullScreenPlugin,
    GBufferPlugin,
    getUrlQueryParam,
    GLTFAnimationPlugin,
    HalfFloatType,
    HDRiGroundPlugin,
    HemisphereLight,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    NoiseBumpMaterialPlugin,
    NormalBufferPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    PLYLoadPlugin,
    PointerLockControlsPlugin,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    SceneUiConfigPlugin,
    STLLoadPlugin,
    ThreeFirstPersonControlsPlugin,
    ThreeViewer,
    TonemapPlugin,
    TransformControlsPlugin,
    USDZLoadPlugin,
    ViewerUiConfigPlugin,
    VignettePlugin,
    VirtualCamerasPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {HierarchyUiPlugin, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'
import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'
import {extraImportPlugins} from '@threepipe/plugin-extra-importers'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {GaussianSplattingPlugin} from '@threepipe/plugin-gaussian-splatting'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
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
        new TransformControlsPlugin(false),
        EditorViewWidgetPlugin,
        CameraViewPlugin,
        ViewerUiConfigPlugin,
        ClearcoatTintPlugin,
        FragmentClippingExtensionPlugin,
        NoiseBumpMaterialPlugin,
        CustomBumpMapPlugin,
        VirtualCamerasPlugin,
        // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
        new GBufferPlugin(HalfFloatType, true, true, true),
        new DepthBufferPlugin(HalfFloatType, false, false),
        new NormalBufferPlugin(HalfFloatType, false),
        new RenderTargetPreviewPlugin(false),
        new FrameFadePlugin(),
        new HDRiGroundPlugin(false, true),
        new VignettePlugin(false),
        new ChromaticAberrationPlugin(false),
        new FilmicGrainPlugin(false),
        KTX2LoadPlugin,
        KTXLoadPlugin,
        PLYLoadPlugin,
        Rhino3dmLoadPlugin,
        STLLoadPlugin,
        USDZLoadPlugin,
        BlendLoadPlugin,
        HierarchyUiPlugin,
        GeometryGeneratorPlugin,
        Object3DWidgetsPlugin,
        Object3DGeneratorPlugin,
        GaussianSplattingPlugin,
        ContactShadowGroundPlugin,
        CanvasSnapshotPlugin,
        DeviceOrientationControlsPlugin,
        PointerLockControlsPlugin,
        ThreeFirstPersonControlsPlugin,
        ...extraImportPlugins,
    ])

    const rt = viewer.getOrAddPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget({texture: viewer.getPlugin(GBufferPlugin)?.normalDepthTexture}, 'normalDepth')
    rt.addTarget({texture: viewer.getPlugin(GBufferPlugin)?.flagsTexture}, 'gBufferFlags')
    rt.addTarget(viewer.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
    rt.addTarget(viewer.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)

    editor.loadPlugins({
        ['Viewer']: [ViewerUiConfigPlugin, SceneUiConfigPlugin, DropzonePlugin, FullScreenPlugin, TweakpaneUiPlugin],
        ['Scene']: [ContactShadowGroundPlugin],
        ['Interaction']: [HierarchyUiPlugin, TransformControlsPlugin, PickingPlugin, Object3DGeneratorPlugin, GeometryGeneratorPlugin, EditorViewWidgetPlugin, Object3DWidgetsPlugin],
        ['GBuffer']: [GBufferPlugin, DepthBufferPlugin, NormalBufferPlugin],
        ['Post-processing']: [TonemapPlugin, ProgressivePlugin, FrameFadePlugin, VignettePlugin, ChromaticAberrationPlugin, FilmicGrainPlugin],
        ['Export']: [CanvasSnapshotPlugin],
        ['Animation']: [GLTFAnimationPlugin, CameraViewPlugin],
        ['Extras']: [HDRiGroundPlugin, Rhino3dmLoadPlugin, ClearcoatTintPlugin, FragmentClippingExtensionPlugin, NoiseBumpMaterialPlugin, CustomBumpMapPlugin, VirtualCamerasPlugin],
        ['Debug']: [RenderTargetPreviewPlugin],
    })

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5))
    hemiLight.name = 'Hemisphere Light'

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    const model = getUrlQueryParam('m') || getUrlQueryParam('model')
    if (model) {
        await viewer.load(model)
    }

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

init().finally(_testFinish)

