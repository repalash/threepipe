import {
    _testFinish,
    _testStart,
    AnimationObjectPlugin,
    CameraViewPlugin,
    CanvasSnapshotPlugin,
    ChromaticAberrationPlugin,
    ClearcoatTintPlugin,
    ContactShadowGroundPlugin,
    CustomBumpMapPlugin,
    DeviceOrientationControlsPlugin,
    DropzonePlugin,
    EditorViewWidgetPlugin,
    FilmicGrainPlugin,
    FragmentClippingExtensionPlugin,
    FrameFadePlugin,
    GBufferPlugin,
    getUrlQueryParam,
    GLTFKHRMaterialVariantsPlugin,
    GLTFMeshOptDecodePlugin,
    HalfFloatType,
    HDRiGroundPlugin,
    HemisphereLight,
    InteractionPromptPlugin,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    LoadingScreenPlugin,
    NoiseBumpMaterialPlugin,
    Object3DGeneratorPlugin,
    ObjectConstraintsPlugin,
    ParallaxMappingPlugin,
    PickingPlugin,
    PLYLoadPlugin,
    PointerLockControlsPlugin,
    PopmotionPlugin,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    SSAAPlugin,
    SSAOPlugin,
    STLLoadPlugin,
    ThreeFirstPersonControlsPlugin,
    ThreeViewer,
    TransformAnimationPlugin,
    TransformControlsPlugin,
    UnsignedByteType,
    USDZLoadPlugin,
    ViewerUiConfigPlugin,
    VignettePlugin,
    VirtualCamerasPlugin,
} from 'threepipe'
import {GaussianSplattingPlugin} from '@threepipe/plugin-gaussian-splatting'
import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'
import {extraImportPlugins} from '@threepipe/plugins-extra-importers'
import {AWSClientPlugin} from '@threepipe/plugin-network'
import {
    B3DMLoadPlugin,
    CMPTLoadPlugin,
    DeepZoomImageLoadPlugin,
    I3DMLoadPlugin,
    PNTSLoadPlugin,
    TilesRendererPlugin,
} from '@threepipe/plugin-3d-tiles-renderer'
import {
    AnisotropyPlugin,
    BloomPlugin,
    DepthOfFieldPlugin,
    SSContactShadowsPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin,
} from '@threepipe/webgi-plugins'

function checkQuery(key: string, def = true) {
    return !['false', 'no', 'f'].includes(getUrlQueryParam(key, def ? 'yes' : 'no')!.toLowerCase())
}

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: checkQuery('msaa', true),
        rgbm: checkQuery('rgbm', true),
        debug: checkQuery('debug', false),
        assetManager: {
            storage: checkQuery('cache', true),
        },
        // set it to true if you only have opaque objects in the scene to get better performance.
        zPrepass: checkQuery('depthPrepass', checkQuery('zPrepass', false)),
        modelRootScale: parseFloat(getUrlQueryParam('modelRootScale', '1')!),
        dropzone: { // this can also be set to true and configured by getting a reference to the DropzonePlugin
            // allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr', 'fbx', 'obj'], // only allow these file types. If undefined, all files are allowed.
            addOptions: {
                disposeSceneObjects: true, // auto dispose of old scene objects
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true, // when any image is dropped
                autoScale: checkQuery('autoScale', true), // auto scale according to radius
                autoCenter: checkQuery('autoCenter', true), // auto center the object
                autoScaleRadius: parseFloat(getUrlQueryParam('autoScaleRadius', '2')!),
                // license: 'Imported from dropzone', // Any license to set on imported objects
                importConfig: true, // import config from file
            },
        },
    })


    await viewer.addPlugins([
        LoadingScreenPlugin,
        PopmotionPlugin,
        AnimationObjectPlugin,
        CameraViewPlugin,
        ObjectConstraintsPlugin,
        new ProgressivePlugin(),
        new SSAAPlugin(),
        // GLTFAnimationPlugin,
        TransformAnimationPlugin,
        new GBufferPlugin(HalfFloatType, true, true, true),
        PickingPlugin,
        new TransformControlsPlugin(false),
        // OutlinePlugin,
        EditorViewWidgetPlugin,
        ViewerUiConfigPlugin,
        ClearcoatTintPlugin,
        FragmentClippingExtensionPlugin,
        NoiseBumpMaterialPlugin,
        CustomBumpMapPlugin,
        AnisotropyPlugin,
        new ParallaxMappingPlugin(false),
        GLTFKHRMaterialVariantsPlugin,
        VirtualCamerasPlugin,
        // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
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
        new SSGIPlugin(UnsignedByteType, 1, false),
        KTX2LoadPlugin,
        KTXLoadPlugin,
        PLYLoadPlugin,
        Rhino3dmLoadPlugin,
        STLLoadPlugin,
        USDZLoadPlugin,
        BlendLoadPlugin,
        // Object3DWidgetsPlugin,
        Object3DGeneratorPlugin,
        GaussianSplattingPlugin,
        ContactShadowGroundPlugin,
        CanvasSnapshotPlugin,
        DeviceOrientationControlsPlugin,
        PointerLockControlsPlugin,
        ThreeFirstPersonControlsPlugin,
        InteractionPromptPlugin,
        // new MeshOptSimplifyModifierPlugin(false, document.head), // will auto-initialize on first use.
        new GLTFMeshOptDecodePlugin(true, document.head),
        // new BasicSVGRendererPlugin(false, true),
        ...extraImportPlugins,
        MaterialConfiguratorPlugin,
        SwitchNodePlugin,
        AWSClientPlugin,
        B3DMLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, CMPTLoadPlugin,
        TilesRendererPlugin, DeepZoomImageLoadPlugin, /* SlippyMapTilesLoadPlugin,*/
    ])

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const model = getUrlQueryParam('m') || getUrlQueryParam('model')
    if (model) {
        const ext = getUrlQueryParam('ext') || getUrlQueryParam('model-extension') || undefined
        const loader = viewer.getPlugin(DropzonePlugin) ?? viewer
        const obj = await loader.load(model, {fileExtension: ext})
        console.log(obj)
        const promptDiv = document.getElementById('prompt-div')!
        promptDiv.style.display = 'none'
    }

    const dropzone = viewer.getPlugin(DropzonePlugin)!
    dropzone.addEventListener('drop', (e: any) => {
        if (!e.assets?.length) return // no assets imported
        console.log('Dropped Event:', e)
        const promptDiv = document.getElementById('prompt-div')!
        promptDiv.style.display = 'none'
    })

}

_testStart()
init().finally(_testFinish)
