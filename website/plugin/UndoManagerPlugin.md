---
prev:
    text: 'ObjectConstraintsPlugin'
    link: './ObjectConstraintsPlugin'

next:
    text: 'EditorViewWidgetPlugin'
    link: './EditorViewWidgetPlugin'
---

# UndoManagerPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#transform-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/UndoManagerPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/UndoManagerPlugin.html)

UndoManagerPlugin adds support for undo/redo operations in the viewer. 
It can be used to manage the history of changes made to the scene, objects, materials, etc.

It uses the [`JSUndoManager`](https://github.com/repalash/ts-browser-helpers/blob/master/src/JSUndoManager.ts)(from [ts-browser-helpers](https://repalash.com/ts-browser-helpers)) to maintain a common undo/redo history across the viewer and other plugins.

The plugin is used automatically by `TweakpaneUiPlugin`, `BlueprintJsUiPlugin`, `PickingPlugin`, `TransformControlsPlugin`, and other plugins that support undo/redo operations.
It is not _required_ to be added to the viewer explicitly when using any of the UI plugins, but can be added if you want to use it directly.

**Keys.** Mod+Z undoes, Mod+Shift+Z and Mod+Y redo (Mod: Cmd on a Mac, Ctrl on other platforms); a held key repeats them. The keys are letters, so they follow the printed key on any layout, and they do nothing while the plugin is disabled. They are actions (`undo`, `redo` in `UndoManagerPlugin.actions`), registered in [`viewer.actions`](../guide/viewer-api#actions-and-shortcuts): a UI lists them, and the app changes or removes their keys there (`setShortcut`). A key typed in a text field is left to the field, for its own text undo; a checkbox or a button has no text, so the key undoes there.

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
