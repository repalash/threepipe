---
prev:
    text: 'TailwindCSSCDNPlugin'
    link: './TailwindCSSCDNPlugin'

next:
    text: 'ACameraControlsPlugin'
    link: './ACameraControlsPlugin'

aside: false
---

# AAssetManagerProcessStatePlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/AAssetManagerProcessStatePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/AAssetManagerProcessStatePlugin.html)

Abstract base plugin for displaying asset loading/processing state. It creates a DOM overlay container, subscribes to the viewer's `AssetManager` process state updates, and calls a subclass-provided `_updateMainDiv` method whenever the state changes. This implements the **Template Method** pattern — the base class handles all wiring while subclasses only define how to render the state.

The built-in [LoadingScreenPlugin](./LoadingScreenPlugin) extends this class to provide a full loading screen with spinners, progress bars, and file names.

## Creating a Custom Loading UI

Subclasses must implement `_updateMainDiv` to render the process state into the DOM:

```typescript
import {AAssetManagerProcessStatePlugin} from 'threepipe'

class MyLoadingPlugin extends AAssetManagerProcessStatePlugin {
    static readonly PluginType = 'MyLoadingPlugin'

    constructor(container?: HTMLElement) {
        super('MyLoading', container)
        // suffix creates div IDs: 'assetManagerMyLoading' and 'assetManagerMyLoadingContent'
    }

    protected _updateMainDiv(
        processState: Map<string, {state: string, progress?: number}>
    ): void {
        if (processState.size === 0) {
            this._mainDiv.style.display = 'none'
            return
        }
        this._mainDiv.style.display = 'block'

        // Render each file's state into the content div
        let html = ''
        for (const [path, {state, progress}] of processState) {
            const pct = progress !== undefined ? ` (${Math.round(progress)}%)` : ''
            html += `<div>${path}: ${state}${pct}</div>`
        }
        this._contentDiv!.innerHTML = html
    }
}
```

## Process State Map

The `processState` parameter is a `Map<string, {state, progress?}>` where:

- **Key**: File path or resource URL (e.g., `'https://example.com/model.glb'`)
- **Value**: `{state: string, progress?: number}`
  - `state`: One of `'downloading'`, `'adding'`, `'processing'`, `'exporting'`, `'error'`
  - `progress`: Optional percentage (0-100), available during downloads

The AssetManager tracks these states automatically:
- `'downloading'` — file is being fetched (with progress updates)
- `'adding'` — file has been downloaded, being added to the scene
- `'processing'` — raw asset processing (e.g., glTF parsing)
- `'exporting'` — file is being exported (via `AssetExporter` or `FileTransferPlugin`)
- `'error'` — loading failed
- Entry is deleted when the operation completes successfully

## Constructor

```typescript
protected constructor(suffix: string, container?: HTMLElement)
```

- **`suffix`**: Used to generate unique HTML element IDs — `'assetManager' + suffix` for the main div and `'assetManager' + suffix + 'Content'` for the inner content div.
- **`container`**: Optional parent HTML element. If omitted, the plugin appends its overlay to `viewer.container` when added to the viewer. Pass a custom element to render the loading UI outside the 3D canvas area.

The constructor is `protected` — the class cannot be instantiated directly.

## Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Toggles visibility of the overlay. Serializable. When set to `false`, hides `_mainDiv`. |
| `_mainDiv` | `HTMLDivElement` | — | The outer container div (protected). Subclasses add styles and children to this. |
| `_contentDiv` | `HTMLDivElement \| undefined` | — | The inner content div (protected). Nested inside `_mainDiv`. Always assigned in constructor. |
| `container` | `HTMLElement \| undefined` | — | Custom parent element passed to constructor. Read-only. |

## Lifecycle

**`onAdded(viewer)`**:
1. Appends `_mainDiv` to `container ?? viewer.container`
2. Calls `_updateMainDiv` with the current process state immediately
3. Subscribes to `'processStateUpdate'` events on `viewer.assetManager`

**`onRemove(viewer)`**:
1. Removes `_mainDiv` from the DOM
2. Unsubscribes from `'processStateUpdate'` events

## Built-in Subclass: LoadingScreenPlugin

[LoadingScreenPlugin](./LoadingScreenPlugin) is the only built-in subclass. It provides:

- Configurable loading spinner, logo, and text
- Per-file progress display with state labels
- Auto-show when files start loading, auto-hide on completion
- Minimize mode when scene has objects but loading continues
- Customizable background opacity, blur, and colors
- Full serialization of all settings

```typescript
import {ThreeViewer, LoadingScreenPlugin} from 'threepipe'

const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})
const loading = viewer.addPluginSync(new LoadingScreenPlugin())

loading.loadingTextHeader = 'Loading Model'
loading.backgroundOpacity = 0.4
loading.backgroundBlur = 28
loading.showFileNames = true
loading.showProgress = true
```

## Related Plugins

- [LoadingScreenPlugin](./LoadingScreenPlugin) — Built-in loading screen overlay
- [FileTransferPlugin](./FileTransferPlugin) — Also feeds into the process state system for upload tracking
