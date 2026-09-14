# FragmentClippingExtensionPlugin: always-true `=== undefined !== undefined` resets, and clipParams gated on the wrong field

**Severity:** medium
**Found:** 2026-06-13 code audit

Two distinct defects in the same plugin, grouped.

## Bug 1: `=== undefined !== undefined` is always true — resets clipMode/clipInvert every call
`AddFragmentClipping` unconditionally overwrites `clipMode` back to `Circle` and `clipInvert` back to `false` on every call, discarding any existing value.

### Root Cause
```ts
if (tf.clipMode === undefined !== undefined) tf.clipMode = FragmentClippingMode.Circle
if (tf.clipInvert === undefined !== undefined) tf.clipInvert = false
```
`tf.clipMode === undefined` yields a boolean, and `<boolean> !== undefined` is ALWAYS `true` (a boolean is never `=== undefined`). Compare the correct lines directly above: `if (tf.clipPosition === undefined) ...`. The intent was clearly `if (tf.clipMode === undefined)`.

### Impact
The GLTF import path is masked (`AddFragmentClipping` runs first, then `Deserialize` overwrites), but the UI "Enabled" toggle and the public `AddFragmentClipping` API call it standalone — there the bug clobbers a previously-set `clipMode`/`clipInvert` to defaults.

### Fix
```ts
if (tf.clipMode === undefined) tf.clipMode = FragmentClippingMode.Circle
if (tf.clipInvert === undefined) tf.clipInvert = false
```

## Bug 2: onObjectRender reads `clipParams` but gates on `Array.isArray(clipPosition)` — wrong field
The non-Plane branch decides how to unpack `clipParams` based on whether `clipPosition` is an array.

### Root Cause
```ts
if (Array.isArray(tfUd.clipPosition))                                      // checks clipPosition...
    this._uniforms.fragClippingParams.value.fromArray(tfUd.clipParams)     // ...to read clipParams
else
    this._uniforms.fragClippingParams.value.copy(tfUd.clipParams)
```
Both fields are independently `Vector4 | Vector4Tuple`. If `clipPosition` is an array but `clipParams` is a `Vector4`, `Vector4.fromArray(<Vector4>)` reads `[0..3]` off a non-indexable object → NaN. If `clipPosition` is a `Vector4` but `clipParams` is an array, `Vector4.copy(<array>)` reads `.x/.y/.z/.w` off an array → NaN. Compare the correct line just above (line 79) which tests `Array.isArray(tfUd.clipPosition)` for `clipPosition`.

### Fix
Test the field actually being read:
```ts
if (Array.isArray(tfUd.clipParams))
    this._uniforms.fragClippingParams.value.fromArray(tfUd.clipParams)
else
    this._uniforms.fragClippingParams.value.copy(tfUd.clipParams)
```

## Files
- `src/plugins/material/FragmentClippingExtensionPlugin.ts:48-49` — always-true reset guards
- `src/plugins/material/FragmentClippingExtensionPlugin.ts:93-96` — clipParams unpack gated on `clipPosition`

See `audit-fragmentclipping-gltf-extension-name-dropped-suffix.md` for a related wire-compat issue.
