---
prev:
  text: 'Widgets, Helpers & Gizmos'
  link: './widgets-and-helpers'

aside: false
---

# Legacy bump scale (old files with bump maps)

three.js r158 changed how bump maps are shaded ([three.js #26899](https://github.com/mrdoob/three.js/pull/26899)): the bump strength no longer depends on the texture size or the distance to the camera. The same `bumpScale` looks much stronger or weaker than before.

Files made with **threepipe 0.0.43 or older**, or with **webgi before 0.12.0**, were made with the old shading. threepipe renders those materials with the old shading (the `BUMP_MAP_SCALE_LEGACY` define), so they look the same as when they were made.

## When is a material legacy

On import, for every material with a bump map, the first of these that is present is used:

1. `legacyBumpScale` in the material's `WEBGI_material_extras` extension (written by threepipe and webgi for every bump mapped material).
2. `normalizedScale` in the `WEBGI_materials_bumpmap` extension (older webgi files).
3. `userData.legacyBumpScale` (the flag saved with the material).
4. The file:
   - `asset.subversion` is `1` or more, or `asset.version` is `2.001` → not legacy.
   - Viewer config (`WEBGI_viewer`): threepipe older than 0.0.44, or webgi older than 0.12.0-dev.5 → legacy.
   - Otherwise legacy only when the file was written by three.js `GLTFExporter` (old threepipe/webgi exports without a viewer config). Files re-saved by other tools (Draco/glTF-Transform, Blender) count as not legacy.

Material JSON files (`.pmat`, `.json`) are legacy when `metadata.version` is `4.6` or lower, or when `userData.legacyBumpScale` is set.

The console shows `legacy bump scale (three.js < r158) applied to ...` for each material that got it.

## Fixing a material that looks wrong

The bump looks far too strong or too flat compared to the original? The detection was wrong for that file (for example an old file that was re-saved by another tool). Toggle it per material.

**In the editor:** select the object, open its material, and in the **Bump/Normal** section check or uncheck **Legacy Bump Scale**. Then export the file again: the flag is saved in the material and used on the next load.

**In code:**

```typescript
const material = viewer.scene.getObjectByName('ring')?.material as PhysicalMaterial
material.legacyBumpScale = true // old shading; false for the current three.js shading
```

To switch all materials of a loaded model:

```typescript
model.traverse((o) => {
    const m = o.material as PhysicalMaterial
    if (m?.bumpMap) m.legacyBumpScale = true
})
```

To check what the importer would decide for a file, without loading it: `GLTFMaterialExtrasExtension.IsLegacyBumpScaleFile(gltfJson)`.
