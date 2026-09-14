# glTF export: `if (!Object.keys(extensionDef))` always false → writes empty material extensions

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
Three glTF material-export extensions guard against writing an empty extension object with `if (!Object.keys(extensionDef)) return`. `Object.keys()` always returns an array, which is always truthy, so `!array` is always `false` and the guard never fires. When the map is empty (e.g. `ignoreEmptyTextures` strips a map with no image) and the scalar params equal their defaults, an empty extension object is written into the exported glTF/GLB and the extension is flagged in `extensionsUsed`.

## Root Cause
```ts
if (!Object.keys(extensionDef)) return
```
`Object.keys(extensionDef)` is `[]` when `extensionDef` is `{}`, and `![]` is `false` — the guard is unconditionally skipped. The intent is `if (!Object.keys(extensionDef).length) return`.

Reachability (AlphaMap example): the only top guard is `if (!material.isMeshStandardMaterial || !material.alphaMap) return`, so the code runs whenever `alphaMap` is set. `checkEmptyMap` (three.js-modded `GLTFExporter.js`) returns `false` for a map with a falsy image when `ignoreEmptyTextures` is on, leaving `extensionDef = {}`. The broken guard fails to skip, so an empty `extensions["WEBGI_materials_alphamap"] = {}` is written and `extensionsUsed` is flagged. LightMap and Displacement leave `extensionDef` empty the same way when their scalars equal defaults and the map is empty.

## Impact
Exported GLBs/glTFs contain empty no-op `WEBGI_materials_*` extension objects and mark those extensions as used, even when there's nothing to encode. Bloats output and can confuse strict glTF validators / other importers.

## Fix
Add `.length` in all three files:
```ts
if (!Object.keys(extensionDef).length) return
```

## Files
- `src/assetmanager/gltf/GLTFMaterialsAlphaMapExtension.ts:99` — broken empty-check
- `src/assetmanager/gltf/GLTFMaterialsLightMapExtension.ts:108` — broken empty-check
- `src/assetmanager/gltf/GLTFMaterialsDisplacementMapExtension.ts:105` — broken empty-check
