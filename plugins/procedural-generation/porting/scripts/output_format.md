# Generator Output Format

## Graph Module (recommended)

Write a `.ts` file that exports a `graphModule: GraphModule`. This is the standard way to define a procedural generator.

```ts
import {
    defineNodeType, defineGraph,
    type GraphModule, type GeneratedInstance,
} from '@threepipe/plugin-procedural-generation/graph'

const myNode = defineNodeType(
    { width: {default: 5, ui: {bounds: [1, 20], stepSize: 1}} },
    { instances: [] as GeneratedInstance[] },
    (inp) => {
        // Generate instances with full world matrices
        return { instances: [{ world_matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], object_name: 'module.glb' }] }
    },
)('My Building')

export const graphModule: GraphModule = {
    graphs: [{
        graph: defineGraph([myNode], []),
        outputs: [{ node: myNode, output: 'instances' }],
    }],
    assets: ['module.glb'],
    assetsPath: './assets/',
}
```

### Verify against ground truth

```bash
./plugins/procedural-generation/porting/scripts/compare.sh my_graph.ts ground_truth.json
```

### View in browser

```ts
import {launchGraphViewer} from '@threepipe/plugin-procedural-generation'
import {graphModule} from './graph'
launchGraphViewer(graphModule)
```

The viewer auto-generates UI from node input metadata (PropDef `ui` fields).

## Instance Format

Each instance in the output must have:

```ts
interface GeneratedInstance {
    world_matrix: number[]   // 16 floats, column-major 4x4, Blender Z-up coordinates
    object_name: string      // GLB asset filename (e.g. 'object_B1_Window.glb', 'object_B1_Awning.glb')
}
```

**`object_name` must be the GLB filename** from the asset export, not the Blender object name. The viewer uses this to look up loaded meshes. A mismatch produces silently invisible instances.

- Individual objects: `object_Name.glb` (from ObjectInfo references)
- Collection members: each exported individually as `object_Member_Name.glb`. For collections with multiple members, use `members[point_index % members.length]` per instance (Pick Instance behavior).
- See the asset manifest from `export_assets.py` for the exact mapping and member order.

**`world_matrix` is in Blender Z-up coordinates** (matching ground truth). The viewer converts to three.js Y-up automatically.

### Column-major layout

```
[ m00, m01, m02, 0,    ←  column 0 (X axis direction + scale)
  m10, m11, m12, 0,    ←  column 1 (Y axis direction + scale)
  m20, m21, m22, 0,    ←  column 2 (Z axis direction + scale)
  tx,  ty,  tz,  1 ]   ←  column 3 (translation)
```

### Ground truth JSON format

Single config:
```json
{ "instances": [{ "world_matrix": [...], "object_name": "..." }] }
```

Multi-config (multiple buildings):
```json
{ "configs": [{ "name": "Building 1", "instances": [...] }, ...] }
```

## Comparison

The comparison checks ALL 16 matrix values per instance. A position-only match is reported separately and is NOT a pass — rotations and scales must also match.

### Direct JSON comparison (legacy)

```bash
npx tsx porting/scripts/compare_ground_truth.ts generated.json ground_truth.json
```
