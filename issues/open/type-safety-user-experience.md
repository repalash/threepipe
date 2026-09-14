# Type Safety UX: Raw three.js Objects vs threepipe Extended Types

## Problem

Users creating three.js objects (Mesh, Material, BufferGeometry) and using them with threepipe APIs face confusing TypeScript errors because threepipe's extended interfaces (`IObject3D`, `IMaterial`, `IGeometry`) are not assignable from raw three.js types — even though threepipe upgrades them at runtime.

### Common user scenarios that fail

**1. Creating a mesh and listening for threepipe events:**
```typescript
const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
viewer.scene.addObject(mesh)
mesh.addEventListener('objectUpdate', () => { ... })
// TS error: '"objectUpdate"' is not assignable to parameter of type 'keyof Object3DEventMap'
```

**2. Accessing material properties after addObject:**
```typescript
const mesh = new Mesh(new BoxGeometry(), new PhysicalMaterial())
viewer.scene.addObject(mesh)
mesh.material.color.set('red')     // TS error: 'color' doesn't exist on Material | Material[]
mesh.material.setDirty()           // TS error: 'setDirty' doesn't exist
```

**3. Passing threepipe materials to three.js constructors:**
```typescript
const mesh = new Mesh(geometry, new PhysicalMaterial())
// TS error: PhysicalMaterial not assignable to Material (toJSON signature mismatch)
```

### Root cause

threepipe extends three.js types with extra properties:
- `IObject3D` adds: `setDirty()`, `material` as `IMaterial`, custom events (`objectUpdate`, `geometryUpdate`, etc.)
- `IMaterial` adds: `setDirty()`, `materialExtensions`, custom `toJSON(meta: SerializationMetaType)`
- `IGeometry` adds: `setDirty()`, `appliedMeshes`, `center2()`

These extended interfaces don't type-check against their base three.js counterparts because:
- The `toJSON` signatures differ (`SerializationMetaType` vs `JSONMeta`)
- Extra required properties don't exist on the base types
- `material` on `Mesh` is `Material | Material[]`, on `IMesh` it's `IMaterial | IMaterial[]`

At **runtime** this is fine — threepipe upgrades all objects added to the scene via `addObject()`. But **TypeScript** doesn't know about runtime upgrades.

---

## Current workarounds (not ideal)

### Use return value of addObject
```typescript
// Instead of:
const mesh = new Mesh(geo, mat)
viewer.scene.addObject(mesh)
mesh.addEventListener('objectUpdate', ...) // error

// Do:
const mesh = viewer.scene.addObject(new Mesh(geo, mat))
mesh.addEventListener('objectUpdate', ...) // works — return type is Mesh & IObject3D
```
**Status:** Fixed in r168 upgrade — `addObject` now accepts `Object3D | IObject3D`.

### Use threepipe constructors
```typescript
// Instead of:
new Mesh(geo, new MeshBasicMaterial())

// Do:
new Mesh2(new BufferGeometry2(), new PhysicalMaterial())
```
But this forces users to change all their constructors.

### Cast everywhere
```typescript
;(mesh.material as IMaterial).setDirty()
```
Noisy and confusing for new users.

---

## Possible improvements

### 1. Document the `addObject` return value pattern
**Effort: Low. Impact: High.**

Update guides, examples, and README to consistently show:
```typescript
const obj = viewer.scene.addObject(new Mesh(...))
```
instead of the two-step pattern. Make this the recommended way.

### 2. Add `objectUpdate`/`geometryUpdate` to three.js `Object3DEventMap` via module augmentation
**Effort: Low. Impact: Medium.**

Since threepipe dispatches these on ALL objects in the scene (via `iObjectCommons.setDirty`), they belong on the base event map. This would let users call `mesh.addEventListener('objectUpdate', ...)` on any `Object3D` without casts.

**Trade-off:** Pollutes the base three.js type with threepipe-specific events. Could confuse users who also use stock three.js.

### 3. Make `IMaterial` compatible with `Material` for `toJSON`
**Effort: Medium. Impact: High.**

The core issue is `toJSON(meta?: SerializationMetaType)` vs three.js's `toJSON(meta?: JSONMeta)`. If `SerializationMetaType` extended `JSONMeta` (or if the `toJSON` override used a compatible signature), `PhysicalMaterial` would be assignable to `Material` and `new Mesh(geo, new PhysicalMaterial())` would work without casts.

**How:** Make `SerializationMetaType extends JSONMeta` or change `IMaterial.toJSON` to accept `JSONMeta`.

### 4. Generic `load()` / `addObject()` helper types
**Effort: Medium. Impact: Medium.**

Provide typed wrappers:
```typescript
// Already works:
const obj = await viewer.load<IObject3D>('model.glb')

// Could add:
const mesh = viewer.createMesh(geo, mat) // returns IMesh
```

### 5. Re-export common constructors as upgraded types
**Effort: Low. Impact: Medium.**

```typescript
// In threepipe:
export function createMesh(geo?: BufferGeometry, mat?: Material): IMesh {
    return new Mesh2(geo as any, mat as any)
}
```
Hides the cast from users.

### 6. Widen `IObject3D` generics to accept base three.js types
**Effort: High. Impact: High.**

Change `IObject3D<TG extends IGeometry>` to `IObject3D<TG extends BufferGeometry | IGeometry>`. Would make `Mesh as IObject3D` work without `unknown` intermediate. But could weaken type safety in internal code.

---

## Priority

1. **Document `addObject` return value pattern** — do this now
2. **`SerializationMetaType extends JSONMeta`** — fixes the `toJSON` cascade, biggest user impact
3. **Module augmentation for common events** — debatable, discuss trade-offs
4. **Helper constructors** — nice-to-have
