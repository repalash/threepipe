# AssimpJsPlugin: emscripten handle leak per export + no onRemove (script element / global / WASM module orphaned)

**Severity:** low
**Found:** 2026-06-13 code audit

Two related lifecycle/leak issues in the AssimpJs plugin.

## Bug 1 — `convertFiles` leaks emscripten/embind handles
```ts
const fileList = new ajs.FileList()
// ...
const result = ajs.ConvertFileList(fileList, format)
// ...
const resultFile = result.GetFile(0)
```
assimpjs is an emscripten/WASM module; `new ajs.FileList()`, `result`, and `resultFile` are embind handles that own WASM-heap memory only freed on `.delete()`. None are deleted, so every conversion leaks heap memory on the long-lived `this.ajs` singleton. Repeated exports grow memory unbounded.
**Fix:** wrap in try/finally and `.delete()` `fileList`, `result` (and `resultFile` if separate) after reading content. Confirm exact API against the repalash/assimpjs build.

## Bug 2 — no `onRemove`: injected script element + global never cleaned up
`_init()` injects a `<script>` via `createScriptFromURL(...)` stored in `this._scriptElement` and populates the global `window.assimpjs` + a WASM runtime in `this.ajs`. The class defines no `onRemove`, so on removal the script element stays in the document and `window.assimpjs`/`this.ajs` stay resident. Re-adding a fresh instance re-runs `_init`; the `if (!window.assimpjs)` guard avoids a second tag but orphans the previous instance's `_scriptElement`/`ajs`. A lifecycle asymmetry vs. other plugins.
**Fix:** add an `onRemove` that removes `this._scriptElement` and clears `this.ajs`/`this._initing` (deleting the shared global is a judgement call).

## Files
- `plugins/assimpjs/src/AssimpJsPlugin.ts:85-104` — `convertFiles` never deletes embind handles
- `plugins/assimpjs/src/AssimpJsPlugin.ts:39-75` — `_init` injects script/global with no `onRemove` to clean up

## Related
- `audit-assimpjs-plugintype-sampleplugin-collision.md` — wrong `PluginType` in the same plugin
