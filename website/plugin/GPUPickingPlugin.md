---
prev:
    text: 'PickingPlugin'
    link: './PickingPlugin'

next:
    text: 'LoadingScreenPlugin'
    link: './LoadingScreenPlugin'

---

# GPUPickingPlugin

[Example](https://threepipe.org/examples/#gpu-picking-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/GPUPickingPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GPUPickingPlugin.html)

GPUPickingPlugin finds the front-most mesh under a point of the canvas on the GPU, without testing triangles. The meshes of the model root draw their object id, view depth and surface normal into a 1×1 float render target, with the camera's view narrowed to the pixel under the point. Then the plugin reads that one pixel back and computes the hit point along the camera ray and the world normal.

The cost is one small draw of the scene and one read-back. It does not grow with the triangle count of a mesh, and there is no tree to build or to keep in memory. Use it for hover and clicks on what is visible.

```typescript
import {ThreeViewer, GPUPickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})
const gpuPicking = viewer.addPluginSync(GPUPickingPlugin)

viewer.canvas.addEventListener('pointermove', (ev) => {
    const rect = viewer.canvas.getBoundingClientRect()
    // CSS pixels from the top-left corner of the canvas
    const hit = gpuPicking.pick(ev.clientX - rect.left, ev.clientY - rect.top)
    if (hit) console.log(hit.object.name, hit.point, hit.distance, hit.normal)
})

// only some meshes take part
const hit = gpuPicking.pick(x, y, (object) => object.userData.userSelectable !== false)
```

`pick(x, y, filter?)` returns `{object, point, distance, normal}` or `null`:
- `object` - the front-most mesh under the point
- `point` - the world position of the hit, at the centre of the canvas pixel under the point
- `distance` - the distance along the camera ray, as `Raycaster.setFromCamera` makes it (from the camera, or from the plane of an orthographic camera)
- `normal` - the world-space unit normal of the surface at the hit, on the side that the camera sees (flipped on a back face of a double-sided material and for a back-sided material, as three's shading does). It is the interpolated vertex normal, with skinning, morph targets, instancing and batching. For a flat-shaded material or a geometry without normals, it is the flat face normal.

The example draws the normal as an arrow at the picked point.

The normal is written in the two free channels of the pixel with an octahedral encoding (every unit vector maps to one point of a square, so no sign is lost). In a float target it loses about 1e-7 rad, so the normal matches the vertex normals that the GPU interpolates. At grazing angles the pixel can hit a nearby point of the surface, as for the hit point.

`lastPickMs` (in the UI) is the time of the last pick.

## The `IGPUPicker` interface

`GPUPickingPlugin` implements `IGPUPicker`: `isGPUPicker: true` and `pick(x, y, filter?)`, which returns a `GPUPickResult`. Each GPU picker is a separate plugin with this interface. A future `GBufferPickingPlugin` (deferred, depends on `GBufferPlugin`) will read the ids, depth and normals of the frame from the G-buffer, with no extra draw, and implement the same interface.

Code that uses GPU picking does not depend on one plugin. It looks up any added plugin that is a GPU picker:

```typescript
import {IGPUPicker, IViewerPlugin} from 'threepipe'

const picker = Object.values(viewer.plugins).find((p): p is IGPUPicker & IViewerPlugin => !!(p as Partial<IGPUPicker>).isGPUPicker)
const hit = picker?.pick(x, y)
```

## Limits

- Only the front-most mesh, and only along camera rays. For other rays, all the hits along a ray, or many queries in a frame, use the `Raycaster` (with a BVH on big meshes).
- The read-back waits for the GPU to finish the draw (a GPU stall). Pick on pointer events, not many times per frame.
- Each mesh draws with the `side` of its material (of each geometry group, for a multi-material mesh), so a face that a render culls is not hit. The unseen back of a front-sided plane does not hide what is behind it.
- Transparent meshes are hit like opaque ones, and so are the parts that alpha test cuts away.
- Fat lines (`Line2`), lines, points, objects outside the model root and meshes on layers that the main camera does not see are not drawn.
- The meshes go on `GPUPickingPlugin.Layer` (29) during a pick. Do not use that layer for other renders.
- Skinned, morphed (also per instance), instanced and batched meshes are drawn in their current pose. An instanced or batched mesh is one object (no instance id).
- The normal does not include normal maps, bump maps or displacement.
