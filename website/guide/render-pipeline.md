---
prev:
    text: 'Exporting Files'
    link: './exporting-files'

next:
    text: 'UI Configuration'
    link: './ui-config'
---

# Render pipeline

Threepipe includes a [RenderManager](https://threepipe.org/docs/classes/RenderManager.html) for managing the composition pipeline, and provides helpers for rendering and render target management.

The `RenderManager` includes an [EffectComposer](https://threejs.org/docs/#api/en/postprocessing/EffectComposer) from three.js for rendering passes and a [WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer) for rendering, but the pass management and sorting is managed by the `RenderManager` itself.

The `RenderManager` inherits from [RenderTargetManager](https://threepipe.org/docs/classes/RenderTargetManager.html)
which provides utilities for creating, tracking and destroying dedicated and temporary render targets.

The main render pipeline supports progressive rendering and is fully configurable. Plugins and applications can add custom passes, effects, and shaders to the pipeline.

Plugins like [GBufferPlugin](https://threepipe.org/docs/classes/GBufferPlugin.html), [SSAOPlugin](https://threepipe.org/docs/classes/SSAOPlugin.html), [TonemapPlugin](https://threepipe.org/docs/classes/TonemapPlugin.html), etc. interact and extend the render pipeline by adding custom passes to the render pipeline and material extensions to the material manager.

## Render Targets

Render targets can be created
using the `viewer.renderManager.createTarget` and `viewer.renderManager.createTargetCustom` methods.
These can then be disposed using the `viewer.renderManager.disposeTarget` method when not needed anymore.

Or to create temp targets for one time/temporary use `viewer.renderManager.getTempTarget` and `viewer.renderManager.releaseTempTarget` methods can be used. All created render targets are tracked in the `RenderManager`, and are resized and disposed automatically when needed along with the viewer.

```typescript
const newTarget = viewer.renderManager.createTarget({sizeMultiplier: 1})
// or
const newTarget2 = viewer.renderManager.createTarget({size: {
    width: 1024,
    height: 1024,
  },
  type: HalfFloatType
})
// or clone an existing target
const newTarget3 = viewer.renderManager.composerTarget.clone()
// for multi-sample render target
const newTarget4 = viewer.renderManager.createTarget({sizeMultiplier: 1, samples: 4})

// or create a custom target
const newTarget5 = viewer.renderManager.createTargetCustom(
    {width: 1024, height: 1024},
    {type: HalfFloatType},
    WebGLCubeRenderTarget
)

// dispose targets
viewer.renderManager.disposeTarget(newTarget)
viewer.renderManager.disposeTarget(newTarget2)
viewer.renderManager.disposeTarget(newTarget3)
viewer.renderManager.disposeTarget(newTarget4)
viewer.renderManager.disposeTarget(newTarget5)

// get a temporary target
const tempTarget = viewer.renderManager.getTempTarget({sizeMultiplier: 1})
// release the temporary target
viewer.renderManager.releaseTempTarget(tempTarget)
```

::: tip
Render targets created with a `sizeMultiplier` are automatically resized when the canvas is resized.
:::

## Passes

By default, the render pipeline([`ViewerRenderManager`](https://threepipe.org/docs/classes/ViewerRenderManager.html) includes 2 passes -
[RenderPass](https://threepipe.org/docs/classes/ExtendedRenderPass.html) for rendering the scene hierarchy and [ScreenPass](https://threepipe.org/docs/classes/ScreenPass.html) for rendering the final output on the canvas.

More passes can be added and removed from the pipeline
using the [registerPass](https://threepipe.org/docs/classes/RenderManager.html#registerPass) and [unregisterPass](https://threepipe.org/docs/classes/RenderManager.html#unregisterPass) methods.

The pipeline passes need to follow the interface of [IPipelinePass](https://threepipe.org/docs/interfaces/IPipelinePass.html) and [PipelinePassPlugin](https://threepipe.org/docs/classes/PipelinePassPlugin.html).
Which adds some important parameters over the three.js Pass,
like pass id and support for defining where the pass should be added in the pipeline and it's dependants.

```typescript
const pass = new GBufferRenderPass('customPass', viewer.renderManager.createTarget({sizeMultiplier: 1}))
pass.before = ['render'] // Add the pass before the render pass
pass.after = [] // Add the pass after these passes (none in this case)
pass.required = ['render'] // render pass is required to be in the pipeline for this. throws an error if not found
viewer.renderManager.registerPass(pass)
```

::: info
See [PipelinePassPlugin](https://threepipe.org/docs/classes/PipelinePassPlugin.html) for an abstract plugin
that provides the boilerplate to create a plugin that registers a custom pass in the pipeline.
Check [NormalBufferPlugin](https://threepipe.org/docs/classes/NormalBufferPlugin.html) for an example of that.
:::

::: tip
All effects in post-processing or material extension need not be a separate pass in the pipeline.
Most effects can be achieved with either extending the scene object material shaders or the Screen Pass material shader using [Material extension](./material-extension) system
:::
