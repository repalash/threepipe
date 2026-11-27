---
prev:
  text: 'UI Configuration'
  link: './ui-config'

next:
    text: 'Plugin System'
    link: './plugin-system'
---

# Serialization

Easy serialization of all threepipe and most three.js objects are supported out of the box using the Asset Manager. 

Complete scene, and 3D objects, can be serialized in glTF format, which saves the 3D data is a standardized format supported by the industry. Custom data like three.js properties, plugin configurations, and viewer configurations are also automatically serialized in glTF format using custom extensions. Read the [glTF Extras Extensions note](./../notes/gltf-three-extras-ext) for more details.

Fine control over serialization is also supported using the [ThreeSerialization](https://threepipe.org/docs/classes/ThreeSerialization.html) class

Call `ThreeSerialization.serialize` on any object to serialize it.
and `ThreeSerialization.deserialize` to deserialize the serialized object.

This is done by performing a nested serialization of all the properties of the object.
It's possible to implement custom serializers for custom types and classes and is done for three.js primitives,
objects and plugins in threepipe.

## Serializable Objects

To make a custom data class that is serializable,
mark it using `@serializable` decorator and any properties using `@serialize` decorator.
```typescript
@serializable('DataClass')
class DataClass{
    @serialize() prop1 = 1
    @serialize() prop2 = 'string'
    @serialize() prop3 = new Vector3()
    @serialize() prop4 = new PhysicalMaterial()
    @serialize() prop4 = {
        prop1: 1,
        prop2: 'string',
        prop3: new Vector3(),
        prop4: new PhysicalMaterial(),
    }
}

const data = new DataClass()
const serialized = ThreeSerialization.serialize(data)
const deserialized = ThreeSerialization.deserialize(serialized)
```

The classes without a `@serializable` decorator are serialized as plain objects.
These can still include `@serialize` decorator to mark the properties are serializable
but these classes cannot be deserialized into a new instance of the class.
The ThreeViewer and plugins are an example of these.
When deserialized they need an object to deserialize into.
This ensures there is always just one instance.
With this, the serialization system works like `toJSON` and `fromJSON` methods in three.js.

To use the same functionality as decorators but in javascript, `ThreeSerialization.MakeSerializable` can be used.

Check the [plugin system](https://threepipe.org/guide/features.html#plugin-system) page for more details on how to mark properties as serializable for plugins.

```typescript
class CustomClass{
    @serialize() prop1 = 1
    @serialize() prop2 = 'string'
    @serialize() prop3 = new Vector3()
    @serialize() prop4 = new PhysicalMaterial()
}
const obj = new DataClass()
const serialized = ThreeSerialization.serialize(data)
// now to deserialize we need to pass in the object to deserialize into
ThreeSerialization.deserialize(serialized, obj)
```

## toJSON and fromJSON 

You can also implement the toJSON and fromJSON functions ot the class to customize the serialization and deserialization process. 

```typescript
class MyClass{
    // ...

    toJSON(meta?: SerializationMetaType): ISerializedConfig {
        const data: any = ThreeSerialization.Serialize(this, meta, true) // last param set to true to indicate not to call toJSON.
        data.type = 'MyType'
        data.assetType = 'config'
        this.dispatchEvent({type: 'serialize', data}) // optional
        return data
    }

    fromJSON(data: ISerializedConfig, meta?: SerializationMetaType): this|null|Promise<this|null> {
        if (data.type !== 'MyType') return null
        ThreeSerialization.Deserialize(data, this, meta, true) // last param set to true to indicate not to call fromJSON.
        this.dispatchEvent({type: 'deserialize', data, meta}) // optional
        return this
    }
}
```

When calling `ThreeSerialization.Serialize` on an object of `MyClass`, it will call `toJSON` on the object and serialize the properties of the object. Similarly, when calling `ThreeSerialization.Deserialize` on an object of `MyClass`, it will call `fromJSON` on the object and deserialize the properties of the object.

### Extending classes

When extending classes that have `toJSON` and `fromJSON` methods(like three.js objects), you can call the super methods and then serialize the properties of the class.

```typescript
class MyMaterial extends ThreeMaterial{
    // ...
    
    /**
     * Serializes this material to JSON.
     * @param meta - metadata for serialization
     * @param _internal - Calls only super.toJSON, does internal three.js serialization and `@serialize` tags. Set it to true only if you know what you are doing. This is used in Serialization->serializer->material
     */
    toJSON(meta?: SerializationMetaType, _internal = false): any {
        if (_internal) return {
            ...super.toJSON(meta),
            ...ThreeSerialization.Serialize(this, meta, true), // this will serialize the properties of this class(like defined with @serialize and @serialize attribute)
        }
        return ThreeSerialization.Serialize(this, meta, false) // this will call toJSON again, but with _internal=true, that's why we set isThis to false.
    }

    /**
     * Deserializes the material from JSON.
     * Note: some properties that are not serialized in Material.toJSON when they are default values (like side, alphaTest, blending, maps), they wont be reverted back if not present in JSON
     * If _internal = true, Textures should be loaded and in meta.textures before calling this method.
     * @param data
     * @param meta
     * @param _internal
     */
    fromJSON(data: any, meta?: SerializationMetaType, _internal = false): this | null {
        if (_internal) {
            ThreeSerialization.Deserialize(data, this, meta, true)
            return this.setValues(data) // todo remove this and add @serialize decorator to properties
        }
        this.dispatchEvent({type: 'beforeDeserialize', data, meta, bubbleToObject: true, bubbleToParent: true})
        return this
    }
}
```


## Custom Serializers

### Primitives

Primitive serializers are for classes that have only `simple` properties(`number`, `string`, `boolean`, `null`, or `object`/`Array` of those), they can be registered like this - 
```javascript
Serialization.RegisterSerializer(
    ThreeSerialization.PrimitiveSerializer(Vector4, 'isVector4', ['x', 'y', 'z', 'w'], 1),
    ThreeSerialization.PrimitiveSerializer(Spherical, 'isSpherical', ['radius', 'phi', 'theta'], 1),
    ThreeSerialization.PrimitiveSerializer(Matrix4, 'isMatrix4', ['elements'], 1),
)
```

::: info
The threejs classes are already registered, these samples are provided as reference
:::

### Serializable Classes

#### Specify Properties

Instead of using typescript and decorators, custom classes can be marked as serializable by manually specifying the properties and a unique type and using `ThreeSerialization.MakeSerializable`
```javascript
ThreeSerialization.MakeSerializable(DataClass, 'DataClass', ['friction', 'restitution', 'position'])
```

This supports properties that are of primitive types, arrays, objects or any other serializable classes/types registered in the framework.

#### Custom toJSON/fromJSON

Instead of using typescript and decorators, custom classes can be marked as serializable if they include 4 items - 
- `.type` - a unique string type
- `.toJSON()` - method to serialize the object
- `.fromJSON()` - method to deserialize the object
- `constructor()` - empty constructor

For example, in three.js, classes like `Curve`, `Path`, `EllipseCurve`, `AnimationClip` etc. include these properties and are marked as serializable like this - 
```javascript
Serialization.SerializableClasses.set('Curve', Curve)
Serialization.SerializableClasses.set('Path', Path)
Serialization.SerializableClasses.set('EllipseCurve', EllipseCurve)
Serialization.SerializableClasses.set('AnimationClip', AnimationClip)
```

With this, whenever a json object with a specific type is found, it is automatically deserialized using the `fromJSON` method of the class.

### Advanced

Its possible to completely customize the serialization and deserialization process for any object, type, classes etc, by registering a custom serializer.

A simple sample for `WebGLRenderTarget`. This is just provided as reference, a complete implementation is built-in in threepipe.
```typescript
Serialization.RegisterSerializer({
    priority: 2,
    isType: (obj: any) => obj.isWebGLRenderTarget || obj.metadata?.type === 'RenderTarget',
    serialize: (obj: IRenderTarget, meta?: SerializationMetaType) => {
        if (!obj?.isWebGLRenderTarget || !obj.uuid) throw new Error('Expected a IRenderTarget')
        if (meta?.extras[obj.uuid]) return {uuid: obj.uuid, resource: 'extras'}

        // This is for the class implementing IRenderTarget, check {@link RenderTargetManager} for class implementation
        const tex = Array.isArray(obj.texture) ? obj.texture[0] : obj.texture
        let res: any = {
            metadata: {type: 'RenderTarget'},
            uuid: obj.uuid,
            width: obj.width,
            height: obj.height,
            depth: obj.depth,
            count: obj.count,
            // ... other properties
        }

        if (meta?.extras) {
            if (!meta.extras[res.uuid]) meta.extras[res.uuid] = res
            res = {uuid: res.uuid, resource: 'extras'}
        }
        return res
    },
    deserialize: (dat: any, obj: IRenderTarget, meta?: SerializationMetaType) => {
        if (obj?.uuid === dat.uuid) return obj
        if (dat.isWebGLRenderTarget) return dat

        const renderManager = meta?._context.renderManager
        const res = renderManager.createTarget({
            size: {width: dat.width, height: dat.height},
            textureCount: dat.count,
            ...dat.options,
        })
        if (!res) return res
        res.uuid = dat.uuid
        if (meta?.extras) meta.extras[dat.uuid] = res
        return res
    },
})
```


## Resources and the meta object

Large and shared resources are not saved inline in the JSON. `toJSON` and `ThreeSerialization.Serialize` take a `meta` object ([SerializationMetaType](https://threepipe.org/docs/interfaces/SerializationMetaType.html), see `getEmptyMeta()`), which has a map, keyed by uuid, for each kind of resource: `geometries`, `materials`, `textures`, `images`, `shapes`, `skeletons`, `animations`, `nodes`, `extras` and `typed`, and a `_context` with the asset importer, render manager, viewer etc., which is never saved.

The built-in serializers add the resource to its map (once per uuid) and return a reference to it:
- A texture is saved in `meta.textures` and referenced as `{uuid, resource: 'textures'}`. Its image data goes in `meta.images`, the texture refers to it by uuid, like in three.js `Texture.toJSON`. A texture with a remote `userData.rootPath` is saved without the image (unless `userData.embedUrlImagePreviews` is set) and loaded from the url again on import. Render target textures are not serialized.
- A material is saved in `meta.materials` and referenced as `{uuid, resource: 'materials'}`.
- Others are saved in `meta.extras` and referenced as `{uuid, resource: 'extras'}`, like render targets (size and options, not the pixels), and textures loaded from files like LUTs and KTX2 (`serializeTextureInExtras`), whose `url` is either the `rootPath` or the file contents as `{data, type, path}`.
- `typed` holds other objects saved by reference, like items of the `ReferenceManager`.

On deserialize, a `{uuid, resource}` reference is replaced with the loaded object from the same map.

### The resources section

The viewer (`viewer.toJSON()`, `viewer.exportConfig()`) and plugin configs (`viewer.exportPluginConfig()`, `viewer.exportPluginsConfig()`) serialize everything with a single meta, and then save it as the top-level `resources` of the file, with `metaToResources(meta)` (a copy without `_context`).

When the file is saved as JSON (`exportConfig()`, `exportPluginsConfig()`, or `toJSON(false)`), binary buffers in the resources (the `url.data` of items, typed arrays or `ArrayBuffer`) are first converted to base64 `data:application/octet-stream;base64,...` URIs with `convertArrayBufferToStringsInMeta`. `toJSON()` is binary by default; this is used for the viewer config in glTF/GLB exports, where `GLTFViewerConfigExtension` stores the buffers in the glTF buffers instead.

```json
{
  "type": "ThreeViewer",
  "version": "0.6.0",
  "metadata": {"generator": "ThreePipe", "version": 2},
  "scene": {"environment": {"uuid": "6a1f...", "resource": "textures"}},
  "plugins": [...],
  "resources": {
    "textures": {"6a1f...": {...}},
    "images": {...},
    "materials": {},
    "extras": {}
  }
}
```

### Importing resources

`viewer.importConfig(json)` first loads the `resources` with `viewer.loadConfigResources`, which calls `MetaImporter.ImportMeta`. It converts the base64 data URIs back to buffers and creates the objects in this order, so that each step can use the ones before it: `animations`, `shapes`, `geometries`, `images`, `textures` (also loading the `rootPath` textures with the asset importer), `materials`, `object` (and `skeletons`), `extras` (deserialized, or imported from their `url` when set), and `typed`.

The result is a new meta marked as loaded (`__isLoadedResources: true`), which is then passed to `fromJSON`. `viewer.fromJSON(json, meta)` expects such a meta (or `json.resources` already loaded), otherwise it logs an error and returns `null`. So use `viewer.importConfig` (or `viewer.importPluginConfig`) for a file, or load the resources first.

```typescript
const meta = await viewer.loadConfigResources(json.resources || {})
viewer.fromJSON(json, meta)
// same as
await viewer.importConfig(json)
```

## Versioning

A viewer config saves two versions:
- `version`: the threepipe version that saved it, `ThreeViewer.VERSION`.
- `metadata.version`: the config format version, currently `2`.

There is no general migration system that upgrades files between versions. Files from older versions are handled with targeted fixes where the format changed, for example:
- `ThreeViewer.fromJSON` moves the old top-level `background` and `backgroundIntensity` to the scene, and drops `useLegacyLights`.
- `RootScene.fromJSON` moves the environment rotation saved in the texture to `environmentRotation` for `ViewerApp` configs with `metadata.version` below 2.
- `iMaterialCommons` (material `setValues`) handles old color management and bump map scale using the `metadata.version` of the material JSON.

When changing what a custom class or plugin saves, keep reading the old properties in its `fromJSON`, as these do.
