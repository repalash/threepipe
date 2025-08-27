---
prev:
  text: 'Material Extension Plugin'
  link: './material-extension-plugin'

next: false
aside: false
---

# Dynamically loaded files in ThreePipe

This article lists all the libraries, assets, and other files that are dynamically loaded by ThreePipe. 
These files are not included in the main ThreePipe bundle to keep it lightweight and allow for more flexibility in loading only the necessary resources.

The URLs are generally exposed as static properties on the relevant classes or modules, and can be overridden before the library is loaded.

By default, these files are loaded from one of the reliable CDNs, or from [threepipe website](https://threepipe.org/), but you can change the URLs to load them from your own server or a different CDN.

## Libraries

### Core

- `DRACOLoader2.DRACO_LIBRARY_PATH` - The URL to the Draco decoder library used for loading compressed 3D models.
  - Default: `https://cdn.jsdelivr.net/gh/google/draco@1.5.6/javascript/`
  - Alternatives:
    - `https://www.gstatic.com/draco/versioned/decoders/1.5.6/`
    - `https://threejs.org/examples/jsm/libs/draco/`
    - `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/`
  - Offline/Mobile Apps - Embedded File - Put the draco_decoder.js file in your src folder, then import it in js/ts as a string
```typescript
import draco_decoder from './libs/draco_decoder.1.5.6.js?raw' // vite will load this as a string
// console.log(draco_decoder) // this should be a string with js content
DRACOLoader2.SetDecoderJsString(draco_decoder) // this sets DRACOLoader2.LibraryValueMap['draco_decoder.js']
```
- `Rhino3dmLoader2.LIBRARY_PATH` - The URL to the Rhino3dm library used for loading Rhino 3D models.
  - Default: `https://cdn.jsdelivr.net/npm/rhino3dm@8.0.1`
  - Note - Versions since 8.4.0 has issues with several files. Use 8.0.1 for stability.
- `MeshOptSimplifyModifierPlugin.SIMPLIFIER_URL` - The URL to the MeshOptimizer library's simplifier module used for mesh simplification.
  - Default: `https://unpkg.com/meshoptimizer@0.20.0/meshopt_simplifier.module.js`
  - Alternative: `https://cdn.jsdelivr.net/gh/zeux/meshoptimizer@master/js/meshopt_simplifier.module.js`
- `GLTFMeshOptDecodePlugin.DECODER_URL` - The URL to the MeshOptimizer library's decoder module used for decoding optimized glTF models.
  - Default: `https://unpkg.com/meshoptimizer@0.20.0/meshopt_decoder.module.js`
  - Alternative: `https://cdn.jsdelivr.net/gh/zeux/meshoptimizer@master/js/meshopt_decoder.module.js`
- `KTX2LoadPlugin.TRANSCODER_LIBRARY_PATH` - The URL to the Basis Universal transcoder library used for loading KTX2 textures.
  - Default: `https://cdn.jsdelivr.net/gh/BinomialLLC/basis_universal@1.16.4/webgl/transcoder/build/`

### Packages 

- `AssimpJsPlugin.LIBRARY_PATH` - Path to the CDN hosted AssimpJS library.
  - Default: `https://cdn.jsdelivr.net/gh/repalash/assimpjs@main/` (Adds fbx export support)
  - Alternative:
    - `https://cdn.jsdelivr.net/gh/repalash/assimpjs@fbx/`
    - `https://cdn.jsdelivr.net/npm/assimpjs@$0.10.0`
- `AWSClientPlugin.PROXY_URL` - To proxy AWS requests through a CORS proxy. (Required For Cloudflare)
  - Note - Requires setting `AWSClientPlugin.USE_PROXY` to true to enable.

## Files

### Core 

- `LoadingScreenPlugin.LS_DEFAULT_LOGO` - The default logo image used in the loading screen plugin. 
  - Default: `https://threepipe.org/logo.svg`

### Samples

These samples are provided and used in examples for testing and development.

- Models
  - https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf
  - https://samples.threepipe.org/minimal/root-tile.b3dm
  - https://samples.threepipe.org/splat/bonsai.splat
  - https://samples.threepipe.org/demos/classic-watch.glb
  - https://samples.threepipe.org/demos/kira.glb
  - https://samples.threepipe.org/demos/sponza-ssgi-ssr.glb
  - https://samples.threepipe.org/demos/temple-lines.glb.zip
  - https://samples.threepipe.org/minimal/Horse.glb
  - https://samples.threepipe.org/tests/SpecGlossVsMetalRough.glb

- Textures
  - https://samples.threepipe.org/minimal/venice_sunset_1k.hdr
  - https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr
  - https://samples.threepipe.org/minimal/studio_small_01_1k.hdr
  - https://samples.threepipe.org/minimal/studio_small_02_1k.hdr
  - https://samples.threepipe.org/minimal/studio_small_03_1k.hdr
  - https://samples.threepipe.org/minimal/studio_small_04_1k.hdr
  - https://samples.threepipe.org/minimal/studio_small_05_1k.hdr
  - https://samples.threepipe.org/minimal/studio_small_06_1k.hdr
  - https://samples.threepipe.org/minimal/venice_sunset_1k.hdr
  - https://samples.threepipe.org/minimal/1_webp_ll.webp
  - https://samples.threepipe.org/minimal/sprite0.png
  - https://samples.threepipe.org/minimal/brick_bump.webp
  - https://samples.threepipe.org/minimal/brick_bump.jpg
  - https://samples.threepipe.org/minimal/style-css-inside-defs.svg
  - https://samples.threepipe.org/minimal/uv_grid_opengl.jpg
  - https://samples.threepipe.org/minimal/plum-blossom-large.profile0.8bpc.yuv420.alpha-full.avif
  - https://samples.threepipe.org/minimal/planets/earth_specular_2048.jpg
  - https://samples.threepipe.org/minimal/big_buck_bunny_720p_1mb.mp4
  - https://samples.threepipe.org/minimal/file_example_MOV_480_700kB.mov
  - https://samples.threepipe.org/minimal/file_example_OGG_480_1_7mg.ogg
  - https://samples.threepipe.org/minimal/file_example_WEBM_480_900KB.webm
  - https://samples.threepipe.org/minimal/sintel.mp4
  - https://samples.threepipe.org/minimal/star.mp4
  - https://samples.threepipe.org/minimal/sample_etc1s.ktx2
  - https://samples.threepipe.org/minimal/sample_uastc.ktx2
  - https://samples.threepipe.org/minimal/sample_uastc_zstd.ktx2
  - https://samples.threepipe.org/minimal/disturb_ASTC4x4.ktx
  - https://samples.threepipe.org/minimal/disturb_BC1.ktx
  - https://samples.threepipe.org/minimal/disturb_ETC1.ktx
  - https://samples.threepipe.org/minimal/disturb_PVR2bpp.ktx
  - https://samples.threepipe.org/minimal/lensflare_ASTC8x8.ktx
  - https://samples.threepipe.org/minimal/lensflare_BC3.ktx
  - https://samples.threepipe.org/minimal/lensflare_PVR4bpp.ktx

### Examples

These files are used in the examples for testing and development. Not to be used in commercial projects.

- Files
  - https://samples.threepipe.org/shaders/tunnel-cylinders.glsl
  - https://threepipe.org/favicon.ico
  - https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/Cesium3DTiles/Hierarchy/BatchTableHierarchy/tile.b3dm
  - https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Blender-Exporter@master/polly/project_polly.gltf
  - https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/MaterialsVariantsShoe/glTF/MaterialsVariantsShoe.gltf
  - https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/WaterBottle/glTF-Draco/WaterBottle.gltf
  - https://cdn.jsdelivr.net/gh/LokiResearch/three-svg-renderer/resources/pig.gltf
  - https://cdn.jsdelivr.net/gh/LokiResearch/three-svg-renderer/resources/vincent.gltf
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/512x512_Texel_Density_Texture_1.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/ObjectSheet.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/example_1_heightmap.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/example_1_texture.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/lookuptable.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/perlin3_cp.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/perlin4_cp.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/toy_box_disp.png
  - https://cdn.jsdelivr.net/gh/Rabbid76/graphics-snippets/resource/texture/toy_box_normal.png
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/3ds/portalgun/portalgun.3ds
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/3mf/cube_gears.3mf
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/amf/rook.amf
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/bvh/pirouette.bvh
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/collada/elf/elf.dae
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/gcode/benchy.gcode
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/ldraw/officialLibrary/models/car.ldr_Packed.mpd
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/mdd/cube.mdd
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/pcd/binary/Zaghetto.pcd
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/tilt/BRUSH_DOME.tilt
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vox/monu10.vox
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vrml/meshWithTexture.wrl
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vtk/bunny.vtk
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/vtk/cube_binary.vtp
  - https://cdn.jsdelivr.net/gh/repalash/three.js-modded@v0.157.1004/examples/models/xyz/helix_201.xyz
  - https://demo-assets.pixotronics.com/pixo/gltf/anisotropyScene.glb
  - https://demo-assets.pixotronics.com/pixo/gltf/classic-watch.glb
  - https://demo-assets.pixotronics.com/pixo/gltf/engagement_ring.glb
  - https://demo-assets.pixotronics.com/pixo/gltf/jewlr1.glb
  - https://demo-assets.pixotronics.com/pixo/gltf/material_configurator.glb
  - https://demo-assets.pixotronics.com/pixo/gltf/product_configurator.glb
  - https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/refs/heads/main/Models/MeshPrimitiveModes/glTF/MeshPrimitiveModes.gltf
  - https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/d7a3cc8e51d7c573771ae77a57f16b0662a905c6/2.0/Sponza/glTF/Sponza.gltf
  - https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/c7a9a7f7607e8759d16c26fb83815ad1cd1fd865/example/data/tileset.json
  - https://raw.githubusercontent.com/NASA-AMMOS/3DTilesSampleData/master/msl-dingo-gap/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize_tileset.json
  - https://raw.githubusercontent.com/NASA-AMMOS/3DTilesSampleData/master/msl-dingo-gap/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_sky/0528_0260184_to_s64o256_sky_tileset.json
  - https://raw.githubusercontent.com/link-u/avif-sample-images/refs/heads/master/red-at-12-oclock-with-color-profile-12bpc.avif
  - https://threejs.org/examples/models/3dm/Rhino_Logo.3dm
  - https://threejs.org/examples/models/draco/bunny.drc
  - https://threejs.org/examples/models/fbx/Samba%20Dancing.fbx
  - https://threejs.org/examples/models/gltf/BoomBox.glb
  - https://threejs.org/examples/models/gltf/Flamingo.glb
  - https://threejs.org/examples/models/gltf/IridescenceLamp.glb
  - https://threejs.org/examples/models/gltf/IridescentDishWithOlives.glb
  - https://threejs.org/examples/models/gltf/LittlestTokyo.glb
  - https://threejs.org/examples/models/gltf/ShadowmappableMesh.glb
  - https://threejs.org/examples/models/gltf/Soldier.glb
  - https://threejs.org/examples/models/gltf/coffeemat.glb
  - https://threejs.org/examples/models/gltf/facecap.glb
  - https://threejs.org/examples/models/gltf/ferrari.glb
  - https://threejs.org/examples/models/obj/male02/male02.mtl
  - https://threejs.org/examples/models/obj/male02/male02.obj
  - https://threejs.org/examples/models/ply/ascii/dolphins_colored.ply
  - https://threejs.org/examples/models/ply/binary/Lucy100k.ply
  - https://threejs.org/examples/models/stl/ascii/slotted_disk.stl
  - https://threejs.org/examples/models/stl/binary/pr2_head_pan.stl
  - https://threejs.org/examples/models/usdz/saeukkang.usdz
  - https://dist.pixotronics.com/webgi/assets/hdr/gem_2.hdr
  - https://packs.ijewel3d.com/files/metal_whitegold_brush_3_08d4d2ad61.pmat
  - https://threejs.org/examples/textures/equirectangular/blouberg_sunrise_2_1k.hdr
  - https://threejs.org/examples/textures/equirectangular/moonless_golf_1k.hdr
  - https://threejs.org/examples/textures/equirectangular/pedestrian_overpass_1k.hdr
  - https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr
  - https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr
  - https://threejs.org/examples/textures/equirectangular/san_giuseppe_bridge_2k.hdr
  - https://threejs.org/examples/textures/equirectangular/spot1Lux.hdr

