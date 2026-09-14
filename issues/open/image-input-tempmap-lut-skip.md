# Bug: LUT wrappers skip the `tp_src_uuid` bridge in `proxyGetValue`

## Summary

`plugins/tweakpane/src/tpImageInputGenerator.ts:122-127`:

```ts
if (cc.image && !cc.image.tp_src_uuid) {
    const uuid = generateUUID()
    cc.image.tp_src_uuid = uuid
    staticData.tempMap[ret] = uuid
}
```

This block only runs when `cc.image` exists. **LUT wrappers (`LUTCubeTextureWrapper`) have no top-level `cc.image`** — the image lives at `cc.texture3D.image`. The block skips, so the LUT's preview URL never gets a uuid bridge in `tempMap`, and `cc.texture3D.image.tp_src_uuid` stays unset.

## Effect

The LUT preview's identity is registered ONLY through:
1. `staticData.textureMap[lutPreviewURL] = cc` — set by the proxy `get` accessor (line 379) when `ret` is the preview URL string.

So inter-slot drag-drop recovery via `textureMap[v.src]` works for LUTs (lookup hits the preview URL key). The asymmetry is in the **`imageMap`** path — `imageMap[uuid]` is never populated for LUT wrappers because the uuid generation block doesn't run.

This means:
- Inter-slot LUT drag-drop **works** today via `textureMap` (we have a regression test for it).
- The `tp_src_uuid` → `imageMap[uuid]` bridge is dead for LUTs. Probably benign in practice, but it's an inconsistency that could surprise future code that relies on `imageMap` lookup.

## Fix

Mirror the texture branch by also populating the bridge for LUT wrappers:

```ts
// In the LUT branch (around line 110-117):
if (image) {
    if (!image.tp_src) image.tp_src = lutPreviewDataUrl(cc) ?? staticData.lutCubeTexImage
    if (!image.tp_src_uuid) {
        image.tp_src_uuid = generateUUID()
        staticData.tempMap[image.tp_src] = image.tp_src_uuid
    }
    // ...
}
```

Or — cleaner — restructure the post-branch uuid generation to look at whichever image (`cc.image` for textures, `cc.texture3D.image` for wrappers) is the "preview-bearing" image:

```ts
const previewImage = cc.image || cc.texture3D?.image || cc.texture?.image
if (previewImage && !previewImage.tp_src_uuid) {
    const uuid = generateUUID()
    previewImage.tp_src_uuid = uuid
    staticData.tempMap[ret] = uuid
}
```

## Severity

Low — current behaviour works, but the asymmetry could break future code that assumes `imageMap[uuid]` is the canonical path.
