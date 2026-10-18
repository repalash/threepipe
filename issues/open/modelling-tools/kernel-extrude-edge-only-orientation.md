# `extrudeEdgeOnly` cannot be chained: the new rim edge comes back reversed

Found while porting the primitives (`plugins/mesh-kernel/src/generate/primitives.ts`). Blender's UV
sphere is built by extruding one meridian arc of wire edges `u_segments` times, rotating between each
step, so the operator has to be chainable. The kernel's version is not.

## What goes wrong

`extrudeEdgeOnly` (`plugins/mesh-kernel/src/ops/extrude.ts`) creates the side quad and lets
`faceCreate` create whatever edges are missing:

```ts
const face = bm.faceCreate([a, b, b2, a2])
```

`faceCreate` walks the vertex list and creates `(a,b)`, `(b,b2)`, `(b2,a2)`, `(a2,a)`. The far-side
edge is therefore stored as `v1 = b2, v2 = a2` - the *reverse* of the original `v1 = a, v2 = b` it was
extruded from. Extruding that rim again reads `e.v1`/`e.v2` and so builds the next quad with the
opposite winding: the two faces traverse their shared edge in the same direction instead of opposite
ones, which is exactly the definition of inconsistent winding. A ribbon extruded twice has alternating
normals; the operator's own tests never notice, because they only extrude once.

`ExtrudeResult` also has no `edges` field, so a caller cannot even recover the new rim except by
looking the edges up by endpoint - at which point it gets the reversed orientation anyway.

## What Blender does

`bmo_extrude_edge_only_exec` (`source/blender/bmesh/operators/bmo_extrude.cc:167`) runs `duplicate`
first, which creates the copy with `BM_edge_create(bm, vmap[e->v1], vmap[e->v2], e, ...)` and so keeps
the endpoint order, and hands back a `boundary_map` from each original edge to its copy. It then picks
the quad's winding explicitly rather than assuming one:

```c
const bool edge_normal_flip = !(e->l && e->v1 != e->l->v);
if (edge_normal_flip == use_normal_flip) {
  f_verts[0] = e->v1; f_verts[1] = e->v2; f_verts[2] = e_new->v2; f_verts[3] = e_new->v1;
}
else {
  f_verts[0] = e->v2; f_verts[1] = e->v1; f_verts[2] = e_new->v1; f_verts[3] = e_new->v2;
}
```

A wire edge has no loop, so it takes the second branch; a rim edge that already carries a face takes
whichever branch keeps the new quad consistent with the face already on it.

## Fix

Port the operator properly in `ops/extrude.ts`:

- create the duplicated edges explicitly with the original endpoint order, not as a side effect of
  `faceCreate`,
- choose the quad winding from `edge_normal_flip`,
- add `use_normal_flip` as an option and return `edgeMap` on `ExtrudeResult`.

`primitives.ts` currently carries a private `extrudeEdgeOnlyOp` that does all of this, written for the
UV sphere; it should be moved into `ops/extrude.ts` and the private copy deleted.

## Regression test

Extrude a chain of wire edges twice and assert that every pair of adjacent faces traverses its shared
edge in opposite directions - or, equivalently, build a UV sphere and assert every face normal points
away from the centre, which is what `generate/primitives.test.ts` does today.

---

## Update — fixed in `ops/extrude.ts` by the spin/lathe work

The spin port hit the identical problem (a lathe is a rim extruded `segments` times) and the fix has
landed in `ops/extrude.ts`. `ExtrudeOptions` grew two flags, both defaulting to `false` so no existing
behaviour or test changed:

- `useNormalFlip` - Blender's `use_normal_flip`.
- `useNormalFromAdjacent` - Blender's `use_normal_from_adjacent`.

`extrudeEdgeOnly` now runs the full winding decision instead of assuming `[a, b, b2, a2]`:

```ts
const eNew = diskEdgeExists(a2, b2)
const edgeNormalFlip = useNormalFromAdjacent
    ? !(e.l !== null && e.v1 !== e.l.v)
    : !(eNew && eNew.l ? eNew.l.v === eNew.v1 : (!e.l || !(e.l.v === e.v1)))
const face = edgeNormalFlip === useNormalFlip
    ? bm.faceCreate([a, b, b2, a2])
    : bm.faceCreate([b, a, a2, b2])
```

With `useNormalFromAdjacent: true` this is `bmo_extrude_edge_only_exec` verbatim - the rule quoted
above. With it left off it is the first-extrusion rule of `bmo_extrude_face_region_exec`, which is
what the operator already did. **The two Blender operators genuinely differ by a flip on a wire edge**
(`edge_only` gets `edge_normal_flip = true` because `e->l` is null; `face_region` falls through to its
`e_new` arm and gets `false`), so the default had to stay put rather than switch to `edge_only`'s.

`ExtrudeResult` also gained `edgeMap`, the original edge to its new rim edge, in the orientation it was
extruded from - the `boundary_map.out` the issue asks for. Chaining is now:

```ts
edges = edges.map(e => res.edgeMap.get(e)!)
```

Regression tests added in `ops/extrude.test.ts` (`chained extrudeEdgeOnly`): four repeats of a wire
chain with `useNormalFromAdjacent`, asserting no two adjacent faces traverse their shared edge the same
way, plus an `edgeMap` orientation check.

**Remaining action: `primitives.ts` should delete its private `extrudeEdgeOnlyOp`** and call
`extrudeEdgeOnly(bm, edges, {useNormalFromAdjacent: true, useNormalFlip, selectResult: false})`.

Proof the tests bite: reverting `extrudeEdgeOnly` to the old unconditional `[a, b, b2, a2]` fails 21
tests across `spin.test.ts` and `lathe.test.ts` and 0 pre-existing ones - which is also why the bug
survived this long.
