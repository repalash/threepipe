# kernel: find-doubles searches in input order, Blender in balanced KD-tree order

**Where**: `plugins/mesh-kernel/src/ops/removeDoubles.ts` (`findDoublesByDistance`).

Blender's `kdtree_calc_duplicates_cb` (`blenlib/BLI_kdtree.hh:802`) walks `tree->nodes[i]` after
`kdtree_balance`, which permutes the node array spatially, so clusters are grown from vertices in
tree order. The kernel's port replaces the tree with a direct range scan in input order and its
comment says "`duplicates_cb` sees the same candidate set either way". That holds for clusters whose
members are all within range of each other. It does not hold for chains (a~b, b~c, a not ~ c): which
vertex starts the search decides whether b joins a's cluster or c's.

Pairs are unaffected in the current source (`deduplicate_target_calc_fn` keeps the lower index of a
pair regardless of who searched). Blender 3.4.1 (`calc_duplicates_fast`) kept the searcher, which is
why `tests/bmesh-ops-mergebydistance-parity.test.ts` documents a pair-survivor version difference.

To fix exactly: port `kdtree_balance` (`BLI_kdtree.hh`) so the search order is Blender's, and add a
chain fixture (needs a Blender >= 4.1 binary for ground truth; the container has 3.4.1). Found while
wiring Merge by Distance into edit mode (track F, 2026-10-03). Not fixed: needs the maintainer's call
on porting the KD-tree.
