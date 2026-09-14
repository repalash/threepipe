# FragmentClippingExtensionPlugin: registered GLTF extension name dropped the `_extension` suffix (breaks wire-compat)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The registered GLTF extension name is `'WEBGI_materials_fragment_clipping'`, but the deprecated static constant, docstring, and the webgi spec all use `'WEBGI_materials_fragment_clipping_extension'`. The current name is the odd one out among the four material GLTF extensions (clearcoat_tint, custom_bump_map, noise_bump all kept their full webgi names).

## Root Cause
```ts
export const fragmentClippingGLTFExtension = {
    name: 'WEBGI_materials_fragment_clipping',        // dropped `_extension`
    ...
}
...
/** @deprecated use - use {@link fragmentClippingGLTFExtension} */
public static readonly FRAGMENT_CLIPPING_EXTENSION_GLTF_EXTENSION = 'WEBGI_materials_fragment_clipping_extension'
```
webgi wrote/read this extension as `WEBGI_materials_fragment_clipping_extension`. Import and export within current threepipe both reference the same (new) constant, so a threepipe→threepipe round-trip works.

## Impact
GLBs authored by webgi (or older threepipe) with the `_extension` suffix silently fail to import their fragment-clipping data, and threepipe now exports a differently-named extension than its own docs/legacy constant declare. threepipe→threepipe round-trips are unaffected.

## Fix
Restore `name: 'WEBGI_materials_fragment_clipping_extension'` to match the spec/legacy constant and webgi files — or intentionally keep the new name but update the deprecated const + docs and add a legacy-name import alias.

## Files
- `src/plugins/material/FragmentClippingExtensionPlugin.ts:276` — registered name without `_extension`
- `src/plugins/material/FragmentClippingExtensionPlugin.ts:213` — deprecated const with `_extension`

See `audit-fragmentclipping-always-true-guard-and-wrong-field-gate.md` for the medium-severity logic bugs in the same plugin.
