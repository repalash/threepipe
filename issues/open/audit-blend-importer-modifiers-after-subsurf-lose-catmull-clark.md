# blend-importer mesh.ts: modifiers after a Subsurf lose Catmull-Clark (cage dropped) and re-weld seam normals

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`mesh.ts` evaluates the modifier stack in order. The faithful Catmull-Clark
subdivision path is taken only when `geometry.userData.__cage` is present. But
`mirrorGeometry` / `arrayGeometry` / `solidifyGeometry` each build a fresh
`BufferGeometry` and never copy `userData.__cage` forward. So a stack ordered e.g.
`[Mirror, Subsurf]` (legal in Blender, and visually distinct from
`[Subsurf, Mirror]`) loses the cage at the Mirror step and the subsequent Subsurf
silently degrades to the Loop approximation instead of faithful Catmull-Clark.

Separately, when Subsurf is NOT last, the following modifier calls
`out.computeVertexNormals()`, which averages by vertex INDEX. The CC path
deliberately splits vertices at UV seams (`catmull.ts` `finalIdxOf` keyed by
`posIdx|uvIdx`) but gives both copies the same smooth normal; `computeVertexNormals`
re-derives per-index normals, so the two seam copies get DIFFERENT normals → a
shading crease reappears along every UV seam.

## Root Cause
```ts
// mesh.ts:63 — Catmull-Clark path gated on the cage in userData
const cage = geometry.userData && geometry.userData.__cage
```
The downstream modifiers each construct a new geometry without carrying
`userData.__cage`, then unconditionally recompute normals:
```ts
// mirror.ts:95
out.computeVertexNormals()
// array.ts:83
out.computeVertexNormals()
// solidify.ts:109
out.computeVertexNormals()
```

## Impact
Fidelity regression limited to the (less common) Subsurf-not-last ordering: the
geometry is still produced, but a Subsurf preceded by Mirror/Array/Solidify uses the
Loop approximation instead of Catmull-Clark, and seam shading creases reappear when
a modifier recomputes normals after CC.

## Fix
Carry `userData.__cage` through the mirror/array/solidify outputs (or apply Subsurf
first when a cage exists, matching most real stacks). Skip `computeVertexNormals`
when the input already has a `normal` attribute (preserve provided normals) rather
than recomputing unconditionally.

## Files
- `plugins/blend-importer/src/loader/mesh.ts:63` — reads `userData.__cage` to choose CC path
- `plugins/blend-importer/src/loader/mirror.ts:95` — fresh geometry, drops `__cage`, recomputes normals
- `plugins/blend-importer/src/loader/array.ts:83` — fresh geometry, drops `__cage`, recomputes normals
- `plugins/blend-importer/src/loader/solidify.ts:109` — fresh geometry, drops `__cage`, recomputes normals
