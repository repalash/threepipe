---
prev:
    text: '3D Assets/Files'
    link: './3d-assets'

next:
    text: 'Materials Guide'
    link: './materials'
---

# Loading files

ThreePipe uses the [AssetManager](https://threepipe.org/docs/classes/AssetManager.html) to load files.
The AssetManager has support for loading files from URLs, local files and data URLs.
The AssetManager also adds support for loading files from a zip archive. The zip files are automatically unzipped, and the files are loaded from the zip archive.

[`viewer.load()`](https://threepipe.org/docs/classes/ThreeViewer.html#load) is a simple helper for loading files from the AssetManager. It accepts urls, local `File`/`Blob`, data URLs, zip files, `IAsset`.
It automatically adds the loaded object to the scene(if possible) and returns a promise that resolves to the loaded object/texture/material/etc, the materials are also automatically registered to the material manager.

```typescript
const object = await viewer.load<IObject3D>('https://example.com/file.glb')
```

::: details AssetManager
AssetManager internally uses [AssetImporter](https://threepipe.org/docs/classes/AssetImporter.html), which provides an API for managing three.js [LoadingManager](https://threejs.org/docs/#api/en/loaders/LoadingManager) and adding and registering loaders for different file types.

If the purpose is not to add files to the scene then [`viewer.assetManager.importer.import()`](https://threepipe.org/docs/classes/AssetImporter.html#import) method can be used to import files from the `AssetImporter`. [`viewer.assetManager.loadImported()`](https://threepipe.org/docs/classes/AssetManager.html#loadImported)
can then be called to load the imported files after any processing.
The `viewer.load()`, `viewer.assetManager.addAsset()`
and `viewer.assetManager.addAssetSingle()` methods perform combination of `import` and `loadImported`.
:::

::: tip Caching
The `AssetManager` automatically caches any loaded files in the browser's `CacheStorage`. This can be controlled by passing a custom storage or `false` to the `assetManager.storage` option in the viewer constructor.
```typescript
const viewer = new ThreeViewer({
  assetManager: {
    storage: await caches.open('my-cache-storage'), // custom storage
    // storage: false // or disable caching
  }
})
```
Caching should be disabled if the server sets proper [cache-control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control) headers, as the browser will automatically cache the files.

Note that using a different query parameter in the URL will bypass the cache and load the file again.
:::


## 3D models

The 3d models are added to `viewer.scene.modelRoot` on `viewer.load` unless some option is specified.

```typescript
const objectGlb = await viewer.load<IObject3D>('https://example.com/file.glb')
const objectFbx = await viewer.load<IObject3D>('https://example.com/file.fbx')
const objectObj = await viewer.load<IObject3D>('https://example.com/file.obj') // .mtl referenced in obj is automatically loaded
// ... load any 3d model file as an object
```
Here, we are casting to [IObject3D](https://threepipe.org/docs/interfaces/IObject3D.html) type
to get the proper type and autocomplete for the object.
`IObject3D` inherits [Object3D](https://threejs.org/docs/#api/en/core/Object3D) from three.js and adds some additional properties.

For JavaScript, the type can be omitted.
```javascript
const objectGlb = await viewer.load('https://example.com/file.glb')
```

When loading models, several options can be passed to automatically process the model first time, like `autoScale`, `autoCenter`, `addToRoot` etc. Check [AddObjectOptions](https://threepipe.org/docs/interfaces/AddObjectOptions.html) and [ImportAddOptions](https://threepipe.org/docs/interfaces/ImportAddOptions.html) for more details.

::: tip
Loaders for some file types are already added, add more loaders using plugins or by registering custom loaders.
```typescript
viewer.addPluginSync(Rhino3dmLoadPlugin)
```
Check the [model-viewer](https://threepipe.org/examples/#model-viewer/) example for a list of plugins that can be used.
:::

## Materials

The materials downloaded as `PMAT`/`BMAT`/`JSON` etc. from threepipe,
webgi or the editor can be loaded
and registered with the [MaterialManager](https://threepipe.org/docs/classes/MaterialManager)
using the `viewer.load` method.

Custom material types can also be registered by plugins(like `DMAT` for diamonds), which can also be loaded automatically using the `viewer.load` method.

```typescript
const pMaterial = await viewer.load<PhysicalMaterial>('https://example.com/file.pmat')
const bMaterial = await viewer.load<UnlitMaterial>('https://example.com/file.bmat')
// ... load any material file as a material
```
Casting to [PhysicalMaterial](https://threepipe.org/docs/classes/PhysicalMaterial) or [UnlitMaterial](https://threepipe.org/docs/classes/UnlitMaterial) is optional but recommended to get the proper type and autocomplete for the material.

To assign the material on any object, set it to `object.material`

```typescript
// find a loaded mesh in the scene
const object = viewer.scene.getObjectByName('objectName');
// assign the material
object.material = pMaterial;
```

To copy the properties without changing the material reference, use `material.copy()` or `material.setValues()` methods.

```typescript
object.material.copy(pMaterial);

// or use material manager to apply to multiple materials.
viewer.assetManager.materialManager.applyMaterial(pMaterial, 'METAL') // apply props to all materials/objects with the name METAL
```

TODO: add examples for material load and copy

## Images/Textures

Images can be loaded using the `viewer.load` method.
There is built-in support for loading all image formats supported by the browser (webp, png, jpeg, jpg, svg, ico, avif) and hdr, exr, hdr.png formats for all browsers.
More formats like ktx2, ktx, etc. can be added using plugins.

```typescript
const texture = await viewer.load<ITexture>('https://example.com/file.png')
// ... load any image file as a texture
```
Casting to [ITexture](https://threepipe.org/docs/interfaces/ITexture.html) is optional
but recommended to get the proper type and autocomplete for the texture.
It inherits from three.js [Texture](https://threejs.org/docs/#api/en/textures/Texture) and adds some additional properties.

To assign the texture on any material, set it to `material.map`

```typescript
// find a loaded mesh in the scene
const object = viewer.scene.getObjectByName('objectName');
const material = object.material as PhysicalMaterial;
// assign the texture
material.map = texture;
material.setDirty() // to let the viewer know that the material has changed and needs to re-render the scene. This will also trigger fade effect if FrameFadePlugin is added.
```
Check out the image load example to see it in action or to check the JS equivalent code: https://threepipe.org/examples/#image-load/

## Zip files

.zip files are automatically unzipped and the files are sent to re-load recursively when loaded with `viewer.load`.
Any level of zip hierarchy is flattened.
Loading files like .gltf with references to assets inside the zip file,
any relative references are also automatically resolved.
This is supported for file types like gltf, glb, obj,
etc. which support references to external files and has `root` set to `true in [IImporter](https://threepipe.org/docs/interfaces/IImporter.html).

```typescript
const objectGltf = await viewer.load<IObject3D>('https://example.com/model.gltf.zip')
```
If we know that the zip file contains a single gltf with all the assets, we can cast the result to [IObject3D](https://threepipe.org/docs/interfaces/IObject3D.html) type.

To load multiple assets from zip files like multiple textures or materials, use `viewer.assetManager.addAsset` method which returns a promise of array of loaded assets.

```typescript
const textures = await viewer.assetManager.addAsset<ITexture[]>('https://example.com/textures.zip')
const materials = await viewer.assetManager.addAsset<IMaterial[]>('https://example.com/materials.zip')
```

The auto import of zip contents can be disabled to get the files and blobs in the zip
```typescript
const zip = await viewer.load<any>('https://example.com/file.zip', {autoImportZipContents: false})
```

TODO - add example for loading zip files.

## txt, json files

Text and JSON files can be loaded using the `viewer.load` method and return strings and objects respectively.

```typescript
const text = await viewer.load<string>('https://example.com/file.txt')
const json = await viewer.load<any>('https://example.com/file.json')
```

## Data URLs

Data URLs can be loaded using the `viewer.load` method. The correct mime-type is required to be set in the data URL for finding the correct importer.

```typescript
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA' // ... some data url
const texture = await viewer.load<ITexture>(dataUrl)
```

## Local files, File and Blob

Local files can be loaded using the `viewer.load` method by passing a [IAsset](https://threepipe.org/docs/interfaces/IAsset) object with [File](https://developer.mozilla.org/en-US/docs/Web/API/File) or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) object.

```typescript
const file: File|Blob = fileObject // create a new file, blob or get from input element 
const res = await viewer.load(file)
const res2 = await viewer.load<IObject>({
  // a path/name is required to determine the proper importer by extension. `file.name` can also be used if available
  path: 'file.glb', 
  file
})
```
The same can be done for any file type.

To load a `Map` of files(like when multiple files are dragged and dropped on the webpage) with internal references to other files, use `viewer.assetManager.importer.importFiles` method. Check the source for [DropzonePlugin](../plugin/DropzonePlugin) for an example.

## File/Blob with URL

Files with references can be loaded with path, by setting the path as the name of the `File` object, or by specifying the `path` parameter.

```typescript
const url = 'https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf'
const blob = await fetch(url).then(res => res.blob())
const file = new File([blob], url)  // Set the file name to the URL, so that internal textures can be resolved correctly from the base path
const result = await viewer.load(file, {
    autoCenter: true,
    autoScale: true,
})
```

Check the complete example - [file-load](https://threepipe.org/examples/#file-load/)

## Background, Environment maps

The background and environment maps can be set using the `viewer.setBackgroundMap` and `viewer.setEnvironmentMap` methods respectively. These accept both loaded textures from `viewer.load` and direct URLs. Files can be of any image format including hdr, exr.

```typescript
await viewer.setEnvironmentMap('https://example.com/file.hdr')
await viewer.setBackgroundMap('https://example.com/file.png')
```

The same texture can be set to both by setting `setBackground` or `setEnvironment` to true in the options:
```typescript
await viewer.setEnvironmentMap('https://example.com/file.hdr', {setBackground: true})
```

Check the HDR Load example to see it in action: https://threepipe.org/examples/#hdr-load/

## SVG strings
SVG strings can be converted to data urls using the [svgUrl](https://repalash.com/ts-browser-helpers/functions/svgUrl.html) string template function

```typescript
const svgDataUrl = svgUrl`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"> ... </svg>`;
const texture = await viewer.load<ITexture>(dataUrl)
```

## Additional File Formats with Plugins

Threepipe supports many additional file formats through plugins and packages. These can be added to extend the import capabilities beyond the built-in formats.

### Core Plugins

Built-in plugins that add support for additional formats:

- **Rhino 3DM Files** - [Rhino3dmLoadPlugin](../plugin/Rhino3dmLoadPlugin)
  - `.3dm` - Rhino 3D Model files with full geometry, materials, and metadata support
  
- **Point Cloud Files** - [PLYLoadPlugin](../plugin/PLYLoadPlugin)
  - `.ply` - Stanford Polygon Format for 3D meshes and point clouds
  
- **3D Printing Files** - [STLLoadPlugin](../plugin/STLLoadPlugin)
  - `.stl` - STereoLithography format for 3D printing
  
- **Compressed Textures** - [KTX2LoadPlugin](../plugin/KTX2LoadPlugin), [KTXLoadPlugin](../plugin/KTXLoadPlugin)
  - `.ktx2` - Khronos Texture format with GPU compression support
  - `.ktx` - Original Khronos Texture format
  
- **Apple AR Files** - [USDZLoadPlugin](../plugin/USDZLoadPlugin)
  - `.usdz` - Universal Scene Description ZIP for AR Quick Look
  
- **Compressed glTF** - [GLTFMeshOptDecodePlugin](../plugin/GLTFMeshOptDecodePlugin)
  - `.glb/.gltf` with `EXT_meshopt_compression` extension for smaller file sizes

### @threepipe Packages

External packages that add support for specialized formats:

- **Gaussian Splatting** - [@threepipe/plugin-gaussian-splatting](../package/plugin-gaussian-splatting)
  - `.splat` (gaussian splat format) - 3D Gaussian Splatting files for photorealistic rendering
  
- **Blender Files** - [@threepipe/plugin-blend-importer](../package/plugin-blend-importer) (WIP)
  - `.blend` - Native Blender files with partial support
  
- **3D Tiles** - [@threepipe/plugin-3d-tiles-renderer](../package/plugin-3d-tiles-renderer)
  - `.b3dm` - Batched 3D Model format for large-scale 3D data
  - `.i3dm` - Instanced 3D Model format
  - `.cmpt` - Composite format for combining tile formats
  - `.pnts` - Point Cloud format for massive point datasets
  - `.json/.tileset` - 3D Tileset JSON for defining tile hierarchies
  
- **Extended Import Support** - [@threepipe/plugins-extra-importers](../package/plugins-extra-importers)
  - Additional three.js supported formats through various loaders
  - Includes support for specialized geometry and material formats
  
- **AssimpJS Integration** - [@threepipe/plugin-assimpjs](../package/plugin-assimpjs)
  - 40+ file formats.
  - Cross-platform 3D model importing through Assimp library

### Usage Examples

Adding plugin support for additional formats:

```typescript
// Add support for Rhino 3DM files
viewer.addPluginSync(Rhino3dmLoadPlugin)
const rhinoModel = await viewer.load<IObject3D>('./model.3dm')

// Add support for point clouds
viewer.addPluginSync(PLYLoadPlugin)
const pointCloud = await viewer.load<IObject3D>('./points.ply')

// Add support for compressed textures
viewer.addPluginSync(KTX2LoadPlugin)
const compressedTexture = await viewer.load<ITexture>('./texture.ktx2')

// Add support for 3D Gaussian Splats
import { GaussianSplattingPlugin } from '@threepipe/plugin-gaussian-splatting'
viewer.addPluginSync(new GaussianSplattingPlugin())
const splatModel = await viewer.load<IObject3D>('./scene.splat')
```

### Installation

Core plugins are included with threepipe and can be imported directly:

```typescript
import { Rhino3dmLoadPlugin, PLYLoadPlugin, STLLoadPlugin } from 'threepipe'
```

External packages need to be installed separately:

```bash
npm install @threepipe/plugin-gaussian-splatting
npm install @threepipe/plugin-3d-tiles-renderer
npm install @threepipe/plugin-assimpjs
```

::: tip Performance Considerations

Some plugins like AssimpJS and 3D Tiles require additional WebAssembly files and may have larger bundle sizes. Consider loading these plugins dynamically or using code splitting for better initial load performance.

:::

::: info File Format Recommendations

- Use **glTF/GLB** for general 3D models (best performance and feature support)
- Use **3DM** for Rhino/CAD workflows with complex geometry
- Use **Gaussian Splats** for photorealistic scene capture
- Use **3D Tiles** for large-scale geospatial or architectural data
- Use **PLY** for point cloud data and research datasets

:::

## Custom file types

Custom file importers/loaders can be registered to the `AssetImporter` using the `addImporter` method.

```typescript
class CustomLoader extends FileLoader implements ILoader{
    constructor(manager?: LoadingManager) {
        super(manager);
    }
    load(url: string, onLoad: (data: any) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): Mesh {
      this.setResponseType('json')
      return super.load(url, (json: any)=>{
        const mat = new PhysicalMaterial(json)
        onLoad?.(mat)
      }, onProgress, onError)
    }
}

viewer.assetManager.importer.addImporter(new Importer(CustomLoader, ['ext'], ['mime/type'], false))

// load the file
const mat = await viewer.load<PhysicalMaterial>('https://example.com/file.ext')
```
