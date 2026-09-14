# Bug: `proxySetValue` deletes the wrong key from `staticData.tempMap`

## Summary

`plugins/tweakpane/src/tpImageInputGenerator.ts:187-193`:

```ts
let iMapKey = v.tp_src_uuid
if (!iMapKey) {
    iMapKey = v.src ?? v.tp_src
    iMapKey = staticData.tempMap[iMapKey] ?? iMapKey   // ← reassigned to the resolved uuid
    delete staticData.tempMap[iMapKey]                  // ← deletes by post-reassignment key
    v.tp_src_uuid = iMapKey
}
```

The original key inserted into `tempMap` (in `proxyGetValue:126`) is the URL string (e.g., a 160px data URL or blob URL). The `delete` here uses the *resolved uuid* — which was the value, not the key. The actual `tempMap[160pxURL]` entry is never cleared.

## Effect

`tempMap` accumulates one stale entry per render-then-drop sequence. Each entry holds a URL string (~5–80 KB for data URLs) and a uuid. Over a long session this grows unboundedly. Same kind of leak as the `textureMap` issue (see `tpImageInputGenerator-textureMap-leak.md`) but smaller per-entry.

Also: the `tempMap` was meant as a short-lived bridge from URL → uuid for one drag-drop pass. Stale entries can collide on subsequent reads if a URL gets reused (very unlikely with random UUIDs in URLs but theoretically possible).

## Fix

Capture the original key, delete that:

```ts
let iMapKey = v.tp_src_uuid
if (!iMapKey) {
    const srcKey = v.src ?? v.tp_src
    iMapKey = staticData.tempMap[srcKey] ?? srcKey
    if (srcKey != null) delete staticData.tempMap[srcKey]
    v.tp_src_uuid = iMapKey
}
```

## Severity

Low — cosmetic memory leak. Not a correctness issue (the tempMap leak doesn't change the resolved iMapKey or the imageMap registration).
