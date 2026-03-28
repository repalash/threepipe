---
prev:
    text: 'BaseGroundPlugin'
    link: './BaseGroundPlugin'

next:
    text: 'PipelinePassPlugin'
    link: './PipelinePassPlugin'

aside: false
---

# BaseImporterPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/BaseImporterPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/BaseImporterPlugin.html)

Abstract base plugin for file importers. Subclasses provide an `Importer` instance that defines the supported file extensions, MIME types, and loader class. When the plugin is added to the viewer, the importer is registered with the `AssetManager`'s import pipeline. When removed, it is unregistered.

## Creating a Custom Importer Plugin

A subclass needs two things — a `PluginType` and an `_importer`:

```typescript
import {BaseImporterPlugin} from 'threepipe'
import {Importer} from 'threepipe'
import {MyFormatLoader} from './MyFormatLoader'

export class MyFormatPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'MyFormatPlugin'

    protected _importer = new Importer(
        MyFormatLoader,     // Loader class (extends three.js Loader)
        ['myf', 'myformat'],// Supported file extensions
        ['model/myformat'], // Supported MIME types
        false               // root: true if this is a primary scene format
    )
}
```

### The Importer Constructor

```typescript
new Importer(cls, ext, mime, root, onCtor?)
```

| Parameter | Type | Description |
|---|---|---|
| `cls` | `Class<Loader>` | The loader class (must extend three.js `Loader`) |
| `ext` | `string[] \| () => string[]` | Supported file extensions (lowercase). Can be a function for dynamic evaluation. |
| `mime` | `string[]` | Supported MIME types (lowercase) |
| `root` | `boolean` | Whether files of this type are "root" files — when importing folders/zips, only root files are loaded if any exist; non-root files are loaded only if no root files are found |
| `onCtor` | callback (optional) | Hook called after loader construction for setup (e.g., WASM paths, extensions) |

### Adding a Transform

When the raw loader output needs conversion (e.g., `BufferGeometry` to `Mesh`), use an anonymous inline class with a `transform` method:

```typescript
import {ILoader} from 'threepipe'

protected _importer = new Importer(class extends STLLoader implements ILoader {
    transform(res: BufferGeometry): Mesh | undefined {
        if (!res) return undefined
        return new Mesh(res, new PhysicalMaterial({
            color: 0x888888,
            metalness: 0.5,
        }))
    }
}, ['stl'], ['model/stl'], false)
```

## Properties

| Property | Type | Description |
|---|---|---|
| `_importer` | `Importer` (abstract) | The importer instance subclasses must provide |
| `toJSON` | `null` | Serialization disabled — importer plugins represent capability, not state |

## Lifecycle

**`onAdded(viewer)`**: Registers `_importer` into `viewer.assetManager.importer.addImporter()`

**`onRemove(viewer)`**: Unregisters via `viewer.assetManager.importer.removeImporter()`

**`dispose()`**: No-op. Override in subclasses if cleanup is needed.

## Built-in Subclasses

### Core Package

| Plugin | Extensions | Root | Notes |
|---|---|---|---|
| [Rhino3dmLoadPlugin](./Rhino3dmLoadPlugin) | `.3dm` | yes | Configurable UI properties |
| [PLYLoadPlugin](./PLYLoadPlugin) | `.ply` | no | Wraps geometry in Mesh |
| [STLLoadPlugin](./STLLoadPlugin) | `.stl` | no | Wraps geometry in Mesh |
| [KTX2LoadPlugin](./KTX2LoadPlugin) | `.ktx2` | no | WASM transcoder setup |
| [KTXLoadPlugin](./KTXLoadPlugin) | `.ktx` | no | Simplest subclass |
| [USDZLoadPlugin](./USDZLoadPlugin) | `.usdz`, `.usda` | no | Custom parse for USDA |

### External Packages

- **[@threepipe/plugins-extra-importers](../package/plugins-extra-importers)** — 14 additional formats: 3DS, 3MF, Collada, AMF, GCode, BVH, VOX, MDD, PCD, Tilt, VRML, LDraw, VTK, XYZ
- **[@threepipe/plugin-blend-importer](../package/plugin-blend-importer)** — Blender `.blend` files
- **[@threepipe/plugin-3d-tiles-renderer](../package/plugin-3d-tiles-renderer)** — B3DM, CMPT, PNTS, I3DM, DZI, slippy map tiles

## The Simplest Subclass

`KTXLoadPlugin`:

```typescript
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'
import {Importer} from '../../assetmanager'
import {KTXLoader} from 'three/examples/jsm/loaders/KTXLoader.js'

export class KTXLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'KTXLoadPlugin'
    protected _importer = new Importer(KTXLoader, ['ktx'], ['image/ktx'], false)
}
```

## Related

- [Loading Files](../guide/loading-files) — Guide on loading assets in threepipe
