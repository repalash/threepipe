---
prev:
  text: 'Widgets, Helpers & Gizmos'
  link: './widgets-and-helpers'
next:
  text: 'Frame updates: last, debounce and throttle'
  link: './frame-updates'

aside: false
---

# Material Previews

A material preview is a small image of a material on a sphere, a cube or a given mesh, like the previews in a material inspector or in the variations of the [Material Configurator](../plugin/MaterialConfiguratorBasePlugin).

Threepipe renders the previews with the viewer's renderer, so a preview uses the same shaders and textures as the viewport. Three APIs build on each other:

- [`snapObject`](https://threepipe.org/docs/functions/snapObject.html), [`snapObjectPixels`](https://threepipe.org/docs/functions/snapObjectPixels.html) and [`snapObjectToCanvas`](https://threepipe.org/docs/functions/snapObjectToCanvas.html) render one object.
- [`MaterialPreviewGenerator`](https://threepipe.org/docs/classes/MaterialPreviewGenerator.html) renders a material on a shape or a geometry, in a private scene.
- [`MaterialPreviewPlugin`](https://threepipe.org/docs/classes/MaterialPreviewPlugin.html) makes previews for an inspector: request a preview on every material change, and the plugin renders it in the next frame (during a drag of a slider or an animation, at most every `dragInterval` ms).

Examples:
- [Material inspector](https://threepipe.org/examples/#material-preview/) ([source](https://github.com/repalash/threepipe/blob/master/examples/material-preview/script.ts)): every material of a model with its preview (sphere, cube or its own mesh); a click, or a pick in the viewport, selects a material and shows its settings and a large preview; "Animate colour" shows the previews during an animation.
- [Material lab](https://threepipe.org/examples/#material-preview-lab/) ([source](https://github.com/repalash/threepipe/blob/master/examples/material-preview-lab/script.ts)): a palette of materials (metals, car paint, velvet, pearl, glass), three of them animated, with the number of renders of each preview; a click puts a material on the vase; a benchmark compares the offscreen preview with the old full canvas snapshot.

## Live previews in an inspector

```typescript
import {MaterialPreviewPlugin, MaterialPreviewHandle, IMaterial} from 'threepipe'

const previews = viewer.addPluginSync(MaterialPreviewPlugin)

const canvas = document.createElement('canvas') // in the inspector panel
canvas.width = canvas.height = 256
let handle: MaterialPreviewHandle | undefined

function showPreview(material: IMaterial, shape: 'sphere' | 'cube' | 'mesh' = 'sphere', geometry?: BufferGeometry) {
    handle?.cancel()
    handle = previews.request(material, {shape, geometry, size: 256}, preview => {
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(preview.canvas, 0, 0)
        // or, for an <img>: img.src = preview.toDataURL()
    })
}

// request on every change; the plugin renders in the next frame, or at most every dragInterval ms during a drag or an animation
material.addEventListener('materialUpdate', () => showPreview(material))
showPreview(material)
```

What the plugin does:

- It renders in the viewer's `preFrame`, at most `maxPerFrame` previews per frame (default 1).
- While a material changes continuously, it renders at most once every `dragInterval` ms (default 32, about two frames at 60 fps; 0 for one preview per frame), and its last change renders too. A change is continuous when its `materialUpdate` has `last: false`, which uiconfig sends while a slider moves (`setDirty({last: false})` from your own inputs), or when it has no `last` and comes less than `dragInterval` ms after the previous change of the material: an animation (`AnimationObject`) or a material transition (`setValues` with a time, as the variations timeline of `MaterialConfiguratorBasePlugin` uses) changes the material in every frame. An animation that does not call the material's `setDirty` (`PopmotionPlugin.animateTarget` alone) sends no `materialUpdate`, so the preview does not follow it; call `material.setDirty()` in its `onUpdate`. A change with `last: true` (uiconfig sends it when the slider is released) renders in the next frame, and so does a change after a pause. See [Frame updates: last, debounce and throttle](./frame-updates).
- Requests for the same material, shape, geometry and size share one render.
- It caches the previews by material uuid, shape, geometry, size and a change counter of the material (the number of its `materialUpdate` events). The cache is also invalid after a change of the scene's environment map or of the tone mapping. A request for an unchanged material gets the cached preview in the next frame, without a render. `previews.invalidate(material)` removes the cached previews of a material.
- `request` returns a handle; `handle.cancel()` stops the callback (and the render, when no other request waits for it).
- The `mesh` shape renders the given geometry alone (for example the geometry of the selected mesh), with a camera fitted to its bounds.
- Its settings are in its UI (`Material Previews`, for example `ui.setupPluginUi(MaterialPreviewPlugin)` with the Tweakpane UI): `enabled`, `size` (the default size, 256), `maxPerFrame`, `dragInterval` and `maxCacheSize` (32). They are not saved with the viewer. While it is disabled, the requests wait.

The callback gets a [`MaterialPreview`](https://threepipe.org/docs/interfaces/MaterialPreview.html): `canvas` (the cheapest output, no image encoding), `toDataURL()` (a png, encoded on the first call), `renderTime` (ms) and `version` (the change counter). The plugin draws the next preview of the same material, shape and size into the same canvas, so copy it in the callback, or put the canvas itself in the page and it updates in place.

## Offscreen render, colours of the viewport

The previews render into a small offscreen render target, and only that target is read back (`readRenderTargetPixels`):

1. The object renders into a linear half float target of the preview size, with MSAA and a transparent background. The screen space material extensions (SSAO, SSR and similar, which read the buffers of the main view) are off in this render.
2. A full screen pass copies it into an 8 bit target. It applies the tone mapping of the viewport with the same shader functions as the [`TonemapPlugin`](../plugin/TonemapPlugin): the three.js tone mapping with the exposure, then contrast and saturation. Then it converts to the output colour space of the screen pass (sRGB).
3. The 8 bit target is read back, and drawn into a 2D canvas.

The canvas of the viewer is not changed: the renderer's render target, clear colour and `autoClear` are put back. So a preview does not need `viewer.setDirty()` and does not restart the progressive rendering of the viewport.

[`materialPreviewOptionsFromViewer(viewer)`](https://threepipe.org/docs/functions/materialPreviewOptionsFromViewer.html) returns the environment map (with its intensity and rotation), the tone mapping and the output colour space of the viewer. With them, a preview of a material on a sphere has the same colours as a sphere with that material in a viewport lit by the environment map. With a material (`materialPreviewOptionsFromViewer(viewer, material)`, which the queue uses), the tone mapping also follows the material's opt-out like in the viewport: a material with `userData.gBufferData.tonemapEnabled = false` gets no tone mapping in its preview when the screen pass reads the GBuffer flags (`TonemapPlugin.isMaterialTonemapped`); the sRGB conversion is kept. The lights of the scene are not in the previews; the hemisphere light of the preview scene is on when there is no environment map, and for materials that three.js does not light with the scene environment (Phong, Lambert, unlit; only `MeshStandardMaterial` and `MeshPhysicalMaterial` use it). Screen pass effects other than tone mapping (vignette, film grain, chromatic aberration, bloom) are not in the previews.

```typescript
import {MaterialPreviewGenerator, materialPreviewOptionsFromViewer} from 'threepipe'

const generator = new MaterialPreviewGenerator()
viewer.doOnce('preFrame', () => {
    const canvas = generator.renderToCanvas(material, viewer.renderManager.renderer, {
        ...materialPreviewOptionsFromViewer(viewer),
        shape: 'cube', // or 'sphere', 'cylinder', or 'mesh' with geometry
        size: 256,
    })
    document.body.appendChild(canvas)
})
```

`generator.renderPixels(...)` returns the pixels (`{data, width, height}`, RGBA, rows from the top) without a canvas.

For any object (not only a material), `snapObject(renderer, object, {root, size: 256, toneMapping, outputColorSpace})` returns a png data url of an offscreen render, and `snapObjectToCanvas` a canvas. Without `size`, `snapObject` keeps its old behaviour: it renders to the canvas and reads the whole canvas, without tone mapping, so it must run in `preFrame` and be followed by `viewer.setDirty()`. The offscreen render is much faster on a large canvas, since it renders and reads back only the small target.
