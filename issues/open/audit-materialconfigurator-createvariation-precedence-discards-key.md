# MaterialConfiguratorBasePlugin.createVariation: operator-precedence bug discards the supplied `variationKey`

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
When a caller supplies a `variationKey`, it is used only as a truthiness flag and is **never** stored as the variation `uuid`. The created variation is keyed by the escaped material name instead, so a later lookup by the same `variationKey` will not find it.

## Root Cause
```ts
uuid: variationKey ?? material.name.length > 0 ? escapeRegExp(material.name) : material.uuid,
```
`>` binds tighter than `?:`, and `?:` is the lowest-precedence operator, so this parses as:
```ts
(variationKey ?? (material.name.length > 0)) ? escapeRegExp(material.name) : material.uuid
```
With a truthy `variationKey`, the condition is always truthy → result is always `escapeRegExp(material.name)`. Verified by evaluation: `variationKey='myKey', name='Mat'` yields `escapeRegExp('Mat')`, not `'myKey'`.

## Impact
Breaks the `addVariation(mat, variationKey)` contract: `addVariation` looks up the existing variation via `findVariation(variationKey ?? material.uuid)` but `createVariation` stores a different key (escaped material name). The `variations.uuid` silently differs from what was requested, so subsequent lookups by `variationKey` miss and duplicate/mismatched variations result.

## Fix
Parenthesize so `variationKey` is actually used:
```ts
uuid: variationKey ?? (material.name.length > 0 ? escapeRegExp(material.name) : material.uuid),
```

## Files
- `src/plugins/configurator/MaterialConfiguratorBasePlugin.ts:431` — operator-precedence bug
