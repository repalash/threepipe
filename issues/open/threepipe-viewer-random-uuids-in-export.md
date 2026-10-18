# A scene export carries random UUIDs from the viewer itself

**Found** 2026-10-16 by Track 1 (agent packaging) while writing the replay-determinism test
(`plugins/modelling-cli/tests/replay-determinism.test.ts`).

## What

Replaying the same 271-command transcript twice in two fresh viewers gives two GLBs whose binary chunk
(all geometry) is byte-identical but whose JSON differs. After `plugin-modelling` derived the UUIDs of
everything it creates from its document id (`ModellingDocument.stableUuid`), the remaining differences
all come from objects the *viewer* creates:

- `scene.modelRoot` - written as the scene node's `extras.gltfUUID` (`assetExportHook.ts:70`);
- the default camera - written inside the bundled viewer config (`extras.viewer...defaultCamera.object.uuid`);
- any other viewer-owned object that ends up under the root (none in the modelling pages).

Each comes from three's `MathUtils.generateUUID` (`Math.random`) when the viewer is constructed.

## Why it matters

"Same input, same file" is what makes a transcript a regression test, a bug report and a build file
(research-ai-3d-ecosystem §5.2 E). Today it holds for a model export
(`export {viewerConfig: false, uuids: false}`), which is what the test asserts, but not for a full scene
export with viewer config.

## Options (core change, needs a decision)

1. A `ThreeViewer` option (e.g. `uuidSeed`) that derives the UUIDs of the viewer's own singletons
   (scene root, default camera) from a seed instead of `Math.random`.
2. Leave scene-root and camera UUIDs out of `viewerConfig`/`gltfUUID` when they are not referenced by
   anything else in the file.

Not worked around in the modelling packages: the sessions do not overwrite the viewer's UUIDs.
