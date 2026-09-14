# LoadingScreenPlugin: out-of-range serialized `loader` index crashes `_updateMainDiv`

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`loader` is a serialized dropdown index, but `spinners` has only one entry and `_updateMainDiv` indexes it with no bounds check. A serialized config (or future API set) with `loader >= spinners.length` makes `this.spinners[this.loader]` undefined → `.html` throws and breaks the whole loading-screen update.

## Root Cause
```ts
@uiDropdown('Loader', ['Spinner 1'].map((v, i) => ({value: i, label: v})))
@serialize() loader = 0
...
this._setHTML(this.loadingElement, this.spinners[this.loader].html)   // no bounds check
```
The dropdown UI only lists `['Spinner 1']`, so this is reachable only via deserialization of a bad/forward value — hence low.

## Impact
A bad/forward serialized `loader` value crashes the loading-screen update path.

## Fix
Clamp/guard:
```ts
this._setHTML(this.loadingElement, (this.spinners[this.loader] ?? this.spinners[0])?.html)
```

## Files
- `src/plugins/interaction/LoadingScreenPlugin.ts:31` — `@serialize() loader = 0`
- `src/plugins/interaction/LoadingScreenPlugin.ts:209` — unguarded `this.spinners[this.loader].html`
