# TonemapPlugin.fromJSON: legacy `clipBackground` migration broken by refactor (reads before base-class spread)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The legacy migration that moves a deprecated `clipBackground` setting to `screenPass.clipBackground` reads `data.clipBackground` **before** the `{...data, ...data.extension}` spread that would promote it from `data.extension`. For legacy payloads where `clipBackground` lives under `data.extension`, the read is `undefined`, the migration body never runs, and the deprecated setting is silently dropped.

## Root Cause
```ts
fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
    // legacy
    if (data.extension) {
        if (data.clipBackground !== undefined) {                 // read BEFORE the spread
            if (this._viewer) this._viewer.renderManager.screenPass.clipBackground = data.clipBackground
            else console.warn('TonemapPlugin: no viewer attached, clipBackground ignored')
            delete data.clipBackground
        }
    }
    return super.fromJSON(data, meta)   // base class does {...data, ...data.extension} here, too late
}
```
Git history confirms the regression: the original override performed `data = {...data, ...data.extension}; delete data.extension` FIRST, then read `data.clipBackground`. The refactor moved the spread into the base class (`AScreenPassExtensionPlugin.fromJSON`) and deleted the local spread but kept the now-premature read.

## Impact
Legacy viewer configs with `clipBackground` under `extension` lose the setting on import — it is not migrated to `screenPass.clipBackground`. A real regression in the legacy-config migration path (not a pre-existing webgi quirk).

## Fix
Read from where the value actually lives at this point, e.g.:
```ts
const cb = data.clipBackground ?? data.extension?.clipBackground
```
(deleting from whichever object holds it), or perform the migration after `super.fromJSON` performs the spread.

## Files
- `src/plugins/postprocessing/TonemapPlugin.ts:132-142` — reads `data.clipBackground` before `super.fromJSON` spread
