---
prev:
    text: 'Serialization'
    link: './serialization'

next:
    text: 'Material Extension'
    link: './material-extension'
---

# Plugin System

Plugins are the building blocks of features in a 3D Viewer. Each plugin handles its own individual feature along with serialisation and lifecycle management. Threepipe uses a plugin system to add new options, rendering styles, post-processing passes, and more functionality. The plugin architecture is designed similar to other js frameworks like vue or webpack (but for 3d rendering).

::: tip
Check the pages on [Core Plugins](./core-plugins) and [@threepipe Packages](./threepipe-packages) for a list of available plugins.
:::

All plugins follow the same basic structure, independent of the logic, with the API to add and remove plugins being always consistent (and one-liner). This makes it easy to debug, bundle, tree-shake, serialisation/deserialisation and extend functionality to the 3d viewer. It is also recommended to keep individual plugins small and handle one specific functionality.

Plugins can be dependent on other plugins. These dependencies are automatically resolved and added to the viewer at runtime. e.g. `SSAOPlugin` depends on `GBufferPlugin` to get the depth and normal data. So, when `SSAOPlugin` is added to the viewer, it automatically adds `GBufferPlugin` before that (if not added already).

::: info Note
Plugin dependencies are different from pass/filter dependencies, which specifies how passes should be arranged in the render pipeline (effect composer).
:::

Threepipe ships with a library of internal and external plugins to achieve photorealistic rendering, generating user interfaces, handling events, loading and exporting assets, building 3d models etc.

The plugins can be added synchronously or asynchronously using `viewer.addPluginSync` and `viewer.addPlugin` methods respectively.

It is recommended to create custom plugins for reusable features, as they provide built-in features for ui configuration, serialization, integration with editors etc. and are easy to manage and tree-shake in the code.

Check out the list of plugins in the [Core Plugin](./core-plugins) and [@threepipe Packages](./threepipe-packages) pages.

To create new plugins, simply implement the `IViewerPlugin` interface or extend the [AViewerPluginSync](https://threepipe.org/docs/classes/AViewerPluginSync.html) or [AViewerPluginAsync](https://threepipe.org/docs/classes/AViewerPluginAsync.html) classes.
The only difference is that in async the `onAdded` and `onRemove` functions are async.

Here is a sample plugin
```typescript
@uiFolder("Sample Plugin") // This creates a folder in the Ui. (Supported by TweakpaneUiPlugin)
export class SamplePlugin extends AViewerPluginSync<"sample-1" | "sample-2"> {
  // These are the list of events that this plugin can dispatch.
  static readonly PluginType = "SamplePlugin"; // This is required for serialization and handling plugins. Also used in viewer.getPluginByType()

  @uiToggle() // This creates a checkbox in the Ui. (Supported by TweakpaneUiPlugin)
  @serialize() // Adds this property to the list of serializable. This is also used when serializing to glb in AssetExporter.
  enabled = true;

  // A plugin can have custom properties.

  @uiSlider("Some Number", [0, 100], 1) // Adds a slider to the Ui, with custom bounds and step size (Supported by TweakpaneUiPlugin)
  @serialize("someNumber")
  @onChange(SamplePlugin.prototype._updateParams) // this function will be called whenevr this value changes.
  val1 = 0;

  // A plugin can have custom properties.
  @uiInput("Some Text") // Adds a slider to the Ui, with custom bounds and step size (Supported by TweakpaneUiPlugin)
  @onChange(SamplePlugin.prototype._updateParams) // this function will be called whenevr this value changes.
  @serialize()
  val2 = "Hello";

  @uiButton("Print Counters") // Adds a button to the Ui. (Supported by TweakpaneUiPlugin)
  public printValues = () => {
    console.log(this.val1, this.val2);
    this.dispatchEvent({ type: "sample-1", detail: { sample: this.val1 } }); // This will dispatch an event.
  }

  constructor() {
    super();
    this._updateParams = this._updateParams.bind(this);
  }

  private _updateParams() {
    console.log("Parameters updated.");
    this.dispatchEvent({ type: "sample-2" }); // This will dispatch an event.
  }

  onAdded(v: ThreeViewer): void {
    super.onAdded(v);

    // Do some initialization here.
    this.val1 = 0;
    this.val2 = "Hello";

    v.addEventListener("preRender", this._preRender);
    v.addEventListener("postRender", this._postRender);
    v.addEventListener("preFrame", this._preFrame);
    v.addEventListener("postFrame", this._postFrame);

    this._viewer!.scene.addEventListener("addSceneObject", this._objectAdded); // this._viewer can also be used while this plugin is attached.
  }

  onRemove(v: ThreeViewer): void {
    // remove dispose objects

    v.removeEventListener("preRender", this._preRender);
    v.removeEventListener("postRender", this._postRender);
    v.removeEventListener("preFrame", this._preFrame);
    v.removeEventListener("postFrame", this._postFrame);

    this._viewer!.scene.removeEventListener("addSceneObject", this._objectAdded); // this._viewer can also be used while this plugin is attached.

    super.onRemove(v);
  }

  private _objectAdded = (ev: IEvent<any>) => {
    console.log("A new object, texture or material is added to the scene.", ev.object);
  };
  private _preFrame = (ev: IEvent<any>) => {
    // This function will be called before each frame. This is called even if the viewer is not dirty, so it's a good place to do viewer.setDirty()
  };
  private _preRender = (ev: IEvent<any>) => {
    // This is called before each frame is rendered, only when the viewer is dirty.
  };
  // postFrame and postRender work the same way as preFrame and preRender.
}
```

Notes:
* All plugins that are present in the dependencies array when the plugin is added to the viewer, are created and attached to the viewer in `super.onAdded`
* Custom events can be dispatched with `this.dispatchEvent`, and subscribed to with `plugin.addEventListener`. The event type must be described in the class signature for typescript autocomplete to work.
* Event listeners and other hooks can be added and removed in `onAdded` and `onRemove` functions for the viewer and other plugins.
* To the viewer render the next frame, `viewer.setDirty()` can be called, or set `this.dirty = true` in preFrame and reset in postFrame to stop the rendering. (Note that rendering may continue if some other plugin sets the viewer dirty like `ProgressivePlugin` or any of the animation plugins). Check `isConverged` in `ProgressivePlugin` to check if it's the final frame.
* All Plugins which inherit from AViewerPlugin support serialisation. Create property `serializeWithViewer = false` to disable serialisation with the viewer in config and glb or `toJSON: any = undefined` to disable serialisation entirely
* `plugin.toJSON()` and `plugin.fromJSON()` or `ThreeSerialization` can be used to serialize and deserialize plugins. `viewer.exportPluginConfig` and `viewer.importPluginConfig` also exist for this.
* `@serialize('label')` decorator can be used to mark any public/private variable as serializable. label (optional) corresponds to the key in JSON.
* `@serialize` supports instances of ITexture, IMaterial, all primitive types, simple JS objects, three.js math classes(`Vector2`, `Vector3`, `Matrix3`...), and some more.
* `@ui...` decorators can be used to mark properties and functions that will be shown in the Ui. The Ui shows up automatically when `TweakpaneUiPlugin`/`BlueprintJsUiPlugin` is added to the viewer. Plugins have special features in the UI for download preset and saving state.

Check various plugins in the source code for more examples.
