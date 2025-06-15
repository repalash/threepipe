---
prev: 
    text: '@threepipe/plugin-svg-renderer'
    link: './plugin-svg-renderer'

next:
  text: '@threepipe/plugin-assimpjs'
  link: './plugin-assimpjs'

---

# @threepipe/plugin-3d-tiles-renderer

Exports 
- [TilesRendererPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/TilesRendererPlugin.html) - adds support for loading and rendering [OGC 3D Tiles](https://www.ogc.org/standards/3dtiles/) json files.
- [EnvironmentControlsPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/EnvironmentControlsPlugin.html) - adds support for using `EnvironmentControls` with the `mainCamera` as a `controlsMode`
- [GlobeControlsPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/GlobeControlsPlugin.html) - adds support for using `EnvironmentControls` with the `mainCamera` as a `controlsMode`
- [B3DMLoadPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/B3DMLoadPlugin.html) - adds support for loading b3dm(Batched 3D Model) files using the Asset Manager.
- [CMPTLoadPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/CMPTLoadPlugin.html) - adds support for loading cmpt(Composite Model) files using the Asset Manager.
- [I3DMLoadPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/I3DMLoadPlugin.html) - adds support for loading i3dm(Instanced 3D Model) files using the Asset Manager.
- [PNTSLoadPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/PNTSLoadPlugin.html) - adds support for loading pnts(Point Cloud) files using the Asset Manager.
- [DeepZoomImageLoadPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/DeepZoomImageLoadPlugin.html) - adds support for loading dzi(Deep Zoom Image) files.
- [SlippyMapTilesLoadPlugin](https://threepipe.org/plugins/3d-tiles-renderer/docs/classes/SlippyMapTilesLoadPlugin.html) - adds support for loading slippy map tiles (open street map).

This package acts as an interface to the [`3d-tiles-renderer`](https://github.com/NASA-AMMOS/3DTilesRendererJS) package.

[Example](https://threepipe.org/examples/#3d-tiles-renderer/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/3d-tiles-renderer/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/3d-tiles-renderer/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-3d-tiles-renderer.svg)](https://www.npmjs.com/package/@threepipe/plugin-3d-tiles-renderer)

```bash
npm install @threepipe/plugin-3d-tiles-renderer
```

::: warning Note
This is still a WIP.
:::

:::tip Editor
Any tileset can also be loaded into the tweakpane editor by adding the url and extension to the query params like -
https://threepipe.org/examples/tweakpane-editor/?m=https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/c7a9a7f7607e8759d16c26fb83815ad1cd1fd865/example/data/tileset.json&ext=tileset

The controls(environment, globe) can be picked from the UI above by going to Viewer -> Scene -> Camera -> Controls
:::

## Sample Usage 

### Load and render tileset
To import a tileset, simply add the `TilesRendererPlugin` and load the root json with the plugin or the viewer.

The near, far plane of the camera can be set based on the file.

```typescript
import {ThreeViewer} from 'threepipe'
import {TilesRendererPlugin, TilesRendererGroup} from '@threepipe/plugin-3d-tiles-renderer'

const viewer = new ThreeViewer({...})
const tiles = viewer.addPluginSync(TilesRendererPlugin)

viewer.scene.mainCamera.position.set(300, 300, 300)

// optional. (Required for GlobeControls)
viewer.scene.mainCamera.autoNearFar = false
viewer.scene.mainCamera.minNearPlane = 1
viewer.scene.mainCamera.maxFarPlane = 1000

// Now load any tileset json file.
const group = await tiles.load('https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/c7a9a7f7607e8759d16c26fb83815ad1cd1fd865/example/data/tileset.json', {
    autoScale: true,
    autoCenter: true,
    autoScaleRadius: 100,
})

// or load directly from the viewer. A custom fileExtension or fileHandler must be passed, to tell the viewer the type of the json file.
const group1 = await viewer.load<TilesRendererGroup>('https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/c7a9a7f7607e8759d16c26fb83815ad1cd1fd865/example/data/tileset.json', {
    fileExtension: TilesRendererPlugin.DUMMY_EXT,
    autoScale: true,
    autoCenter: true,
    autoScaleRadius: 100,
})

```

Check the [3d-tiles-renderer](https://threepipe.org/examples/#3d-tiles-renderer/), [ogc-tiles-mars](https://threepipe.org/examples/#ogc-tiles-mars/) examples for a live demo.

### Use `EnvironmentControls` with `TilesRendererPlugin`

```typescript
import {TilesRendererPlugin, TilesRendererGroup, EnvironmentControlsPlugin, EnvironmentControls2, GlobeControlsPlugin, GlobeControls2} from '@threepipe/plugin-3d-tiles-renderer'
const viewer = new ThreeViewer({...})
const tiles = viewer.addPluginSync(TilesRendererPlugin)
const group = await tiles.load('...')

viewer.addPluginSync(EnvironmentControlsPlugin) 
viewer.addPluginSync(GlobeControlsPlugin) 

viewer.scene.mainCamera.controlsMode = 'environment'
viewer.scene.mainCamera.lookAt(0, 0, 0)
let controls = viewer.scene.mainCamera.controls as EnvironmentControls2
controls.minDistance = 0.25;

// For globe controls
viewer.scene.mainCamera.controlsMode = 'globe'
viewer.scene.mainCamera.lookAt(0, 0, 0)
controls = viewer.scene.mainCamera.controls as GlobeControls2

// optional. (Required for GlobeControls)
controls.setTilesRenderer(group.tilesRenderer)
```

### Additional `TilesRenderer` Plugins

Some plugins are used by default in the `TilesRendererPlugin` to load and render the tileset. These can be disabled/configured when loading a file and more can be added. 
Custom plugins can be added to the individual `TilesRenderer` when loading a tileset file.
```typescript
import {UnloadTilesPlugin, TileCompressionPlugin} from '@threepipe/plugin-3d-tiles-renderer'
const result = await tiles.load('url', {
    autoCenter: true,
    autoScale: false,
    tiles: {
        TilesFadePlugin: {
            fadeDuration: 0.5,
        },
        plugins: [
            ()=>new UnloadTilesPlugin(),
            ()=>new TileCompressionPlugin(),
        ],
    },
})
```

### Loading Cesium Ion Assets

Cesium Ion assets like Google Maps can be loaded with the `loadCesiumIon` function in the plugin, or by passing a custom plugin in the viewer.

```typescript
const tiles = viewer.getPlugin(TilesRendererPlugin)
const result = await tiles.loadCesiumIon({
    assetId: '2275207',
    apiToken: CESIUM_ION_API_TOKEN,
    autoRefreshToken: true,
}, {
    autoCenter: false,
    // more options
    tiles: {
        TilesFadePlugin: true,
        plugins: [
            ()=>new TileCompressionPlugin(),
            ()=>new UnloadTilesPlugin(),
        ],
    },
})

// or 
const result2 = await viewer.load('file.tileset', {
    tiles: {
        CesiumIonAuthPlugin: {
            assetId: '2275207',
            apiToken: CESIUM_ION_API_TOKEN,
            autoRefreshToken: true,
        },
        TilesFadePlugin: true,
        plugins: [
            ()=>new TileCompressionPlugin(),
            ()=>new UnloadTilesPlugin(),
        ],
    },
})
```

Note - `TilesRendererPlugin.DUMMY_EXT` = `tileset`

:::info
Get the `CESIUM_ION_API_TOKEN` for free from [cesium ion](https://ion.cesium.com/)
:::

Check the Google Maps examples - [ogc-tiles-google-maps](https://threepipe.org/examples/#ogc-tiles-google-maps/), [ogc-tiles-google-maps-3d](https://threepipe.org/examples/#ogc-tiles-google-maps-3d/) examples for sample usage

### Loading 3d tiles files

To load any individual tile file format, add the plugin to the viewer and load the file directly as you would with any other file. The plugin will automatically detect the type of the file and load it.
```typescript
import {ThreeViewer} from 'threepipe'
import {B3DMLoadPlugin, CMPTLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin} from '@threepipe/plugin-3d-tiles-renderer'

const viewer = new ThreeViewer({...})
viewer.addPluginsSync([B3DMLoadPlugin, CMPTLoadPlugin, I3DMLoadPlugin, PNTSLoadPlugin, LoadingScreenPlugin])

// Now load any file
const b3dm = await viewer.load<IObject3D>('https://example.com/file.b3dm')
const cmpt = await viewer.load<IObject3D>('https://example.com/file.cmpt')
const i3dm = await viewer.load<IObject3D>('https://example.com/file.i3dm')
const pnts = await viewer.load<IObject3D>('https://example.com/file.pnts')

// Load file by data url
const model = await viewer.load<IObject3D>('data:application/octet-stream;base64,...', {
    fileExtension: 'b3dm',
})
// or by using `model/<extension>` mime type
const model2 = await viewer.load<IObject3D>('data:model/b3dm;base64,...')
```

The asset importer will automatically detect the type of the file and load it. 

Checkout the examples [b3dm-load](https://threepipe.org/examples/#b3dm-load/),
[cmpt-load](https://threepipe.org/examples/#cmpt-load/),
[pnts-load](https://threepipe.org/examples/#pnts-load/),
[i3dm-load](https://threepipe.org/examples/#i3dm-load/) for more details.

### Loading Image tiles

The package exports plugins `DeepZoomImageLoadPlugin` and `SlippyMapTilesLoadPlugin` to load deep zoom images and slippy map tiles respectively. 
They add and use the `TilesRendererPlugin` automatically.

The plugins can be added to the viewer and files can be loaded directly from the viewer or asset manager.

```typescript
import {ThreeViewer} from 'threepipe'
import {TilesRendererPlugin, DeepZoomImageLoadPlugin, SlippyMapTilesLoadPlugin} from '@threepipe/plugin-3d-tiles-renderer'

const viewer = new ThreeViewer({...})

viewer.addPluginsSync([TilesRendererPlugin, DeepZoomImageLoadPlugin, SlippyMapTilesLoadPlugin])

// Load deep zoom image
const result = await viewer.load('https://openseadragon.github.io/example-images/duomo/duomo.dzi', {
    autoCenter: true,
    autoScale: true,
    autoScaleRadius: 30,
    tiles: {
        DeepZoomImagePlugin: {
            center: true
        },
        errorTarget: 1,
    }
})

const result2 = await viewer.load('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    autoCenter: true,
    autoScale: true,
    autoScaleRadius: 30,
    fileExtension: SlippyMapTilesLoadPlugin.DUMMY_EXT,
    tiles: {
        errorTarget: 1,
        XYZTilesPlugin: {
            projection: 'planar',
            center: true
        },
    }
})
```

Checkout the examples [dzi-load](https://threepipe.org/examples/#dzi-load/),
[slippy-map-tiles](https://threepipe.org/examples/#slippy-map-tiles/) for a demo.
