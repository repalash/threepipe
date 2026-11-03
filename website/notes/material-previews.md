---
prev:
  text: 'Widgets, Helpers & Gizmos'
  link: './widgets-and-helpers'

aside: false
---

# Material Previews

A material preview is a small image of a material on a sphere, a cube or a given mesh, like the previews in a material inspector or in the variations of the [Material Configurator](../plugin/MaterialConfiguratorBasePlugin).

Threepipe renders the previews with the viewer's renderer, so a preview uses the same shaders and textures as the viewport. Three APIs build on each other:

- [`snapObject`](https://threepipe.org/docs/functions/snapObject.html), [`snapObjectPixels`](https://threepipe.org/docs/functions/snapObjectPixels.html) and [`snapObjectToCanvas`](https://threepipe.org/docs/functions/snapObjectToCanvas.html) render one object.
- [`MaterialPreviewGenerator`](https://threepipe.org/docs/classes/MaterialPreviewGenerator.html) renders a material on a shape or a geometry, in a private scene.
- [`MaterialPreviewQueue`](https://threepipe.org/docs/classes/MaterialPreviewQueue.html) makes previews for an inspector: request a preview on every material change, and the queue renders it when the material stops changing.

[Example](https://threepipe.org/examples/#material-preview/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/examples/material-preview/script.ts)

## Live previews in an inspector

```typescript
import {MaterialPreviewQueue, MaterialPreviewHandle, IMaterial} from 'threepipe'

const queue = new MaterialPreviewQueue(viewer)

const canvas = document.createElement('canvas') // in the inspector panel
canvas.width = canvas.height = 256
let handle: MaterialPreviewHandle | undefined

function showPreview(material: IMaterial, shape: 'sphere' | 'cube' | 'mesh' = 'sphere', geometry?: BufferGeometry) {
    handle?.cancel()
    handle = queue.request(material, {shape, geometry, size: 256}, preview => {
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(preview.canvas, 0, 0)
        // or, for an <img>: img.src = preview.toDataURL()
    })
}

// request on every change, the queue waits for the material to stop changing
material.addEventListener('materialUpdate', () => showPreview(material))
showPreview(material)
```

What the queue does:

- It renders in the viewer's `preFrame`, at most `queue.maxPerFrame` previews per frame (default 1).
- A request for a material that changed (`materialUpdate`) less than `queue.debounce` ms ago (default 200) waits until the material did not change for that long. A request for a material that did not change renders in the next frame.
- Requests for the same material, shape, geometry and size share one render.
- It caches the previews by material uuid, shape, geometry, size and a change counter of the material (the number of its `materialUpdate` events). The cache is also invalid after a change of the scene's environment map or of the tone mapping. A request for an unchanged material gets the cached preview in the next frame, without a render. `queue.invalidate(material)` removes the cached previews of a material.
- `request` returns a handle; `handle.cancel()` stops the callback (and the render, when no other request waits for it).
- The `mesh` shape renders the given geometry alone (for example the geometry of the selected mesh), with a camera fitted to its bounds.

The callback gets a [`MaterialPreview`](https://threepipe.org/docs/interfaces/MaterialPreview.html): `canvas` (the cheapest output, no image encoding), `toDataURL()` (a png, encoded on the first call), `renderTime` (ms) and `version` (the change counter). The queue draws the next preview of the same material, shape and size into the same canvas, so copy it in the callback, or put the canvas itself in the page and it updates in place.

## Offscreen render, colours of the viewport

The previews render into a small offscreen render target, and only that target is read back (`readRenderTargetPixels`):

1. The object renders into a linear half float target of the preview size, with MSAA and a transparent background. The screen space material extensions (SSAO, SSR and similar, which read the buffers of the main view) are off in this render.
2. A full screen pass copies it into an 8 bit target. It applies the tone mapping of the viewport with the same shader functions as the [`TonemapPlugin`](../plugin/TonemapPlugin): the three.js tone mapping with the exposure, then contrast and saturation. Then it converts to the output colour space of the screen pass (sRGB).
3. The 8 bit target is read back, and drawn into a 2D canvas.

The canvas of the viewer is not changed: the renderer's render target, clear colour and `autoClear` are put back. So a preview does not need `viewer.setDirty()` and does not restart the progressive rendering of the viewport.

[`materialPreviewOptionsFromViewer(viewer)`](https://threepipe.org/docs/functions/materialPreviewOptionsFromViewer.html) returns the environment map (with its intensity and rotation), the tone mapping and the output colour space of the viewer. With them, a preview of a material on a sphere has the same colours as a sphere with that material in a viewport lit by the environment map. With a material (`materialPreviewOptionsFromViewer(viewer, material)`, which the queue uses), the tone mapping also follows the material's opt-out like in the viewport: a material with `userData.gBufferData.tonemapEnabled = false` gets no tone mapping in its preview when the screen pass reads the GBuffer flags (`TonemapPlugin.isMaterialTonemapped`); the sRGB conversion is kept. The lights of the scene are not in the previews; the hemisphere light of the preview scene is on only when there is no environment map. Screen pass effects other than tone mapping (vignette, film grain, chromatic aberration, bloom) are not in the previews.

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
