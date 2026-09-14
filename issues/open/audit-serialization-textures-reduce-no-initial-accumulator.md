# serialization: `json.textures.reduce` without initial accumulator corrupts first texture

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
In the legacy "textures is an array" branch, `reduce` is called without an initial accumulator. With a non-empty array, `acc` starts as the first texture object, so `acc[cur.uuid] = cur` mutates that first texture (adding sibling textures as uuid-keyed properties) instead of building a clean `{uuid: texture}` map. An empty array throws `Reduce of empty array with no initial value`.

## Root Cause
```ts
json.textures = json.textures.reduce((acc, cur) => {
    if (!cur) return acc
    acc[cur.uuid] = cur
    return acc
})   // no initial value
```
Without a seed, `acc` is `json.textures[0]`. The intended result (cf. `JSONMaterialLoader.ts`: `Object.fromEntries(json.textures.map(t => [t.uuid, t]))`) is a uuid-keyed map. This branch is already guarded by a `console.error('TODO: check file format')`, so it's a known-rough legacy/error path, but it silently corrupts the first texture and throws on empty arrays.

## Impact
On the legacy array path, the first texture object is mutated with foreign uuid keys (corrupting its data), and an empty textures array throws during deserialization.

## Fix
Pass an initial value:
```ts
json.textures = json.textures.reduce((acc, cur) => {
    if (!cur) return acc
    acc[cur.uuid] = cur
    return acc
}, {})
```

## Files
- `src/utils/serialization.ts:736` — `reduce` missing `{}` initial accumulator
