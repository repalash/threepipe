# Generator Output Format

Your procedural generator must produce a JSON file in this format to be comparable against Blender ground truth.

```json
{
  "instances": [
    {
      "world_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1],
      "object_name": "module_name.glb"
    }
  ]
}
```

## Fields

- **`world_matrix`**: 16 floats, column-major 4x4 matrix (same format as Blender's depsgraph). Contains position (indices 12,13,14), rotation (columns 0-2 rows 0-2), and scale (column magnitudes).
- **`object_name`**: The GLB asset path or module name. Must match what the scene builder uses to look up the mesh.

## Column-major layout

```
[ m00, m01, m02, 0,    ←  column 0 (X axis direction + scale)
  m10, m11, m12, 0,    ←  column 1 (Y axis direction + scale)
  m20, m21, m22, 0,    ←  column 2 (Z axis direction + scale)
  tx,  ty,  tz,  1 ]   ←  column 3 (translation)
```

## Comparison

Run the standard comparison script:

```bash
npx tsx porting/scripts/compare_ground_truth.ts generated.json ground_truth.json
```

This compares ALL 16 matrix values per instance. A position-only match is reported separately and is NOT a pass — rotations and scales must also match for the visual output to be correct.
