# Rhino3dmLoader2: `userData.layers` indexed without null guard

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`Rhino3dmLoader2` reads `ret.userData.layers` and indexes it per-object inside the traverse with no null guard. If a 3dm file produces no `userData.layers`, `layers[layerIndex]` throws `TypeError` and aborts the entire load.

## Root Cause
```ts
const layers = ret.userData.layers                 // may be undefined
ret.traverse((obj) => {
    ...
    const layerIndex = obj.userData.attributes?.layerIndex ?? obj.userData.defAttributes?.layerIndex
    const layer = layers[layerIndex]               // throws if layers is undefined
    if (layer) obj.userData.rhinoLayer = layer
    ...
})
```
three.js's base Rhino loader normally populates `userData.layers`, so this is an edge/defensive case (low confidence it triggers in practice), but the unguarded index would crash the whole import if it ever is undefined.

## Impact
A 3dm file without `userData.layers` aborts the entire load with a `TypeError` instead of importing geometry without layer metadata.

## Fix
```ts
const layers = ret.userData.layers || []
```

## Files
- `src/assetmanager/import/Rhino3dmLoader2.ts:60` — `layers` may be undefined; indexed at line 67 without guard
