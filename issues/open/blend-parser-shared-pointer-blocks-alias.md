# `js.blend` resolves several meshes' data pointers to one another's blocks

**Severity**: high, and silent. Affected meshes import as empty or as a collapsed blob at the origin,
with no warning from the parser, the loader, or the console.

Package: `@threepipe/plugin-blend-importer` (`src/js-blend/parser/parser.js`).

Two distinct pointer fields are affected. Both are cases where Blender writes a pointer that is *not*
a unique heap address identifying one block.

## 1. `Mesh.attribute_storage.dna_attributes` (Blender 5.0+)

Every `Mesh` datablock in a multi-mesh 5.0 file resolves to **the same** attributes array.

Measured on `GeometryNodesFrenchHous.blend` (Blender 5.0, 488 mesh datablocks). Dumping
`attrs[0].__data_address__` and the `position` attribute's block for the first seven meshes:

```
MECircle       tot 15 15 1 15  | attrsAddr 5633004 | position size 4 dataAddr 5633365 len 48
MECylinder.001 tot 63 89 34 120 | attrsAddr 5633004 | position size 4 dataAddr 5633365 len 48
MEPlane        tot 4 4 1 4     | attrsAddr 5633004 | position size 4 dataAddr 5633365 len 48
MEPlane.001    tot 4 4 1 4     | attrsAddr 5633004 | position size 4 dataAddr 5633365 len 48
MEPlane.002    tot 10 15 6 24  | attrsAddr 5633004 | position size 4 dataAddr 5633365 len 48
...
```

Every mesh gets a four-vertex plane's attributes, while its own `poly_offset_indices` block describes
its own geometry. 445 of the file's 488 meshes are affected (the rest genuinely are four-vertex
planes, so they are indistinguishable rather than correct).

**Why.** `mesh_blend_write` (`blenkernel/intern/mesh.cc:390`) writes the array with

```c
BLO_write_generated_pointer_tag(writer, mesh->attribute_storage.dna_attributes);
```

`attribute_data.attributes` is a `Vector` local to the write scope, reused for every mesh, so the
pointer value written into the DNA is the same stack/heap address each time. It is a *tag*, and
Blender's reader resolves it through the generated-pointer mapping
(`attribute_storage.blend_read`), not by address. `parser.js` resolves pointers by address alone and
so hands every mesh the last block written under that tag.

**What it looks like today.** `createBufferGeometryFromAttributes` in `loader/geometry.ts` reads the
aliased four-element `.corner_vert` with the mesh's own face offsets; the range check at
`faceStart + faceVertCount <= loopCount` then rejects every face, and the mesh renders as nothing.

## 2. `Mesh.mvert` and the `vdata` `CD_MVERT` layer (pre-3.6 files)

On `blender-3.5-splash.blend`, 55 of the file's meshes resolve `mvert` to an `MLoopUV` block:

```
MECircle.005  totvert 224  mvert.length 336  mvert[0].blender_name = 'MLoopUV'
              vdata layer type 0 (CD_MVERT) data.length 336, first element has no `co`
              ldata 'UVMap' (CD_MLOOPUV) length 840, but totloop is 832
```

Both the convenience pointer (`Mesh.mvert`) and the `CustomData` layer's own `data` pointer land on
the same wrong block, and the `UVMap` layer's length does not match `totloop` either - so the address
map is producing collisions in this file rather than one field being read from the wrong offset.

**What it looks like today.** `createBufferGeometryOld` reads `vertices[loop.v].co`, gets `undefined`,
and leaves every position at 0, so the mesh imports as a point at the origin.

## Not introduced by the n-gon import work

Both were found while adding `loader/meshData.ts`, and both predate it. The new decoder detects the
inconsistency (the stored element counts disagree with the face offsets, or `MVert.co` is missing) and
returns `null`, which falls back to exactly the code path that was running before - so the *outcome*
is unchanged, but it now says why on the console instead of producing an empty mesh silently.

## Suggested fix

For (1), implement Blender's generated-pointer mapping: `BLO_write_generated_pointer_tag` pairs a tag
with the block that follows it in write order, so the reader needs to associate the tag with the next
`DATA` block of the matching size rather than with an address. That is a parser change, in
`parser.js`'s block-indexing pass.

For (2), the address collisions need diagnosing first - the likely cause is the 32-bit pointer
truncation path in `getPointer` (`parser.js:114`), which folds a 64-bit pointer into
`'<high>h|l<low>'` strings; a file large enough to reuse low words across blocks would collide. Worth
checking whether the affected blocks' full 64-bit addresses actually differ.

Until then, a cheap and worthwhile guard: have the parser cross-check a resolved `CustomData` layer's
block byte length against `totlayer`'s element count and the DNA struct size, and report a mismatch
rather than returning a block of a different struct type.
