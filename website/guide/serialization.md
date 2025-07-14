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
