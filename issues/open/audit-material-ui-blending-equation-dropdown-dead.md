# Material UI: custom-blending equation dropdown bound to non-existent `blendingEquation`

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The Custom-blending equation dropdown in the material UI binds to a property named `blendingEquation`, which does not exist on any three.js material. The real property is `blendEquation`. The control reads/writes `undefined` and has no effect on the material's blend equation.

## Root Cause
```ts
{
    type: 'dropdown',
    hidden: ()=>material.blending !== CustomBlending,
    property: [material, 'blendingEquation'],   // wrong property name
    children: ([
        ['Add', AddEquation],
        ['Subtract', SubtractEquation],
        ...
    ])
}
```
`grep blendingEquation three.js-modded/src/` returns zero hits; the actual property is `blendEquation` (`Material.js`: `this.blendEquation = AddEquation`). Every other place in `src/` (threeMaterialPropList.ts, GLTFMaterialExtrasExtension.ts, RenderManager.ts) uses the correct `blendEquation` — `IMaterialUi.ts:167` is the only occurrence of the misspelled name in the whole tree.

## Impact
With `blending === CustomBlending`, the equation dropdown is inert: changing it never updates `material.blendEquation`, so custom blending equations cannot be set from the UI. Niche (custom blending is uncommon), hence medium rather than high.

## Fix
Rename to the real property:
```ts
property: [material, 'blendEquation'],
```

## Files
- `src/core/material/IMaterialUi.ts:167` — dropdown bound to non-existent `blendingEquation` (should be `blendEquation`)
