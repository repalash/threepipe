# AssetExporterPlugin: "Ignore invalid textures" checkbox bound to a non-existent option key

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The "Ignore invalid textures" UI checkbox binds to `exportOptions.ignoreInvalidTextures`, a key that does not exist in the defaults object and is read nowhere. The real option the exporter consumes is `ignoreEmptyTextures`, which has no UI and can never be toggled off via this panel.

## Root Cause
```ts
// UI checkbox (line 145):
property: [this.exportOptions, 'ignoreInvalidTextures'],

// defaults object (lines 64-65):
ignoreInvalidMorphTargetTracks: true,
ignoreEmptyTextures: true,
```
The exporter reads `options.ignoreEmptyTextures` (`GLTFExporter2.ts:176`). A grep over `src` shows `ignoreInvalidTextures` appears ONLY at the UI line — nothing ever reads it, and it isn't `@serialize`d into defaults.

## Impact
Toggling the checkbox writes a junk property that nothing consumes, while the real `ignoreEmptyTextures` option is unreachable from this UI panel.

## Fix
Change line 145 to bind the real key:
```ts
property: [this.exportOptions, 'ignoreEmptyTextures'],
```
(and update the label if desired).

## Files
- `src/plugins/export/AssetExporterPlugin.ts:145` — UI bound to non-existent `ignoreInvalidTextures`
- `src/plugins/export/AssetExporterPlugin.ts:64-65` — defaults define `ignoreEmptyTextures`, not `ignoreInvalidTextures`
