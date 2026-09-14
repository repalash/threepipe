# blend-importer material.ts: emissive texture is decoded but never assigned to material.emissiveMap

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
`textureFromSocket` loads and decodes the emissive Image Texture (allocates a
`Texture`, a Blob URL, an `<img>`, and schedules a GPU upload), but the resulting
`emTex` is used ONLY as a truthiness flag. `material.emissiveMap` is never set
anywhere in the file. Any material whose emission comes from a texture (an emissive
PBR map, or an `Emission` node fed by an Image Texture) renders with a flat
emissive *color* and the actual emissive texture is silently dropped.

## Root Cause
```ts
// material.ts:338 — decodes the texture
const emTex = textureFromSocket(links, emSock, true, ctx)
let emCol = socketConst(emSock)
// material.ts:343 — emTex used only as a boolean presence flag
if (emTex && (!emCol || emCol.length < 3 || (!emCol[0] && !emCol[1] && !emCol[2]))) emCol = [1, 1, 1]
// material.ts:344 — emTex used only as a boolean again
if (emCol && emCol.length >= 3 && (emCol[0] || emCol[1] || emCol[2] || emTex)) {
    ...
    material.emissive.setRGB(...)   // only the COLOR is wired, never the map
}
```
`grep emissiveMap` returns zero assignments in the file. Every sibling channel IS
assigned to its map slot: `material.map = baseTex` (`:217`), `roughnessMap`
(`:227`), `metalnessMap` (`:231`), `normalMap` (`:239`), `alphaMap` (`:263`).
Emissive is the one channel that is loaded and thrown away. Blender's glTF exporter
emits `emissiveTexture`; the loader mirrors that for every other channel but not
this one.

This is distinct from the known "emission black-default kills the map" fix in
`blend-importer-code-review-followups.md` — that fix forced `emCol` → white so the
emissive *color* survives; it never wired the map itself.

## Impact
Emissive-map materials lose their texture entirely and render as a flat emissive
color (forced to white at `:343` when the factor is black). Glowing details
(screens, signs, windows driven by an emissive map) disappear.

## Fix
After computing `emTex`, assign it to the map slot (emissive map is sRGB, already
loaded with `srgb=true`):
```ts
if (emTex && material.emissiveMap !== undefined) material.emissiveMap = emTex
```
Keep `material.emissive` / `emissiveIntensity` set so the map is modulated by a
non-black factor (the existing white-fallback already handles that).

## Files
- `plugins/blend-importer/src/loader/material.ts:338-352` — emTex decoded, used only as a flag, never assigned to emissiveMap
- `plugins/blend-importer/src/loader/material.ts:217,227,231,239,263` — sibling channels that ARE assigned to their map slots (reference)
