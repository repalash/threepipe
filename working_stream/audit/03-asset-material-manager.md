# Audit: Asset/Material Manager Core

Scope: orchestration layer (AssetManager, AssetImporter, AssetExporter, MaterialManager) plus the four UI/state plugins (LoadingScreen, AssetManagerPopup, AssetManagerLoadingBar, AAssetManagerProcessStatePlugin) and AssetExporterPlugin. Sub-folders `gltf/`, `import/`, `export/` are out-of-scope.

The legacy bump-scale fallback in `iMaterialCommons.ts` (item 3 of the prior round) is already covered and intentionally not re-flagged here.

The threepipe-webgi experiment under `experiments/threepipe-webgi/src/` does not contain any partial port of these files (only references AssetManager['gltfExtensions'] from threepipe in `plugins/extras/AnisotropyPlugin.ts:518`). All comparison is webgi -> threepipe.

## Summary

Threepipe's orchestration layer is a near-complete supersession of webgi's: it has been refactored from a plugin (`AssetManagerPlugin`) into a first-class `viewer.assetManager` member, the importer is single-class with richer mime/cache/storage handling, and the exporter has hooks plus a render-target multi-texture path. Most webgi-only functionality has been moved to `ThreeViewer` (config/preset import/export) or other plugins (DropzonePlugin, FileTransferPlugin).

However a handful of edge-case behaviors and three small bugs in threepipe stand out:

- threepipe registers two listeners on `materialChanged`/`addSceneObject` that auto-register materials, but the `_setupObjectProcess` `processRaw` listener also calls `registerMaterial` on every imported material. This is mostly harmless (the registry de-dupes) but the order is non-obvious — see Behavior divergences.
- A regression: in `AssetImporter._urlModifier` the sub-frag check `!normalizedURL.startsWith(rootUrl)` is inherited from webgi but webgi never strips query-strings before the test. With the new `replace(/\?.*$/, '')` happening before the check, a URL like `path?qs` becomes `path`, but `rootUrl` may contain trailing slash so the prefix check should still hold. Not actively broken, but `_rootContext` only stores `rootUrl` now (webgi also stored `baseUrl`/`url`); FileTransfer-style relative URL workflows that depended on `baseUrl` are no longer possible from inside loaders. See `Behavior divergences`.
- `AssetImporter.registerFile` (threepipe) computes mime via a precedence bug: `file?.mime ?? isData ? ... : undefined` — the `??` and ternary precedence makes `mime` always equal `path.slice(...)` (or `undefined`) when `isData=true`, never preserving `file.mime` for data: URLs (see Bugs in threepipe).
- `MaterialManager.copyMaterialProps` no longer wires `__appliedMeshes` -> `setMaterial`; it directly mutates `mesh.material`, which side-steps the iMesh cleanup machinery. Webgi went through `mesh.setMaterial?.(newMat)`. (Bug-leaning divergence.)
- LoadingScreenPlugin in threepipe lost the file-name truncation that webgi did (16-char trim with extension preservation). For long URLs the loading screen now overflows.
- AssetExporterPlugin in threepipe lost `convertMeshToIndexed`, the DRACO encoder options UI/state, and `Encrypt Password` is wired to `type: 'checkbox'` (regression — should be `input`).

Overall: threepipe is the clear forward path; webgi has just a few bits worth porting back.

## webgi-only / new in webgi (missing in threepipe)

### 1. MaterialManager: template-based material creation API

webgi exposes a richer template system that threepipe has dropped:
- `findOrCreate(info, params)` — webgi looks up by uuid OR template name. threepipe's `findOrCreate` looks up uuid and otherwise calls `create(info)` against `ThreeSerialization.SerializableMaterials` which expects a TYPE/TypeAlias, not a free-form template name. Different lookup semantics. (`MaterialManager.ts:29-33`, vs webgi `AMaterialManager.ts:102-106`.)
- `generateFromTemplate(name, params)` and `generateFromTemplateType(type, params)` — webgi keeps a `_templates: IMaterialTemplate[]` with default-overrides (color, etc) per-template. threepipe has no equivalent; templates collapsed to constructors with no per-template default values. The `IMaterialTemplate` interface is gone.
- `findTemplate` in threepipe (`MaterialManager.ts:304`) is `@deprecated` and returns the constructor class only.
- `registerMaterialTemplate`/`unregisterMaterialTemplate` in threepipe (`MaterialManager.ts:281`, `295`) are `@deprecated` and just delegate to `ThreeSerialization.SerializableMaterials`.

If we still want to expose default-value templates (e.g. for "create a `standardWhite` material", or for plugin presets), this is gone.

### 2. MaterialManager.registerMaterialObject

webgi `AMaterialManager.ts:184-192` accepts an arbitrary three.js material object, decorates it with `assetType: 'material'` and `materialObject: material`, then registers. threepipe has no equivalent — you must go through `convertToIMaterial` which only works for actual three.js `Material` instances and creates a separate IMaterial wrapper.

The webgi pattern of `mat.materialObject` (a back-reference, sometimes equal to `this`, used to distinguish wrapped from raw materials) is fully removed. This is intentional because threepipe inherits from `Material` directly — but external callers porting old code that did `material.materialObject = …` will need updating.

### 3. MaterialManager: `_refreshTextureRefs` / `__appliedMaterials` bookkeeping

webgi `AMaterialManager.ts:125-150` walks every map on a material and tracks `map.userData.__appliedMaterials = Set<IMaterial>`. On material dispose it disposes any map whose `__appliedMaterials` is empty (unless `disposeOnIdle === false`). threepipe's `_disposeMaterial` (`MaterialManager.ts:69-74`) just unregisters and nothing more.

The auto-disposal of "orphan textures" is gone. Texture leak risk for callers that depended on this. Also the `'textureUpdate'` event fan-out from texture -> material is gone.

### 4. AssetImporter: explicit `processFileStart` / `processFileEnd` events

webgi dispatches `processFileStart` and `processFileEnd` events around `processImported` (asset-importer side). threepipe replaced these with `processRaw` and `processRawStart`, but then in `AssetManager._setupProcessState` (lines 531/538) it routes them through `setProcessState` to a `'processing'` state. The events ARE there, just renamed. Note however: webgi fired them only inside `importAsset` (ie around the whole asset), while threepipe fires `processRawStart`/`processRaw` around every single result inside `processRaw` (recursive for arrays). Multiple processStateUpdates per import.

### 5. AssetManagerPlugin (the wrapper class)

webgi's `AssetManagerPlugin.ts` is a viewer-plugin wrapper. threepipe reorganised this so `AssetManager` is constructed inside `ThreeViewer` and exposed as `viewer.assetManager`. Most methods moved to:
- `addAsset`, `addFromPath`, `addAssetSingle`, `addImported`, `addImportedSingle` -> kept on `AssetManager` (with deprecations on a few names).
- `exportViewerConfig`, `exportPluginPresets`, `exportPluginPreset`, `importPluginPreset`, `importViewerConfig`, `applyViewerConfig`, `importConfigResources` -> moved to `ThreeViewer`. Threepipe leaves `@deprecated` shims that delegate but `applyViewerConfig`'s shim signature drops the `resources` arg behaviour (`AssetManager.ts:677-680` calls `viewer.fromJSON` instead of preserving the webgi post-processing of `__useCount` cleanup — see Behavior divergences).

### 6. AssetManagerPlugin.exportViewerConfig with binary=false

webgi has explicit handling for serializing buffers as base64 data URIs depending on `Uint16Array` (RGBE), `Uint8Array`, or `ArrayBuffer` (`AssetManagerPlugin.ts:268-292`). The replacement `viewer.toJSON(binary, undefined)` (called via the deprecated shim) — needs verification that `ThreeViewer.toJSON(binary)` does the same per-type encoding. Worth confirming in `ThreeViewer.ts:1320` region.

### 7. AAssetManagerProcessStatePlugin in webgi listens to extra plugins

webgi's `AAssetManagerProcessStatePlugin.ts:74-128` subscribes to:
- `FileTransferPlugin.transferFile`
- `MaterialConfiguratorPlugin.progress` (sets `'MatpreviewGeneration'` state)
- `SwitchNodePlugin.progress` (`'SwitchNodeGeneration'`)
- `ThemePlugin.progress` (`'ThemeInit'`)

threepipe's centralised `AssetManager.processState` Map is updated only by importer/exporter (`AssetManager.ts:523-549`). Those plugins (where they exist in threepipe) need to be updated to call `viewer.assetManager.setProcessState(...)` directly. Public API for that exists (`AssetManager.setProcessState`) but plugin call-sites do not exist — the integration was never re-wired. If `FileTransferPlugin`/`MaterialConfiguratorPlugin`/`SwitchNodePlugin`/`ThemePlugin` are present in threepipe, search for `setProcessState` usages and confirm; if missing, the loading screen will not surface those operations.

### 8. LoadingScreenPlugin: filename truncation

webgi `LoadingScreenPlugin.ts:204-208` truncates filenames > 16 chars while preserving extension. threepipe (`LoadingScreenPlugin.ts:194-195`) just `.split('/').pop()` and shows the raw string. Long URLs cause overflow.

### 9. AssetExporterPlugin: convertMeshToIndexed + DRACO encoder options

webgi `AssetExporterPlugin.ts:42-58` registers a `model` processor that walks the model and runs `toIndexedGeometry(o.geometry)` for any non-indexed geometries when `convertMeshToIndexed` is enabled. webgi also serializes `dracoOptions` (`encodeSpeed`, `method`, `quantizationVolume`, `quantizationBits.{POSITION,NORMAL,COLOR,TEX_COORD,GENERIC}`) and exposes them in the export UI (`AssetExporterPlugin.ts:144-187`).

threepipe `AssetExporterPlugin.ts:35-48` has the conversion code commented out as `// todo` and the exportOptions object lacks `compress` / `dracoOptions` entirely. The DRACO UI panel is gone.

### 10. AssetManagerPlugin.AssetManagerOptions.linkDropzone

webgi has `linkDropzone` in the constructor (currently commented out). threepipe doesn't have it but `DropzonePlugin` in `src/plugins/interaction/DropzonePlugin.ts` already calls `viewer.assetManager` directly — net result is fine, just noting the API isn't there.

### 11. webgi processImported special-case for empty rootSceneModelRoot with animations

webgi `AssetImporter.ts:486-510` has a sequence:
1. If a `rootSceneModelRoot` has 0 children but has `__importedViewerConfig`, return that as the result.
2. If it has children, push `res.animations` onto the first child's animations, copy `__importedViewerConfig` and `userData.__importData` to it, then recursively process `[...res.children]` and cache as `__processedChildren`.

threepipe `AssetImporter.processRaw` (`AssetImporter.ts:572-590`) only does `res._childrenCopy = [...res.children]` for `rootSceneModelRoot` and never merges animations / `__importedViewerConfig` / `__importData` into the first child. The "animations on the empty wrapper" path is dropped — if a GLB wraps animations on its scene root rather than on a node, those animations may now be lost. (Possibly already accounted for elsewhere in `GLTFLoader2`/`loadImported`; worth verifying with a test gltf that has animations at the scene level.)

Confirmed missing from threepipe:
- `if (res.animations) { children[0].animations.push(...res.animations) }`
- copying `__importedViewerConfig` to `children[0]`
- forwarding `userData.__importData` to `children[0]`

### 12. webgi processImported: line-mesh upgrade (useMeshLines)

webgi `AssetImporter.ts:528-544` upgrades `Line` -> `Line2` with `LineMaterial` when `useMeshLines === true`. threepipe references `useMeshLines` in `LoadFileOptions` doc-comment (`IAssetImporter.ts:158-162`) but the actual upgrade-to-Line2 path is GLTF-only (handled in `GLTFLoader2`). Standalone OBJ/FBX line objects won't be upgraded.

### 13. webgi importer plugin-preset auto-import

webgi `AssetImporter.ts:596-621` has an auto-detect for plugin/viewer config payloads inside `processImported`:
- If `res.type` matches a plugin -> call `plugin.fromJSON(res, meta)` automatically.
- If `res.plugins` or `res.type === 'ViewerApp'/'ThreeViewer'` -> call `viewer.getManager().importViewerConfig(res)` automatically.

threepipe replicates a milder version in `AssetManager.loadImported` (`AssetManager.ts:198-201`):
```ts
if (obj.type && typeof obj.type === 'string' && (Array.isArray((obj as any).plugins) ||
    (obj as any).type === 'ThreeViewer' || this.viewer.getPlugin((obj as any).type))) {
    await this.viewer.importConfig(<ISerializedConfig>obj)
}
```
But this only runs in `loadImported`, not in the importer's `processRaw`. So if a plugin downloads a `.vjson` via `importer.import` without going through `addAsset` -> `loadImported`, plugin-preset auto-application won't fire.

Also note: the `assetImporterProcessed = false` reset that webgi did is missing — meaning re-import via drag-drop won't retrigger the plugin-fromJSON path. Minor.

### 14. AssetExporter.processors

webgi exposes `processors: ObjectProcessorMap<TAssetTypes>` on the exporter so plugins (like `AssetExporterPlugin.convertMeshToIndexed`) can hook into export-preprocess. threepipe deleted the processors map and replaced the convertMeshToIndexed with a `// todo` comment in `AssetExporterPlugin`. The hook points are gone — `exportHooks` (`AssetExporter.ts:56`) is partial replacement but shape is different.

## threepipe-only / new in threepipe (missing in webgi)

### 1. AssetImporter cache-storage initialization

`AssetImporter._initCacheStorage` (`AssetImporter.ts:721-738`) auto-opens `caches.open('threepipe-assetmanager')` when `storage === true` (the new default). webgi required the user to explicitly pass a `Cache` instance. threepipe also gates on `_cacheStoreInitPromise` so the first import waits for the cache to be ready (`AssetImporter.ts:370`). Net win.

### 2. AssetImporter cleaner mime-type plumbing

threepipe's `IImporter.mime` and the `_getImporter`/`_createLoader` regex for `^data:<mime>` (`AssetImporter.ts:702-715`) is more thorough than webgi's `name.startsWith(ext)` substring match. New importers can be registered by mime alone.

### 3. AssetImporter event-typed handlers

threepipe declares `IAssetImporterEventMap` with discriminated unions. webgi's was loosely-typed `AssetImportEventTypes` string union. addEventListener/dispatchEvent are now type-safe.

### 4. AssetImporter.processRaw `_testDataTextureComplete`

threepipe moved this option into `ProcessRawOptions` interface (`IAssetImporter.ts:131-133`) with proper @internal doc. Still present in webgi but undocumented.

### 5. AssetImporter `processRawSingle` helper

`AssetImporter.ts:594-596`, `AssetExporter`'s `addExporter`/`removeExporter` symmetric API, `MaterialManager.registerMaterials` (plural), `MaterialManager.clearMaterials`, `MaterialManager.clearExtensions`. None in webgi.

### 6. AssetExporter render-target multi-texture zip path

`AssetExporter.ts:165-178` — render-targets with multiple textures now zip per-texture exports. webgi only handles single-texture render-targets. This is new functionality.

### 7. AssetExporter material toJSON via `matToJson`

`AssetExporter.ts:199-202` exposes `matToJson` as a re-usable export helper. webgi inlined `(obj as IMaterial).toJSON()`.

### 8. AssetExporter exportHooks

`AssetExporter.ts:56-61` adds a hook system (`AssetExportHooks`) that runs on `exportFile`. webgi has no equivalent; the closest is `processors`.

### 9. AssetExporter `excludeFromExport` is fixed

threepipe `AssetExporter.ts:71-77` traverses `obj.traverse` directly (since IObject3D extends Object3D). webgi `AssetExporter.ts:85` traverses `obj.modelObject.traverse` which only works for the wrapped IModel API.

### 10. AssetManager.gltfExtensions registry

`AssetManager.ts:555-600` — `registerGltfExtension`/`unregisterGltfExtension` with auto-wire to GLTFLoader2 and GLTFExporter2. webgi handled this ad-hoc per plugin. Big improvement for plugin authors.

### 11. AssetManager._loadObjectDependencies (rootPath refresh)

`AssetManager.ts:415-500` — when a model has `userData.rootPathRefresh`, the asset manager re-fetches the model from `userData.rootPath` and swaps it in-place, preserving `name`/`uuid`/`userData`. This is the dynamically-loaded-files mechanism. Not in webgi at all.

### 12. AssetManager `processState` Map and processStateUpdate event

Hoisted out of plugin-level (webgi had this only inside `AAssetManagerProcessStatePlugin` per-plugin). Now centralized on `AssetManager` (`AssetManager.ts:508-521`). Plugins subscribe via the `'processStateUpdate'` event. Cleaner architecture.

### 13. AssetManager.legacySeparateMapSamplerUVFix and beforeDeserialize listener

`AssetManager.ts:128, 165` — legacy material/sampler-UV serialisation fix-up. Specific to threepipe's serialization changes. Not in webgi.

### 14. AssetExporter processBeforeExport: light/excludeFromExport handling

threepipe handles `excludeFromExport` (`AssetExporter.ts:69-77`) before calling `_exportFile`, restores visibility after. webgi did this but only for `model` assetType — both do it for `model` only, but threepipe's traversal goes through `obj.traverse` directly (cleaner).

### 15. SVGTextureLoader, PolyhavenMaterialGLTFLoader, JSONMaterialLoader auto-routing

threepipe's `_addImporters` (`AssetManager.ts:296-368`) wires:
- A custom `SimpleJSONLoader` subclass that detects `json.type` and forwards to other JSON-handling loaders (e.g. `JSONMaterialLoader`).
- `PolyhavenMaterialGLTFLoader` for `.phmatgltf`.
- `JSONMaterialLoader.SupportedJSONExtensions`.
- `gltfz`/`glbz` zip variants for ZipLoader.

webgi has none of this. threepipe is more capable.

### 16. AssetImporter `__sourceBlob`, `__needsSourceBuffer`, `__sourceBuffer`

Top-level, well-documented (`IAssetImporter.ts:43-65`, `AssetImporter.ts:551-559`). webgi put `__sourceBlob` and `__sourceBuffer` inside `userData` (`AssetImporter.ts:574-580`). The threepipe relocation is intentional and discussed in code comments — userData is for user-facing config, not internal byte buffers. Good change.

### 17. `__rootPathOptions` capture

threepipe captures the serialised options (`AssetImporter.ts:454, 540, 547-548`) so when an embedded `rootPath` is reloaded, the same fileExtension/queryString/etc are reapplied. webgi only stored `__rootPath`. (See also `_loadObjectDependencies`.)

### 18. AssetManager AssetExporterPlugin's exportSelected

`AssetExporterPlugin.ts:77-87` — exports the currently-picked object. webgi had this commented out (`AssetExporterPlugin.ts:295-308`). 

## Bugs in webgi

### B1. `_isRootFileExtension` ignores mime type
webgi `AssetImporter.ts:266-268` — drag-dropped files with a mime but no extension can never be detected as root files. threepipe fixed this by passing both `ext` and `mime` to `_isRootFile` (`AssetImporter.ts:670-677`).

### B2. `importViewerConfig` resources side-channel
webgi `AssetManagerPlugin.ts:340-344` passes `resources` to `plugin.fromJSON(json, meta)` then re-attaches `json.resources = meta` outside. If `fromJSON` mutates `meta`, the cleanup `delete json.resources` happens before `await`, leading to a possible resource-loss on errors. Threepipe moved this into `ThreeViewer.importPluginConfig` and the flow is cleaner.

### B3. `applyViewerConfig` always logs `'WebGi: No viewer or importer'` if called pre-init
Two checks at `AssetManagerPlugin.ts:359` and `:362` — same warning, redundant. Cosmetic.

### B4. `AssetImporter.dispatchEvent({type: 'importFile', state:'adding'})` fires twice
webgi `AssetImporter.ts:315-316` dispatches both `state:'downloading' progress:1` and `state:'adding'` after success. threepipe simplified to a single `state:'done'` from the loadingManager itemEnd hook (`AssetImporter.ts:142-144`). Process-state map gets an `'adding'` entry that lingers until `processFileEnd` fires — confirmed if you watch `processState.get(path)` between events.

### B5. `MaterialManager._disposeMaterial` calls `_refreshTextureRefs()` on every dispose
webgi `AMaterialManager.ts:154` walks the entire `_materials` array on every material dispose to keep `__appliedMaterials` accurate. O(N*M) on bulk dispose. The comment notes "find a better way". threepipe removed the entire mechanism — but the perf bug is webgi's.

## Bugs in threepipe

### T1. `AssetImporter.registerFile` mime computation precedence bug

`AssetImporter.ts:479`:
```ts
const mime = file?.mime ?? isData ? path.slice(0, path.indexOf(';')).split(':')[1] || undefined : undefined
```
JS operator precedence: `??` binds tighter than `?:`. The expression parses as
`(file?.mime ?? isData) ? <data-uri-mime> : undefined`.
- If `file?.mime` is set, the conditional is truthy and `mime` is set from the data-URI parse — even when `isData=false` and there's no `;` in the path (slice yields garbage).
- If `file?.mime` is unset and `isData=false`, conditional is `undefined` -> falsy -> `mime = undefined` (correct by accident).
- If `file?.mime` is unset and `isData=true`, conditional truthy -> data-URI parse runs (correct).
- If `file?.mime` is set and `isData=false`, **bug**: `mime` will be `path.slice(...).split(':')[1] || undefined`, never `file.mime`.

Wrap in parens: `mime = file?.mime ?? (isData ? <data> : undefined)`.

### T2. `AssetManager` triple-registration of materials

Three independent listeners register materials:
1. `AssetManager.ts:127` — `addSceneObject` -> `_sceneUpdated` -> `registerMaterial` (line 241).
2. `AssetManager.ts:128` — `materialChanged` -> `_sceneUpdated` -> `registerMaterial` (line 257).
3. `AssetManager.ts:402` — `processRaw` -> `registerMaterial` (line 398).
4. `AssetManager.ts:180` — `loadImported` directly registers materials.

`MaterialManager.registerMaterial` (line 83) early-returns when already in the array, so this is idempotent. But each path also calls `material.setDirty()` (line 100) which dispatches events / triggers re-uniform-uploads. Re-registering causes redundant `setDirty` only on the first registration (subsequent calls early-return at line 83 before line 100), so this is mostly fine — but the multiple paths are confusing and a future refactor could easily re-introduce the bug.

### T3. `MaterialManager.copyMaterialProps` no longer goes through `setMaterial`

`MaterialManager.ts:264-269`:
```ts
const meshes = c.appliedMeshes
for (const mesh of [...meshes ?? []]) {
    if (!mesh) continue
    mesh.material = newMat
    applied = true
}
```
webgi `AMaterialManager.ts:340-344`:
```ts
const meshes = c.userData.__appliedMeshes as Set<IModel<Mesh>>
for (const mesh of [...meshes ?? []]) {
    mesh?.setMaterial?.(newMat)
    if (mesh) applied = true
}
```
Direct assignment to `mesh.material` may bypass three.js change-detection plus iMesh hooks like `appliedMaterials` updates, dispose old material listeners, geometry-attribute fix-ups, etc. For an `IObject3D` subclass that has a `setMaterial` method, threepipe should prefer that path. Verify whether `IObject3D.material =` setter is intercepted in threepipe's three.js fork.

### T4. `MaterialManager.findMaterialsByName` regex parameter ignored when name is RegExp

`MaterialManager.ts:144-150` (and identical in webgi `AMaterialManager.ts:233-239`):
```ts
return this._materials.filter(v=>
    typeof name !== 'string' || regex ?
        v.name.match(typeof name === 'string' ? '^' + name + '$' : name) !== null :
        v.name === name
)
```
The condition `typeof name !== 'string' || regex` uses `||` without parens — fine — but the inner ternary `typeof name === 'string' ? '^' + name + '$' : name` is correct. Net behavior:
- `name=string, regex=false` -> `v.name === name` ✓
- `name=string, regex=true` -> `v.name.match('^name$') !== null` ✓
- `name=RegExp, regex=anything` -> `v.name.match(name) !== null` ✓

This is fine; flagged as I had to triple-check — leaving as a note.

### T5. `MaterialManager.convertToIMaterial` always sets `mat.uuid = uuid`, even on minimal-upgrade path

`MaterialManager.ts:186-194`:
```ts
if (mat) {
    mat.uuid = uuid
    mat.userData.uuid = uuid
    material.iMaterial = mat
} else {
    console.warn('Failed to convert material to IMaterial, just upgrading', material, useSourceMaterial, materialTemplate)
    mat = iMaterialCommons.upgradeMaterial.call(material)
}
```
When `useSourceMaterial = true` and the new mat was created via `this.create(template, material)`, its uuid is then forcibly overwritten with `material.uuid`. If a previous `findMaterial(uuid)` already existed (and we hit the `else if` branch on line 180), `mat.uuid = uuid` was already its own uuid — no-op. But the `MaterialManager.registerMaterial` path *also* calls `safeSetProperty(material, 'uuid', generateUUID(), true, true)` if a duplicate is detected (line 89). The two flows can fight: `convertToIMaterial` keeps the old uuid; subsequent `registerMaterial` of the same material may see the dup and reissue a new uuid. Edge case but possible inconsistency. Verify with a test that imports two assets with the same material uuid.

### T6. `AssetExporterPlugin.exportOptions` Encrypt Password is `type: 'checkbox'`

`AssetExporterPlugin.ts:120-125`:
```ts
{
    type: 'input',  // line 121
    label: 'Encrypt Password',
    hidden: ()=>!this.exportOptions.encrypt,
    property: [this.exportOptions, 'encryptKey'],
},
```
Wait — re-reading: it IS `type: 'input'`. webgi has `type: 'checkbox'` (`AssetExporterPlugin.ts:212`) which is the bug. threepipe is correct. **Retracting** this — webgi has the bug, not threepipe.

(Adding to Bugs in webgi: webgi's Encrypt Password UI is incorrectly typed `checkbox` — `experiments/webgi-legacy-src/extras/asset_manager/AssetExporterPlugin.ts:212-216`.)

### T7. `LoadingScreenPlugin._updateMainDiv` doesn't escape filename truncation suffix

Not strictly a bug but loadingscreen.ts in threepipe doesn't truncate filenames — see "webgi-only #8" above. If a URL contains characters that look like HTML, escapeHtml catches it, so it's not an XSS, just visually noisy.

### T8. `AssetImporter.importPath` query-string deduplication

`AssetImporter.importPath` (`AssetImporter.ts:205-214`) keys the cache by `JSON.stringify(options-minus-pathOverride/forceImport/etc)`. But `LoadFileOptions.queryString` IS preserved in the serialised options. So `import('foo.glb', {queryString: 'a=1'})` and `import('foo.glb', {queryString: 'a=2'})` produce different cache entries — good. But `import('foo.glb?a=1')` and `import('foo.glb?a=2')` have the same `path` but different effective URL, AND `_serializeOptions` doesn't include the query string in the path, so they'd be cached as the same asset and the second call would return the first. This is a behavior change from webgi, which had the same `path` mismatch but webgi didn't dedupe to the same extent. Possibly intentional (cache by path-without-query) — flagging for confirmation.

## Behavior divergences

### D1. `_rootContext` lost `baseUrl` and `url`

webgi `AssetImporter.ts:299-304`:
```ts
this._rootContext = {
    path,
    url,                                          // resolveURL'd path
    rootUrl: LoaderUtils.extractUrlBase(path),
    baseUrl: LoaderUtils.extractUrlBase(url),
}
```
threepipe `AssetImporter.ts:385-389`:
```ts
this._rootContext = {
    path,
    rootUrl: LoaderUtils.extractUrlBase(path),
    // baseUrl: LoaderUtils.extractUrlBase(url),
}
```
The commented-out `baseUrl` was used by the URL-modifier in webgi (also commented out at `:120`). If any custom loader/importer in webgi-land peeked at `_rootContext.baseUrl`, that's gone. None of the in-tree loaders did, but flag for downstream code.

### D2. `AssetImporter._urlModifier` no longer respects `baseUrl` rewrite

The webgi version had a commented-out alternate path that mapped between `baseUrl` (object-URL prefix) and `rootUrl` (real prefix). Both implementations now use the simpler "if the URL doesn't include rootUrl, prepend it" — fine, same behavior.

### D3. `_serializeOptions` includes `mimeType` in cache key

threepipe added `mimeType` to `ImportAssetOptions` (`IAssetImporter.ts:211`) but `_serializeOptions` (`AssetImporter.ts:216-225`) does not strip it. So changing `mimeType` between calls invalidates the cache. Webgi had no `mimeType` field at all. Probably correct, just noting.

### D4. AssetManager listens to `materialChanged` from scene

threepipe `AssetManager.ts:127-128` subscribes to `materialChanged` on the scene and registers any new material. webgi `AssetManagerPlugin.ts:151-164` only handles `addSceneObject`. So changing a mesh's material in threepipe at runtime auto-registers that material in MaterialManager — webgi required explicit call. Probably intentional and a real improvement.

### D5. `AssetManager.applyViewerConfig` deprecated shim drops resource-cleanup

webgi `AssetManagerPlugin.ts:358-385`:
- After `viewer.fromJSON(viewerConfig, resources)`, walks `resources.materials` and `resources.textures` and unregisters/deletes any with `__useCount === 0`.

threepipe shim `AssetManager.ts:677-680` just calls `viewer.fromJSON` and skips the use-count cleanup. If anything still calls `applyViewerConfig` (the shim) with extracted resources, materials with no references will accumulate. Should be ported into `viewer.fromJSON` if not already there.

### D6. processRaw recursion — Map handling

webgi: when `res instanceof Map` (zip output), at end of `processImported`, recursively calls `importFiles` and returns flat results.

threepipe: same pattern but only `if (res instanceof Map && options.autoImportZipContents !== false)` (`AssetImporter.ts:585-588`). The new flag is good (lets you import a zip and inspect entries without auto-extracting), but the default is the same behavior.

### D7. `processRaw` logs / dispatches event ordering

webgi dispatches `processFileStart`, then runs assetType-specific upgrade, then `processFileEnd`. threepipe dispatches `processRawStart`, runs assetType branch (via the `processRawStart` listener doing camera/light/material upgrades — see `AssetManager.ts:703`), then dispatches `processRaw`. The upgrade work is split between AssetImporter (texture upgrade, name auto-set) and AssetManager (the `processRawStart` hook does camera/light/material upgrades). Webgi did everything inside AssetImporter. The split is intentional (webgi-style ObjectProcessorMap), but means a custom AssetImporter (no AssetManager) won't upgrade cameras/lights/materials.

### D8. autoSetName behavior

threepipe (`AssetImporter.ts:516, 576-578`) sets name when `res.name === ''`. webgi (`AssetImporter.ts:584`) does it inside the assetType branch after `_processors.process`, which means processors can early-set the name. In threepipe this happens always before processRaw is dispatched, so a user-side `processRaw` listener that needs to read the original `''` won't see it. Minor behavior change.

## API / signature drift

### A1. `IAssetImporter.import` lost the multi-asset/file overloads in interface

`IAssetImporter.import` (`IAssetImporter.ts:260`) is typed as `(IAsset | string)` only — but the implementation `AssetImporter.import` (`AssetImporter.ts:182-195`) accepts `string | IAsset | IAsset[] | File | File[]`. Interface lies; should be updated.

### A2. `IAssetImporter` missing `importPath`, `importAsset`, `importFile`, `importFiles` typed signatures from webgi

webgi `IAssetImporter` declared `importPath`, `importAsset` etc as part of the interface contract. threepipe `IAssetImporter` only exposes `import`, `importSingle`, `importFiles`, `processRaw`, `registerFile`, `unregisterFile`, `addURLModifier`, `removeURLModifier`. So importing a single asset by path requires `import(path)` (returns array) or `importSingle(path)` — `importPath` is no longer on the interface (only on the class). Means a third-party `IAssetImporter` impl can't be drop-in.

### A3. `MaterialManager.create` signature

threepipe `create<TM>(type, params, register, uuid)` (`MaterialManager.ts:41`). webgi `generateFromTemplate(name, params)` returns the new material with template defaults applied. Different return semantics: threepipe passes `params` to `setValues` directly; webgi merges template defaults into params before constructing.

### A4. `IMaterialTemplate` interface gone

webgi `AMaterialManager.ts:54-60` defined a public-API interface for material templates. threepipe deleted it; templates are now constructor classes with optional `TYPE`/`TypeAlias`/`TypeSlug` static fields. Plugin authors that registered templates with `{templateUUID, name, materialType, generator}` will need to migrate to constructor-based registration via `ThreeSerialization.SerializableMaterials`.

### A5. Material event names: `'__unregister'`, `'__register'` vs webgi `'dispose'`

threepipe (`MaterialManager.ts:96-97`) listens for `__unregister`/`__register`; dispose alone does not unregister. The comment at line 73 explains: dispose is for GPU resources. webgi (`AMaterialManager.ts:177`) used the standard three.js `'dispose'` event. Behavioral split is intentional but makes interop with raw three.js code awkward.

### A6. `AssetExporter.processBeforeExport` signature

webgi: `processBeforeExport(obj, options): Promise<{obj, ext, typeExt?}|undefined>` — note no `blob` field.
threepipe: `processBeforeExport(obj, options): Promise<{obj, ext, typeExt?, blob?}|undefined>` — adds `blob` for the render-target-multi-texture path. Subclasses overriding will need updating.

### A7. `AssetManagerOptions.storage` semantics

webgi: `storage?: Cache | Storage`.
threepipe: `storage?: Cache | Storage | boolean`. `true` (the default) opens a default Cache. `false` disables. Sentinel for default. Behavior change for callers that passed `false` expecting `undefined` semantics.

### A8. `AssetExporter.dispose()` is a no-op stub

`AssetExporter.ts:194-196` — empty. webgi at least disposed `_processors`. Cached writers (`_cachedWriters`) and event listeners are not torn down. Minor leak on viewer disposal if writers hold native handles.

### A9. `LoadingScreenPlugin` lost `webp` from VideoTextureLoader extensions

Not an API drift but worth noting: webgi's VideoTextureLoader handled `mp4/ogg/mov/data:video`. threepipe added `webm` (`AssetManager.ts:363`). Good; flagging because Drag-drop tests for `webm` in webgi never worked.

### A10. `AssetManager.exportPluginPresets`/`exportPluginPreset` etc. forwarded to viewer

Deprecated shims (`AssetManager.ts:640-661`) emit `console.error` and proxy. webgi-style code that did `viewer.getPlugin(AssetManagerPlugin).exportPluginPresets(...)` will get noise but work. Caller migration required.

## Notes / open questions

1. **MaterialManager template restoration** — Do we want `IMaterialTemplate` (with default-field overrides) back? It's a small ergonomic feature missing in threepipe. Particularly useful for `LineMaterial2`, `UnlitLineMaterial`, etc, where defaults differ. Decide whether to add or document the new constructor-only pattern.

2. **Texture auto-disposal on material dispose** (webgi feature #3) — Re-implementing `__appliedMaterials` -> auto-dispose-orphan-maps would close real texture leaks on dispose-heavy workloads (material configurator, switch-node). Flag for own issue.

3. **AssetExporter.processors / convertMeshToIndexed** — Either restore the export-side processor map, or wire `AssetExporter.exportHooks` from `AssetExporterPlugin.exportOptions.convertMeshToIndexed`. Currently the option is dead.

4. **DRACO encoder options** — webgi exposed encodeSpeed/method/quantizationVolume/quantizationBits. In threepipe these are on `GLTFExporter2` options but NOT serialised through `AssetExporterPlugin.exportOptions`. If we want UI-controlled DRACO from the Asset Export panel, this needs porting.

5. **rootSceneModelRoot animation merging** (webgi-only #11) — Verify a GLB with animations on the scene root still loads animations correctly in threepipe. If not, port the merge logic from webgi `AssetImporter.ts:498-507` into `AssetImporter.processRaw`.

6. **AAssetManagerProcessStatePlugin extra-plugin subscriptions** (webgi-only #7) — Audit MaterialConfiguratorPlugin/SwitchNodePlugin/ThemePlugin/FileTransferPlugin in threepipe (if present) and confirm each calls `viewer.assetManager.setProcessState(...)` for its progress events. If missing, the loading screen won't surface those.

7. **Plugin-preset auto-import in AssetImporter** (webgi-only #13) — Currently only fires through `AssetManager.loadImported`. Decide whether `AssetImporter.processRaw` should also auto-apply plugin presets when the data shape matches, or whether requiring callers to go through `addAsset` is the new contract.

8. **AssetImporter._urlModifier `baseUrl`** (D1) — Decide whether to expose `_rootContext.baseUrl` again, or document as removed.

9. **`mesh.material = newMat` direct assignment in copyMaterialProps** (T3) — Verify with a test that materials get cleanly swapped (old material's appliedMeshes Set updated, listeners re-attached, geometry attribute fix-ups still run). If not, restore `setMaterial?.()` call.

10. **`AssetImporter.registerFile` mime precedence** (T1) — Quick fix; add parens. Worth a one-line PR.

11. **`AssetImporter.importPath` query-string cache key** (T8) — Decide if `path` with different query-strings should be different cache entries. webgi de-facto behavior was the same; if anything depended on different-query-different-asset, flag now.

12. **`AssetExporter.dispose`** (A8) — Implement properly or mark `@todo`. Currently silent leak risk on viewer disposal.

13. **threepipe-webgi experiment** — does NOT contain a port of the asset/material manager. Only `AnisotropyPlugin.ts:518` references threepipe's `AssetManager['gltfExtensions']` shape. Out of scope for asset/material manager audit.

## Citations

- webgi: `experiments/webgi-legacy-src/extras/asset_manager/{AMaterialManager.ts, AssetManager.ts, AssetManagerPlugin.ts, AssetExporterPlugin.ts, AssetManagerPopupPlugin.ts, AssetManagerLoadingBarPlugin.ts, AAssetManagerProcessStatePlugin.ts, LoadingScreenPlugin.ts, importer/threejs/AssetImporter.ts, exporter/threejs/AssetExporter.ts}`
- threepipe: `src/assetmanager/{MaterialManager.ts, AssetManager.ts, AssetImporter.ts, AssetExporter.ts, IAssetImporter.ts, IAsset.ts}`, `src/plugins/base/AAssetManagerProcessStatePlugin.ts`, `src/plugins/interaction/LoadingScreenPlugin.ts`, `src/plugins/export/AssetExporterPlugin.ts`
- threepipe-webgi: `experiments/threepipe-webgi/src/plugins/extras/AnisotropyPlugin.ts:518` (only)
