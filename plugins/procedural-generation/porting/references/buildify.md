# Buildify-Specific Porting Patterns

Read this reference when porting grid-based or edge-based building generators (Buildify-style).

## Grid-based building generators use offset wall positions

When geometry nodes create wall grids using MeshGrid, the wall face is offset by `moduleLength / 2` beyond the grid edge. The wall position formula is `(dimension + 1) * moduleLength / 2`, not `dimension * moduleLength / 2`. This means a building with X=5, moduleLen=3 has its front wall at Y = (3+1)*3/2 = 6, not 3*3/2 = 4.5.

Div and roof floors use the **inner grid** (no offset) while window and ground floors use the **outer grid** (with offset).

## Position-only matching is insufficient

Comparing just the XYZ position of instances (matrix indices 12,13,14) catches placement errors but misses rotation and scale errors. Two instances at the same position but different rotations look completely different visually. Always compare the full 16-value world matrix using the standard comparison script. A "200/200 position match" with 36 rotation mismatches means the building looks wrong.

## Ground truth positions include object origin offset

Instance world matrices in the ground truth include the Blender object's origin position. When comparing generated positions against ground truth, subtract the object origin (available in the `location` field of the ground truth JSON). For example, Building 1 has origin at (-0.091, 0, 0), which shifts all X positions by -0.091.

## Div/roof corners use clockwise rotation assignment

Inner grid corners (div floor, roof floor) do NOT inherit the rotation of the wall face they're geometrically on. Instead, each corner gets the rotation of the wall face to its **clockwise left** (as seen from above):
- Corner at (-X, -Y) -> left wall rotation (Rz(-90deg))
- Corner at (+X, -Y) -> front wall rotation (Rz(0deg))
- Corner at (+X, +Y) -> right wall rotation (Rz(+90deg))
- Corner at (-X, +Y) -> back wall rotation (Rz(180deg))

All inner grid corners have scale [1,1,1] (no flip), unlike outer grid corners which use scale flips.

## Resample Curve LENGTH mode uses floor(), not round()

Blender's Resample Curve in LENGTH mode computes point count as `int(curve_length / sample_length) + 1` (source: `geometry/intern/resample_curves.cc` line 44). The `int()` cast is a floor operation. The number of wall segments (instances) = count - 1 = `floor(curve_length / sample_length)`.

Using `Math.round()` instead of `Math.floor()` produces different wall counts for many segment lengths, causing instance count mismatches. This was discovered during demo-4 porting where the .blend uses moduleWidth=3 but `round(len/3)` gave 38 walls/floor while `floor(len/3)` correctly gave 28.

## Edge-based buildings: coordinate conversion at the boundary

For edge-based generators (Buildify-style, using `meshToCurveSplitTrim` + `alignEulerToEdgeNormal`), the compute functions work in three.js Y-up internally. Convert to Blender Z-up only at the output boundary using:
```typescript
// three.js (tx, ty_height, tz_depth) -> Blender (tx, -tz, ty)
fromLocRotScale(tx, -tz, ty, 0, 0, rotY, scaleX, 1, 1)
```
The rotation value (rotY in three.js = rotZ in Blender) is the same number -- both represent rotation around the up axis.

## Export base geometry without modifiers

When exporting a mesh that has a GeometryNodes modifier (e.g. building_base for the roof plane), `export_apply=True` in the glTF exporter evaluates all modifiers first -- you get the full generated building, not the base mesh. Remove modifiers before export: `for m in list(obj.modifiers): obj.modifiers.remove(m)`. Also apply the object transform (`bpy.ops.object.transform_apply(location=True)`) so vertices are in world space, matching the wall placement coordinates.
