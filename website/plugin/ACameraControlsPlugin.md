---
prev:
    text: 'AAssetManagerProcessStatePlugin'
    link: './AAssetManagerProcessStatePlugin'

next:
    text: 'BaseGroundPlugin'
    link: './BaseGroundPlugin'

aside: false
---

# ACameraControlsPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/ACameraControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ACameraControlsPlugin.html)

Abstract base plugin for registering custom camera controls. Subclasses provide a controls constructor and a unique key. When the plugin is added to the viewer, the controls mode becomes available on the camera. Users activate it by setting `camera.controlsMode` to the key.

The built-in `'orbit'` mode (using `OrbitControls3`) is always available without any plugin. This base class is for adding **additional** control modes like first-person, device orientation, pointer lock, etc.

## Creating a Custom Controls Plugin

A subclass needs exactly three things:

```typescript
import {ACameraControlsPlugin, TControlsCtor} from 'threepipe'

export class MyControlsPlugin extends ACameraControlsPlugin {
    public static readonly PluginType = 'MyControlsPlugin'

    // Unique key — users set camera.controlsMode to this string
    readonly controlsKey = 'myControls'

    // Factory function that creates the controls instance
    protected _controlsCtor: TControlsCtor = (camera, domElement) => {
        return new MyCustomControls(camera, domElement)
    }
}
```

The controls class must implement `ICameraControls`, which extends `IUiConfigContainer` and `EventDispatcher`:

```typescript
interface ICameraControls extends IUiConfigContainer, EventDispatcher {
    object: Object3D        // The camera being controlled
    enabled: boolean        // Whether controls are active
    domElement?: HTMLElement | Document
    dispose(): void         // Cleanup
    update(): void          // Called each frame
    // Optional:
    target?: Vector3
    autoRotate?: boolean
    minDistance?: number
    maxDistance?: number
    minZoom?: number
    maxZoom?: number
    enableDamping?: boolean
    enableZoom?: boolean
    enableRotate?: boolean
}
```

## Using a Controls Plugin

**Step 1** — Add the plugin (registers the controls mode on the camera):

```typescript
import {ThreeViewer, DeviceOrientationControlsPlugin} from 'threepipe'

const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})
viewer.addPluginSync(DeviceOrientationControlsPlugin)
```

**Step 2** — Activate the controls mode:

```typescript
viewer.scene.mainCamera.controlsMode = 'deviceOrientation'
```

**Switch back to orbit:**

```typescript
viewer.scene.mainCamera.controlsMode = 'orbit'
```

The camera's UI dropdown (in Tweakpane or other UI) automatically shows all registered modes.

## How It Works

1. On `onAdded`: calls `camera.setControlsCtor(controlsKey, _controlsCtor)` on the current main camera, registering the mode
2. Listens to `'mainCameraChange'` on the scene — when the main camera switches, it unregisters from the old camera and registers on the new one
3. On `onRemove`: calls `camera.removeControlsCtor(controlsKey)` to clean up
4. When a user sets `camera.controlsMode = 'someKey'`, the camera looks up the factory in its `controlsCtors` map, creates the controls instance, disposes the old controls, and enables the new ones

## Properties

| Property | Type | Description |
|---|---|---|
| `enabled` | `boolean` (readonly) | Always `true`. The plugin is either registered (added) or not (removed). |
| `toJSON` | `undefined` | Explicitly disabled — the plugin has no state to serialize. The camera's `controlsMode` property (which is serialized) is what persists the active mode. |
| `controlsKey` | `string` (abstract) | Unique identifier for the controls mode. |
| `_controlsCtor` | `TControlsCtor` (abstract) | Factory: `(camera, domElement?) => ICameraControls`. |

## Built-in Subclasses

| Plugin | controlsKey | Controls Class | Description |
|---|---|---|---|
| [DeviceOrientationControlsPlugin](./DeviceOrientationControlsPlugin) | `'deviceOrientation'` | `DeviceOrientationControls2` | Gyroscope-based camera control for mobile devices |
| [PointerLockControlsPlugin](./PointerLockControlsPlugin) | `'pointerLock'` | `PointerLockControls2` | Mouse-locked first-person camera |
| [ThreeFirstPersonControlsPlugin](./ThreeFirstPersonControlsPlugin) | `'threeFirstPerson'` | `FirstPersonControls2` | Keyboard + mouse first-person camera |

External packages also provide subclasses:
- `EnvironmentControlsPlugin` (`'environment'`) — from `@threepipe/plugin-3d-tiles-renderer`
- `GlobeControlsPlugin` (`'globe'`) — from `@threepipe/plugin-3d-tiles-renderer`

## Example: DeviceOrientationControlsPlugin

The simplest concrete subclass (10 lines):

```typescript
import {ACameraControlsPlugin} from '../base/ACameraControlsPlugin'
import {TControlsCtor} from '../../core'
import {DeviceOrientationControls2} from '../../three'

export class DeviceOrientationControlsPlugin extends ACameraControlsPlugin {
    public static readonly PluginType = 'DeviceOrientationControlsPlugin'
    readonly controlsKey = 'deviceOrientation'
    protected _controlsCtor: TControlsCtor = (object, _domElement) => new DeviceOrientationControls2(object)
}
```

## Related Plugins

- [DeviceOrientationControlsPlugin](./DeviceOrientationControlsPlugin) — Gyroscope controls
- [PointerLockControlsPlugin](./PointerLockControlsPlugin) — Pointer lock controls
- [ThreeFirstPersonControlsPlugin](./ThreeFirstPersonControlsPlugin) — First-person controls
