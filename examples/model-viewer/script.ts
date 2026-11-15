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
import {GridItemListPlugin, MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
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
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

// Models to try, on samples.threepipe.org. A CC BY model shows its credit in the card.
const SAMPLES: {label: string, url: string, credit?: string}[] = [
    {label: 'Classic watch', url: 'https://samples.threepipe.org/demos/webgi/classic-watch.glb'},
    {label: 'Lounge chair', url: 'https://samples.threepipe.org/poly-haven/mid_century_lounge_chair_2k.glb', credit: 'Mid Century Lounge Chair by Kuutti Siitonen, Poly Haven (CC0)'},
    {label: 'Marble bust', url: 'https://samples.threepipe.org/poly-haven/marble_bust_01_2k.glb', credit: 'Marble Bust 01 by Rico Cilliers, Poly Haven (CC0)'},
    {label: 'Camera', url: 'https://samples.threepipe.org/poly-haven/Camera_01_2k.glb', credit: 'Camera 01 by Rajil Jose Macatangay, Poly Haven (CC0)'},
    {label: 'Velvet sofa', url: 'https://samples.threepipe.org/khronos/GlamVelvetSofa.glb', credit: 'Glam Velvet Sofa by Eric Chadwick, © Wayfair LLC, CC BY 4.0, via Khronos glTF Sample Assets'},
    {label: 'Sunglasses', url: 'https://samples.threepipe.org/khronos/SunglassesKhronos.glb', credit: 'Sunglasses Khronos by Eric Chadwick (Darmstadt Graphics Group), CC BY 4.0. The Khronos logo is a trademark'},
    {label: 'Damaged helmet', url: 'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', credit: 'Battle Damaged Sci-fi Helmet by theblueturtle_, glTF by ctxwing, via Khronos glTF Sample Assets'},
]

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
        new EditorViewWidgetPlugin('top-right'), // the example card is at the top left
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

    const dropzone = viewer.getPlugin(DropzonePlugin)!
    const promptDiv = document.getElementById('prompt-div')!

    // the model in ?m= (or ?model=), else the first sample; ?m=none starts empty
    const query = getUrlQueryParam('m') || getUrlQueryParam('model')
    let sample = query ? -1 : 0
    const credit = document.createElement('p')
    credit.style.margin = '0'
    const swatches = document.createElement('div')
    const loadSample = async(i: number) => {
        sample = i
        credit.textContent = SAMPLES[i].credit ?? ''
        await dropzone.load(SAMPLES[i].url)
        promptDiv.style.display = 'none'
    }
    if (query && query !== 'none') {
        const ext = getUrlQueryParam('ext') || getUrlQueryParam('model-extension') || undefined
        const obj = await dropzone.load(query, {fileExtension: ext})
        console.log(obj)
        promptDiv.style.display = 'none'
    } else if (!query) await loadSample(0)

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'A viewer with most of the plugins. Drop any 3D file on the page (glTF, FBX, OBJ, STL, PLY, USDZ, 3DM, Blend, splats, 3D tiles, a zip) or an HDR/EXR for the environment, or open one here. URL: ?m=<model url>, ?env=<hdr url>.',
        actions: [
            {type: 'button', label: 'Open file…', icon: 'file-code', value: () => dropzone.promptForFile()},
            {type: 'button', label: 'Open URL…', icon: 'link', value: () => dropzone.promptForUrl()},
            // "Your file" shows after a model is dropped or opened (or came from ?m=)
            {type: 'dropdown', label: 'Sample', icon: 'box', children: [...SAMPLES.map((m, i) => ({label: m.label, value: i})), {label: 'Your file', value: -1}],
                getValue: () => sample, setValue: (i: number) => i >= 0 && loadSample(i)},
            {type: 'monitor', label: 'Meshes', getValue: () => stats.meshes.toLocaleString()},
            {type: 'monitor', label: 'Triangles', getValue: () => stats.triangles.toLocaleString()},
        ],
        content: [credit, swatches],
    })
    // the swatches of a model with material variations or switch nodes (the watch) go in the card too
    viewer.getPlugin(GridItemListPlugin)!.container = swatches

    dropzone.addEventListener('drop', (e: any) => {
        if (!e.assets?.length) return // no assets imported
        console.log('Dropped Event:', e)
        promptDiv.style.display = 'none'
        // a model replaces the sample; an HDR or an image only changes the environment or the background
        if (!e.assets.some((a: any) => a?.isObject3D)) return
        sample = -1 // not a sample now
        credit.textContent = ''
    })

}

_testStart()
init().finally(_testFinish)
