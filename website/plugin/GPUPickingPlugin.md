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

GPUPickingPlugin finds the front-most mesh under a point of the canvas on the GPU, without testing triangles. The meshes of the model root draw their object id and view depth into a 1×1 float render target, with the camera's view narrowed to the pixel under the point. Then the plugin reads that one pixel back and computes the hit point along the camera ray.

The cost is one small draw of the scene and one read-back. It does not grow with the triangle count of a mesh, and there is no tree to build or to keep in memory. Use it for hover and clicks on what is visible.

```typescript
import {ThreeViewer, GPUPickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})
const gpuPicking = viewer.addPluginSync(GPUPickingPlugin)

viewer.canvas.addEventListener('pointermove', (ev) => {
    const rect = viewer.canvas.getBoundingClientRect()
    // CSS pixels from the top-left corner of the canvas
    const hit = gpuPicking.pick(ev.clientX - rect.left, ev.clientY - rect.top)
    if (hit) console.log(hit.object.name, hit.point, hit.distance)
})

// only some meshes take part
const hit = gpuPicking.pick(x, y, (object) => object.userData.userSelectable !== false)
```

`pick(x, y, filter?)` returns `{object, point, distance}` or `null`:
- `object` - the front-most mesh under the point
- `point` - the world position of the hit, at the centre of the canvas pixel under the point
- `distance` - the distance along the camera ray, as `Raycaster.setFromCamera` makes it (from the camera, or from the plane of an orthographic camera)

`lastPickMs` (in the UI) is the time of the last pick.

## Limits

- Only the front-most mesh, and only along camera rays. For other rays, all the hits along a ray, or many queries in a frame, use the `Raycaster` (with a BVH on big meshes).
- The read-back waits for the GPU to finish the draw (a GPU stall). Pick on pointer events, not many times per frame.
- Transparent meshes are hit like opaque ones, and so are the parts that alpha test cuts away.
- Fat lines (`Line2`), lines, points, objects outside the model root and meshes on layers that the main camera does not see are not drawn.
- The meshes go on `GPUPickingPlugin.Layer` (29) during a pick. Do not use that layer for other renders.
- Skinned, morphed and instanced meshes are drawn in their current pose. An instanced mesh is one object (no instance id).
