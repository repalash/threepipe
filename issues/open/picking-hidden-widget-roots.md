# PickingPlugin picks hidden widget roots

**Found**: 2026-10-03, while adding the mesh-edit transform gizmo (branch `p1-transform`).

`PickingPlugin._addSceneObject` (`src/plugins/interaction/PickingPlugin.ts:615`) pushes every object
added to the scene with `userData.isWidgetRoot` into `ObjectPicker.extraObjects`, so widgets can be
picked. `ObjectPicker` then raycasts those roots with three's `Raycaster`, which **does not test
`visible`**: a widget root hidden with `visible = false` (and any of its children) still receives
hits, and a click on the empty space where it would be selects one of its unnamed child meshes.

Repro: add an `Object3D` with `userData.isWidgetRoot = true` and a child `Mesh` to the scene via
`viewer.scene.addObject(obj, {addToRoot: true})`, set `obj.visible = false`, click where the mesh
would be: `picking.getSelectedObject()` is the hidden mesh (name `''`).

The mesh-edit gizmo works around it by not being an `isWidgetRoot` (the plugin picks the gizmo
itself) and marking every part `userData.userSelectable = false`.

Suggested fix: in `ObjectPicker`, skip `extraObjects` entries whose `visible` is false (or filter the
intersections by walking `visible` up the ancestors), and respect `userSelectable` on ancestors so a
root flag covers its parts.
