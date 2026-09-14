# Audit: GLTF Exporter

## Summary

Threepipe's exporter has diverged in significant ways from webgi: threepipe added image-bytes fast-path (`_sourceImgBuffer`), basePath rewriting, encryption-as-processor, and per-material default-value gating in extras; webgi has `mergeMetalnessRoughnessMaps` + `WEBGI_materials_separate_metalrough` (already on TODO list), plus `iMaterialIgnoredUserData` userData filtering, and a stronger `Object3D.castShadow` round-trip. Several threepipe-side bugs remain: `if (!Object.keys(...))` truthy guards, missing `castShadow=true` from extras export, and inherited three.js `buildMetalRoughTexture` userData/rootPath leak into the packed texture clone (the "clone() userData leak"). `experiments/threepipe-webgi/src/` has **no exporter ports yet** — exporter changes haven't been touched there.

## webgi-only / new in webgi (missing in threepipe)

- **`mergeMetalnessRoughnessMaps` option** + **`WEBGI_materials_separate_metalrough` extension** (already on TODO; confirmed):
  - `experiments/webgi-legacy-src/.../GLTFExporter2.ts:29` defines option; `GLTFWriter2.ts:86-127` implements skip-merge by null-saving `metalnessMap`/`roughnessMap` around `super.processMaterial`, then writes the pair into the extension. Includes try/finally restoration. Threepipe's `processMaterial` at `src/assetmanager/export/GLTFWriter2.ts:73-116` has zero awareness of either feature.
  - The gltf-transform `ALL_WEBGI_EXTENSIONS` includes `SeparateMetalRoughMaterialExtension` (`exporters/GLTFDracoExporter.ts:494-497, 600`) with `{metalnessTexture: TextureChannel.B, roughnessTexture: TextureChannel.G}`. Threepipe's `GLTFDracoExportPlugin.extraExtensions` at `plugins/gltf-transform/src/GLTFDracoExportPlugin.ts:50-75` does not include it.

- **`iMaterialIgnoredUserData` filter list** in `serializeUserData` — webgi `GLTFWriter2.ts:39-42` excludes `appliedMeshes`, `imageLoadAwaiter`, `inverseModelMatrix`, `uvTransform`, `uuid`, `iMaterial` plus geometry's `appliedMeshes` and model's `parentRoot`/`iCamera`/`iModel`. Threepipe `GLTFWriter2.ts:34-46` only filters `_`-prefixed keys, falsy, functions, isObject3D/isTexture/isMaterial, `assetType != null`. **Risk**: any leftover keys with those names on `userData` (e.g., legacy data, plugins) will round-trip into JSON. In threepipe `appliedMeshes` is a class property not in userData — but `imageLoadAwaiter`, `iMaterial` and others are not guaranteed; needs verification.

- **`processSampler` extras with `flipY` + `colorSpace` + `uuid` carrying** — webgi has `// todo` note at `GLTFWriter2.ts:215-220` mentioning samplers should carry `colorSpace`/`uuid`/`flipY`. Threepipe also has the same TODO at `GLTFWriter2.ts:178-181` (parity here, but webgi additionally listed `colorSpace` in the comment and "todo other properties that are not in sampler like flipY maybe").

- **gltf-transform extension list — threepipe is missing many of `ALL_WEBGI_EXTENSIONS`**, including (`exporters/GLTFDracoExporter.ts:582-605`):
  - `WEBGI_materials_separate_metalrough` (call it out separately above)
  - `WEBGI_animation_markers` (`AnimationMarkersExtension`) — for `GLTFAnimationPlugin`
  - `WEBGI_materials_thinFilmLayer` (`THIN_FILM_LAYER_GLTF_EXTENSION`)
  - `WEBGI_materials_triplanarMapping` (`TRIPLANAR_GLTF_EXTENSION`)
  - `WEBGI_materials_ssbevel` (`SSBEVEL_GLTF_EXTENSION`)
  - `WEBGI_materials_layered` (`LAYERED_MATERIAL_GLTF_EXTENSION`)
  - `WEBGI_materials_autouv` (`AUTOUV_GLTF_EXTENSION`)
  - `WEBGI_materials_diamond`, `WEBGI_materials_gemInclusions` (these are in the diamond-stack and explicitly out of audit scope; flagging only for completeness)
  Threepipe's `GLTFDracoExportPlugin.extraExtensions` already includes `bumpmap, lightmap, alphamap, displacementmap, customBumpMap, light_extras, object3d_extras, material_extras, clearCoatTint, noiseBumpMaterial, fragmentClipping, anisotropy`. The inline TODO comment at `plugins/gltf-transform/src/GLTFDracoExportPlugin.ts:69-74` already acknowledges Diamond/Animation/ThinFilm/Triplanar/SSBevel as missing.

- **`GLTFDracoExporter.addExtension(extension: typeof Extension)` signature** in webgi (`GLTFDracoExporter.ts:153`) takes a single class; threepipe's `GLTFDracoExporterBase.addExtension(...extension: (typeof Extension)[])` at `plugins/gltf-transform/src/GLTFDracoExporterBase.ts:131` is variadic. Behavioral parity is fine but the API drifted.

- **webgi `gltf.ts:postparse` / `__askjniucy9e18y` / `__smbId` / `__kryfgudlskdnme` watermarking hook** — entirely missing in threepipe. This is a licensing/domain-verification mechanism (out-of-scope per audit instructions; flagging that it does not need porting).

- **webgi `GLTFViewerExport.processViewer` resource cross-dedup against `writer.json.materials`** — present and equivalent in threepipe `GLTFViewerConfigExtension.BundleExtraResources` (`src/assetmanager/gltf/GLTFViewerConfigExtension.ts:268-294`). Parity.

## threepipe-only / new in threepipe (missing in webgi)

- **Image fast-path via preserved source bytes (`_sourceImgBuffer`)** — `src/assetmanager/export/GLTFWriter2.ts:203-228`. Bypasses three.js's canvas `drawImage`/`toBlob` re-encode, deterministic across runs, preserves quality. Webgi has nothing equivalent.

- **`exporterOptions._basePath`** to strip a base prefix from `userData.rootPath` URI when emitting external-image refs (`GLTFWriter2.ts:258-261`). Webgi never strips.

- **`isNonRelativeUrl(rootPath)` helper** instead of `startsWith('http')||startsWith('data:')` — `GLTFWriter2.ts:194-195` and `GLTFMaterialExtrasExtension.ts:348`. Catches more schemes (`asset://`, `file://`, etc., per `src/utils/browser-helpers.ts:50` + tests). Webgi misses these.

- **`forceIndices` option in `GLTFExporter2Options`** at `GLTFExporter2.ts:103,173` (TODO/unimplemented — passes the flag through but doesn't act on it). Not in webgi.

- **`processors` chain on `GLTFExporter2`** (`GLTFExporter2.ts:136,142-144`) — pluggable post-processors, with `glbEncryptionProcessor` registered by default (`GLTFExporter2.ts:129`). Webgi inlined the encryption directly inside `parseAsync` (`GLTFExporter2.ts:45-65` of webgi). Threepipe's design is cleaner and more extensible.

- **`isNonRelativeUrl`-based `hasRootPath` precondition includes `!map.isRenderTargetTexture`** — `GLTFWriter2.ts:194,206`. Webgi's check at `GLTFWriter2.ts:234-237` does not exclude render target textures. Threepipe is more correct.

- **Color-from-shader-material override** — `GLTFWriter2.ts:96-99`: when a shader material is being processed (via the default-material substitution), threepipe writes `pbrMetallicRoughness.baseColorFactor` from the underlying material's `color`+`opacity` if non-white. Webgi has no such override.

- **`GLTFViewerConfigExtension.ExportViewerConfig` + `BundleExtraResources` + `BundleArrayBuffers` split** — `src/assetmanager/gltf/GLTFViewerConfigExtension.ts:174-294`. Threepipe extracted this into reusable methods so it can run viewer config OR plain bundled-resources mode (when not a root scene). Webgi conflated this in `processViewer` only.

- **Encryption preparser (`glbEncryptionPreparser`)** — `src/assetmanager/gltf/gltfEncyptionHelpers.ts:42-68`. Webgi only had encryption on the export side.

- **AsseutExportHook hooks** (`src/assetmanager/export/assetExportHook.ts`) — full lifecycle: `objectGeometry`, `objectMaterial`, `replaceTexture`, `revertTextures`, `revertObject`, plus mesh-line geometry temp swap, sProperties partial-clone, gltfUUID round-trip, gltfAnimations rootRefs. Webgi `AssetExporter.exportObject` (`AssetExporter.ts:75-100`) only had `excludeFromExport` toggling and `__exportViewerConfig=false`. Threepipe is significantly richer here.

- **`PhysicalMaterial.MaterialProperties`/`threeMaterialPropList` default-value gating in `GLTFMaterialExtrasExtension.Export`** — every property is only emitted when it differs from the class default. Webgi unconditionally writes everything that's `!== undefined` (so even default values bloat the file). Threepipe is significantly more efficient here.

- **`PhysicalMaterial.MaterialProperties` default gating for `displacementScale/Bias` and `lightMapIntensity`** — `GLTFMaterialsDisplacementMapExtension.ts:91-95` and `GLTFMaterialsLightMapExtension.ts:97-98`. Webgi always writes `displacementScale/Bias` and `lightMapIntensity`. Threepipe only writes when non-default.

- **`subversion`/`normalizedScale` legacy-bump cascade** — already-handled, do not re-flag.

- **`emissiveIntensity` import** in `GLTFMaterialExtrasExtension.ts:58` — read-only backwards-compat support; export side uses `KHR_materials_emissive_strength` only. Webgi material-extras importer has neither (webgi exporter already commented this out at `gltf.ts:151-156`). Parity at the export, threepipe-only at the legacy import.

- **Stencil props round-trip** — threepipe imports `stencilWrite/stencilRef/...` (`GLTFMaterialExtrasExtension.ts:92-99`). Threepipe **does not** export stencil props (the `if (material.stencilWrite ...)` lines are present but commented out at `gltf.ts:189-196` of webgi too — wait, threepipe's `GLTFMaterialExtrasExtension.Export` at lines 254-261 DOES export stencil props. Webgi `gltf.ts:189-196` has them all commented out. So threepipe is doing more here.

- **`linewidth/worldUnits/dashed/dashSize/dashScale/dashOffset/gapSize` (LineMaterial2 props)** — only exported by threepipe (`GLTFMaterialExtrasExtension.ts:270-276`) and imported (`...:108-114`). Webgi has these commented out at `gltf.ts:205-208`.

- **`Object3D.castShadow=true` fallback** when `ext` missing on a non-AmbientLight — `GLTFObject3DExtrasExtension.ts:21`. Smart legacy-default; webgi has nothing similar.

- **`__keepShadowDef` flag** set by importer — `GLTFObject3DExtrasExtension.ts:36`. webgi has nothing similar.

## Bugs in webgi (sync-back candidates)

- **`webgi.GLTFWriter2.processTexture` only checks `rootPath.startsWith('http') || startsWith('data:')`** (`GLTFWriter2.ts:236, 256`). Misses other non-relative schemes (`asset://`, `file://`, `blob:`, etc.). Threepipe's `isNonRelativeUrl` is correct — sync forward already done.

- **`webgi.GLTFWriter2.processTexture` does not exclude render target textures** from the rootPath path — would attempt to emit `userData.rootPath` for a RT, which is meaningless. Threepipe fixed this with `!map.isRenderTargetTexture`. Already-fixed direction is threepipe→webgi.

- **`webgi.gltf.ts` material extras unconditionally writes default-value properties** — generates verbose JSON. Threepipe gates on `MaterialProperties` defaults — sync forward already done.

- **`webgi.GLTFExporter2.parse` invokes `super.parse` synchronously** but cleanup of `obj1.userData.gltfUUID` happens inside the `onDone` callback (`webgi/GLTFExporter2.ts:117-127`). On `onError` path (or pending-promise rejection), `gltfUUID` leaks on the live object. Threepipe moved this to `assetExportHook` which has both a `done` and `error` cleanup branch (`assetExportHook.ts:114, 132`). Sync direction: threepipe→webgi.

- **`webgi.GLTFDracoExporter.preload` is fire-and-forget** (`GLTFDracoExporter.ts:69-72`) — caller cannot await readiness. Same in threepipe `GLTFDracoExporterBase.preload` (`GLTFDracoExporterBase.ts:47-50`). Both should return a Promise. Bidirectional bug.

## Bugs in threepipe (need fix)

- **`if (!Object.keys(extensionDef)) return` is always falsy** — an empty array `[]` is still truthy in JS. Bug present in three places:
  - `src/assetmanager/gltf/GLTFMaterialsAlphaMapExtension.ts:99`
  - `src/assetmanager/gltf/GLTFMaterialsDisplacementMapExtension.ts:105`
  - `src/assetmanager/gltf/GLTFMaterialsLightMapExtension.ts:108`
  Should be `if (!Object.keys(extensionDef).length) return`. Currently the early-return never triggers, so an empty `extensionDef` (only happens if all checks fall through, e.g., all values are at defaults AND map fails `checkEmptyMap`) is still attached to `materialDef.extensions[name] = {}` and `extensionsUsed` is set. This produces empty extension entries in output, which downstream tools (gltf-transform, validators) may flag.

- **Inherited three.js `buildMetalRoughTexture` userData/clone leak** — `three.js-modded/examples/jsm/exporters/GLTFExporter.js:921`: `const texture = reference.clone()`. The clone copies `userData` (including `rootPath`, `mimeType`, `colorSpace` flags) from the source `metalnessMap || roughnessMap` into the brand-new packed texture. When threepipe's `GLTFWriter2.processTexture` then runs on it, the `hasRootPath` branch (`GLTFWriter2.ts:194-195, 230-236`) will treat the packed texture as an external URL and emit `img.uri = userData.rootPath` of the source — pointing the metallicRoughness slot at the standalone metalnessMap URL. **This is the user-mentioned "clone() userData leak"**. Webgi inherited the same three.js `buildMetalRoughTexture` so it's also affected — but webgi's `processTexture` only checks `http/data:` (subset). Either way both are buggy. Fix: clear `userData.rootPath`/`userData.mimeType`/`source.userData` on the packed clone, or detect "synthesized texture" in `processTexture`. Note webgi's mergeMetalnessRoughnessMaps=false avoids this entirely by not running buildMetalRoughTexture.

- **`flipY` mismatch in fast-path** — `src/assetmanager/export/GLTFWriter2.ts:206-228`: when emitting preserved `_sourceImgBuffer` bytes via `processImageBlob`, the cache key inside `processImageBlob` is `blob.type + ':flipY/' + texture.flipY.toString()` (`GLTFWriter2.ts:136`). But the original bytes were captured with whatever `flipY` was at decode time, **not necessarily `texture.flipY` at export time**. If `texture.flipY` was toggled after import, the fast-path emits unchanged bytes but caches them under the wrong key, AND the gltf consumer will see flipY mismatch with the actual pixel data. Fix: either (a) bypass fast-path when `texture.flipY` differs from a stored "decoded flipY" (would need to record at decode in TextureLoader2/GLTFLoader2), or (b) drop the `flipY` from the fast-path cache key and write `extras.flipY` from a known-canonical value. Webgi has no fast-path so it's not affected.

- **`mimeType` allowlist mismatch** — fast-path at `GLTFWriter2.ts:205` accepts `image/jpeg`, `image/png`, `image/jpg`. Three.js inherited `processImage` rejects DataTextures with non-RGBA format (`GLTFExporter.js:1316-1320`). The fast-path emits `image/jpg` after coercing to `image/jpeg` (`GLTFWriter2.ts:208`), which is correct. But: if `userData.mimeType === 'image/webp'` (or `image/ktx2`), three.js in `processTexture` (`GLTFExporter.js:1455`) downconverts webp→png — losing the original bytes. The fast-path doesn't run for webp. So webp `_sourceImgBuffer` is silently re-encoded via canvas, defeating the optimization for webp inputs. Could expand fastMimeOk to include webp.

- **Duplicate / inconsistent `source.uuid` and `t_uuid` writes** — `GLTFWriter2.ts:222-226` (fast-path) writes `imageDef.extras.uuid = map.source.uuid` and `imageDef.extras.t_uuid = map.uuid`; the slow path (`GLTFWriter2.ts:284-287`) only writes `extras.uuid` (source uuid) and `extras.t_uuid`. Webgi (`GLTFWriter2.ts:289-293`) ALSO wrote `extras.t_colorSpace = map.colorSpace`. **Threepipe lost the `t_colorSpace` extras.** This means a viewer config which references textures by `colorSpace` may fail to round-trip in some cases (compare `GLTFViewerExport.ts:21` of webgi which used both keys). Sync from webgi.

- **`writer.options.exporterOptions` may be undefined** — `GLTFWriter2.ts:204, 232, 258` access `this.options.exporterOptions.embedUrlImages`/`._basePath`. While `GLTFExporter2.parse` always passes `exporterOptions: options` (`GLTFExporter2.ts:174`), if a third-party exporter creates a `GLTFWriter2` directly (or a test mock), `this.options.exporterOptions` could be `undefined` and the dot access throws. Use optional chaining everywhere.

- **`GLTFObject3DExtrasExtension.Export` does NOT emit `castShadow:false`** — `GLTFObject3DExtrasExtension.ts:59`: `if (object.castShadow !== undefined && object.castShadow) dat.castShadow = object.castShadow`. Only emits when `true`. The importer (`...:27`) does `o.castShadow = ext.castShadow ?? false`, so `false` round-trips ONLY because the absence flips it to false. But webgi (`gltf.ts:121`) emits unconditionally: `if (object.castShadow !== undefined) dat.castShadow = object.castShadow`. The threepipe semantics: if the extension is present, missing castShadow → false. If extension absent → for non-Ambient lights, defaults to `true` (`GLTFObject3DExtrasExtension.ts:21`); for non-light objects, three.js default (false). This is a divergence: a non-light object loaded into webgi could lose `castShadow=true` if it ever roundtripped through threepipe extension-absent path (unlikely since the extension is registered, but worth verifying with mixed-tooling files).

- **`forceIndices` option is plumbed but never acted on** — `GLTFExporter2.ts:103, 173`. The threepipe export forwards `forceIndices: options.forceIndices ?? false` into `gltfOptions` but three.js GLTFExporter has no `forceIndices` option. Either implement (force-generate index buffer for non-indexed geometry pre-export), or remove the option to avoid silent misuse.

- **`embedUrlImagePreviews` userData key naming inconsistency** — webgi uses `__embedUrlImagePreviews` (double underscore prefix, signaling "private/strip from userData"); threepipe uses `embedUrlImagePreviews` (no prefix). Threepipe's `GLTFWriter2.serializeUserData` strips ONLY single-underscore-prefixed keys, so if someone serializes the same texture twice in a row and the cleanup at `GLTFMaterialExtrasExtension.ts:313` is interrupted (throw), the flag could leak into output userData. Recommend prefixing with `__` like webgi.

- **`GLTFExporter2.ExportExtensions` no longer registers `GLTFMaterialsBumpMapExtension.Export`** (line 194 commented "deprecated"). The `*.normalizedScale` writer is dead code from registration's POV. Per audit notes this is intentional. **Confirmed.**

## Behavior divergences

- **Color override on shader-material substitution** — threepipe `GLTFWriter2.ts:96-99` writes `pbrMetallicRoughness.baseColorFactor` from underlying shader material's `color`/`opacity`. Webgi does not. This means a webgi-exported file from a ShaderMaterial yields default white baseColor; threepipe yields the actual color. Round-trip stable on threepipe side; one-way on webgi.

- **Encryption flow** — webgi: inline `aesGcmEncrypt` in `GLTFExporter2.parseAsync` only when `byteLength` (i.e., GLB), wraps in `makeGLBFile` with embedded asset.encryption metadata. Threepipe: a `processors` post-chain hooks `glbEncryptionProcessor` which checks `gltf instanceof ArrayBuffer && options.encrypt`. Same end output, more extensible in threepipe.

- **`gltfViewerWriter` placement** — webgi unconditionally registers viewer-config writer in `addGLTFExporter` (`gltf.ts:91`); threepipe registers it last in `setup()` (`GLTFExporter2.ts:243-244`) and additionally has a fallback path that writes plain bundled resources to `extras` when not a `rootSceneModelRoot` (`GLTFExporter2.ts:251-273`). Threepipe handles non-scene-root exports more cleanly.

- **Resource bundling for material external resources** — webgi `gltf.ts:299-304` writes `scene.extensions.WEBGI_material_extras = {resources: serializedMeta}`. Threepipe `GLTFMaterialExtrasExtension.ts:370-376` does the same. Parity. But threepipe writes the serializedMeta at scene-extension on the `default scene` (`writer.json.scene || 0`) — webgi same. Equivalent.

- **`processObjects` uses `processScene` when the single root has `userData.rootSceneModelRoot`** — webgi `GLTFWriter2.ts:58-65` and threepipe `GLTFWriter2.ts:58-65` are byte-identical. Parity.

- **`AssetExporter.processBeforeExport`** — webgi's switch (`AssetExporter.ts:160-176`) returns `{obj, ext: 'glb'}` for `model`. Threepipe's flow goes through `assetExportHook` (much richer). Cleaner.

## API / signature drift

- **`GLTFExporter2Options` keys differ**:
  - webgi has: `encrypt`, `encryptKey`, `embedUrlImages`, `embedUrlImagePreviews`, `exportExt`, `preserveUUIDs`, `externalImagesInExtras`, `encodeUint16Rgbe` (default=true), `jsonSpaces`, `mergeMetalnessRoughnessMaps`.
  - threepipe has all of those PLUS `viewerConfig`, `forceIndices`, `_basePath`, `[key: string]: any` open-key escape hatch. Threepipe also documented all GLTFExporter base options inline.
  - threepipe MISSING: `mergeMetalnessRoughnessMaps`.
  - **Default drift**: webgi `encodeUint16Rgbe` default = `true` (per webgi comment at `GLTFExporter2.ts:21`); threepipe says `@default false` (`GLTFExporter2.ts:48`). **This is a behavior break for env-map exports** — a webgi-exported file with Uint16Array env-map will pass through `encodeUint16Rgbe` path; threepipe-exported won't (will dump raw Uint16Array bufferView). Decide whether to flip the default or keep current.

- **`GLTFExporter2.parseAsync` signature**: webgi takes `obj: any`; threepipe takes `obj: ArrayBuffer|any`. Functionally same.

- **`GLTFExporter2.parse` return type** — webgi typed `: any`, threepipe `: void`. Minor.

- **`GLTFDracoExporter` constructor**:
  - webgi: `constructor(encoderOptions?: EncoderOptions)` then `loader` set externally (`addGLTFDracoExporter`).
  - threepipe `GLTFDracoExporterBase`: `constructor(io: PlatformIO, encoderOptions?: EncoderOptions, loader?: DRACOLoader2)`. PlatformIO injected — necessary for the Browser/Node split. `loader` constructor-param eagerly calls `preload(true, true)`.

- **`AssetExporter` shape**: webgi has `Exporters: IExporter[]` array with `addGLTFExporter(this, viewer)` registration in constructor. threepipe has a richer `IExporter['ctor']` signature that takes the AssetExporter and the IExporter itself, plus `extensions` slot is auto-wired via `ex.setup(viewer, _exporter.extensions)` (`GLTFDracoExportPlugin.ts:106`).

## Notes / open questions

- **threepipe-webgi has zero exporter content** — `find experiments/threepipe-webgi/src -name '*.ts'` returns only postprocessing/buffer/extras plugins. The exporter porting work is pending. No PR/sync changes there yet.

- **`testing_patchGLTFWriter2` injection point** — threepipe added `GLTFWriter2.ts:21` static block to allow deterministic test patching. Not in webgi. No issue.

- **Asset version subversion** — both sides set `json.asset.subversion = TPAssetVersion (1)`. The ephemeral `subversion` is stripped by gltf-transform draco passthrough; the audit-allowed legacy-bump cascade explicitly handles this. Confirmed not to re-flag.

- **`GLTFViewerConfigExtensionGP` only registered via gltf-transform path** — `GLTFDracoExportPlugin.gltfTransformExtensions` (`GLTFDracoExportPlugin.ts:78`) prepends `GLTFViewerConfigExtensionGP` ahead of the generic ones. Webgi did same with `WebGIViewerExtension` at the head of `ALL_WEBGI_EXTENSIONS`. Parity — but threepipe's class is named differently (`GP` suffix); no functional issue.

- **`preserveUUIDs` location moved** — webgi sets `gltfUUID` inside `GLTFExporter2.parse` directly (line 97-101). Threepipe moved it into `assetExportHook.ts:70`. Both correct, threepipe's is more lifecycle-aware.

- **Open: `_savePreview` uses 32×32 hardcoded preview size** — `GLTFWriter2.ts:299` (threepipe) and `GLTFWriter2.ts:306` (webgi). Identical behavior. Make this configurable?

- **Open: `ALL_WEBGI_EXTENSIONS` in webgi is exported** (`GLTFDracoExporter.ts:582`) so callers can inject via constructor; threepipe's equivalent `gltfTransformExtensions` is a getter that re-builds each access (`GLTFDracoExportPlugin.ts:77`). Slight perf hit but allows hot-update of `extraExtensions`.

- **Open: webgi's `GLTFViewerExtensionProperty` was `parentTypes: [PropertyType.SCENE]`**, threepipe's `ViewerJSONExtensionProperty` same. Parity.

- **Open: `GLTFMaterialExtrasExtension.Export.beforeParse` mutation safety** — both webgi and threepipe set `material[k] = null` directly on the live material (`GLTFMaterialExtrasExtension.ts:350`) and rely on `afterParse` to restore. Same try/finally hazard as webgi's mergeMetalnessRoughnessMaps logic — if `parse` throws asynchronously after `beforeParse` but before `afterParse`, the live material is left with null textures. Webgi has the same bug. Worth wrapping in try/finally.

- **Open: animations dedup difference** — webgi `GLTFExporter2.parse` (line 104-113) pushes animations from object traversal into `gltfOptions.animations`. threepipe `assetExportHook.processGLTFAnimations` (line 222-242) does same plus tracks `userData.rootRefs` for re-association. Threepipe is richer. Make sure this is preserved.
