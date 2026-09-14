# DropzonePlugin._onFileDrop: mutates the caller-owned `files` Map then re-emits it

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
When `_allowedExtensions` is set, the handler calls `files.delete(file)` directly on the `files: Map` it received from `Dropzone`, then dispatches that same mutated map in the `drop` event. It mutates shared input rather than a copy, so the dispatched `files` no longer matches the actual drop set / `nativeEvent.dataTransfer`.

## Root Cause
```ts
if (this._allowedExtensions !== undefined) {
    for (const file of files.keys()) {
        if (!this._allowedExtensions.includes(file.split('.').pop()?.toLowerCase() ?? '')) {
            files.delete(file)       // mutates the caller's Map
        }
    }
}
...
this.dispatchEvent({type: 'drop', files, imported, assets, nativeEvent})   // dispatches the mutated Map
```
`DropzonePluginEventMap['drop']` advertises `files` as the dropped files; consumers (e.g. `PickingPlugin._onDrop`) receive the filtered map, not the actual drop set.

## Impact
Side-effect on shared input; the dispatched `files` is inconsistent with the real drop / `dataTransfer`. Can surprise callers that reuse the map.

## Fix
Filter into a new Map (or clone before deleting) and dispatch/import that copy.

## Files
- `src/plugins/interaction/DropzonePlugin.ts:200-206` — mutates caller's `files` Map
- `src/plugins/interaction/DropzonePlugin.ts:220` — dispatches the mutated Map
