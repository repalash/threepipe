# `extrudeFaceRegion` always deletes the originals; Blender only sometimes does

Found while porting `spin` (`plugins/mesh-kernel/src/generate/spin.ts`). Not a blocker for the lathe,
which spins a wire profile and never reaches this path, but it is a real parity gap in an operator the
rest of the milestone builds on.

## What Blender does

`bmo_extrude_face_region_exec` (`source/blender/bmesh/operators/bmo_extrude.cc:319`) decides whether to
delete the input region at all, rather than always doing it:

```c
if (!BMO_slot_bool_get(op->slots_in, "use_keep_orig")) {
  BM_ITER_MESH (e, &iter, bm, BM_EDGES_OF_MESH) {
    if (!BMO_edge_flag_test(bm, e, EXT_INPUT)) continue;
    found = false; edge_face_tot = 0;
    BM_ITER_ELEM (f, &fiter, e, BM_FACES_OF_EDGE) {
      if (!BMO_face_flag_test(bm, f, EXT_INPUT)) { found = true; delorig = true; break; }
      edge_face_tot++;
    }
    if ((edge_face_tot > 1) && (found == false)) BMO_edge_flag_enable(bm, e, EXT_DEL);
  }
  ...
}
...
if (delorig) BMO_op_exec(bm, &delop);
```

`delorig` is set only when some edge of the region has an adjacent face *outside* the region. So:

- Extruding a face of a cube: every edge has a second, non-input face, `delorig` is true, the original
  is deleted. This is what the kernel already does, and `extrude.test.ts` covers it.
- Extruding the single face of a plane, or a whole connected island with nothing attached to its
  border: no edge has an outside neighbour, `delorig` stays false, and **the original is kept**. This
  is why extruding a Plane in Blender gives a closed box rather than an open one.

## What the kernel does

`extrudeFaceRegion` (`plugins/mesh-kernel/src/ops/extrude.ts`) deletes the region unconditionally when
`keepOriginal` is false. For the cube case that agrees with Blender; for the lone-face and
whole-island cases it does not.

## How it shows up

`spin.test.ts > spin - face input > sweeps a face region into a closed torus-like tube` asserts
`4 * steps + 1` faces. Blender would produce `4 * steps + 2` - the first cap survives too - and the
sweep would come out closed (`V - E + F = 2`) instead of open at one end (`= 1`). The test comment
points here.

## Why it was not fixed in place

Implementing `delorig` changes the result of existing `extrudeFaceRegion` tests (the 2x2 grid case
extrudes a whole island, so its originals would start surviving), and the brief for the spin/lathe work
says not to weaken or rewrite existing tests. It needs a decision on whether the kernel adopts
Blender's rule wholesale, plus the matching updates to `extrude.test.ts`.

## Fix sketch

1. In `extrudeFaceRegion`, classify the region's edges as Blender does and compute `delorig`.
2. Delete the originals only when `delorig`; also delete interior edges only via the same `EXT_DEL`
   rule (`edge_face_tot > 1 && !found`) rather than by the current "not a boundary edge" test.
3. Update `extrude.test.ts` for the island case, and add a lone-face case asserting a closed box.
4. Re-assert the spin face-input counts.
