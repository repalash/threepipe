# `unregisterGltfExtension` never removes the exporter hook, and re-adding duplicates it

`AssetManager.registerGltfExtension` stores the whole descriptor in `gltfExtensions` but pushes only
the *export factory function* onto the exporter:

```ts
// src/assetmanager/AssetManager.ts:579
registerGltfExtension(ext: AssetManager['gltfExtensions'][number]) {
    const ext1 = this.gltfExtensions.findIndex(e => e.name === ext.name)
    if (ext1 >= 0) this.gltfExtensions.splice(ext1, 1)
    this.gltfExtensions.push(ext)
    this._gltfExporter.extensions.push(ext.export)      // <- a bare function
    ...
}
```

`unregisterGltfExtension` then looks that function up by `.name`:

```ts
// src/assetmanager/AssetManager.ts:589
const ind1 = this._gltfExporter.extensions.findIndex(e => e.name === name)
```

For a function, `.name` is its declared name, not the glTF extension name. None of the built-ins
match. `clearCoatTintGLTFExtension.export` is `glTFMaterialsClearcoatTintExtensionExport`
(`ClearcoatTintPlugin.ts:224`), so `findIndex` looks for `'WEBGI_materials_clearcoat_tint'` among
functions called `glTFMaterialsClearcoatTintExtensionExport`, `customBumpMapGLTFExtensionExport` and
so on, and never finds it. `ind1` is `-1` and the splice is skipped.

## What goes wrong

1. **Removing a plugin leaves its exporter hook behind.** `ClearcoatTintPlugin.onRemove` calls
   `unregisterGltfExtension`, the importer side is removed from `gltfExtensions`, and the export hook
   stays on `_gltfExporter.extensions` for the life of the viewer. The exported file keeps gaining
   the extension after the plugin that produced it is gone.
2. **Re-adding duplicates it.** `registerGltfExtension` de-duplicates `gltfExtensions` by name, but
   pushes onto `_gltfExporter.extensions` unconditionally. Add, remove, add again and the export hook
   runs twice per material; a third cycle, three times.

Affects at least `ClearcoatTintPlugin`, `CustomBumpMapPlugin`, `NoiseBumpMaterialPlugin` and
`FragmentClippingExtensionPlugin`, which all follow the same shape, and `exporter2` in the same two
methods has the identical problem.

## Fix

Track what was pushed rather than trying to recover it by name. Either store the pushed factory on
the descriptor:

```ts
registerGltfExtension(ext) {
    this.unregisterGltfExtension(ext.name)        // also cleans the exporter lists
    this.gltfExtensions.push(ext)
    ...
}
unregisterGltfExtension(name) {
    const ext = this.gltfExtensions.find(e => e.name === name)
    if (!ext) return
    const drop = (list?: any[]) => {
        const i = list?.indexOf(ext.export) ?? -1
        if (i >= 0) list!.splice(i, 1)
    }
    drop(this._gltfExporter.extensions)
    ...
}
```

...or keep a `Map<string, GLTFExporterPlugin>` alongside. Identity, not `.name`.

## Workaround in the meantime

An extension that wants to be unregisterable has to name its export factory after itself:

```ts
Object.defineProperty(exportFactory, 'name', {value: MY_EXTENSION_NAME})
```

which is what `plugins/modelling/src/gltf/GLTFMeshTopologyExtension.ts` does, with a comment pointing
here.

Found while adding `THREEPIPE_mesh_topology` in `@threepipe/plugin-modelling`.
