# three-svg-renderer find3dSingularities: `q` and `r` aliased to the same vertex (degenerate overlap test)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
In the face-overlap boundary test, `q` and `r` are both assigned from the identical expression `halfedge.next.vertex.position`, so they alias the same vertex. The overlap test is supposed to use the two *non-shared* vertices of the adjacent triangular face.

## Root Cause
```ts
const q = halfedge.next.vertex.position;
const r = halfedge.next.vertex.position;   // should be halfedge.prev.vertex.position
// ...
if (!sameSide(p,q,r,c,e) && sameSide(c,p,q,e,r) && sameSide(c,p,r,e,q)) {
    return true;
}
```
With `p = vertex.position` and the loop halfedge having `halfedge.vertex === vertex`, the other two face vertices are `halfedge.next.vertex` and `halfedge.prev.vertex` (= `halfedge.next.next.vertex`). `r` should be `halfedge.prev.vertex.position`. With `q === r` the triangle `(p,q,r)` is degenerate (zero area), so `orient3D` returns 0, `sameSide` collapses, and the curtain-fold-on-boundary detection is effectively broken.

## Impact
Wrong singularity classification on boundary vertices, which then changes chain splitting in the viewmap. Inherited from upstream LokiResearch/three-svg-renderer (the same erroneous line exists there), but it is a genuine correctness bug.

## Fix
`const r = halfedge.prev.vertex.position;`

## Files
- `plugins/svg-renderer/src/three-svg-renderer/core/viewmap/operations/find3dSingularities.ts:162-163` — `q` and `r` both read `halfedge.next.vertex.position`
