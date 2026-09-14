# three-svg-renderer splitViewEdge3d: colinearity test sums cross-product components instead of magnitude

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
To test whether `position` lies on the line through `a`-`b`, the code computes the cross product `(position-a) × (b-a)` and then **sums its components** instead of taking its magnitude. A non-colinear point whose cross product is e.g. `(k, -k, 0)` sums to 0 and is wrongly accepted as colinear.

## Root Cause
```ts
_u.subVectors(position, edge.a.pos3d);
_v.subVectors(edge.b.pos3d, edge.a.pos3d);

const cross = _u.cross(_v);
const v = cross.x + cross.y + cross.z;     // should be cross.length()
if (v > 1e-10 || v < -1e-10) {
    return null;
}
```
The cross product should be (near) the zero *vector* for colinearity; summing components lets cancelling components (e.g. `(1e0,-1e0,0)`) pass as zero.

## Impact
Used by the `computeMeshIntersections` path (`splitViewEdge3d`) when inserting intersection vertices: a mis-accepted point inserts a view vertex off the edge line. False-colinear acceptance is the real risk. Inherited from upstream LokiResearch source, but a genuine correctness bug.

## Fix
`if (cross.length() > 1e-10) return null;` (or compare `lengthSq` against `1e-20`).

## Files
- `plugins/svg-renderer/src/three-svg-renderer/core/viewmap/operations/splitEdge.ts:74-78` — cross-component sum used as the colinearity metric
