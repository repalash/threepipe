# legacy: `legacySeparateMapSamplerUVFix` version compare crashes on 2-part versions and mis-orders patch ≥ 10

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The version comparison in `legacySeparateMapSamplerUVFix` (a) throws on a short/2-part version string when the minor is `7`, because it calls `version[2].toString()` while `version[2]` is `undefined`; and (b) compares only the first character of the patch lexicographically, so patch numbers ≥ 10 are mis-ordered.

## Root Cause
```ts
const version = (config.version ? config.version as string : '0.0.0').split('.').map(v => parseInt(v))
if (!(config.type === 'ViewerApp' && version[0] === 0 && (version[1] < 7 || version[1] === 7 && version[2].toString()[0] < '6'))) {
    return
}
```
(a) **Crash**: `'0.7'` → `version = [0, 7]`, so `version[2]` is `undefined`. When `version[1] === 7`, `&&` reaches `version[2].toString()` → `undefined.toString()` → `TypeError`. Fires for `config.type === 'ViewerApp'`, major 0, truncated version.

(b) **Mis-order for patch ≥ 10**: `version[2].toString()[0] < '6'` takes only the first character and compares lexicographically. `'10'[0]` = `'1'` and `'1' < '6'` is `true`, so `0.7.10` (which is NOT older than `0.7.6`) is wrongly treated as needing the legacy fix. Patch should be compared numerically.

## Impact
A legacy/handcrafted `ViewerApp` config with a truncated version (`'0.7'`) throws during migration. Configs at `0.7.10`+ may have the legacy UV-sampler fix wrongly applied. Both are edge cases on the legacy-config path, hence low.

## Fix
Default missing parts to 0 and compare numerically:
```ts
const [maj = 0, min = 0, patch = 0] = (config.version || '0.0.0').split('.').map(v => parseInt(v) || 0)
if (!(config.type === 'ViewerApp' && maj === 0 && (min < 7 || (min === 7 && patch < 6)))) return
```

## Files
- `src/utils/legacy.ts:8` — `version[2].toString()[0] < '6'` crashes on short versions and mis-orders patch ≥ 10
