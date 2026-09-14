# GLTFLoader2: resource-path URL modifier leaked if parse errors before afterRoot

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`gltfViewerParser` adds a URL modifier to the importer when the parser is created and removes it only inside the plugin's `afterRoot`. If parsing throws before `afterRoot` runs (corrupt file, decode error, a `beforeRoot` throw), the modifier is never removed and stays registered on the importer, affecting all subsequent URL resolution.

## Root Cause
Added at parser creation:
```ts
return (parser: GLTFParser) => { // this is called when the parser is created
    this._resPathUrlModifier.newResourcePath = parser.options.path
    this._resPathUrlModifier.oldResourcePath = parser.json?.extras?.resourcePath
    viewer.assetManager.importer.addURLModifier(this._resPathUrlModifier.modify)
    ...
```
Removed only in `afterRoot`:
```ts
afterRoot: async(result: GLTF) => {
    ...
    viewer.assetManager.importer.removeURLModifier(this._resPathUrlModifier.modify)
}
```
There is no removal in a catch/finally. Any error between parser creation and `afterRoot` leaves the modifier installed. Additionally `_resPathUrlModifier` is shared instance state (`oldResourcePath`/`newResourcePath`), so concurrent parses on the same loader instance can clobber each other (though `registerFile` generally yields a fresh loader per file).

## Impact
A failed glTF load leaves a resource-path URL modifier registered on the importer, silently rewriting URLs for all later asset loads. Low — only on a parse error path.

## Fix
Remove the URL modifier in a finally/catch around the parse (or track and clean it up in the loader's error path) so it is unregistered regardless of success.

## Files
- `src/assetmanager/import/GLTFLoader2.ts:322` — `addURLModifier` at parser creation
- `src/assetmanager/import/GLTFLoader2.ts:393` — `removeURLModifier` only inside `afterRoot`
