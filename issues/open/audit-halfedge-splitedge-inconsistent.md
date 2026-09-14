# HalfedgeDS.splitEdge leaves the halfedge structure inconsistent (3 broken invariants)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`splitEdge` turns `A --he--> B` (twin `B --twin--> A`) into `A --he--> v --newHe--> B` / `A <--twin-- v <--newTwin-- B`, but the next/prev rewire leaves three halfedge invariants broken.

## Root Cause
```ts
// Update next and prev refs
newHalfedge.next = halfedge.next;   // newHe.next = N (old he.next)
newHalfedge.prev = halfedge;
halfedge.next = newHalfedge;        // he.next = newHe
newTwin.next = twin;
newTwin.prev = twin.prev;           // newTwin.prev = Q (old twin.prev)
twin.prev = newTwin;
// twin.vertex never updated
```
1. `halfedge.next` (old `N`) still has `N.prev === halfedge` instead of `newHe`, so `N.prev.next !== N` — the doubly-linked next/prev cycle is inconsistent; a backwards walk skips `newHe`.
2. `twin.prev` (old `Q`) still has `Q.next === twin` instead of `newTwin` — same broken cycle on the twin side.
3. `twin.vertex` is never updated. After the split `twin` runs from `v` to `A`, so its source vertex must become the new vertex `v`; the code leaves `twin.vertex === B`. This breaks `Halfedge.id` (`vertex.id + '-' + twin.vertex.id`), `Halfedge.containsPoint` (uses `this.vertex.position`), and the CW/CCW vertex fan around `v` (which won't include `twin`). The twin pairing (`he`↔`twin`, `newHe`↔`newTwin`) is correct; only `twin.vertex` is stale.

## Impact
Latent today — the live SVG render path does not reach `HalfedgeDS.splitEdge` (`setFromGeometry` only uses addVertex/addEdge/addFace; the viewmap uses its own `ViewEdge` split ops), and the halfedge unit tests are all commented out. But this is a multi-defect correctness bug in an exported public operation; any caller of `HalfedgeDS.splitEdge` gets a corrupted structure.

## Fix
- Capture `const oldNext = halfedge.next;` then set `oldNext.prev = newHalfedge;` before `halfedge.next = newHalfedge;`.
- Capture `const oldPrev = twin.prev;` then set `oldPrev.next = newTwin;` before `twin.prev = newTwin;`.
- Set `twin.vertex = newVertex;`.

## Files
- `plugins/svg-renderer/src/three-mesh-halfedge/operations/splitEdge.ts:62-72` — the broken next/prev rewire and missing `twin.vertex` update
