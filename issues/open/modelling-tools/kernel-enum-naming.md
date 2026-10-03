# mesh-kernel: two spellings for Blender enums

**Found**: 2026-10-03, merging p3-fill and p3-loop.

The kernel spells the same kind of value two ways.

- **Most ops use camelCase:** `SubdFalloff` (`'smooth' | ... | 'inverseSquare'`), `SubdQuadCornerType`,
  `PokeCenterMode`, `ArrayFitType`, `DissolveDelimit`, ... These cover subdivide, poke, array, loop cut
  and the slides.
- **Track F's ops use Blender's RNA identifiers:** `SubdivProfileShape` (`'SMOOTH' | ... | 'INVERSE_SQUARE'`),
  `SubdivRingInterp`, `BridgeLoopType`, `TriangulateQuadMethod`, `TriangulateNgonMethod`. These cover
  bridge, edge-ring, grid fill, dissolve and triangulate.

The redo panel shows the raw values, so the user sees both spellings. For example, the Edge-Ring panel
shows `PATH` / `SMOOTH`, while Loop Cut's falloff shows `inverseSquare`. Two types also describe one
Blender enum: `SubdivProfileShape` and `SubdFalloff` are both `SUBD_FALLOFF_*`. Since the merge, one
`subdFalloffCalc` serves both, through `rna_enum_proportional_falloff_curve_only_items`'s mapping in
`subdivideEdgering.ts`.

**Decide**: which spelling is the public one. RNA identifiers match `bpy` and the Python API docs that
agents and Blender users know; camelCase matches the rest of threepipe. Separately from that choice,
the panel needs enum labels ("Blend Path", "Inverse Square"), as Blender's RNA items have.
