import {
    _testFinish,
    AssetExporterPlugin,
    BaseGroundPlugin,
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
    GLTFKHRMaterialVariantsPlugin,
    GLTFMeshOptDecodePlugin,
    HalfFloatType,
    HDRiGroundPlugin,
    HemisphereLight,
    InteractionPromptPlugin,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    LoadingScreenPlugin,
    MeshOptSimplifyModifierPlugin,
    NoiseBumpMaterialPlugin,
    NormalBufferPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    ParallaxMappingPlugin,
    PickingPlugin,
    PLYLoadPlugin,
    PointerLockControlsPlugin,
    PopmotionPlugin,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    SceneUiConfigPlugin,
    SSAAPlugin,
    SSAOPlugin,
    STLLoadPlugin,
    ThreeFirstPersonControlsPlugin,
    ThreeViewer,
    TonemapPlugin,
    TransformAnimationPlugin,
    TransformControlsPlugin,
    UnsignedByteType,
    USDZLoadPlugin,
    ViewerUiConfigPlugin,
    VignettePlugin,
    VirtualCamerasPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {HierarchyUiPlugin, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'
import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'
import {extraImportPlugins} from '@threepipe/plugins-extra-importers'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {GaussianSplattingPlugin} from '@threepipe/plugin-gaussian-splatting'
import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
import {AWSClientPlugin, TransfrSharePlugin} from '@threepipe/plugin-network'
import {GLTFDracoExportPlugin} from '@threepipe/plugin-gltf-transform'
// @ts-expect-error todo fix import
import {BloomPlugin, DepthOfFieldPlugin, SSContactShadowsPlugin, SSReflectionPlugin, TemporalAAPlugin, VelocityBufferPlugin} from '@threepipe/webgi-plugins'

function checkQuery(key: string, def = true) {
    return !['false', 'no', 'f'].includes(getUrlQueryParam(key, def ? 'yes' : 'no').toLowerCase())
}

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: checkQuery('msaa', false),
        rgbm: checkQuery('rgbm', true),
        debug: checkQuery('debug', false),
        assetManager: {
            storage: checkQuery('cache', true),
        },
        // set it to true if you only have opaque objects in the scene to get better performance.
        zPrepass: checkQuery('depthPrepass', checkQuery('zPrepass', false)),
        dropzone: {
            autoImport: true,
            autoAdd: true,
            addOptions: {
                clearSceneObjects: false, // clear the scene before adding new objects on drop.
            },
        },
    })

    // @ts-expect-error unused
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

    await viewer.addPlugins([
        LoadingScreenPlugin,
        AssetExporterPlugin,
        GLTFDracoExportPlugin,
        PopmotionPlugin,
        new ProgressivePlugin(),
        new SSAAPlugin(),
        GLTFAnimationPlugin,
        TransformAnimationPlugin,
        PickingPlugin,
        new TransformControlsPlugin(false),
        EditorViewWidgetPlugin,
        CameraViewPlugin,
        ViewerUiConfigPlugin,
        ClearcoatTintPlugin,
        FragmentClippingExtensionPlugin,
        NoiseBumpMaterialPlugin,
        CustomBumpMapPlugin,
        new ParallaxMappingPlugin(false),
        GLTFKHRMaterialVariantsPlugin,
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
        new SSAOPlugin(UnsignedByteType, 1),
        SSReflectionPlugin,
        new SSContactShadowsPlugin(false),
        new DepthOfFieldPlugin(false),
        BloomPlugin,
        TemporalAAPlugin,
        new VelocityBufferPlugin(UnsignedByteType, false),
        KTX2LoadPlugin,
        KTXLoadPlugin,
        PLYLoadPlugin,
        Rhino3dmLoadPlugin,
        STLLoadPlugin,
        USDZLoadPlugin,
        BlendLoadPlugin,
        HierarchyUiPlugin,
        GeometryGeneratorPlugin,
        new Object3DWidgetsPlugin(false),
        Object3DGeneratorPlugin,
        GaussianSplattingPlugin,
        // BaseGroundPlugin,
        ContactShadowGroundPlugin,
        CanvasSnapshotPlugin,
        DeviceOrientationControlsPlugin,
        PointerLockControlsPlugin,
        ThreeFirstPersonControlsPlugin,
        // InteractionPromptPlugin, // todo disable when not in Viewer tab, like in webgi
        new MeshOptSimplifyModifierPlugin(false, document.head), // will auto-initialize on first use.
        new GLTFMeshOptDecodePlugin(true, document.head),
        // new BasicSVGRendererPlugin(false, true),
        ...extraImportPlugins,
        MaterialConfiguratorPlugin,
        SwitchNodePlugin,
        AWSClientPlugin,
        TransfrSharePlugin,
    ])

    // to show more details in the UI and allow to edit changes in title etc.
    viewer.getPlugin(MaterialConfiguratorPlugin)!.enableEditContextMenus = true
    viewer.getPlugin(SwitchNodePlugin)!.enableEditContextMenus = true

    // todo do same in blueprint editor
    // disable fading on update
    viewer.getPlugin(LoadingScreenPlugin)!.isEditor = true
    // disable fading on update
    viewer.getPlugin(FrameFadePlugin)!.isEditor = true

    viewer.getPlugin(TemporalAAPlugin)!.stableNoise = true

    const rt = viewer.getOrAddPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget({texture: viewer.getPlugin(GBufferPlugin)?.normalDepthTexture}, 'normalDepth')
    rt.addTarget({texture: viewer.getPlugin(GBufferPlugin)?.flagsTexture}, 'gBufferFlags')
    rt.addTarget(viewer.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
    rt.addTarget(viewer.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)

    editor.loadPlugins({
        ['Viewer']: [ViewerUiConfigPlugin, DropzonePlugin, FullScreenPlugin, TweakpaneUiPlugin, LoadingScreenPlugin, InteractionPromptPlugin],
        ['Scene']: [SSAAPlugin, BaseGroundPlugin, SceneUiConfigPlugin, ContactShadowGroundPlugin],
        ['Interaction']: [HierarchyUiPlugin, TransformControlsPlugin, PickingPlugin, Object3DGeneratorPlugin, GeometryGeneratorPlugin, EditorViewWidgetPlugin, Object3DWidgetsPlugin, MeshOptSimplifyModifierPlugin],
        ['GBuffer']: [GBufferPlugin, DepthBufferPlugin, NormalBufferPlugin],
        ['Post-processing']: [TonemapPlugin, ProgressivePlugin, SSAOPlugin, SSReflectionPlugin, BloomPlugin, DepthOfFieldPlugin, FrameFadePlugin, VignettePlugin, ChromaticAberrationPlugin, FilmicGrainPlugin, TemporalAAPlugin, VelocityBufferPlugin, SSContactShadowsPlugin],
        ['Export']: [AssetExporterPlugin, CanvasSnapshotPlugin, AWSClientPlugin, TransfrSharePlugin],
        ['Configurator']: [MaterialConfiguratorPlugin, SwitchNodePlugin, GLTFKHRMaterialVariantsPlugin],
        ['Animation']: [GLTFAnimationPlugin, CameraViewPlugin],
        ['Extras']: [HDRiGroundPlugin, Rhino3dmLoadPlugin, ClearcoatTintPlugin, FragmentClippingExtensionPlugin, NoiseBumpMaterialPlugin, CustomBumpMapPlugin, VirtualCamerasPlugin],
        ['Debug']: [RenderTargetPreviewPlugin],
    })

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    viewer.getPlugin(TransfrSharePlugin)!.queryParam = 'm'

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

