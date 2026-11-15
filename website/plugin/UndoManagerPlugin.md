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

## Undo and Redo

`undo()` and `redo()` step through the shared history. The plugin also binds hot keys on the `document`: **Ctrl/Cmd+Z** to undo, **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** to redo.

```typescript
const undoPlugin = viewer.getPlugin(UndoManagerPlugin)!
undoPlugin.undo()
undoPlugin.redo()

undoPlugin.enabled = false // stop recording and ignore undo/redo and the hot keys
undoPlugin.limit = 200 // maximum number of steps kept in the history, default 1000
```

## Commands

A command is either an object with `undo` and `redo` functions, or an object with a `type` naming a preset registered in `undoManager.presets`, which turns it into `undo`/`redo` functions when it is undone or redone. The plugin registers two presets, `ThreeViewerUM_set` and `ThreeViewerUM_action` (see `undoCommandTypes`), used by `setValue` and `performAction` below.

`undoManager.record(command)` adds a step without running it, the change is expected to be done already. `recordUndo(command)` records a preset command the same way, and merges consecutive `setValue` commands (see below).

```typescript
const obj = viewer.scene.getObjectByName('box')!
const oldPosition = obj.position.clone()
obj.position.set(1, 0, 0)
const newPosition = obj.position.clone()

undoPlugin.undoManager?.record({
    undo: () => { obj.position.copy(oldPosition); obj.setDirty() },
    redo: () => { obj.position.copy(newPosition); obj.setDirty() },
})
```

### setValue

`setValue(binding, value, props, uid)` sets `binding[0][binding[1]] = value` and records a `ThreeViewerUM_set` step that restores the previous value on undo.

Consecutive `setValue` calls with the same `uid` within `undoEditingWaitTime` (2000 ms) are merged into a single step (the last step is replaced, keeping the first value), as long as the previous call was not final. A call is final unless `props.last` is `false`, so pass `last: false` while the value is still changing (e.g. dragging a slider) and `last: true` when done.

```typescript
const material = obj.material as PhysicalMaterial
const uid = 'material-roughness' // any value that identifies the property, like the ui config

undoPlugin.setValue([material, 'roughness'], 0.3, {last: false}, uid)
undoPlugin.setValue([material, 'roughness'], 0.4, {last: false}, uid)
undoPlugin.setValue([material, 'roughness'], 0.5, {last: true}, uid)
// one step in the history, undo sets roughness back to its value before the first call
```

`setValues(bindings, defaults, values, props, uid)` does the same for several bindings in one step, `defaults` are the values used for a binding whose target property is not defined.

```typescript
undoPlugin.setValues([[material, 'roughness'], [material, 'metalness']], [1, 0], [0.5, 1], {last: true}, 'material-rm')
```

### performAction

`performAction(target, fn, args, uid)` calls `fn` (with `this` as `target`, if not `undefined`) and records a `ThreeViewerUM_action` step. `fn` returns either
- an undo function, then redo calls `fn` again, or
- an object `{undo, redo?, action?}`. If `action` is set, it is called right away and is used as `redo` when `redo` is not set.

Nothing is recorded if no undo function is returned.

```typescript
await undoPlugin.performAction(undefined, () => {
    const child = new Mesh2(new BoxGeometry(), new PhysicalMaterial())
    return {
        action: () => viewer.scene.addObject(child),
        undo: () => child.removeFromParent(),
    }
}, [], 'add-box')
```

## Using in plugins

Other plugins get the shared manager with `viewer.forPlugin`, which calls the first function when the plugin is added (or right away if it is already added) and the second when it is removed. Pass the calling plugin as the last argument to also unmount when it is removed. This is how `PickingPlugin`, `TransformControlsPlugin` and others record their steps.

```typescript
class MyPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'MyPlugin'
    undoManager?: JSUndoManager

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um)=> {
            this.undoManager = um.undoManager
        }, ()=> this.undoManager = undefined, this)
    }
}
```
