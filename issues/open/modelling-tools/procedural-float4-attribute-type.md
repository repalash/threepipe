# plugin-procedural: no FLOAT4 attribute type (only FLOAT_COLOR)

**Found by**: track2-procedural (nodes-mesh agent), 2026-10-18, while writing the Subdivide Mesh typed-attribute case.

Blender 5.2.2 has a generic 4-float attribute type next to the colour one: Store Named Attribute offers `FLOAT4`
(`rna_enum_attribute_type_items`, `makesrna/intern/rna_attribute.cc`), and the dump of a case that stores one reports
`"type": "FLOAT4"`. `@threepipe/plugin-procedural` maps attribute types through `RNA_DATA_TYPES`
(`src/nodes/attributeTypes.ts`), where `FLOAT_COLOR` is `float4` and `FLOAT4` is missing, so Store Named Attribute with
`data_type = 'FLOAT4'` throws "attribute data type FLOAT4 is not supported", and `geometryFromDump` cannot read a
dumped FLOAT4 layer either.

The arithmetic of both types is the same float4 maths (`ColorGeometry4f` mixes as `float4`), but they are distinct
attribute types in Blender (type shown in the spreadsheet, implicit conversions, socket type of reads), so mapping both
to one `DataType` loses the distinction on a round trip. Needs a decision on the data type set (a `float4` vs `color`
split in `DATA_TYPES`, or a type tag on the layer).

Case affected: none committed (`subdivMesh` typed case leaves FLOAT4 out and references this file).
