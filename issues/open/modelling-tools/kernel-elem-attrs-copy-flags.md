# Element creation does not follow `BM_elem_attrs_copy`'s flag rule

Found while porting inset (`plugins/mesh-kernel/src/ops/inset.ts`), which depends on the rule in both
directions and had to work around it with three private `*CreateFrom` helpers.

## What Blender does

`BM_elem_attrs_copy` (`source/blender/bmesh/intern/bmesh_construct.cc:333-395`) copies a source
element onto a destination like this:

- the destination **keeps its own select bit**
- everything else in the header comes from the source, **including `BM_ELEM_TAG`**
- `v->no` and `f->no` are copied too — the file says so explicitly at `bmesh_core.cc:170`

## What the kernel does

`BMesh.vertCreate` / `edgeCreate` / `faceCreate` take an `example` and do the exact opposite:

```ts
f.hflag = example.hflag & ~(ElemFlag.Tag | ElemFlag.InternalTag)
```

`Tag` is stripped, `Select` is inherited, and the cached normal is not copied.

## Why it matters

Both halves bite:

- **Tags must survive onto separated geometry.** Inset separates an edge and then relies on the tag it
  set beforehand still being there. Stripping it breaks the pass that follows.
- **A new face must not arrive selected.** Inheriting `Select` from the example desynchronises
  `bm.totfacesel` against the actual flags, because the counters are maintained by
  `faceSelectSet`/`edgeSelectSet`/`vertSelectSet`, not by `faceCreate`. Several operators already
  clear the bit by hand immediately after creating — `duplicateGeometry` does exactly that — which is
  the workaround spreading rather than the rule being followed.

## The fix

Change the three `*Create` methods to Blender's rule, then delete the by-hand `Select` clearing in
`ops/duplicate.ts` and the private `*CreateFrom` helpers in `ops/inset.ts`. Copy `no` while there.

Not done yet because it touches every operator's output flags at once and the suite (752 tests) needs
to be read carefully afterwards rather than just re-run — a test that happened to depend on the
inherited select bit would fail for a good reason, and a test that happened to depend on the stripped
tag would fail for a bad one. It wants its own pass, not a drive-by.

## Related

Two more promotions the same port asked for, tracked here rather than separately:

- `bmesh_kernel_edge_separate`, `bmesh_kernel_vert_separate` and
  `bmesh_kernel_unglue_region_make_vert` are general topology surgery and are private in `inset.ts`
  only because `bmesh/euler.ts` was owned by another agent at the time. They belong beside the Euler
  operators.
- `bmesh_core.cc:2772` has an inverted condition upstream in
  `bmesh_kernel_unglue_region_make_vert`: the test reads
  `while (!ELEM(e_iter, l_sep->e, l_sep->prev->e))`, while its comment, its `BLI_assert` and the
  `#if 0`'d block above all describe the opposite, making the no-op early return unreachable. Ported
  as shipped, with a comment saying so. The resulting geometry is identical either way for inset's
  purposes; worth revisiting if a future operator depends on the no-op path.
