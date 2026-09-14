# Bug: hardcoded `isLinear` map list in `setterTex` is wrong for many slots

## Summary

`plugins/tweakpane/src/tpImageInputGenerator.ts:142-144` decides whether a dropped texture should be tagged as linear or sRGB by checking the binding key against a hardcoded list:

```ts
const key = renderer.methods.getBinding(config)[1] + ''
const isLinear = ['normalMap', 'aoMap', 'emissiveMap', 'roughnessMap', 'metalnessMap',
                  'displacementMap', 'bumpMap', 'alphaMap'].includes(key)
v1.colorSpace = isLinear ? LinearSRGBColorSpace : SRGBColorSpace
```

The list is incomplete and **`emissiveMap` is wrong** (it's sRGB, not linear).

## Slots missing from the linear list (will be set to sRGB → render wrong)

- `transmissionMap`
- `thicknessMap`
- `clearcoatRoughnessMap`
- `clearcoatNormalMap`
- `iridescenceMap`
- `iridescenceThicknessMap`
- `sheenRoughnessMap`
- `anisotropyMap`
- `specularIntensityMap`

## Wrong entry in the linear list

- `emissiveMap` — emissive maps encode display-referred color, should be **sRGB**. Putting it in `isLinear` causes the emissive output to be doubly-decoded (sRGB-encoded source decoded as if linear → too dark/desaturated).

## Slots that ARE correctly sRGB by default (no change needed)

- `map`, `sheenColorMap`, `specularColorMap`

## Fix

Replace the hardcoded list with a lookup table that mirrors three.js's official map-color-space matrix. Possibly extract to a small util in `src/utils/textureColorSpace.ts` so it's reusable.

```ts
// Linear maps (all are encoded data, not color):
const LINEAR_MAPS = new Set([
    'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap',
    'displacementMap', 'bumpMap', 'alphaMap',
    'transmissionMap', 'thicknessMap',
    'clearcoatRoughnessMap', 'clearcoatNormalMap',
    'iridescenceMap', 'iridescenceThicknessMap',
    'sheenRoughnessMap',
    'anisotropyMap',
    'specularIntensityMap',
])
// All other maps are sRGB-encoded color (map, emissiveMap, sheenColorMap, specularColorMap).
```

## Repro

1. Drop a transmission map onto a `transmissionMap` image input.
2. Render — transmission appears wrong because the data was treated as sRGB-encoded.
3. Manually set `material.transmissionMap.colorSpace = LinearSRGBColorSpace` → renders correctly.

## Severity

High — visibly incorrect material rendering for any of the listed slots.
