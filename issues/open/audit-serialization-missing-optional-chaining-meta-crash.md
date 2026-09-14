# serialization: Texture/RenderTarget serializers crash on partial `meta` (missing optional chaining)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The Texture and RenderTarget serializers guard `meta` with `meta?.` but then index `.textures` / `.extras` non-optionally. When a truthy-but-partial `meta` (one missing the `textures` or `extras` key) is passed, `meta?.textures` is `undefined` and `undefined[obj.uuid]` throws `TypeError`. Every sibling check uses the safe double-optional form, and the maintainer just fixed the identical pattern in `serializeTextureInExtras` (the committed `meta?.extras?.[...]` change), proving this is a real defect.

## Root Cause
```ts
// Texture serializer
if (meta?.textures[obj.uuid]) return {uuid: obj.uuid, resource: 'textures'}   // line 92
...
// RenderTarget serializer
if (meta?.extras[obj.uuid]) return {uuid: obj.uuid, resource: 'extras'}       // line 367
```
`meta?.textures` / `meta?.extras` is `undefined` for a partial meta, and `undefined[obj.uuid]` throws. Reachable: `Material.serialize` calls `Serialization.Serialize(v, meta2)` with `meta2 = meta ?? {textures: {}, images: {}}` — that fallback has **no `extras` key**. Serializing a material holding an `IRenderTarget`-typed property then runs `({textures:{},images:{}}).extras[obj.uuid]` → `undefined[uuid]` → crash. Same class of crash at line 92 for any truthy-but-partial meta missing `textures`.

Every sibling uses the safe form (material serializer `meta?.materials?.[...]`, texture deserialize `meta?.textures?.[...]`), and the committed fix at line 945 changed `meta?.extras[...]` → `meta?.extras?.[...]`.

## Impact
Serializing a material that references a render target (or any texture) without a fully-populated `meta` throws and aborts the serialization instead of falling through to inline the resource.

## Fix
Mirror the line-945 fix — add the second optional chain:
```ts
if (meta?.textures?.[obj.uuid]) ...   // line 92
if (meta?.extras?.[obj.uuid]) ...     // line 367
```

## Files
- `src/utils/serialization.ts:92` — Texture serializer `meta?.textures[obj.uuid]`
- `src/utils/serialization.ts:367` — RenderTarget serializer `meta?.extras[obj.uuid]`
