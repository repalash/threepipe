# plugin-procedural: Blender stores some attributes as a single value; layers here are always arrays

**Found by**: track2-procedural, 2026-10-18 (cases `meshCluster/merge-points` with radius 1 ulp off; `node_geo_dual_mesh.cc` transfer).

Blender 5.x `AttributeStorage` keeps an attribute as `Attribute::SingleData` when it is created from
`AttributeInitValue`, or from `AttributeInitVArray` with a single-value varray, and its name does not need array
storage (`attribute_init_to_data`, `blenkernel/intern/attribute_storage_access.cc:76`). That covers Mesh to Points'
constant radius, a constant field stored or captured, and `add(..., AttributeInitValue)` in many operations. A
single-data attribute reads as a single varray (`CommonVArrayInfo::Single`). Code that tests for that takes another
path:
- Merge Points / `merge_points` (`point_merge.cc:78`) and `retrieve_attributes_for_transfer` copy the value
  instead of mixing groups. Mixing k copies of 0.05f gives 0.049999997 here, but Blender stores 0.05 exactly.
  This is the measured difference: `merge-points` radius, 4 of 15 values, 1 ulp.
- Domain adaptation (`adapt_domain`) of a single varray stays single, with no averaging.
- Dual Mesh's `transfer_attributes` adds single attributes with their value on every element. That includes
  boundary-edge midpoints, which the array path leaves at zero.

The kernel's `AttributeLayer` has only array data, and `AttributeStorage.clone` copies arrays, so the procedural
package cannot record "single" on a layer that survives copies.

**Proposal** (kernel data model, needs a decision): give `AttributeLayer` an optional single-value representation, or
a flag kept by `clone`. The procedural accessor would then set it where Blender creates single data (`add` with a
value; capture/store of a single field when the name does not require arrays). It would clear it on
`layerForWrite`, and `lookup` would return single varrays for such layers. Until then, results that mix or adapt
constant attributes can differ from Blender by an ulp. The cases record these as "pass (<= N ulp)", with this
issue as the cause.
