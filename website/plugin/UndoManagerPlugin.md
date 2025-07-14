---
prev: 
    text: 'MeshOptSimplifyModifierPlugin'
    link: './MeshOptSimplifyModifierPlugin'

next: false
---

# UndoManagerPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#transform-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/rendering/UndoManagerPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/UndoManagerPlugin.html)

UndoManagerPlugin adds support for undo/redo operations in the viewer. 
It can be used to manage the history of changes made to the scene, objects, materials, etc.

It uses the [`JSUndoManager`](https://github.com/repalash/ts-browser-helpers/blob/master/src/JSUndoManager.ts)(from [ts-browser-helpers](https://repalash.com/ts-browser-helpers)) to maintain a common undo/redo history across the viewer and other plugins.

The plugin is used automatically by `TweakpaneUiPlugin`, `BlueprintJsUiPlugin`, `PickingPlugin`, `TransformControlsPlugin`, and other plugins that support undo/redo operations.
It is not _required_ to be added to the viewer explicitly when using any of the UI plugins, but can be added if you want to use it directly.

```typescript
viewer.addPlugin(UndoManagerPlugin)

let undoManager: JSUndoManager | undefined
// listen for plugin to be added/removed/changed
viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um)=> {
    undoManager = um.undoManager
}, ()=> undoManager = undefined)

// on button click
undoManager.record({
    // my command
})
```
