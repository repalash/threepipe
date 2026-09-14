# AssimpJsPlugin.PluginType is 'SamplePlugin' (copy-paste leftover, collides with plugin-template)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`AssimpJsPlugin.PluginType` is the string `'SamplePlugin'`, a leftover from the plugin template. Plugins are registered and looked up keyed by `PluginType`, so AssimpJs is registered under `'SamplePlugin'` — the same key used by `plugin-template-vite/src/SamplePlugin.ts`.

## Root Cause
```ts
@uiFolderContainer('Assimp')
export class AssimpJsPlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'SamplePlugin'
```
`ThreeViewer.addPlugin` registers into `this.plugins[type.PluginType]` and `getPlugin` reads the same key. The only other `PluginType: string = 'SamplePlugin'` in the repo is `plugins/plugin-template-vite/src/SamplePlugin.ts:8`.

## Impact
- If both `AssimpJsPlugin` and the template `SamplePlugin` are added, `addPlugin` sees the existing type, logs "Plugin of type SamplePlugin already exists, removing and disposing old plugin", and removes the first.
- `exportPluginConfig` / serialization key the plugin under `"SamplePlugin"`, so a saved AssimpJs config cannot be matched back reliably, and a serialized `SamplePlugin` config could be wrongly applied to `AssimpJsPlugin`.
- `getPlugin('SamplePlugin')` resolves ambiguously.

## Fix
Change to `public static readonly PluginType = 'AssimpJsPlugin'`. (Add `OldPluginType = 'SamplePlugin'` only if any saved files reference the old key — unlikely.)

## Files
- `plugins/assimpjs/src/AssimpJsPlugin.ts:24` — `PluginType = 'SamplePlugin'`
- `plugins/plugin-template-vite/src/SamplePlugin.ts:8` — the colliding template `PluginType`

## Related
- `audit-assimpjs-wasm-leaks.md` — emscripten handle leak + missing onRemove in the same plugin
