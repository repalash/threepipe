# `.blend` import loads every object of every scene, ignoring the active scene and hidden layers

**Status**: open — proposal below, needs a decision. Found while verifying
[blend-importer-mpoly-subsurf-hang](./blend-importer-mpoly-subsurf-hang.md); present in 0.5.1 too.

## What happens

`loader/index.ts` builds the scene from `file.objects.Object` — every Object datablock in the file.
Blender shows one scene, and in it only what its view layers and collections show.

`tmp/bugatti/bugatti.blend` (Blender 2.7x) has 10 scenes, each a variant of the same car set:

| scene | objects | on a visible layer |
| --- | --- | --- |
| SCparkinghdr | 69 | 40 |
| SCparkinghdr.001 | 70 | 41 |
| SCScene | 23 | 15 |
| SCScene.001 | 23 | 15 |
| SCScene.002 | 28 | 20 |
| **SCScene.003** (active: window and `FileGlobal.curscene`) | 44 | 44 |
| SCScene.004 | 65 | 41 |
| SCScene.005 | 69 | 40 |
| SCScene.006 | 69 | 40 |
| SCsunset | 100 | 44 |

Blender opens it on `SCScene.003`: 44 objects. The importer creates all 446 mesh objects (560 objects
in total) on top of each other. Visible results, in the Mac GPU browser on both 0.5.1 and the fix:

- nine copies of a car-sized, materialless helper cube (`OBCube`, `.015`, `.023` …) enclose the car —
  in the scenes that contain it, it sits on a layer the scene does not show;
- duplicated parts (wheels, the transporter) from the overlapping variants;
- 10M triangles, most of them not in the scene the author saved.

Screenshots: `tmp/browser-check/bugatti-{fix,old}-{three-quarter,side,top}.png`.

## What Blender does

- **Which scene**: the window's scene (`wmWindow.scene`, 2.8+; `bScreen.scene` before), falling back to
  `FileGlobal.curscene`.
- **2.7x layers**: an object is shown when its base's layer bits meet the scene's,
  `base.lay & scene->lay`. Blender 2.8 converts this on load in `do_version_layers_to_collections`
  (`blenloader/intern/versioning_280.cc:261`): one collection per used layer, and layers not in
  `scene->lay` become collections with `COLLECTION_HIDE_VIEWPORT | COLLECTION_HIDE_RENDER`.
- **2.8+**: the scene's master collection tree, with collection exclude/hide flags, view-layer
  `LayerCollection` flags and object visibility flags (`visibility_flag`, `restrictflag` before it).

## Proposal

Import the active scene by default, from its own base list (2.7x) or collection tree (2.8+), honouring
layer and hide flags — what Blender shows when it opens the file. Add a plugin option to import a named
scene, or every scene as separate roots, for callers that relied on getting everything.

This changes what an import returns for multi-scene files, so it is a behaviour change to decide on,
not a bug fix to slip in. Collection hierarchy could map to `Object3D` groups at the same time.
