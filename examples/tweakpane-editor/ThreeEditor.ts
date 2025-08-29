import {
    AnimationObjectPlugin,
    AssetExporterPlugin,
    BaseGroundPlugin,
    CameraViewPlugin,
    CanvasSnapshotPlugin,
    ChromaticAberrationPlugin,
    Class,
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
    GLTFAnimationPlugin,
    GLTFKHRMaterialVariantsPlugin,
    GLTFMeshOptDecodePlugin,
    HalfFloatType,
    HDRiGroundPlugin,
    InteractionPromptPlugin,
    IViewerPlugin,
    KTX2LoadPlugin,
    KTXLoadPlugin,
    LoadingScreenPlugin,
    MeshOptSimplifyModifierPlugin,
    NoiseBumpMaterialPlugin,
    NormalBufferPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin, ObjectConstraintsPlugin,
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
    TonemapPlugin,
    TransformAnimationPlugin,
    TransformControlsPlugin,
    UndoManagerPlugin,
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
import {FontLibrary, GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {GaussianSplattingPlugin} from '@threepipe/plugin-gaussian-splatting'
import {MaterialConfiguratorPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
import {AWSClientPlugin, TransfrSharePlugin} from '@threepipe/plugin-network'
import {GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin} from '@threepipe/plugin-gltf-transform'
import {
    B3DMLoadPlugin,
    CMPTLoadPlugin,
    DeepZoomImageLoadPlugin,
    EnvironmentControlsPlugin,
    GlobeControlsPlugin,
    I3DMLoadPlugin,
    PNTSLoadPlugin,
    TilesRendererPlugin,
} from '@threepipe/plugin-3d-tiles-renderer'
import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'
import {ThreeGpuPathTracerPlugin} from '@threepipe/plugin-path-tracing'
import {TimelineUiPlugin} from '@threepipe/plugin-timeline-ui'
import {
    AnisotropyPlugin,
    BloomPlugin,
    DepthOfFieldPlugin,
    OutlinePlugin,
    SSContactShadowsPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin,
} from '@threepipe/webgi-plugins'
import {TroikaTextPlugin} from '@threepipe/plugin-troika-text'

export class ThreeEditor extends ThreeViewer {

    editorPlugins: (IViewerPlugin | Class<IViewerPlugin>)[] = [
        UndoManagerPlugin,
        LoadingScreenPlugin,
        AssetExporterPlugin,
        GLTFDracoExportPlugin,
        GLTFSpecGlossinessConverterPlugin,
        PopmotionPlugin,
        AnimationObjectPlugin,
        new ProgressivePlugin(),
        new SSAAPlugin(),
        GLTFAnimationPlugin,
        TransformAnimationPlugin,
        new GBufferPlugin(HalfFloatType, true, true, true),
        new DepthBufferPlugin(HalfFloatType, false, false),
        new NormalBufferPlugin(HalfFloatType, false),
        CameraViewPlugin,
        FullScreenPlugin,
        PickingPlugin,
        ObjectConstraintsPlugin,
        new TransformControlsPlugin(false),
        OutlinePlugin,
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
        new RenderTargetPreviewPlugin(true),
        new FrameFadePlugin(),
        new HDRiGroundPlugin(false, true),
        new VignettePlugin(false),
        new ChromaticAberrationPlugin(false),
        new FilmicGrainPlugin(false),
        new SSAOPlugin(UnsignedByteType, 1),
        SSReflectionPlugin, new SSContactShadowsPlugin(false),
        new DepthOfFieldPlugin(false), BloomPlugin,
        TemporalAAPlugin, new VelocityBufferPlugin(UnsignedByteType, false),
        new SSGIPlugin(UnsignedByteType, 1, false),
        KTX2LoadPlugin, KTXLoadPlugin, PLYLoadPlugin, Rhino3dmLoadPlugin, STLLoadPlugin, USDZLoadPlugin,
        BlendLoadPlugin,
        HierarchyUiPlugin,
        new Object3DWidgetsPlugin(false),
        Object3DGeneratorPlugin,
        GeometryGeneratorPlugin,
        GaussianSplattingPlugin,
        // BaseGroundPlugin,
        ContactShadowGroundPlugin,
        CanvasSnapshotPlugin,
        DeviceOrientationControlsPlugin, PointerLockControlsPlugin, ThreeFirstPersonControlsPlugin,
        // InteractionPromptPlugin, // todo disable when not in Viewer tab, like in webgi
        new MeshOptSimplifyModifierPlugin(false, document.head), // will auto-initialize on first use.
        new GLTFMeshOptDecodePlugin(true, document.head),
        // new BasicSVGRendererPlugin(false, true),
        ...extraImportPlugins,
        MaterialConfiguratorPlugin, SwitchNodePlugin,
        AWSClientPlugin, TransfrSharePlugin,

        // todo add these to 3dviewer.xyz
        EnvironmentControlsPlugin, GlobeControlsPlugin,
        B3DMLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, CMPTLoadPlugin,
        TilesRendererPlugin, DeepZoomImageLoadPlugin, /* SlippyMapTilesLoadPlugin,*/
        new AssimpJsPlugin(false),
        new ThreeGpuPathTracerPlugin(false),
        new TimelineUiPlugin(false, document.body),
        TroikaTextPlugin,
    ]

    editorModes: Record<string, Class<IViewerPlugin<any>>[]> = {
        ['Viewer']: [ViewerUiConfigPlugin, DropzonePlugin, BaseGroundPlugin, ContactShadowGroundPlugin, TweakpaneUiPlugin, InteractionPromptPlugin, ThreeGpuPathTracerPlugin, FullScreenPlugin],
        ['Interaction']: [HierarchyUiPlugin, TransformControlsPlugin, PickingPlugin, OutlinePlugin, Object3DGeneratorPlugin, GeometryGeneratorPlugin, EditorViewWidgetPlugin, ObjectConstraintsPlugin, Object3DWidgetsPlugin, MeshOptSimplifyModifierPlugin],
        ['GBuffer']: [GBufferPlugin, DepthBufferPlugin, NormalBufferPlugin],
        ['Post-processing']: [TonemapPlugin, ProgressivePlugin, SSAAPlugin, SSAOPlugin, SSReflectionPlugin, BloomPlugin, DepthOfFieldPlugin, SSGIPlugin, FrameFadePlugin, VignettePlugin, ChromaticAberrationPlugin, FilmicGrainPlugin, TemporalAAPlugin, VelocityBufferPlugin, SSContactShadowsPlugin],
        ['Export']: [AssetExporterPlugin, CanvasSnapshotPlugin, AWSClientPlugin, TransfrSharePlugin, AssimpJsPlugin, LoadingScreenPlugin],
        ['Configurator']: [MaterialConfiguratorPlugin, SwitchNodePlugin, GLTFKHRMaterialVariantsPlugin],
        ['Animation']: [TimelineUiPlugin, AnimationObjectPlugin, GLTFAnimationPlugin, CameraViewPlugin],
        ['Extras']: [HDRiGroundPlugin, Rhino3dmLoadPlugin, ClearcoatTintPlugin, FragmentClippingExtensionPlugin, NoiseBumpMaterialPlugin, AnisotropyPlugin, CustomBumpMapPlugin, VirtualCamerasPlugin, TilesRendererPlugin],
        ['Debug']: [RenderTargetPreviewPlugin],
    }

    async init() {
        await this.addPlugins(this.editorPlugins)

        KTX2LoadPlugin.SAVE_SOURCE_BLOBS = true // so that ktx files can be exported.

        // to show more details in the UI and allow to edit changes in title etc.
        const mat = this.getPlugin(MaterialConfiguratorPlugin)
        mat && (mat.enableEditContextMenus = true)
        const swi = this.getPlugin(SwitchNodePlugin)
        swi && (swi.enableEditContextMenus = true)

        const loading = this.getPlugin(LoadingScreenPlugin)
        loading && (loading.isEditor = true)

        // disable fading on update
        const fade = this.getPlugin(FrameFadePlugin)
        fade && (fade.isEditor = true)

        const taa = this.getPlugin(TemporalAAPlugin)
        taa && (taa.stableNoise = true)

        const rt = this.getPlugin(RenderTargetPreviewPlugin)
        if (rt && this.debug) {
            const gbuffer = this.getPlugin(GBufferPlugin)
            if (gbuffer) {
                rt.addTarget({texture: this.getPlugin(GBufferPlugin)?.normalDepthTexture}, 'normalDepth')
                rt.addTarget({texture: this.getPlugin(GBufferPlugin)?.flagsTexture}, 'gBufferFlags')
            }
            const depth = this.getPlugin(DepthBufferPlugin)
            const normal = this.getPlugin(NormalBufferPlugin)
            depth && rt.addTarget(this.getPlugin(DepthBufferPlugin)?.target, 'depth', false, false, false)
            normal && rt.addTarget(this.getPlugin(NormalBufferPlugin)?.target, 'normal', false, true, false)
        }

        this.addPluginSync(new TweakpaneUiPlugin(true))
        const editor = this.addPluginSync(new TweakpaneEditorPlugin())

        editor.loadPlugins(this.editorModes)

        await FontLibrary.Init // required for text geometry generation. todo add to other editors?
    }
}
