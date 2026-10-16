# `display {mode: 'wireframe'}` draws the render triangles, not the mesh's edges; there is no x-ray mode

Found making the wireframe and x-ray passes of `demos/stair`.

`displayCommand` (`plugins/modelling/src/commands/scene.ts`) sets `material.wireframe = true` on every
object. three.js draws that from the baked index buffer, so every quad shows its triangulation
diagonal and every n-gon its fan. The point of a wireframe pass in a modelling demo is to show the
topology the commands made (quads, the radial array's copies, the loop cuts), and the triangle
diagonals hide exactly that. The edit-mode overlay in `plugin-mesh-edit` already draws real edges.

There is also no x-ray (see-through) mode; the demo fakes it with `material {object: '*', opacity}`,
which sorts badly and changes the materials themselves (they are recorded in history).

## Repro

```js
await run({op: 'primitive', type: 'grid', name: 'g', xSegments: 4, ySegments: 4, size: 2})
await run({op: 'display', mode: 'wireframe'})
await run({op: 'capture'})  // 32 triangles' worth of lines, not a 4 x 4 grid
```

## Expected (Blender)

Viewport Wireframe shading (and the Wireframe overlay) draw mesh edges: a 4 x 4 grid shows 40 edges.
X-ray (Alt+Z) shows hidden edges and faces through the surface without touching materials. Suggested:
build `LineSegments` from `MeshData.edgeVerts` of each evaluated mesh for `wireframe`, and add
`mode: 'xray'` drawing the same lines with `depthTest: false` over a translucent overlay material
that is not the object's own.
