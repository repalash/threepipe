---
prev:
    text: 'BaseImporterPlugin'
    link: './BaseImporterPlugin'

next:
    text: 'AScreenPassExtensionPlugin'
    link: './AScreenPassExtensionPlugin'

aside: false
---

# PipelinePassPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/PipelinePassPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PipelinePassPlugin.html)

Abstract base plugin for registering custom render passes in the pipeline. Subclasses implement `_createPass()` to create a pass with ordering constraints (`before`, `after`, `required`). The pass is automatically registered/unregistered with the `RenderManager` on plugin add/remove.

For screen-space shader effects that modify the final output (vignette, grain, etc.), see [AScreenPassExtensionPlugin](./AScreenPassExtensionPlugin) instead — it injects into the existing ScreenPass rather than adding a new pipeline pass.

## Creating a Custom Pipeline Pass Plugin

```typescript
import {PipelinePassPlugin} from 'threepipe'
import type {IPipelinePass} from 'threepipe'

export class MyBufferPlugin extends PipelinePassPlugin<MyPass, 'myBuffer'> {
    static readonly PluginType = 'MyBufferPlugin'
    readonly passId = 'myBuffer'

    protected _createPass(): MyPass {
        const target = this._viewer!.renderManager.createTarget({sizeMultiplier: 1})
        const pass = new MyPass(this.passId, target)

        // Ordering: run before main render, after nothing, require render pass exists
        pass.before = ['render']
        pass.after = []
        pass.required = ['render']

        return pass
    }

    onRemove(viewer: ThreeViewer) {
        // Dispose render targets before super.onRemove disposes the pass
        this._pass?.target?.dispose()
        super.onRemove(viewer)
    }
}
```

## Abstract Members

| Member | Type | Description |
|---|---|---|
| `passId` | `TPassId` | Unique string identifier for the pass (e.g., `'depth'`, `'ssao'`) |
| `_createPass()` | `protected abstract` | Factory method to create the pass instance. Called in `onAdded`. |

## Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Toggles the pass. Serializable, UI-exposed. Changes trigger `setDirty()`. |
| `pass` | `T \| undefined` | — | Read-only accessor for the internal pass instance. |

## Pass Ordering

Each pass declares its position in the pipeline via three arrays:

```typescript
pass.before = ['render']    // This pass runs BEFORE the 'render' pass
pass.after = ['gbuffer']    // This pass runs AFTER the 'gbuffer' pass
pass.required = ['render']  // The 'render' pass must exist in the pipeline
```

The `RenderManager` sorts all passes topologically based on these constraints. The default pipeline has two built-in passes: `'render'` (scene rendering) and `'screen'` (final output).

Typical ordering:
```
depth/normal/gbuffer → ssao → render → frameFade → progressive → screen
```

## Lifecycle

**`onAdded(viewer)`**:
1. Creates the pass via `_createPass()`
2. Wires `viewer.setDirty` into `pass.onDirty[]`
3. Wraps `pass.beforeRender` to call `_beforeRender()` first
4. Registers the pass via `viewer.renderManager.registerPass(pass)`

**`onRemove(viewer)`**:
1. Unregisters via `viewer.renderManager.unregisterPass(pass)`
2. Disposes the pass
3. Sets `_pass = undefined`

**`_beforeRender()`**: Called every frame before the pass renders. Sets `pass.enabled = !this.isDisabled()`. Subclasses override for per-frame logic.

**`setDirty()`**: Sets `pass.enabled` from `isDisabled()`, triggers viewer re-render, and refreshes UI.

## Serialization

Both the plugin's `enabled` state and the pass's own properties are serialized. The pass is stored under the key `'pass'` in the JSON output, so pass-level settings (like SSAO intensity or progressive blend count) are automatically saved/restored.

## Built-in Subclasses

| Plugin | passId | Description |
|---|---|---|
| [DepthBufferPlugin](./DepthBufferPlugin) | `'depth'` | Renders scene depth to a buffer |
| [NormalBufferPlugin](./NormalBufferPlugin) | `'normal'` | Renders world-space normals to a buffer |
| [GBufferPlugin](./GBufferPlugin) | `'gbuffer'` | Multi-target G-buffer (flags, depth, normals) |
| [SSAOPlugin](./SSAOPlugin) | `'ssao'` | Screen-space ambient occlusion |
| [ProgressivePlugin](./ProgressivePlugin) | `'progressive'` | Progressive temporal blending |
| [FrameFadePlugin](./FrameFadePlugin) | `'frameFade'` | Smooth frame transitions |

## Related

- [Render Pipeline](../guide/render-pipeline) — Guide on the rendering pipeline architecture
- [AScreenPassExtensionPlugin](./AScreenPassExtensionPlugin) — For screen-space shader effects without a new pass
