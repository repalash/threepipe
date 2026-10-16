# `material` is per object: no way to assign a material to some faces

Found building `demos/haussmann/build.mjs`.

## The gap

Window panes, shop doors and dormer glass need a different material from the stone they are cut
into. Blender does this with material slots and *Assign* on the selected faces. The kernel already
carries the data (`AttrName.materialIndex`, `MeshData.materials`, and `bake.ts` emits one geometry
group per slot run), and `bevel` exposes `materialIndex` - but no command sets a face's slot or adds a
slot, and `material` colours the whole object.

## Consequence

The only route is `separate {mode: 'faces'}` into a second object. That works visually, but the wall
is left with a hole at every window: in the Haussmann build the façade has one boundary loop per
pane (it is closed only together with `glass`), so a manifold check on the façade alone fails and
an exporter sees two meshes where Blender would have one with two materials.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
// No command can make face 0 glass and the rest stone.
await run({op: 'separate', object: 'c', mode: 'faces', faces: [0], name: 'c-glass'})
// c is now an open box (4 boundary edges).
```

## Suggested command (needs a decision)

`material {object, faces: [...], slot: n, color, roughness, ...}` - add or reuse slot `n` and set the
listed faces' `material_index`, as `object.material_slot_add` + `object.material_slot_assign`. The
render side needs a multi-material `Mesh2` (array material) for the groups `bake.ts` already writes.
