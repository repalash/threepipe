---
prev:
    text: 'PickingPlugin'
    link: './PickingPlugin'

next:
    text: 'LoadingScreenPlugin'
    link: './LoadingScreenPlugin'

---

# BVHPlugin

[Example](https://threepipe.org/examples/#bvh-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/BVHPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/BVHPlugin.html)

BVHPlugin makes raycasts fast on big meshes. It builds a bounding volume hierarchy (BVH) with [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) for the mesh geometries in the scene. A raycast then tests a few boxes and the triangles in them, not every triangle of the mesh. Picking, hover, snapping and placing objects on surfaces stay fast on models with millions of triangles.

The `Raycaster` API does not change: a mesh with a tree raycasts with `acceleratedRaycast` of three-mesh-bvh, and gives the same hits.

## three-mesh-bvh

threepipe does not depend on three-mesh-bvh. Install it (0.9.5 or newer) and give it to the plugin:

```bash
npm install three-mesh-bvh
```

```typescript
import {ThreeViewer, BVHPlugin, PickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

// with a bundler: three-mesh-bvh goes in its own chunk, loaded when the plugin is added
const bvh = viewer.addPluginSync(new BVHPlugin(true, {
    load: async () => import('three-mesh-bvh'),
}))

// or the module, when the page has it already
// import * as threeMeshBVH from 'three-mesh-bvh'
// viewer.addPluginSync(new BVHPlugin(true, {lib: threeMeshBVH}))

viewer.addPluginSync(PickingPlugin)
```

Without options, the plugin loads `three-mesh-bvh` with a native dynamic import that bundlers do not process. This works only with an import map, for example with the CDN build of threepipe:

```html
<script type="importmap">
{
    "imports": {
        "three": "https://unpkg.com/threepipe/dist/index.mjs",
        "threepipe": "https://unpkg.com/threepipe/dist/index.mjs",
        "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.16?external=three"
    }
}
</script>
```

If the module does not load, the plugin logs an error and raycasts work as before, without trees.

## Which meshes get a tree

- Meshes in `auto` mode get a tree from `autoMinTriangles` triangles (default 1000).
- `object.userData.bvh` sets the mode per object: `'auto'`, `'on'` (always) or `'off'` (never). It is saved with the object. The object's UI has a BVH section with the mode, the status, a Rebuild button and Show boxes (a `BVHHelper`, not saved).
- Skinned, morphed, instanced and batched meshes, and meshes with their own `raycast` (like fat lines), do not get a tree.

```typescript
mesh.userData.bvh = 'on'
bvh.refreshObject(mesh)

bvh.autoMinTriangles = 10000 // builds or drops the trees of all meshes again
bvh.enabled = false // drops all trees, raycasts work without them
```

## Building and updating

- Trees are built after a frame (the viewer `postFrame` event), for at most `buildBudget` ms per frame (default 6). A geometry that takes longer is still built in one go.
- A tree is kept in `geometry.boundsTree`. The trees are `indirect`: the index of the geometry keeps its order, the geometry is not changed.
- After a geometry update (`geometry.setDirty()`), the plugin refits the tree when the triangle count is the same (moved vertices), else it builds the tree again.
- A removed geometry loses its tree.

The plugin UI shows the number of geometries with a tree, their memory and the build time.

## Trees for other code

`getBVH(meshOrGeometry)` returns the tree of a mesh or geometry, and builds it at once when there is none. It returns `undefined` until three-mesh-bvh is loaded. The return type has only `refit()`: cast it to `MeshBVH` of three-mesh-bvh for the full API (closest point, shapecast, physics, path tracing).

```typescript
import type {MeshBVH} from 'three-mesh-bvh'

const tree = bvh.getBVH(mesh) as MeshBVH | undefined
tree?.closestPointToPoint(point)
```

Events:
- `bvhBuilt` - `{geometry, bvh, ms}`, after a tree is built
- `bvhDisposed` - `{geometry}`, after a tree is dropped
