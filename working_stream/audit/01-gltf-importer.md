# Audit: GLTF Importer

## Summary
threepipe's GLTF importer is the more polished, feature-rich side: it has many extras (line→fat-line conversion, AuxScene unwrap, `gltfUUID` rebinding, `rootRefs` animation reattach, `BundledResources` in glTF extras, `createUniqueName`, URL-modifier resource path, geometry/material placeholders, RGBE encodingVersion v3 support, mime-type aware importer registry, encryption preparser hardened, DRACOLoader2 normal-recompute fix, RGBEPNGLoader Float32 fix). webgi is leaner but still owns one cross-tool primitive that's missing in threepipe: **`WEBGI_materials_separate_metalrough`**. There are also two webgi-only bugs (RGBEPNGLoader Float type, RGBE encodingVersion=3 mis-parse) and two minor threepipe behavior divergences (`GLTFObject3DExtras` import defaults `castShadow`/`receiveShadow` to `false` when extension is present; `matrixAutoUpdate` exported but never read back). `threepipe-webgi/` has no GLTF import code (only commented-out plugin stubs in `SSContactShadowsPlugin.ts`), so all sync candidates are between webgi-legacy-src and threepipe.

## webgi-only / new in webgi (missing in threepipe)

- **`WEBGI_materials_separate_metalrough` extension is missing in threepipe.** webgi defines and registers it on both import and export sides. Importer reads `metalnessTexture` and `roughnessTexture` and assigns them as `metalnessMap` / `roughnessMap`. Used by webgi exporter when `GLTFExporter2Options.mergeMetalnessRoughnessMaps === false` to keep the two textures unpacked.
  - webgi import: `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/generators/gltf.ts:156, 770-811`
  - webgi ext-name const: `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/generators/ext-names.ts:17`
  - webgi exporter consumer: `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/GLTFWriter2.ts:81-125`
  - threepipe: no occurrence in `src/assetmanager/gltf/` or `src/assetmanager/import/GLTFLoader2.ts:71-88` (verified `grep`). Means a webgi-exported file with this extension and `metallicRoughnessTexture` omitted will silently lose the metalness/roughness maps entirely (third-party fallback to scalar factors only).

- **Encrypted/mangled `loadBuffer` path (`fq3fvf_ckuehdq`, `__kryfgudlskdnme`, `__djoqwyhasb78e`, `__smbId*`).** webgi `gltf.ts:23-106` overrides `parser.loadBuffer` to apply a per-byte XOR demangle keyed off `scene.extras.__smbId` after stripping a per-user prefix. This is licensing-tied (out of scope per audit instructions) — flagging only so it isn't accidentally pulled across.
  - webgi: `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/generators/gltf.ts:41-106`

- **`importViewer` separate path for resources.** webgi calls `parser.options.path` setup and `viewer.getPlugin(AssetManagerPlugin)?.importConfigResources` directly inside `gltf.ts:482-522`, then assigns `viewerConfig.resources` back. threepipe reorganized this into `GLTFViewerConfigExtension.ImportResources` / `_parseExtraResources` / `_parseArrayBuffers` and sets `importedViewerConfig` on the result-scene level (more modular). Functional behavior matches; flagging because round-trip ordering differs slightly (threepipe iterates over all `result.scenes`, webgi only over `result.scene`/single scene; webgi's loop on multi-scene also drops `__importedViewerConfig` assignment to non-first scenes — see "Bugs in webgi" below).

## threepipe-only / new in threepipe (missing in webgi)

- **AuxScene unwrap.** `src/assetmanager/import/GLTFLoader2.ts:192-195`: when the scene is named `AuxScene`, has a single child, no rootSceneModelRoot, no viewer config, and no cameras, the child is hoisted up. webgi has nothing equivalent. Used to flatten the auxiliary scene wrapper threepipe's exporter sometimes emits.
- **`userData.gltfUUID` rebind.** `GLTFLoader2.ts:212-215` reads `gltfUUID` saved by `GLTFExporter2` and restores the original uuid via `safeSetProperty`. webgi has the same idea on `loaders/GLTFLoader2.ts:53-57` but only in its own loader's `transform`, and uses raw `node.uuid =`. threepipe uses `safeSetProperty` so the assignment goes through any uuid setters. Minor, but correctness-relevant.
- **Animation rootRefs reattach.** `GLTFLoader2.ts:259-282`: walks `animation.userData.rootRefs` (saved by `GLTFExporter2`) and re-binds the animation to the matching uuid/name root. webgi just dumps every animation onto `scene.animations`.
- **Line → fat line conversion (`MeshLine`/`MeshLineSegments`).** `GLTFLoader2.ts:284-291, 406-462`. Triggered by `useMeshLines` option. No equivalent on webgi side (webgi has `upgradeThreejsLine` in AssetImporter but it's not wired through GLTF import).
- **Geometry / Material placeholders.** `GLTFLoader2.ts:226-245`: replaces objects with `userData.isPlaceholder` by `AssetImporter.DummyGeometry` / `DummyMaterial` / `DummyLineBasicMaterial` / `DummyLineMaterial`. webgi has no such concept.
- **`createUniqueName` toggle.** `GLTFLoader2.ts:332-345` (with `CreateUniqueNames: 'auto'`): allows duplicate names when the scene is a `rootSceneModelRoot`, otherwise uses three.js's default. webgi accepts whatever three.js does.
- **`importedBundledResources` / `BundledResources` in `parser.json.extras`.** `GLTFLoader2.ts:380-387` adds a `beforeRoot` step that loads pre-bundled resources from the gltf extras key `BundledResources`, deserialized via `GLTFViewerConfigExtension.ImportResources`. Then exposed on both `GLTF._bundledResources` and `scene.importedBundledResources`. webgi doesn't have this concept.
- **`gltfExtras` saved on scene userData.** `GLTFLoader2.ts:197`: `scene.userData.gltfExtras = res.userData`. webgi only sets `gltfAsset`, dropping top-level userData.
- **Per-geometry userdata deserialize after import.** `GLTFLoader2.ts:255-257, 471-481`: traverses geometries and runs `deserializeUserData(geom, _bundledResources)`. webgi only deserializes via the parser-level `getDependency` wrapper, which doesn't get called for geometries (parser caches them by primitive index).
- **Resource-path URL modifier.** `GLTFLoader2.ts:89-111, 319-323`: re-rewrites embedded asset URLs based on `extras.resourcePath` saved by `GLTFExporter2`. Allows the importer to follow assets back to their original location even after the gltf is moved. webgi has no equivalent.
- **`importOptions` plumbing.** `GLTFLoader2.ts:45, 161, 324, 391-404`: per-import options (`useMeshLines`, `createUniqueNames`, `importAsModelRoot`) flow through `loader.importOptions` → `parser.importOptions`. webgi's signature is `(res, options: AnyOptions)` but no per-loader option plumbing.
- **`AllowEmptyFiles` / empty-file early-out.** `GLTFLoader2.ts:133, 145-153`: returns an empty `Group` scene instead of throwing for empty buffers. webgi just propagates the error.
- **Stencil + line-material extras round-tripped.** `src/assetmanager/gltf/GLTFMaterialExtrasExtension.ts:92-117` reads back `stencilWrite/Mask/Func/Ref/FuncMask/Fail/ZFail/ZPass`, `linewidth`, `worldUnits`, `dashed`, `dashScale`, `dashOffset`, `gapSize`, `resolution`. webgi `gltf.ts:280-287, 296-299` has those lines commented out (only basic `dashSize`/`gapSize` actually wired up). Means webgi loses stencil + LineMaterial2 extras on import.
- **MIME-type aware Importer registry.** `Importer` ctor takes a `mime` array; `AssetImporter._getImporter / _getLoader / _createLoader` match on mime as well as extension. webgi only matches on extension.
- **DRACOLoader2 normal recompute.** `src/assetmanager/import/DRACOLoader2.ts:36`: `if (!res.attributes?.normal) res.computeVertexNormals()`. Bare-mesh draco files load without normals on webgi.
- **DRACOLoader2 `decoderModulePending` cache.** `DRACOLoader2.ts:9, 79-96`: avoids re-initializing the decoder factory on repeated `initDecoder()` calls. webgi `loaders/DRACOLoader2.ts:64-72` re-fetches+re-evals every call.
- **DRACOLoader2 `SetDecoderWasmBinary` helper.** `DRACOLoader2.ts:143-146`: bundle the wasm + wrapper with the app. webgi only has `SetDecoderJsString`.
- **DRACOLoader2 actually invokes the factory.** `DRACOLoader2.ts:67-72`: `factory({...this.encoderConfig, onModuleLoaded: resolve})` returns a real decoder instance. webgi just returns the factory function (`return DRACOLoader2.EvalProxy?.(jsContent + '\nDracoEncoderModule;')?.()` — calling it without arguments, which short-circuits Emscripten's onModuleLoaded). See "Bugs in webgi" below.
- **GLB encryption preparser hardened.** `src/assetmanager/gltf/gltfEncyptionHelpers.ts:46-67`: requires `data.byteLength >= 100` before parsing prefix; checks `'GLBWrapper'` (works for both `WebGiGLBWrapper` and `ThreePipeGLBWrapper`). webgi `loaders/GLTFLoader2.ts:81-103` checks specifically `'WebGiGLBWrapper'`, so it can't unwrap threepipe-encrypted glbs.
- **RGBEPNGLoader v3 path.** `src/assetmanager/gltf/GLTFViewerConfigExtension.ts:147-153, 222-243`: env-map data textures saved as encodingVersion=3 use raw rgbe bytes (no base64 wrapping). Threepipe importer detects with `encodingVersion < 3 ? legacy_path : new_path`. webgi exporter only knows v1/v2; webgi importer mis-handles v3 (see Bugs in webgi).
- **`Texture.DEFAULT_IMAGE = whiteImageData` save/restore around inner `super.parse`.** Both have it; threepipe also restores `GLTFLoader.ObjectConstructors.LineBasicMaterial` per-call.
- **`updateMatrixWorld()` after parse for each scene.** `GLTFLoader2.ts:169-171` (with `// todo remove after three update` note). webgi doesn't.
- **`GLTFObject3DExtrasExtension` exports `matrixAutoUpdate`.** `src/assetmanager/gltf/GLTFObject3DExtrasExtension.ts:65`. webgi does too. (Same — but threepipe import never reads it back; see Bugs.)
- **Asset manager: `importFile<File>`, `importPath`, `importAsset`, `importSingle`, `processRaw` API surface.** `AssetImporter.ts:182-291`. webgi has `importAsset / importSingle / importPath / importFiles / processImported` only. Different signature surface — see API drift.
- **`__rootPathOptions` round-tripped via `_serializeOptions`.** `AssetImporter.ts:447-456, 539-549`. webgi only stores `__rootPath`.
- **`autoSetName`** option (`AssetImporter.ts:516, 576-578`) — webgi always sets name unconditionally (line 584).
- **Cache storage** (`Cache | Storage`) and `_initCacheStorage` plumbing (`AssetImporter.ts:720-738`). webgi has no equivalent.

## Bugs in webgi (sync-back candidates)

- **RGBEPNGLoader uses `Uint32Array` instead of `Float32Array` for `FloatType`.** `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/loaders/RGBEPNGLoader.ts:47`: `else if (this.type === FloatType) aType = Uint32Array`. threepipe fixed to `Float32Array` at `src/assetmanager/import/RGBEPNGLoader.ts:50`. This corrupts rgbe → float decoding when `type === FloatType` (would write float values bit-cast as uint32). Sync back.

- **RGBE `encodingVersion === 3` mis-parsed.** `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/generators/gltf.ts:465-470`: passes `parseAsync(url, undefined, true)` unconditionally as the `isFloat16Data` flag. threepipe at `src/assetmanager/gltf/GLTFViewerConfigExtension.ts:153` correctly uses `encodingVersion < 3`. Result: webgi importer loading a threepipe-exported v3 RGBE-encoded env-map will treat raw float16 bytes as 8-bit, producing a wrong env map. Threepipe exports v3 by default (line 225). Sync back.

- **DRACOLoader2 encoder factory never instantiated.** `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/loaders/DRACOLoader2.ts:51-58, 64-72`: `EvalProxy(... + '\nDracoEncoderModule;')?.()` calls the Emscripten module factory with **no args**, which returns the module synchronously without waiting for `onRuntimeInitialized`/`onModuleLoaded`. Encoder/decoder may not actually be ready when the promise resolves. threepipe `DRACOLoader2.ts:67-73, 89-93` passes `{...config, onModuleLoaded: resolve}` and resolves on actual load. Sync back.

- **DRACOLoader2 missing `decoderModulePending` cache.** Calling `initDecoder()` twice on webgi re-fetches the worker source and re-evals it. Sync back from threepipe `DRACOLoader2.ts:9, 79-96`.

- **`importViewer` only attaches `__importedViewerConfig` to the first scene of multi-scene gltf.** `gltf.ts:139, 144-145`: `(result.scene as any).__importedViewerConfig = viewerConfig` only on `result.scene`, but the surrounding loop iterates over `result.scenes`. Threepipe iterates and attaches to each `resultScenes[i]` correctly (`GLTFViewerConfigExtension.ts:25-37, 55`). Multi-scene viewer configs lose attachment in webgi.

- **Line color-buffer conversion never reaches the gltf importer.** webgi `AssetImporter.upgradeThreejsLine` runs only in `processImported` for already-`isLine` objects, but `gltfMaterialExtrasParser` strips the gltf material extras *before* lines are upgraded → line userData/material info is lost. (Not a bug in extras code, but in the order — flagging as design issue. Threepipe handles inline in `transform`.)

- **GLB encryption preparser only matches `'WebGiGLBWrapper'`.** `loaders/GLTFLoader2.ts:85`: `if (!prefix.includes('WebGiGLBWrapper')) return dat`. Means webgi cannot read a `ThreePipeGLBWrapper`-prefixed encrypted glb produced by threepipe. threepipe matches the broader `'GLBWrapper'` substring (`gltfEncyptionHelpers.ts:50`). Sync back the relaxed match.

- **`GLTFLoader2.parse` doesn't restore `Texture.DEFAULT_IMAGE` on error path.** webgi `loaders/GLTFLoader2.ts:30-47`: the `Texture.DEFAULT_IMAGE = whiteImageData` save is restored on success (line 40) but if parse errors out (`onError` branch), the saved value is lost — leaks `DEFAULT_IMAGE` for the rest of the session. threepipe has the same issue actually (`src/assetmanager/import/GLTFLoader2.ts:163-174` — only restores on success). Common bug — file separately.

- **`legacyBumpScale` flag not exported, but the legacy detection cascade depends on `viewer.metadata?.generator` — webgi doesn't always set it.** webgi exports the metadata only when the viewer config is exported; many `WEBGI_materials_bumpmap`-only files (no `WEBGI_viewer`) won't have `vcGenerator` and fall to the "default modern" branch. The asset.subversion fallback was added but only present on later files. Files in the gap (mid-2023, no viewer config, pre-asset.subversion) get auto-detected as modern when they're actually legacy. Threepipe has the same logic so same gap. (Already flagged as out of scope per the audit prompt — only mentioning that webgi is in the same boat.)

## Bugs in threepipe (need fix)

- **`GLTFObject3DExtrasExtension.Import` overrides `castShadow`/`receiveShadow` to `false` when the extension is present but the field isn't.** `src/assetmanager/gltf/GLTFObject3DExtrasExtension.ts:27-28`:
  ```
  o.castShadow = ext.castShadow ?? false
  o.receiveShadow = ext.receiveShadow ?? false
  ```
  webgi `gltf.ts:179-181` only assigns when explicit (`if (ext.castShadow !== undefined)`). The threepipe Export side (line 59-60) only writes these when *truthy* — so a threepipe file from a mesh whose `castShadow=true` will round-trip fine, but **a non-shadowing object that gains a sibling-only extension field (e.g. only `frustumCulled=false` set) will have its inherited `castShadow=true` stomped to `false` on import**. Specifically: any object with one of `frustumCulled / visible / renderOrder / layers / matrixAutoUpdate` set, but `castShadow` true (default for some lights and user-toggled meshes), will be silently flipped. Either match webgi's "explicit-only" semantics or always export both fields when the extension is emitted.

- **`matrixAutoUpdate` is exported but never imported.** `GLTFObject3DExtrasExtension.ts:65` writes it, but the Import block at `lines 12-44` has no reader. Round-trip data loss for any object with `matrixAutoUpdate=false`. webgi gltf.ts:179-189 has the same gap (but doesn't export it either, so no round-trip — webgi exporter at `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/gltf.ts:127` does export it, so webgi has the same one-sided gap).

- **`GLTFLightExtrasExtension` Import constructs a fresh `new ObjectLoader()` per-extension.** `src/assetmanager/gltf/GLTFLightExtrasExtension.ts:35`: `new ObjectLoader().parseObject(ext.shadow.camera, {}, {}, {}, {})`. webgi shares an `objLoader: ObjectLoader2` for the whole import. Beyond perf, `ObjectLoader2` has texture-loading side-effects (`parseTextures2`) that the bare three.js `ObjectLoader` doesn't — so any extras on a saved shadow camera that reference textures would be silently dropped. Probably edge-case (shadow cameras don't usually carry texture refs) but worth noting.

- **`Texture.DEFAULT_IMAGE` not restored on parse error.** `src/assetmanager/import/GLTFLoader2.ts:163-174`: the `val = Texture.DEFAULT_IMAGE; Texture.DEFAULT_IMAGE = whiteImageData` save/restore only restores in the success callback (line 165). If parsing throws / `onError`, `Texture.DEFAULT_IMAGE` stays as `whiteImageData` for the rest of the session. (Same bug exists on webgi side, see above.)

- **`_resPathUrlModifier` is shared across imports.** `src/assetmanager/import/GLTFLoader2.ts:89-111, 319-322`: `this._resPathUrlModifier.oldResourcePath/newResourcePath` are instance fields on the loader, but threepipe creates one loader per importer and reuses it (`AssetManager.ts:359` registers the GLTFLoader2 class once). When two glTFs are imported concurrently, the second overwrites the first's `oldResourcePath` mid-flight. Race condition under parallel imports.

- **`createUniqueName` `auto` reads only the active scene index.** `GLTFLoader2.ts:337`: `parser.json?.scenes[parser.json.scene ?? 0]?.extras?.rootSceneModelRoot`. Multi-scene glTFs where the rootSceneModelRoot flag is on a non-default scene don't trigger the duplicate-allowed path.

- **`processRaw` no longer handles the `res.children → res.__processedChildren` recursion that webgi had.** webgi's `processImported` (lines 486-509) recurses into the children of a `rootSceneModelRoot`, calling `_processors` for each child (light upgrade, model wrap). threepipe stops at the rootSceneModelRoot with just `_childrenCopy = [...res.children]` (line 572-574). Could be intentional refactor but means `iModel` light upgrade and `setupIModel` no longer happen on import — verify whether AssetManager's `addRaw` chain picks this up downstream. (Threepipe seems to handle this in AssetManager.ts, so this is an architectural shift not a bug.)

- **`asset.subversion` is read off `parser.json?.asset` but written without a clear writer reference in this audit's scope.** Confirm `GLTFExporter2`/`GLTFWriter2` actually emits `asset.subversion: 1` for new threepipe files; otherwise the legacy bump cascade always falls through to vcGenerator. (Out-of-scope for importer audit but worth verifying on the exporter audit.)

## Behavior divergences

- **threepipe defaults `GLTFLoader2.UseMeshLines = true` and converts `Line` → `MeshLine` during `transform`.** webgi keeps three.js's plain `Line`. Files with line primitives behave fundamentally differently between the two viewers.

- **threepipe's `GLTFMaterialExtrasExtension.Import` reads stencil + LineMaterial2 extras (linewidth/worldUnits/dashed/dashScale/dashOffset/gapSize/resolution).** webgi has those lines commented out. webgi-exported files with stencil props won't read them back into webgi but threepipe will read both threepipe- and webgi-exported (since the extras keys are common).

- **`isLegacy` cascade default differs by generator.** Both check `vcGenerator === 'WebGiViewerApp'`; threepipe additionally treats *unknown* generators as modern (skipping the "WebGi-without-generator" pre-May-2023 fallback). webgi treats `vcGenerator === undefined && vcVersion !== undefined` as legacy. Both behaviours documented in their respective comments — intentional divergence — but it means a webgi-pre-May-2023 file (no generator) loads as legacy in webgi and as modern in threepipe. The comment at `GLTFMaterialExtrasExtension.ts:43` says this is on purpose, but flagging because users may not realize.

- **Legacy bump flag: webgi clears `defines.BUMP_MAP_SCALE_LEGACY` on `explicitNotLegacy`; threepipe also clears `userData.legacyBumpScale`.** Threepipe is a strict superset (good).

- **Encryption preparser prefix size differs slightly.** Both check first 100 bytes; threepipe also rejects when total `byteLength < 100` (`gltfEncyptionHelpers.ts:47`). webgi crashes on tiny files (fine in practice).

- **`importer.addURLModifier` is threepipe-only.** webgi has no public hook; only the internal `_urlModifier` in AssetImporter. threepipe's `gltfViewerParser` registers/removes a per-import url modifier (`GLTFLoader2.ts:322, 393`).

- **`setKTX2Loader` is unconditional in threepipe** (`GLTFLoader2.ts:368`) vs only when `KHR_texture_basisu` is in `extensionsUsed` in webgi (`gltf.ts:132-138`). Threepipe sets it always to enable handler discovery for embedded ktx2; minor perf cost.

- **`needsDrc` predicate.** Both check `extensionsRequired?.includes('KHR_draco_mesh_compression')`. Same.

- **Object3D extras export uses `if (cast/receive) dat.x = true` (truthy-only) on both sides** but threepipe import semantically interprets *missing* as `false`, while webgi import interprets missing as "unchanged". See "Bugs in threepipe".

- **`parseAsync` third arg `isFloat16Data` differs** (covered above).

## API / signature drift

- **`Importer` ctor now requires `mime: string[]`.** threepipe: `new Importer(cls, ext, mime, root, onCtor?)`. webgi: `new Importer(cls, ext, root, onCtor?)`. Any subclass / consumer outside threepipe needs updating.
- **`ILoader<TIn, TOut>.transform(res, options)` vs `transform(res, options: AnyOptions)`.** threepipe options is now `ImportAddOptions`; webgi was `AnyOptions`.
- **`AssetImporter.importPath` → `importPath`** (same name) but threepipe's signature accepts `(path, options, onDownloadProgress?)` and returns `Promise<T[]>`; webgi returns `Promise<ISceneObject[]>`.
- **`AssetImporter.processImported` is deprecated**, replaced by `processRaw` (`AssetImporter.ts:776-779`). Webgi consumers calling `processImported` will hit a deprecation warning + same path.
- **`GLTFLoader2.preparsers` is a public field on both** but threepipe declares it after the `setup()` method and uses it in a `parse()` chain that propagates errors through `.then().catch()`. webgi same chain. No drift.
- **`GLTFLoader2.transform` signature.** threepipe: `transform(res: GLTF, options: ImportAddOptions): Object3D|undefined`. webgi: `transform(res: GLTF, options: AnyOptions): Object3D`. (return-type nullable in threepipe; options typed.)
- **`GLTFLoader2.setup(viewer, extraExtensions)` is a threepipe-specific entry point.** webgi has the equivalent inline in `addGLTFLoader(viewer)` (`gltf.ts:57-162`). Means threepipe loaders must be `setup()`-ed before use; webgi's were preconfigured by the factory.
- **Loader `register(callback)` now returns `this` typed as `this`** in threepipe (`GLTFLoader2.ts:298-300`). Webgi same.
- **`GLTFParser.bundledResources` and `GLTFParser.importOptions` are declared via `declare module`** in threepipe (`GLTFLoader2.ts:464-491`). New module-augmentation.
- **`IAssetImporter` interface drift.** threepipe adds `addURLModifier`, `removeURLModifier`, `processRaw` (renamed from `processImported`); removes `loaderCreate` enrollment differences. Different event-map shape.

## Notes / open questions

- `experiments/threepipe-webgi/src/` has zero active GLTF importer code — only commented-out plugin GLTF extension stubs in `plugins/postprocessing/SSContactShadowsPlugin.ts:264-372`. So nothing to compare on that side; sync candidates are 1:1 webgi-legacy-src ↔ threepipe.
- `ext-names.ts` is webgi's central registry of extension names. threepipe scattered them across each extension class as `static readonly WebGi*Extension = '...'`. Functionally equivalent but harder to grep. Consider centralizing for cross-tool tooling (Draco export + Transform plugin both need the names).
- `WEBGI_viewer` extension name is read directly as `'WEBGI_viewer'` string in `GLTFMaterialExtrasExtension.ts:37`. Should reference `GLTFViewerConfigExtension.ViewerConfigGLTFExtension` to keep the definition single-source.
- Verify `asset.subversion` is actually emitted by the threepipe exporter (`GLTFExporter2`). Importer cascade depends on it as the primary signal; if exporter never writes it, the cascade falls to `vcVersion`/`vcGenerator` only.
- `parser.options.path` is read in `GLTFLoader2.ts:319` as the new resourcePath. If glTF is loaded from a `data:` URL or blob, this is empty string — behaviour confirmed but worth documenting.
- Worth checking: when webgi-exported `WEBGI_materials_separate_metalrough` files are loaded by threepipe, the parser will use `pbrMetallicRoughness.metallicRoughnessTexture` if present, else fall back to scalar factors — and silently drop `metalnessTexture`/`roughnessTexture` from the unknown extension. Adding the importer to threepipe is a 1-day port (mirror `GLTFMaterialsAlphaMapExtension.ts`).
- `GLTFKHRMaterialVariantsPlugin` in threepipe is intentionally a separate plugin (`src/plugins/extras/GLTFKHRMaterialVariantsPlugin.ts`) registered through `gltfExtensions`, not part of the core importer. webgi did the same. No drift.
- `glbEncryptionPreparser.process` in threepipe coerces `data2 = binaryExtension.body || data` — but `binaryExtension.body` could be the original `data` slice, so on reassignment to `data` for re-parsing, the path still works. Sanity-check with a real encrypted file.
- DRACOLoader2 default CDN path differs: threepipe uses `draco@1.5.6/javascript/`, webgi uses `draco@1.4.1/javascript/`. Files emitted from one should still decode in the other (Draco bitstream is back-compatible) but worth pinning.
