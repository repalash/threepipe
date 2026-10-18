# `userData.excludeFromExport` does not exclude anything from a glTF export

**Found** 2026-10-18 by Track 1 while implementing `export {objects}` in plugin-modelling.

## What

`AssetExporter.exportObject` (`src/assetmanager/AssetExporter.ts:69-82`) "excludes" objects marked
`userData.excludeFromExport` by setting `visible = false` for the duration of the export. But
`GLTFExporter2.parse` passes `onlyVisible: options.onlyVisible ?? false` (`GLTFExporter2.ts:167`), and three's
`GLTFWriter` only skips invisible children when `onlyVisible` is true (`GLTFExporter.js:2366, 2420`). So the
marked objects are written anyway - as invisible nodes - and the file gets bigger, not smaller.

Consequences seen here:
- plugin-modelling's reference planes (`commands/reference.ts:169`) and its orthographic camera
  (`commands/session.ts`, `ORTHO_CAMERA_NAME`) are marked `excludeFromExport` and end up in every export;
- `export {objects: 'keep'}` (which marks every other branch, the same mechanism) exports everything.

## Repro

`plugins/modelling-cli` Node session: two cubes, mark one `excludeFromExport`, `exportScene()`, re-import:
both come back (the second invisible).

## Fix (core, needs approval)

Skip excluded objects in the writer instead of hiding them: in `GLTFWriter2`, do not process a node (or
its subtree) whose `userData.excludeFromExport` is set, and drop the visibility toggling in
`AssetExporter.exportObject` (which also has the "won't work when exporting invisible objects" todo).
That keeps invisible-but-wanted objects exported and makes the flag mean what it says.
