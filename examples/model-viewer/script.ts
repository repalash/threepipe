import {
    _testFinish,
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
    NoiseBumpMaterialPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    ParallaxMappingPlugin,
    PickingPlugin,
    PLYLoadPlugin,
    PointerLockControlsPlugin, PopmotionPlugin,
    ProgressivePlugin,
    RenderTargetPreviewPlugin,
    Rhino3dmLoadPlugin,
    SSAAPlugin,
    SSAOPlugin,
    STLLoadPlugin,
    ThreeFirstPersonControlsPlugin,
    ThreeViewer, TransformAnimationPlugin,
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
// @ts-expect-error todo fix import
import {BloomPlugin, DepthOfFieldPlugin, SSContactShadowsPlugin, SSReflectionPlugin, TemporalAAPlugin, VelocityBufferPlugin, SSGIPlugin, AnisotropyPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        rgbm: true,
        zPrepass: false, // set it to true if you only have opaque objects in the scene to get better performance.
        dropzone: { // this can also be set to true and configured by getting a reference to the DropzonePlugin
            // allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr', 'fbx', 'obj'], // only allow these file types. If undefined, all files are allowed.
            addOptions: {
                disposeSceneObjects: true, // auto dispose of old scene objects
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true, // when any image is dropped
                autoCenter: true, // auto center the object
                autoScale: true, // auto scale according to radius
                autoScaleRadius: 2,
                // license: 'Imported from dropzone', // Any license to set on imported objects
                importConfig: true, // import config from file
            },
        },
    })


    await viewer.addPlugins([
        LoadingScreenPlugin,
        PopmotionPlugin,
        new ProgressivePlugin(),
        new SSAAPlugin(),
        GLTFAnimationPlugin,
        TransformAnimationPlugin,
        new GBufferPlugin(HalfFloatType, true, true, true),
        PickingPlugin,
        new TransformControlsPlugin(false),
        // OutlinePlugin,
        EditorViewWidgetPlugin,
        CameraViewPlugin,
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
        Object3DWidgetsPlugin,
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
    ])

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    const model = getUrlQueryParam('m') || getUrlQueryParam('model')
    if (model) {
        await viewer.load(model)
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

init().finally(_testFinish)
