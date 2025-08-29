import {defineConfig} from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "ThreePipe",
  description: "Effortlessly create 3D web experiences, from quick demos to advanced applications, with Three.js",
  themeConfig: {
    logo: '/logo.svg',
    outline: 'deep',

    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: 'https://threepipe.org/examples' },
      { text: '3D Editor', link: 'https://editor.threepipe.org' },
      { text: 'API Reference', link: 'https://threepipe.org/docs' }
    ],

    sidebar: [
      {
        text: 'Introduction', collapsed: false,
        items: [
          {text: 'What is Threepipe?', link: 'guide/introduction'},
          {text: 'Getting Started', link: 'guide/getting-started'},
          {text: 'Threepipe Editors', link: 'guide/editors'},
          {text: 'Features', link: 'guide/features'},
          {text: 'Viewer API', link: 'guide/viewer-api'},
          {text: 'Core Plugins', link: 'guide/core-plugins'},
          {text: '@threepipe Packages', link: 'guide/threepipe-packages'},
        ]
      },
      {
        text: 'Manual', collapsed: false,
        items: [
          {text: '3D Assets', link: 'guide/3d-assets'},
          {text: 'Loading Files', link: 'guide/loading-files'},
          {text: 'Materials', link: 'guide/materials'},
          {text: 'Exporting Files', link: 'guide/exporting-files'},
          {text: 'Render Pipeline', link: 'guide/render-pipeline'},
          {text: 'UI Configuration', link: 'guide/ui-config'},
          {text: 'Serialization', link: 'guide/serialization'},
          {text: 'Plugin System', link: 'guide/plugin-system'},
          {text: 'Material Extension', link: 'guide/material-extension'},
          {text: 'Screen Pass Shaders', link: 'guide/screen-pass'},
        ]
      },
      {
        text: 'Articles', collapsed: false,
        items: [
          {text: 'Mesh Lines (Spiral)', link: 'notes/fat-lines'},
          {text: 'glTF Mesh Lines', link: 'notes/gltf-mesh-lines'},
          {text: 'Setting Background', link: 'notes/scene-background'},
          {text: 'ShaderToy Shader Tutorial', link: 'notes/shadertoy-player'},
          {text: 'Using Vanilla Three.js code', link: 'notes/vanilla-threejs'},
          {text: 'Three.js properties in glTF', link: 'notes/gltf-three-extras-ext'},
          {text: 'Follow Path Constraint Animation', link: 'notes/follow-path-constraint'},
          {text: 'Material Extension Plugin', link: 'notes/material-extension-plugin'},
          {text: 'Dynamically Loaded Files', link: 'notes/dynamically-loaded-files'},
        ]
      },
      {
        text: 'Core Plugins', collapsed: false,
        items: [
          {
            text: 'Import', collapsed: true,
            items: [
              {text: 'Rhino3dmLoadPlugin', link: 'plugin/Rhino3dmLoadPlugin'},
              {text: 'PLYLoadPlugin', link: 'plugin/PLYLoadPlugin'},
              {text: 'STLLoadPlugin', link: 'plugin/STLLoadPlugin'},
              {text: 'KTX2LoadPlugin', link: 'plugin/KTX2LoadPlugin'},
              {text: 'KTXLoadPlugin', link: 'plugin/KTXLoadPlugin'},
              {text: 'USDZLoadPlugin', link: 'plugin/USDZLoadPlugin'},
              {text: 'GLTFMeshOptDecodePlugin', link: 'plugin/GLTFMeshOptDecodePlugin'},
            ],
          },
          {
            text: 'Post-processing', collapsed: true,
            items: [
              {text: 'TonemapPlugin', link: 'plugin/TonemapPlugin'},
              {text: 'VignettePlugin', link: 'plugin/VignettePlugin'},
              {text: 'ChromaticAberrationPlugin', link: 'plugin/ChromaticAberrationPlugin'},
              {text: 'FilmicGrainPlugin', link: 'plugin/FilmicGrainPlugin'},
            ],
          },
          {
            text: 'Rendering Pipeline', collapsed: true,
            items: [
              {text: 'ProgressivePlugin', link: 'plugin/ProgressivePlugin'},
              {text: 'SSAAPlugin', link: 'plugin/SSAAPlugin'},
              {text: 'DepthBufferPlugin', link: 'plugin/DepthBufferPlugin'},
              {text: 'NormalBufferPlugin', link: 'plugin/NormalBufferPlugin'},
              {text: 'GBufferPlugin', link: 'plugin/GBufferPlugin'},
              {text: 'SSAOPlugin', link: 'plugin/SSAOPlugin'},
              {text: 'FrameFadePlugin', link: 'plugin/FrameFadePlugin'},
            ],
          },
          {
            text: 'Interaction', collapsed: true,
            items: [
              {text: 'DropzonePlugin', link: 'plugin/DropzonePlugin'},
              {text: 'PickingPlugin', link: 'plugin/PickingPlugin'},
              {text: 'LoadingScreenPlugin', link: 'plugin/LoadingScreenPlugin'},
              {text: 'FullScreenPlugin', link: 'plugin/FullScreenPlugin'},
              {text: 'InteractionPromptPlugin', link: 'plugin/InteractionPromptPlugin'},
              {text: 'TransformControlsPlugin', link: 'plugin/TransformControlsPlugin'},
              {text: 'ObjectConstraintsPlugin', link: 'plugin/ObjectConstraintsPlugin'},
              {text: 'UndoManagerPlugin', link: 'plugin/UndoManagerPlugin'},
              {text: 'EditorViewWidgetPlugin', link: 'plugin/EditorViewWidgetPlugin'},
              {text: 'DeviceOrientationControlsPlugin', link: 'plugin/DeviceOrientationControlsPlugin'},
              {text: 'PointerLockControlsPlugin', link: 'plugin/PointerLockControlsPlugin'},
              {text: 'ThreeFirstPersonControlsPlugin', link: 'plugin/ThreeFirstPersonControlsPlugin'},
            ],
          },
          {
            text: 'Animation', collapsed: true,
            items: [
              {text: 'AnimationObjectPlugin', link: 'plugin/AnimationObjectPlugin'},
              {text: 'GLTFAnimationPlugin', link: 'plugin/GLTFAnimationPlugin'},
              {text: 'PopmotionPlugin', link: 'plugin/PopmotionPlugin'},
              {text: 'CameraViewPlugin', link: 'plugin/CameraViewPlugin'},
              {text: 'TransformAnimationPlugin', link: 'plugin/TransformAnimationPlugin'},
            ],
          },
          {
            text: 'Material', collapsed: true,
            items: [
              {text: 'NoiseBumpMaterialPlugin', link: 'plugin/NoiseBumpMaterialPlugin'},
              {text: 'CustomBumpMapPlugin', link: 'plugin/CustomBumpMapPlugin'},
              {text: 'ClearcoatTintPlugin', link: 'plugin/ClearcoatTintPlugin'},
              {text: 'FragmentClippingExtensionPlugin', link: 'plugin/FragmentClippingExtensionPlugin'},
              {text: 'ParallaxMappingPlugin', link: 'plugin/ParallaxMappingPlugin'},
            ],
          },
          {
            text: 'Export', collapsed: true,
            items: [
              {text: 'CanvasSnapshotPlugin', link: 'plugin/CanvasSnapshotPlugin'},
              {text: 'AssetExporterPlugin', link: 'plugin/AssetExporterPlugin'},
              {text: 'FileTransferPlugin', link: 'plugin/FileTransferPlugin'},
            ],
          },
          {
            text: 'Extras', collapsed: true,
            items: [
              {text: 'ContactShadowGroundPlugin', link: 'plugin/ContactShadowGroundPlugin'},
              {text: 'HDRiGroundPlugin', link: 'plugin/HDRiGroundPlugin'},
              {text: 'VirtualCamerasPlugin', link: 'plugin/VirtualCamerasPlugin'},
              {text: 'Object3DWidgetsPlugin', link: 'plugin/Object3DWidgetsPlugin'},
              {text: 'Object3DGeneratorPlugin', link: 'plugin/Object3DGeneratorPlugin'},
              {text: 'GLTFKHRMaterialVariantsPlugin', link: 'plugin/GLTFKHRMaterialVariantsPlugin'},
              {text: 'SimplifyModifierPlugin', link: 'plugin/SimplifyModifierPlugin'},
              {text: 'MeshOptSimplifyModifierPlugin', link: 'plugin/MeshOptSimplifyModifierPlugin'},
            ],
          },
          {
            text: 'Configurator', collapsed: true,
            items: [
              {text: 'MaterialConfiguratorBasePlugin', link: 'plugin/MaterialConfiguratorBasePlugin'},
              {text: 'SwitchNodeBasePlugin', link: 'plugin/SwitchNodeBasePlugin'},
            ],
          },
          {
            text: 'UI', collapsed: true,
            items: [
              {text: 'RenderTargetPreviewPlugin', link: 'plugin/RenderTargetPreviewPlugin'},
              {text: 'GeometryUVPreviewPlugin', link: 'plugin/GeometryUVPreviewPlugin'},
              // {text: 'SceneUiConfigPlugin', link: 'plugin/SceneUiConfigPlugin'},
              // {text: 'ViewerUiConfigPlugin', link: 'plugin/ViewerUiConfigPlugin'},
            ],
          },
          {
            text: 'Base', collapsed: true,
            items: [
              {text: 'AAssetManagerProcessStatePlugin', link: 'plugin/AAssetManagerProcessStatePlugin'},
              {text: 'ACameraControlsPlugin', link: 'plugin/ACameraControlsPlugin'},
              {text: 'BaseGroundPlugin', link: 'plugin/BaseGroundPlugin'},
              {text: 'BaseImporterPlugin', link: 'plugin/BaseImporterPlugin'},
              {text: 'PipelinePassPlugin', link: 'plugin/PipelinePassPlugin'},
              {text: 'AScreenPassExtensionPlugin', link: 'plugin/AScreenPassExtensionPlugin'},
            ],
          },
        ]
      },
      {
        text: 'Packages', collapsed: false,
        items: [
          {text: 'WebGi Rendering Plugins', link: 'https://webgi.dev/'},
          {text: 'Tweakpane Plugin', link: 'package/plugin-tweakpane'},
          {text: 'Blueprint.js Plugin', link: 'package/plugin-blueprintjs'},
          {text: 'Tweakpane Editor Plugin', link: 'package/plugin-tweakpane-editor'},
          {text: 'Configurator Plugins', link: 'package/plugin-configurator'},
          {text: 'Geometry Generator Plugin', link: 'package/plugin-geometry-generator'},
          {text: 'glTF Transform Plugin', link: 'package/plugin-gltf-transform'},
          {text: 'Extra Importers Plugins', link: 'package/plugins-extra-importers'},
          {text: 'Network Plugin', link: 'package/plugin-network'},
          {text: 'Blend Importer Plugin', link: 'package/plugin-blend-importer'},
          {text: 'Gaussian Splatting Plugin', link: 'package/plugin-gaussian-splatting'},
          {text: 'svg-renderer Plugin', link: 'package/plugin-svg-renderer'},
          {text: '3D Tiles (OGC) Renderer Plugin', link: 'package/plugin-3d-tiles-renderer'},
          {text: 'Assimpjs Plugin', link: 'package/plugin-assimpjs'},
          {text: 'Path Tracing Plugin', link: 'package/plugin-path-tracing'},
          {text: 'Timeline UI Plugin', link: 'package/plugin-timeline-ui'},
          {text: 'React Three Fiber (r3f)', link: 'package/plugin-r3f'},
          {text: 'Troika Text Plugin (2D)', link: 'package/plugin-troika-text'},
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/repalash/threepipe' },
      { icon: 'twitter', link: 'https://twitter.com/repalash' }
    ],

    footer: {
      message: 'ThreePipe - Make 3D applications on the web',
      copyright: 'Copyright © 2023-present, <a href="https://repalash.com/">repalash</a>. All rights reserved.',
    },


    // https://vitepress.dev/reference/default-theme-search#minisearch-options
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          /**
           * @type {Pick<import('minisearch').Options, 'extractField' | 'tokenize' | 'processTerm'>}
           */
          options: {
            /* ... */
          },
          /**
           * @type {import('minisearch').SearchOptions}
           * @default
           * { fuzzy: 0.2, prefix: true, boost: { title: 4, text: 2, titles: 1 } }
           */
          searchOptions: {
            /* ... */
          }
        }
      }
    },


  }
})
