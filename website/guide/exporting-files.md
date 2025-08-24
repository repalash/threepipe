---
prev:
    text: 'Materials'
    link: './materials'

next:
    text: 'Render Pipeline'
    link: './render-pipeline'
---

# Exporting files

Threepipe has support for exporting various asset type with AssetManager, as well as support to export viewer and plugin configuration, arbitrary objects etc. using the [serialization](./serialization) system.

[viewer.export()](https://threepipe.org/docs/classes/ThreeViewer.html#export) is a high-level wrapper for exporting scene objects, materials, textures, render targets, viewer/scene configuration and plugin configurations.

AssetManager internally uses [AssetExporter](https://threepipe.org/docs/classes/AssetExporter.html) to export files.
AssetExporter includes some basic exporters for glb, exr, textures,
and materials and a system to register exporters for different file types with plugins or custom exporters.

## Exporting 3D models

Export the root scene as glb
```typescript
const blob = await viewer.exportScene({
  viewerConfig: true, // default = true. export all viewer and plugin configuration. if false only the model root object is exported.
})
// download the file
downloadBlob(blob, 'scene.glb')
```

Export a single object from the scene as glb
```typescript
const object = viewer.scene.getObjectByName('objectName');
const glb: Blob = await viewer.export(object, {
  exportExt: 'glb', // default = glb for models
  embedUrlImages: true, // default = false. embed images in glb even when url is available.
})
// download the file
downloadBlob(glb, 'object.glb')
```

Check the example [glb-export](https://threepipe.org/examples/#glb-export/) to see a demo.

::: tip DRACO compression

Models can be processed with [gltf-transform](https://gltf-transform.donmccurdy.com/) to apply DRACO compression and other optimizations after exporting.

```typescript
viewer.addPluginSync(GLTFDracoExportPlugin)
const blob = await viewer.export(mesh, {
    exportExt: 'glb',
    embedUrlImages: true, // embed images in glb even when url is available.
    compress: true,
})
```

Check the example [glb-export-draco](https://threepipe.org/examples/#glb-export-draco/) to see a demo.
:::

::: info Other formats

Only glTF/glb export supports all serialization in threepipe, and is the recommended format for exporting 3D models.

But in some cases it might be required to export your files in other formats, which can be achieved using plugins or any third-party three.js exporters.

To export fbx files, `@threepipe/plugin-assimpjs` plugin can be used. Check out the [package docs](../package/plugin-assimpjs#export-to-fbx-convert-to-fbx) and the [fbx-export example](https://threepipe.org/examples/#fbx-export/) for more details.

:::

## Exporting Materials

Export a material
```typescript
const material = viewer.assetManager.materialManager.findMaterialsByName('materialName')[0];
// or 
// const material = viewer.scene.getObjectByName('objectName').material;
const blob = await viewer.export(material)
// download the file
downloadBlob(blob, 'material.' + blob.ext)
```

Check the example [pmat-material-export](https://threepipe.org/examples/#pmat-material-export/) to see a demo.

## Exporting Canvas Images

Canvas Screenshot/snapshot can be exported as png, jpeg or webp(if supported by the browser)
```typescript
const blob = await viewer.getScreenshotBlob({mimeType: 'image/' + type, quality: 0.85})
// or to get data url:
// const dataUrl = await viewer.getScreenshotDataUrl({mimeType: 'image/' + type, quality: 0.85})
// download the file
downloadBlob(blob, 'screenshot.' + blob.ext)
```

Check the example [image-snapshot-export](https://threepipe.org/examples/#image-snapshot-export/) to see a demo.

See also: [CanvasSnapshotPlugin](../plugin/CanvasSnapshotPlugin).

## Exporting Viewer Config (vjson)

The viewer configuration can be exported to JSON using `viewer.exportConfig` or `viewer.export(viewer)`. This would export a JSON object with all the viewer, scene and all plugin configuration but no 3D data.

::: tip
Plugins can exclude themselves from being included in vjson by setting property `serializeWithViewer` to `false`
:::

We use the extension `.vjson` to easily identify viewer configuration files and use them as presets/starter scenes.

```typescript
// get a blob directly
const blob = viewer.export(viewer);

// get a json object
const json = viewer.exportConfig();

// get a json object that will later be embedded in a binary file (like glb)
const json2 = viewer.exportConfig(true);
```

## Exporting Plugin

Any plugin that supports serialization(most of them), can be exported independently to JSON using `viewer.export` or `viewer.exportPluginConfig`.

::: info Note
Don't use `plugin.toJSON` directly, use `viewer.export` instead as that will make sure the resources(like textures) are embedded with proper context.
:::

```typescript
const plugin = viewer.addPluginSync(SSAOPlugin)

const blob = viewer.export(plugin);
downloadBlob(blob, plugin.name + '.' + blob.ext); // json
```
The exported JSON config can then be imported by `viewer.load` or `viewer.importPluginConfig`.

## Exporting Textures

Textures can be exported to JSON using `viewer.export` or `AssetExporter`

```typescript
const texture = await viewer.load('https://example.com/file.jpeg')
const blob = await viewer.export(texture)
downloadBlob(blob, texture.name + '.' + blob.ext)
```

Render target textures can be exported with `viewer.renderManager.exportRenderTarget` or `viewer.export`,
read about [Exporting Render Targets](#exporting-render-targets) below.

[//]: # (TODO: add examples for texture export)

Textures and Uint8 Data Textures can be exported as a data url or copied to a new canvas
```typescript
// get a base64 data url
const dataUrl = textureToDataUrl(texture, 4096, false, 'image/png') // texture or data texture, max-size, flipY, mimeType
// or copy to a new canvas
const canvas = textureToCanvas(texture, 4096) // texture or data texture, max-size
```

Data Textures of type Half float and Float can be exported with `viewer.export`
```typescript
const dataTex = await viewer.load('https://example.com/file.hdr')
const blob = await viewer.export(dataTexture, {exportExt: 'exr'})
```
Check the example [hdr-to-exr](https://threepipe.org/examples/#hdr-to-exr/) to see a demo of HDR to EXR conversion.

TODO: add support to export unsigned byte textures as png, jpeg, webp

## Exporting Images/Textures

Exporting Textures as Images with image of types ImageBitmap, HTMLImageElement,
HTMLOrSVGImageElement, CanvasImageSource, HTMLCanvasElement,
OffscreenCanvas can be exported to png data urls with [imageBitmapToBase64](https://repalash.com/ts-browser-helpers/functions/imageBitmapToBase64.html) function.

```typescript
const texture = await viewer.load('https://example.com/file.jpeg')

const dataUrl = await imageBitmapToBase64(texture.image, 'image/png', 0.85);
```

[//]: # (TODO: add support for texture export as images in AssetExporter)

## Exporting Render Targets

Unsigned byte render targets can be exported as png, jpeg or webp(if supported by the browser)
```typescript
const depthPlugin = viewer.addPluginSync(DepthBufferPlugin, UnsignedByteType)
// wait for the first render
const blob = await viewer.export(depthPlugin.target!, {exportExt: 'png'})
if (blob) downloadBlob(blob, target.texture.name + '.' + blob.ext)
```

Half float and float render targets can be exported as exr
```typescript
const depthPlugin = viewer.addPluginSync(DepthBufferPlugin, HalfFloatType)
// wait for the first render
const blob = await viewer.export(depthPlugin.target!, {exportExt: 'exr'})
if (blob) downloadBlob(blob, target.texture.name + '.' + blob.ext)
```

::: tip
`exportExt` is determined automatically if not specified.
:::

Checkout the example [render-target-export](https://threepipe.org/examples/#render-target-export/) to see a demo.
