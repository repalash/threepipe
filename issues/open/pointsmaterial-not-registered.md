# PointsMaterial not registered as serializable material template

**Created:** 2026-03-27
**Status:** Open
**Discovered via:** E2E tests (extra-importer-plugins, gltf-mesh-lines, pnts-load)

## Problem

When importing models with point cloud geometry (PNTS, OBJ point clouds, glTF with points), the console logs:
```
No material template found for type PointsMaterial
```

Three.js's `PointsMaterial` is used in `OBJLoader2` and `GLTFLoader2` but is not registered in `ThreeSerialization.SerializableMaterials`. The commented-out line in `GLTFLoader2.ts:58` confirms this was intentionally deferred:
```ts
// GLTFLoader.ObjectConstructors.PointsMaterial = PointsMaterial2
```

## Impact

- Point cloud materials lose their properties on serialization/deserialization
- Console error noise in 3 examples
- Not blocking — fallback material is used

## Fix Options

1. Create a `PointsMaterial2` class (like `PhysicalMaterial` extends `MeshPhysicalMaterial`) and register it
2. Or register the raw `PointsMaterial` as a serializable template without the full threepipe material wrapper
