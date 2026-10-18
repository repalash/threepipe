# plugin-procedural: Scale Elements on islands averaging more than 1000 elements

**Found by**: track2-procedural, 2026-10-18, while porting `node_geo_scale_elements.cc`.

`gather_groups` (`node_geo_scale_elements.cc:120`) groups the selected faces or edges by island. When
`elements / islands > 1000` it switches to `from_indices_large_groups` (:72). That function sorts each 1024-element
segment by island with `parallel_sort`, which is `tbb::parallel_sort` with a pre-test for already-sorted input,
quick-sort partitioning above 500 elements, and libc++ `std::sort` below. None of these sorts is stable. The
resulting order of elements inside an island is the order in which `gather_mean` sums Scale, Center and Axis, so the
means and the positions depend on it at the float32 ulp level.

The port throws for that branch: "Scale Elements with more than 1000 elements per island ... is not ported yet".
Vertex grouping is not affected, because vertices are moved independently of their order.

**Fix**: port oneTBB's `parallel_sort` (`quick_sort_pretest_body`, `quick_sort_range` with its pseudo-median-of-9
split, using the oneTBB version in Blender 5.2's macOS libs) and libc++'s `std::sort` (`__introsort`, ninther pivot,
`__partition_with_equals_on_right/left`, `__insertion_sort_incomplete`, using the libc++ version of the Xcode that
built Blender 5.2.2). Then verify against Blender with a single 2000-face island and with several islands averaging
more than 1000 faces. Both ports would also serve the other `parallel_sort` users whose output depends on unstable
order.
