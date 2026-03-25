# Instanced Rendering for GraphViewer

**Parent:** [procedural-generation-status.md](procedural-generation-status.md)
**Status:** Complete
**Priority:** P1 — pebble scatter runs at ~1fps with 40k individual Mesh2 objects

## Problem
`buildSceneFromInstances()` in `GraphViewer.ts` creates a new `Group2` + `Mesh2` per instance. For the pebble scatter demo (40,758 instances), this means 40k+ draw calls — rendering is unusable.

## Solution
Group instances by `object_name`, then create one `InstancedMesh2` per (asset, submesh) pair. threepipe already provides `InstancedMesh2` (extends three.js `InstancedMesh`).

## Implementation

### Step 1: Group instances by asset name
```ts
const groups = new Map<string, GeneratedInstance[]>()
for (const inst of instances) {
    const list = groups.get(inst.object_name) ?? []
    list.push(inst)
    groups.set(inst.object_name, list)
}
```

### Step 2: For each group, create InstancedMesh2
For each asset in `modules`, for each submesh in that asset:
```ts
const instMesh = new InstancedMesh2(mesh.geometry, mesh.material, count)
for (let i = 0; i < count; i++) {
    // Convert Blender Z-up matrix to three.js Y-up
    // Set instance matrix
    instMesh.setMatrixAt(i, convertedMatrix)
}
instMesh.instanceMatrix.needsUpdate = true
```

### Step 3: Handle the Z-up → Y-up conversion
The existing `_m4.set(...)` conversion code stays the same, just applied per instance matrix instead of per group transform.

### Step 4: Shadows
`instMesh.castShadow = true` and `instMesh.receiveShadow = true` apply to all instances.

## Files to modify
- `plugins/procedural-generation/src/viewer/GraphViewer.ts` — `buildSceneFromInstances()`

## Files to read (not modify)
- `src/core/object/InstancedMesh2.ts` — threepipe's InstancedMesh wrapper
- `src/three/utils/gpu-instancing.ts` — any existing instancing utilities

## Verification
- Pebble scatter should render at interactive framerates (30+ fps)
- All existing demos (buildify, flower, flowers-on-building) still work correctly
- Matrix comparison still passes (rendering should match)

## Not doing
- LOD / culling (future optimization)
- Merging different assets into one draw call (not possible with different geometry)
