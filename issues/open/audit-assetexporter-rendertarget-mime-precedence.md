# AssetExporter: renderTarget mime `||`/`!==` precedence has dead term (clarity)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The renderTarget export-mime expression mixes `||` and `!==` without parentheses. `!==` binds tighter than `||`, so the `'' !== ''` sub-term is dead code (always `false`), and the intended `(options.exportExt || '') !== ''` is not what executes. The bug has no behavioral impact for any reachable input, but the precedence is wrong and confusing.

## Root Cause
```ts
const mime = (options.exportExt || '' !== '') && options.exportExt !== 'auto' ?
    options.exportExt === 'exr' ? 'image/x-exr' : 'image/' + options.exportExt : 'auto'
```
`!==` binds tighter than `||`, so `(options.exportExt || ('' !== ''))` evaluates as `options.exportExt || false` = `options.exportExt`. The `'' !== ''` term is dead. Because `exportExt` is `string | undefined` and its only falsy value besides `undefined` is `''` (falsy in both forms), the buggy and intended `((exportExt || '') !== '')` forms produce identical results for every reachable value (`undefined`→auto, `''`→auto, `'png'`→image/png, `'exr'`→image/x-exr, `'auto'`→auto).

## Impact
None functionally — output is identical for all reachable inputs. Worth fixing for clarity / to remove the misleading dead term.

## Fix
```ts
const mime = ((options.exportExt || '') !== '') && options.exportExt !== 'auto' ? ... : 'auto'
```

## Files
- `src/assetmanager/AssetExporter.ts:161` — mis-parenthesized mime expression with dead `'' !== ''` term
