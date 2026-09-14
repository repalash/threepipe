# PhysicalMaterial: `MeshStandardMaterial2` deprecation message names the wrong replacement class

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The deprecation message logged by `MeshStandardMaterial2` tells the user to use `UnlitMaterial` instead, but `MeshStandardMaterial2 extends PhysicalMaterial` — the correct replacement is `PhysicalMaterial`. `UnlitMaterial` is the unlit/basic material and is not a substitute.

## Root Cause
```ts
export class MeshStandardMaterial2 extends PhysicalMaterial {
    constructor(parameters?: MeshPhysicalMaterialParameters) {
        super(parameters)
        console.error('MeshStandardMaterial2 is deprecated, use UnlitMaterial instead')
    }
}
```
The class extends and forwards to `PhysicalMaterial`, so steering users to `UnlitMaterial` is a copy-paste error in the message text.

## Impact
Misleading deprecation log: developers following the advice swap to `UnlitMaterial` and lose all PBR/lighting behavior. Cosmetic (message-only), but actively wrong guidance.

## Fix
```ts
console.error('MeshStandardMaterial2 is deprecated, use PhysicalMaterial instead')
```

## Files
- `src/core/material/PhysicalMaterial.ts:400` — wrong replacement class in deprecation message
