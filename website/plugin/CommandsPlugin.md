---
prev:
    text: 'UndoManagerPlugin'
    link: './UndoManagerPlugin'

next:
    text: 'EditorViewWidgetPlugin'
    link: './EditorViewWidgetPlugin'

---

# CommandsPlugin

[Example](https://threepipe.org/examples/#commands-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/CommandsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CommandsPlugin.html)

CommandsPlugin is a registry of actions: the commands that a person runs from a key, a toolbar, a context menu or a command palette. Plugins register their actions and keys once, and any UI lists and runs them. The plugin has no UI of its own (only a `Commands` folder in its `uiConfig`), so a plain viewer gets the shortcuts too.

An action (`CommandAction`) has:

| Field | What it is |
|---|---|
| `id` | A unique id, like `'undo'`. A new action with the same id replaces the old one. |
| `label` | The name in a menu or a tooltip |
| `icon` | Optional. An SVG string or an icon name, for a UI |
| `shortcut` | Optional. The key, like `'Mod+Z'`, `'Shift+D'` or `'Delete'` (see below) |
| `group` | Optional. A group for a UI, like `'Edit'` or `'Camera'` |
| `repeat` | Optional. A held key runs the action again on each repeat. Default: once per press |
| `enabled()` | Optional. The action can run now. Default: always |
| `run()` | Runs the action. It can return (or resolve to) `{error?: string, warn?: string}` for the person |

```typescript
import {ThreeViewer, CommandsPlugin, formatShortcut} from 'threepipe'

const viewer = new ThreeViewer({...})
const commands = viewer.addPluginSync(CommandsPlugin)

const unregister = commands.register([{
    id: 'autoRotate', label: 'Auto rotate', group: 'View', shortcut: 'Shift+R',
    run: () => {
        const controls = viewer.scene.mainCamera.controls
        if (!controls) return {warn: 'The camera has no controls'}
        controls.autoRotate = !controls.autoRotate
    },
}, {
    id: 'upload', label: 'Upload', group: 'File', shortcut: 'Shift+U',
    run: async() => (await upload()) ? undefined : {error: 'The upload failed'},
}])

commands.list('View') // the actions of a group, in the order they were registered
commands.get('upload') // one action
await commands.run('upload') // runs it, resolves to its result ({} when it told nothing)
formatShortcut('Mod+Shift+Z') // '⇧⌘Z' on a Mac, 'Ctrl+Shift+Z' on other platforms

commands.addEventListener('actionRun', ({action, result}) => {
    if (result.error) showError(result.error)
})
commands.addEventListener('actionsChange', () => rebuildMenus())

commands.unregister('upload')
unregister() // removes the actions of that register call
```

## Shortcuts

A shortcut is modifiers and a key, joined with `+`: `Mod+Z`, `Shift+D`, `Alt+Shift+T`, `Delete`, `Escape`, `Mod++`.

- `Mod` is Cmd on a Mac (also an iPhone or an iPad with a keyboard) and Ctrl on other platforms. The other one of the two matches no shortcut: Ctrl+Z on a Mac is not `Mod+Z`. The other modifiers are `Shift` and `Alt`. A key press must have the same modifiers: `Mod+Z` does not run on Ctrl+Shift+Z.
- The key is a key name (`Z`, `Delete`, `Escape`, `\`) or a [`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/code) (`KeyC`, `Digit1`, `Backslash`).
- A key name matches the character of the key in any case, or, for a letter, a digit or a sign, the place of that key on a US keyboard. So `Mod+Z` also works on a keyboard with other letters (Cyrillic, Greek), and `Alt+T` works on a Mac, where Alt changes the character.
- A code matches only that place on the keyboard: `KeyC` is the key at the place of C, whatever it types.
- A sign that needs Shift names Shift: `Shift+/` for `?`.

One `keydown` listener on the window runs the shortcuts of all the actions:

- It leaves a key typed in a text field (an input that takes text, a text area, a select, an editable element; not a checkbox, a radio button, a button, a colour or a file input, which keep the focus after a click) and a key that another handler used (`defaultPrevented`).
- It runs an action only when `enabled()` is not `false`, and calls `preventDefault` only when an action runs.
- An action can have more keys: `shortcut: ['Delete', 'Backspace']`.
- When two enabled actions have the same key, the one with the higher `priority` runs (default `0`), then the one registered last. An action that ends a mode (Escape that ends the pivot edit, `priority: 1`) is above one that acts on the selection (Escape that clears it).
- While the plugin is disabled (`enabled = false` or `disable(key)`), the keys do nothing. `run(id)` still runs an action.
- With more viewers on the page, a key is for the viewer that has the focus (the target is its canvas or in its container). When the focus is in no viewer (the page, a side panel), the viewer with the last pointer press takes it. A viewer that left the page takes no key while another one is on it (`viewerTakesKey(viewer, event)`).

**The app sets the keys in one place.** `setShortcut(id, keys)` changes the key of an action (also of one that is registered later or again): another key, more keys, or `null` for none; `undefined` gives the action its own key again. `shortcutOf(id)` is the key now. `enabled = false` turns all the keys off, for an app with its own keymap.

```typescript
commands.setShortcut('picking.delete', 'Delete') // not Backspace too
commands.setShortcut('transformControls.toggleEnabled', null) // Space does nothing
```

**Toasts.** The `error` and the `warn` of each run show in a toast of the viewer dialog (`viewer.dialog.toast`, in the viewer container), while `toastResults` is on (default). The UI plugins (`TweakpaneUiPlugin`, `BlueprintJsUiPlugin`) use the HTML dialog of `ts-browser-helpers`, which shows a small chip at the top centre; without one, the message goes to the console.

The helpers `parseShortcut`, `matchShortcut`, `formatShortcut`, `isTextTarget`, `shortcutsOf` and `viewerTakesKey` are exported for other UIs.

## Plugins that work with and without it

`bindActions(viewer, actions)` binds the actions of a plugin or a UI: while the viewer has a `CommandsPlugin` (also one added or removed later), the actions are registered there; else a key listener of their own runs their shortcuts, with the same rules. So each key has one implementation, and the behaviour without the plugin stays the same.

```typescript
import {bindActions, CommandAction} from 'threepipe'

class MyPlugin extends AViewerPluginSync {
    static readonly PluginType = 'MyPlugin'
    enabled = true
    readonly actions: CommandAction[] = [
        {id: 'my.toggle', label: 'Toggle', shortcut: 'KeyT', enabled: () => !this.isDisabled(), run: () => this.toggle()},
    ]
    private _unbind?: () => void
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._unbind = bindActions(viewer, this.actions)
    }
    onRemove(viewer: ThreeViewer) {
        this._unbind?.()
        super.onRemove(viewer)
    }
}
```

These plugins bind their keys this way (the ids, for `setShortcut`):

| Plugin | Actions | Keys |
|---|---|---|
| `PickingPlugin` | `picking.selectAll`, `duplicate`, `duplicateOther`, `copy`, `cut`, `paste`, `clearSelection`, `delete`, `toggleVisibility`, `unhideAll`, `focus`, `resetPosition`, `resetRotation`, `resetScale` | Mod+A, Mod+D, Mod+Shift+D, Mod+C, Mod+X, Mod+V, Escape, Delete or Backspace, H, Shift+H, F, Alt+G, Alt+R, Alt+S |
| `UndoManagerPlugin` | `undo`, `redo` | Mod+Z; Mod+Shift+Z or Mod+Y |
| `TransformControlsPlugin` (`TransformControls2.actions`) | `transformControls.translate`, `rotate`, `scale`, `toggleSpace`, `larger`, `smaller`, `toggleX`, `toggleY`, `toggleZ`, `toggleEnabled` | W, E, R, Q, + or =, -, X, Y, Z, Space |
| `PivotControlsPlugin` (`PivotControls.actions`) | `pivotControls.toggleSpace`, `larger`, `smaller`, `toggleX`, `toggleY`, `toggleZ`, `toggleEnabled` | Q, + or =, -, X, Y, Z, Space |
| `PivotEditPlugin` | `pivotEdit.toggle`, `pivotEdit.end` | P, Escape |
| `AnnotationsPlugin` | `annotations.next`, `annotations.prev` | →, ← (while a card is open) |
| `EditorFrame` (tweakpane editor) | `editorFrame.toggleTheme`, `editorFrame.cycleModeBar` | Shift+T, Mod+\\ |
| `EditorCameraPlugin` (tweakpane editor) | `editorCamera.toggleEditing` | C |

The keys of a gizmo work while it is enabled and attached; the keys of the selection need a selection, except select all, paste, show all and focus (F frames everything with no selection). Keys that belong to an open popup (Escape that closes a card or a menu) and held keys (Shift that snaps a gizmo) stay with their element.

The plugin is not saved with the viewer config (`serializeWithViewer` is `false`).
