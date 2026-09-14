# computeScreenSpaceBoundingBox: z read from constant index `1+2` instead of `i+2`

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
`computeScreenSpaceBoundingBox` reads every vertex's z component from a constant buffer index (`1+2` = `3`) instead of the per-iteration `i+2`. So all geometry gets the z of the first vertex's second component, corrupting the world transform and the resulting screen-space bounding box.

## Root Cause
```ts
for (let i = 0; i < pos.count * pos.itemSize; i += pos.itemSize) {
    vertex.set(pos.array[i], pos.array[i + 1], pos.array[1 + 2])
```

`pos.array[1 + 2]` is the constant `pos.array[3]` (the y of the second vertex), not `pos.array[i + 2]`. Clear copy-paste typo: `1 + 2` should be `i + 2`.

## Impact
The function returns a wrong `Box2` for any buffered geometry. It is exported in the public API (`src/three/utils/index.ts`), so any consumer computing screen-space bounds (selection rects, screen-space layout/culling, etc.) gets incorrect results.

## Fix
```ts
vertex.set(pos.array[i], pos.array[i + 1], pos.array[i + 2])
```

(Separately, the `i += pos.itemSize` strided loop over `pos.array` is unsafe for `InterleavedBufferAttribute` and itemSize ≠ 3 — see the related low-severity issue; the robust form is `for (let i=0;i<pos.count;i++) vertex.set(pos.getX(i), pos.getY(i), pos.getZ(i))`.)

## Files
- `src/three/utils/bbox.ts:32` — `pos.array[1 + 2]` constant z index
- `src/three/utils/index.ts` — re-exports the function (public API)
