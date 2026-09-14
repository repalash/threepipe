# Audit: Material Classes + UI

Comparison scope (paths are absolute):

webgi:
- `/Users/palash/Projects/threepipe/experiments/webgi-legacy-src/extras/asset_manager/threejs/materialUtils.ts`
- `/Users/palash/Projects/threepipe/experiments/webgi-legacy-src/extras/asset_manager/threejs/MeshStandardMaterial2.ts`
- `/Users/palash/Projects/threepipe/experiments/webgi-legacy-src/extras/asset_manager/threejs/MeshBasicMaterial2.ts`
- `/Users/palash/Projects/threepipe/experiments/webgi-legacy-src/extras/asset_manager/threejs/MaterialThree.ts`
- `/Users/palash/Projects/threepipe/experiments/webgi-legacy-src/extras/asset_manager/threejs/MaterialManager.ts`
- `/Users/palash/Projects/threepipe/experiments/webgi-legacy-src/extras/asset_manager/threejs/MaterialExtender.ts`

threepipe:
- `/Users/palash/Projects/threepipe/src/core/IMaterial.ts`
- `/Users/palash/Projects/threepipe/src/core/material/PhysicalMaterial.ts`
- `/Users/palash/Projects/threepipe/src/core/material/UnlitMaterial.ts`
- `/Users/palash/Projects/threepipe/src/core/material/LegacyPhongMaterial.ts`
- `/Users/palash/Projects/threepipe/src/core/material/LineMaterial2.ts`
- `/Users/palash/Projects/threepipe/src/core/material/IMaterialUi.ts`
- `/Users/palash/Projects/threepipe/src/core/material/iMaterialCommons.ts`
- `/Users/palash/Projects/threepipe/src/core/material/threeMaterialPropList.ts`
- `/Users/palash/Projects/threepipe/src/utils/serialization.ts` (`copyMaterialUserData`, `copyUserData`)
- `/Users/palash/Projects/threepipe/src/ui/image-ui.ts` (`makeSamplerUi`)
- `/Users/palash/Projects/threepipe/src/materials/MaterialExtender.ts`, `MaterialExtension.ts`

threepipe-webgi experiment: contains plugins only, no material classes — out of scope for this audit.

Already handled (per task brief): legacy bump scale UI checkbox in `IMaterialUi.ts:497-514`, and legacyBumpScale flag handling in `iMaterialCommons.ts:67-72`. Not re-flagged below.

## Summary

The class layout in threepipe is healthier (split into `iMaterialCommons` + per-class subclasses, decorator-based serialization, real `MaterialExtender.UnregisterExtensions`). The webgi versions still ship a few small pieces of UI/behavior that have not been ported:

1. **userData leakage on save/clone**: webgi excludes `appliedMeshes`, `imageLoadAwaiter`, `inverseModelMatrix`, `uvTransform`, `iMaterial` from material userData copy (`materialUtils.ts:196`). threepipe only excludes `uuid` (`serialization.ts:547`), so these keys leak into JSON output and clones.
2. **PhysicalMaterial UI gaps** vs webgi `MeshStandardMaterial2` UI: missing the `Render to Depth` checkbox (always shown without an `undefined` gate), `Render to Gbuffer` does exist in threepipe (extra, good), and `inverseAlphaMap` UI is fine. The big functional gap in PhysicalMaterial is that the *Sheen / Clearcoat / Iridescence* folder UI is generated through `iMaterialUI.*` matching webgi but a few range bounds and folder hidden conditions changed (see "Behavior divergences").
3. **`UnlitMaterial.envMap` defines management**: webgi `MeshBasicMaterial2` initialises `defines = {}` (so envMap defines work) and ports `envMap` semantics through `customProgramCacheKey` (with `inverseAlphaMap` token). threepipe matches on `defines` init but `customProgramCacheKey` always appends `this.userData.inverseAlphaMap` for *every* material via `iMaterialCommons.customProgramCacheKey` even when the property is irrelevant — minor pollution, but not a bug.
4. **Material extensions API**: webgi's `MaterialExtender.UnregisterExtensions` is a TODO no-op (`MeshStandardMaterial2.ts:204`, `MeshBasicMaterial2.ts:91`). threepipe has a real impl (`MaterialExtender.ts:101-118`). webgi has *no priority* sort and its `customCacheKey` field has been replaced/renamed `computeCacheKey` in threepipe.
5. **PhysicalMaterial.attenuationDistance hack**: both apply the `Infinity → 0` UI hack on construction and after `setValues`. threepipe additionally re-applies in `setValues` (`PhysicalMaterial.ts:193`). Same approach.
6. **Legacy `userData.setDirty` warn shim**: webgi installs it on every material (`MeshStandardMaterial2.ts:184-187`, `MeshBasicMaterial2.ts:74-77`); threepipe has it only commented out in `iMaterialCommons.upgradeMaterial` (lines 277-280). Already explicitly handled per task brief.
7. **Sampler UI** in webgi has color-space/wrap/min/mag/anisotropy `onChange` callbacks that fire `setDirty` on the material. threepipe only sets `tex.needsUpdate = true` in some branches and doesn't always call `setDirty` — minor: most are wrapped in the parent folder `onChange: setDirty` (`image-ui.ts:27`), so behavior is preserved.

## webgi-only / new in webgi (missing in threepipe)

### A. `iMaterialIgnoredUserData` — leak list at userData copy/serialize
File: `experiments/webgi-legacy-src/extras/asset_manager/threejs/materialUtils.ts:196`

```js
export const iMaterialIgnoredUserData = ['appliedMeshes', 'imageLoadAwaiter', 'inverseModelMatrix', 'uvTransform', 'uuid', 'iMaterial']
```

threepipe equivalent: `src/utils/serialization.ts:547` only ignores `['uuid']`.

Keys that webgi excludes but threepipe **lets through** `copyMaterialUserData` (so they can land in `userData` of cloned materials and in JSON exports):

- `appliedMeshes` — would be a Set in legacy threepipe (it's now `material.appliedMeshes`, a class field, *not* on userData — but if any pipeline writes `userData.appliedMeshes`, it now leaks). Low risk in current threepipe but no defense.
- `imageLoadAwaiter` — webgi-specific name. Not used in threepipe.
- `inverseModelMatrix` — webgi-specific cached matrix. Not used in threepipe.
- `uvTransform` — webgi-specific cached. Not used in threepipe.
- `iMaterial` — back-reference set in `MaterialManager.ts:62` (`oldMaterial.userData.iMaterial = material`). Not currently used in threepipe — but if any plugin ever writes a material reference into userData it will be cloned (and the function will then deep-copy through it because `isMaterial` short-circuits that branch — so actually safe at runtime, but it persists into JSON via Serialization).

webgi `copyMaterialUserData` (lines 198-214) also has stricter handling than threepipe `copyUserData`:
- Considers `userDataSkipClone`, `isTexture`, `isObject3D`, `isMaterial`, `isBufferGeometry` in the skipClone test — same as threepipe `copyUserData` at `serialization.ts:515`. Match.
- Recurses for `Array.isArray(src) || typeof src === 'object'` — threepipe uses `src.constructor === Object || Array.isArray(src)` (`serialization.ts:519`). threepipe is *stricter* (won't recurse into class instances), which is actually a fix, not a regression.

Net: threepipe should add the leak-list, parameterized as it already supports `ignoredKeysInRoot`. Suggested call sites:
- `copyMaterialUserData(this.userData, userData, ['uuid', 'appliedMeshes', 'imageLoadAwaiter', 'inverseModelMatrix', 'uvTransform', 'iMaterial'])` inside `iMaterialCommons.setValues` (line 60).
- Same defaults inside `serializeMaterialUserData` (line 572).
Or change the default of `copyMaterialUserData` itself to those keys.

### B. `copyTextureUserData` ignored list parity
webgi `materialUtils.ts:216`: `iTextureIgnoredUserData = ['appliedMaterials', 'uuid']`.
threepipe `serialization.ts:534`: `copyTextureUserData(..., ['uuid'])`.
`appliedMaterials` is leaked through (analogous to material's `appliedMeshes`).

### C. `MeshStandardMaterial2.copyProps` ignoredUserData rebuilding behavior
webgi `MeshStandardMaterial2.ts:939-952` (clearCurrentUserData branch): preserves only the keys in `iMaterialIgnoredUserData` plus `__appliedMeshes` from current userData before merging the new userData. threepipe `iMaterialCommons.setValues:36` simply sets `this.userData = {}` if `clearCurrentUserData` — *all* current userData is dropped, including any pipeline-internal cached bits like `_X_version` (used by the material extension version-tracking in `MaterialExtender.ts:155-159`). This means cloning/setValues from a material strips extension version state — slight regression vs webgi.

### D. Custom blending UI — completeness
webgi has the full custom-blending dropdown set in `MeshStandardMaterial2.ts:551-646`. threepipe `IMaterialUi.blending` (`IMaterialUi.ts:165-258`) matches all of them. Good. *No* gap here — initial reading suggested otherwise but verified equivalent.

### E. `PhysicalMaterial` — emission intensity range
webgi `MeshStandardMaterial2.ts:422-427`: `emissiveIntensity` is `type: 'input'` (no bounds).
threepipe `IMaterialUi.ts:565-568`: `emissiveIntensity` is `type: 'slider', bounds: [0, 100]`.
Threepipe is *better* (clamped slider with bound 100). Just noting the divergence; webgi accepts arbitrarily large intensities via input.

### F. `attenuationDistance` UI type
webgi `MeshStandardMaterial2.ts:466-468`: `type: 'input'`.
threepipe `IMaterialUi.ts:613-616`: `type: 'number'`. Equivalent.

### G. `MeshBasicMaterial2` envMap UI presence
webgi `MeshBasicMaterial2.ts:97-261` has *no* environment folder for the unlit material. threepipe `UnlitMaterial.uiConfig` also disables it (`UnlitMaterial.ts:191` — line is commented). Match.

### H. `MeshStandardMaterial2.fromJSON` calls `copyProps` directly
webgi (`MeshStandardMaterial2.ts:990-995`) skips three.js's `Material.toJSON` round-trip and uses prop list copy. threepipe uses `ThreeSerialization.Deserialize` + `setValues` (`PhysicalMaterial.ts:224-232`). Different mechanisms but both end up exercising `setValues` with the JSON. Threepipe is the right design.

### I. `customProgramCacheKey` always includes `inverseAlphaMap`
- webgi `MeshStandardMaterial2.ts:874-876` and `MeshBasicMaterial2.ts:289-291` both include `this.userData.inverseAlphaMap` even though the unlit material doesn't actually use INVERSE_ALPHAMAP (TODO in `MeshBasicMaterial2.ts:300-304`).
- threepipe carries the same behavior because `iMaterialCommons.customProgramCacheKey` is shared (`iMaterialCommons.ts:127`). Net: same minor noise on both sides — not a bug, just unused token in unlit/legacy/line.

### J. Polygon-offset UI grouping
webgi includes polygon-offset under the **Blending** folder (`MeshStandardMaterial2.ts:672-688`).
threepipe extracts it into its own folder via `iMaterialUI.polygonOffset` (`IMaterialUi.ts:313-336`). Cleaner in threepipe.

### K. `makeSamplerUi` UV channel dropdown
threepipe `image-ui.ts:76-85` adds a **UV Channel** dropdown (channels 0..3). webgi has no such control. threepipe-only feature.

## threepipe-only / new in threepipe (missing in webgi)

- `iMaterialUI.misc` `Select <typeSlug>` button (`IMaterialUi.ts:439-453`) — load a saved material file and apply with undo/redo. webgi only has the Download button.
- `iMaterialUI.blending` `Render to Gbuffer` and `Forced Linear Depth` controls (`IMaterialUi.ts:266-298`).
- Property serialization decorators / `MaterialProperties` static (e.g. `PhysicalMaterial.ts:237-330`) used by `iMaterialCommons.setValues` (line 43). Replaces webgi's loose `physicalMaterialPropList` from `MeshStandardMaterial2.ts:128`.
- `InterpolateProperties` static + `lerpParams` — animation/interpolation support in `setValues(...time)` (`iMaterialCommons.ts:52-55`). Not present in webgi.
- `materialExtensions` priority sort (`MaterialExtender.ts:81-82`).
- `MaterialExtender.UnregisterExtensions` real implementation (`MaterialExtender.ts:101-118`). webgi version is a TODO no-op.
- `MaterialExtension.computeCacheKey` accepts `string | function` (webgi only had `customCacheKey: string` and `computeCacheKey: function` — two separate fields). threepipe consolidated.
- `texturesChanged` event + `refreshTextureRefs` map ref tracking (`iMaterialCommons.ts:212-245`). webgi has none of this.
- `dispatchEvent` override that auto-bubbles to `appliedMeshes` for `materialUpdate`/`textureUpdate`/`select`/`beforeDeserialize` (`iMaterialCommons.ts:115-124`). webgi does this manually per call site.
- Class hierarchy split: `LegacyPhongMaterial`, `UnlitMaterial`, `PhysicalMaterial`, `LineMaterial2`, plus `ShaderMaterial2`, `ObjectShaderMaterial`, `ExtendedShaderMaterial`. webgi only ships `MeshStandardMaterial2` + `MeshBasicMaterial2`.
- `upgradeMaterial(this)` retrofit path (`iMaterialCommons.ts:262-305`) — converts a stock three.js Material into an IMaterial in place. Not in webgi.

## Bugs in webgi

1. **`MeshStandardMaterial2.copyProps` clearCurrentUserData rebuild loses non-essential keys** (`MeshStandardMaterial2.ts:941-949`): `__appliedMeshes` is preserved but other `__*` keys (cached extension versions etc.) are dropped because the loop at line 942 only iterates over `iMaterialIgnoredUserData`. Comment at line 945-947 (commented-out) shows the author considered the broader fix and didn't ship it.

2. **`MaterialExtender.UnregisterExtensions` is unimplemented** (`MeshStandardMaterial2.ts:203-205`, `MeshBasicMaterial2.ts:90-92`): callers never actually remove an extension. Memory leak / dangling listeners on long-lived materials.

3. **`MaterialManager._generateFromTemplate` uuid handling** (`MaterialManager.ts:44-45`): `tempUd = materialParams.userData?.uuid` overwrites `tempUd` (declared as `any = {}` for the iMaterial case) with the *uuid string*. Then `if (tempUd) delete materialParams.userData.uuid` deletes the uuid only if it was truthy — fine — but later `if (tempUd) { material.uuid = tempUd; ... }` writes the *string* uuid into `material.uuid`. Works, but the variable name suggests "tempUserData" while it actually holds a uuid string — bookkeeping smell, easy to break.

4. **`MaterialManager` clone closure captures `mat`** (`MaterialManager.ts:121-141`): `material.clone = ()=>{...mat.copyProps(...)...}`. This reuses `mat` from the template generation closure, so subsequent `material.clone()` always copies *the original* material's userData, not the current `this.userData`. If the material has been mutated since registration the clone diverges. (threepipe `iMaterialCommons.clone` uses `this`, correct.)

5. **`MeshStandardMaterial2.toJSON`** (line 967-987): mutates `this.userData = {}` then restores it. Not thread-safe / re-entrant — if another thing iterates `userData` during super.toJSON it sees an empty userData. Threepipe avoids this by serializing through `ThreeSerialization.Serialize` and `serializeMaterialUserData` (`serialization.ts:569`).

6. **`MaterialExtender.ApplyMaterialExtension` always sets `material.lastShader`** (`MaterialExtender.ts:73`) inside the loop in webgi → for every extension the last-write-wins. threepipe sets it once, after the loop (`MaterialExtender.ts:44`). Equivalent end state, but webgi version is wasteful.

7. **`MaterialExtender.RegisterExtensions` unconditionally replaces `material.materialExtensions`** (`MaterialExtender.ts:113`): `material.materialExtensions = exts`. This nukes any previously registered extensions from a different `RegisterExtensions` call. The materials' constructors call this at most once, so practical impact is bounded — but `registerMaterialExtensions(...)` (instance method on `MeshStandardMaterial2.ts:200-202`) builds a *spread* array on the material before *handing it to `RegisterExtensions`* which then *overwrites* it again with only the new exts. Bug: any previously-spread extensions are lost on re-register if their `isCompatible` rejects them on the second call — though in practice they pass. Threepipe handles this correctly: `RegisterExtensions` checks `material.materialExtensions.includes(ext)` (`MaterialExtender.ts:68`) and uses `[...material.materialExtensions, ...exts]` (`MaterialExtender.ts:81`).

## Bugs in threepipe

1. **`copyMaterialUserData` default ignored list too small** — `src/utils/serialization.ts:547` only filters `'uuid'`. Webgi's leak list (`appliedMeshes`, `imageLoadAwaiter`, `inverseModelMatrix`, `uvTransform`, `iMaterial`) is not applied. Even if all keys are not present in current threepipe data flows, missing the filter is fragile. **Action: extend the default list.**

2. **`iMaterialCommons.setValues` clears userData entirely when `clearCurrentUserData`** (`iMaterialCommons.ts:36`): drops `__*` keys (including `_<extUuid>_version` markers from `MaterialExtender.ts:155`). After a clone/setValues, the next `materialBeforeRender` pass detects a version mismatch and calls `material.needsUpdate = true` — recovers, but spends one extra shader recompile per extension. webgi at least preserves `__appliedMeshes`. Decide whether to preserve all `__*` keys (safer) or live with the recompile.

3. **`PhysicalMaterial.uiConfig.children` is built once at field init** (`PhysicalMaterial.ts:134-163`). The field is `uiConfig: UiObjectConfig = { ... children: [...] }`. The children list is captured at constructor time. `iMaterialUI.misc` returns a function that lazily produces material-extension UIs (`IMaterialUi.ts:405-411`), so dynamic extensions still show up. But adding/removing a `iMaterialUI.*` group at runtime is impossible. webgi rebuilds `_uiConfig.children` on every `get uiConfig` (`MeshStandardMaterial2.ts:847`). Trade-off, not a bug. (Note: `UnlitMaterial.uiConfig`, `LegacyPhongMaterial.uiConfig`, `LineMaterial2.uiConfig` all follow the same threepipe pattern.)

4. **`PhysicalMaterial.uiConfig` clearcoat folder duplicates `clearcoatRoughness`** (`IMaterialUi.ts:629-648`): both children include the same property+slider entry (line 635-639 *and* line 645-649). Likely copy-paste from webgi, which has the same duplication (`MeshStandardMaterial2.ts:382-396`). Both bugs — but worth de-duping in the port.

5. **`makeSamplerUi` `setDirty` arg defaulting** (`image-ui.ts:21`): default uses `setDirty: ()=>any = ()=>mat.setDirty && mat.setDirty()`. The `Flip Y` setValue captures this `setDirty` (line 114, 119), but the parent folder `onChange` (line 27) and the wrap/filter `onChange` arrays (lines 136, 150, 158, 175, 188) **don't** call `setDirty`, only `mat[map].needsUpdate = true`. webgi consistently includes `setDirty` in the onChange array (e.g. `materialUtils.ts:136`). Result: changing wrap/filter only triggers texture update, not material needsUpdate — usually fine because TextureUpdate event ends up dispatching, but tighter parity with webgi is to always include `setDirty`.

6. **`UnlitMaterial.uiConfig` lacks `vertexColors` and `flatShading` toggles via `iMaterialUI.base`** — wait, it uses `iMaterialUI.base(this)` which includes both (`IMaterialUi.ts:65-72`, line 77-80). Good. *Not* a bug.

7. **`PhysicalMaterial.copy(source)` calls `setValues(source, false)`** (`PhysicalMaterial.ts:198-201`) — `false` for `allowInvalidType`, but the type-name list at line 180 doesn't include the dynamic `parameters.type` for variants (e.g. nothing other than the listed strings). If a subclass calls `super.copy(otherSubclass)`, this rejects the copy with `console.error`. Webgi's `copyProps` accepts `allowUnknownType` argument explicitly (`MeshStandardMaterial2.ts:922`). Minor but worth being explicit when `copy` is invoked from `clone` upstream.

8. **`UnlitMaterial.copy` passes `allowInvalidType=false`** (`UnlitMaterial.ts:133-135`) — same issue.

9. **`iMaterialCommons.upgradeMaterial` envMap defines** — `onBeforeRender` modifies `defines.FIX_ENV_DIRECTION` only when `this.defines && this.envMap !== undefined`. For materials with `envMap === null` but defines present (most materials), the FIX_ENV_DIRECTION add path is skipped. This matches webgi's behavior (`MeshStandardMaterial2.ts:889-899`). Match.

## Behavior divergences

| Aspect | webgi | threepipe | Notes |
|---|---|---|---|
| `setDirty` event payload | `{...options, type:'materialUpdate'}` (`MeshStandardMaterial2.ts:196`) | `{bubbleToObject:true, bubbleToParent:true, ...options, type:'materialUpdate'}` (`iMaterialCommons.ts:28`) | threepipe adds bubbling flags by default — bubbling reaches `appliedMeshes` automatically. webgi only does this manually elsewhere. |
| `setDirty` UI refresh timing | `'postFrame', true, 1` (`MeshStandardMaterial2.ts:197`) | `true, 'postFrame', 1` (`iMaterialCommons.ts:29`) | Argument order to `uiRefresh` differs — verify this matches the uiconfig.js API. **Probably a real bug** in one of them. Need to check uiconfig.js signature. |
| `PhysicalMaterial.fog` default | `false` (matches webgi `MeshStandardMaterial2.ts:188`) | `false` (`PhysicalMaterial.ts:69`) | Match. |
| `PhysicalMaterial.attenuationDistance` default | `0` (matches webgi `MeshStandardMaterial2.ts:189`) | `0` (`PhysicalMaterial.ts:70`) | Match — both override three.js Infinity to 0 for UI. |
| `fromJSON` mechanism | `copyProps(data)` direct (`MeshStandardMaterial2.ts:994`) | `dispatchEvent('beforeDeserialize')` then defer to listener (`PhysicalMaterial.ts:224-232`) | threepipe relies on `AssetImporter` / `ObjectLoader2` to do the heavy lifting, then `setValues` finishes. Different but intentional. |
| `toJSON` userData uuid | webgi: `data.userData.uuid = this.userData.uuid` then serialize (`MeshStandardMaterial2.ts:972-976`) | threepipe: `userData.uuid = this.uuid` set in `setValues` (`iMaterialCommons.ts:61`). At serialize, `serializeMaterialUserData` copies userData via `copyMaterialUserData` then runs through `Serialization.Serialize`. | threepipe relies on the userData carrying `uuid`. webgi pre-fills then post-serializes. Either works, but threepipe **never strips uuid before re-emitting**. |
| `MeshStandardMaterial2`/`PhysicalMaterial.type` after `toJSON` | webgi sets `data.type = MeshStandardMaterial2.TYPE` (`MeshStandardMaterial2.ts:983`) | threepipe `ThreeSerialization.Material` should set the runtime type — verify. | Confirmed via class field overrides in `Serialization.Serialize` callstack. |
| Iridescence range | webgi: `iridescence` slider [0,3] (`MeshStandardMaterial2.ts:728-730`) — *bug* in webgi, three.js spec is [0,1]. | threepipe: same [0,3] (`IMaterialUi.ts:674-678`). | Both wrong by spec. Worth fixing both. |
| Sheen color hidden cond | webgi: `()=>this.sheen < 0.001` (`MeshStandardMaterial2.ts:352`) | threepipe: `()=>material.sheen < 0.001` (`IMaterialUi.ts:723-725`) | Match. |
| Clearcoat roughness hidden cond | webgi: `()=>this.clearcoat < 0.001` only on first roughness slider, second has none (`MeshStandardMaterial2.ts:384-386` and `392-396`) | threepipe: same pattern (`IMaterialUi.ts:637-639` and `645-648`) | Match including the duplication bug. |
| Polygon offset bounds | webgi: `[-10, 10]` (`MeshStandardMaterial2.ts:680-687`) | threepipe: `[-10, 10]` (`IMaterialUi.ts:325-333`) | Match. |
| Bump scale bounds | webgi: `[-500, 500]` (`MeshStandardMaterial2.ts:291`) | threepipe: `[-500, 500]` (`IMaterialUi.ts:489-494`) | Match. |
| Flat shading checkbox | webgi: present on Physical, not on Basic (`MeshStandardMaterial2.ts:818-821`) | threepipe: present in `iMaterialUI.base` for any material that has the property (`IMaterialUi.ts:77-80`). UnlitMaterial inherits it (defined in `MaterialProperties`, line 222). | threepipe shows it on Unlit too. Minor divergence. |
| Side dropdown | webgi: in `MeshStandardMaterial2.ts:801-812` directly on root, not folder. | threepipe: in `iMaterialUI.misc[1]` (`IMaterialUi.ts:412-424`). Same shape. | Match. |

### Behavior divergence on userData ignore-list serialization

Critical example: when re-saving a glTF that round-tripped through threepipe with `appliedMeshes` accidentally written into `userData` (e.g. by some plugin code path), the JSON output will include a Set. The serializer's `userDataSkipClone` test (`serialization.ts:515`) won't handle a Set, so it'd recurse — infinite loop or corrupted output. webgi's filter prevents this entirely.

## API / signature drift

| API | webgi | threepipe |
|---|---|---|
| Class name | `MeshStandardMaterial2`, `MeshBasicMaterial2` | `PhysicalMaterial`, `UnlitMaterial`. Aliased deprecated stubs `MeshStandardMaterial2` (`PhysicalMaterial.ts:397-402`) and `MeshBasicMaterial2` (`UnlitMaterial.ts:247-252`) exist for back-compat. |
| `TypeAlias` | not defined | `static readonly TypeAlias = [...]` lists string names. Used by `MaterialManager.findMaterialTemplate`. |
| `setValues` signature | `setValues(values: MaterialParameters)` (inherited three.js) | `setValues(parameters, allowInvalidType?, clearCurrentUserData?, time?)` (`PhysicalMaterial.ts:178`, `UnlitMaterial.ts:122`, etc.) — extended with type-validation and lerp. |
| `copyProps` | `copyProps(oldMaterial, allowUnknownType?, clearCurrentUserData?)` (`MeshStandardMaterial2.ts:922`, `MeshBasicMaterial2.ts:314`) | not present (folded into `setValues`). |
| `clone` | overridden by `MaterialManager` to call `generateFromTemplate` (`MaterialManager.ts:121-141`) | `clone(track=false)` (`PhysicalMaterial.ts:56`, etc.) — `track` controls cloneId/cloneCount bookkeeping. |
| `dispose` | inherited from three.js | `dispose(force=true)` — respects `userData.disposeOnIdle === false` if `force=false` (`iMaterialCommons.ts:81-84`). |
| `customMaterialExtensions` constructor arg | `MeshPhysicalMaterialParameters & {customMaterialExtensions?: MaterialExtension[]}` | `MeshPhysicalMaterialParameters & IMaterialParameters` (`PhysicalMaterial.ts:67`). `IMaterialParameters` is `MaterialParameters & {customMaterialExtensions?: MaterialExtension[]}` (`IMaterial.ts:26`). Same shape. |
| `registerMaterialExtensions` | instance method (`MeshStandardMaterial2.ts:200-202`) | bound from `iMaterialCommons.registerMaterialExtensions` (`PhysicalMaterial.ts:81`). Signature identical. |
| `unregisterMaterialExtensions` | instance method, **TODO no-op** (`MeshStandardMaterial2.ts:203-205`) | functional via `MaterialExtender.UnregisterExtensions` (`MaterialExtender.ts:101-118`). |
| `MaterialExtension.computeCacheKey` | function only | `string \| (mat)=>string` (`MaterialExtension.ts:57`). |
| `MaterialExtension.customCacheKey` | string field (`MaterialExtender.ts:84-87`) | removed (folded into `computeCacheKey`). |
| `MaterialExtension.priority` | not supported | supported, sort key (`MaterialExtender.ts:82`). |
| `MaterialExtension.onUnregister` | not supported | supported (`MaterialExtension.ts:105`). |
| `MaterialExtension.getUiConfig` arg | `(material) => UiObjectConfig` | `(material, refreshUi?) => UiObjectConfig` (`MaterialExtension.ts:128`). |
| `extraUniforms` value type | `IUniform` | `ValOrFunc<IUniform>` (`MaterialExtension.ts:21`). Allows lazy creation. |
| `extraDefines` value type | `number \| string` | `ValOrFunc<number\|string\|undefined\|boolean>` (`MaterialExtension.ts:27`). |
| `MaterialProperties` static | not present (uses module-level `physicalMaterialPropList` / `basicMaterialPropList`) | static on each class (`PhysicalMaterial.ts:237`, `UnlitMaterial.ts:200`, `LegacyPhongMaterial.ts:251`, `LineMaterial2.ts:210`). Used by `iMaterialCommons.setValues:43`. |
| `MapProperties` static | not present (manual lists in `MaterialManager` and `MeshStandardMaterial2`) | static on each class — drives `iMaterialCommons.getMapsForMaterial` and `refreshTextureRefs`. |
| `InterpolateProperties` static | not present | static on each class — drives `setValues(...time)` lerp. |
| `texturesChanged` event | not emitted | emitted (`iMaterialCommons.ts:236-244`). |
| `setDirty` options | `AnyOptions` (no shape) | `IMaterialSetDirtyOptions` with `change`, `key`, `needsUpdate`, `refreshUi`, `bubbleToObject`, `last` (`IMaterial.ts:124`). |

## Notes / open questions

1. **`uiRefresh` argument order** divergence between `MeshStandardMaterial2.setDirty` (`'postFrame', true, 1`) and `iMaterialCommons.setDirty` (`true, 'postFrame', 1`). The two are incompatible — only one matches the actual `uiconfig.js` `uiRefresh(immediate, mode, throttle)` signature. Verify against uiconfig.js source. If threepipe is wrong, UI won't refresh post-frame after material changes.

2. **Should threepipe extend `copyMaterialUserData` default ignored keys?** Recommend yes:
   ```ts
   export function copyMaterialUserData(dest, source, ignoredKeysInRoot = ['uuid', 'appliedMeshes', 'imageLoadAwaiter', 'inverseModelMatrix', 'uvTransform', 'iMaterial']) { ... }
   ```
   Or define an exported constant `iMaterialIgnoredUserData` and reuse it in `copyMaterialUserData` and `iMaterialCommons.setValues:60`. Decision should match how plugins push state into userData going forward.

3. **`MaterialManager` clone closure in webgi** — confirmed bug (item 4 above). Filed a note in case any port still relies on `MaterialManager.generateFromTemplate` patching the clone. threepipe's `iMaterialCommons.clone` is correct.

4. **`fromJSON` ergonomics**: webgi accepts `fromJSON(data, meta?, allowUnknownType?)` (`MeshStandardMaterial2.ts:990`); threepipe's signature is `fromJSON(data, meta?, _internal?)` (`PhysicalMaterial.ts:224`). Different third argument semantics. Confirm callers (`AssetImporter`, `ObjectLoader2`, `ThreeMaterialLoader`) all pass the right value.

5. **`MeshStandardMaterial2.copyProps` `clearCurrentUserData` defaulting to `true`** while threepipe's `iMaterialCommons.setValues` defaults to `clearCurrentUserData = (parameters as Material).isMaterial` (`iMaterialCommons.ts:35`). For `mat.copy(otherMat)` both clear; for `mat.fromJSON(plainObj)` webgi clears, threepipe doesn't. May affect material round-trips through external JSON. Worth a test.

6. **Iridescence slider bounds [0, 3]** — three.js docs spec [0, 1]. Both webgi and threepipe use [0, 3]. If intentional (allow super-charged iridescence), document it; otherwise fix.

7. **Duplicated `clearcoatRoughness` slider in clearcoat folder** — present in both. Easy cleanup during port.

8. **`renderToDepth` UI**: webgi shows it always (`MeshStandardMaterial2.ts:653-661`). threepipe gates with `hidden: ()=>material.userData.renderToDepth === undefined` (`IMaterialUi.ts:279`). This means the toggle never appears unless something else sets it first — surprising UX. Confirm intended.

9. **`Override Environment` checkbox missing `onChange: setDirty`** in threepipe (`IMaterialUi.ts:380` is commented out). webgi calls setDirty (`MeshStandardMaterial2.ts:777`). Toggling the checkbox in threepipe won't trigger a re-render via the standard path — the surrounding folder onChange may catch it, but worth re-enabling the explicit call.

10. **`MeshBasicMaterial2.userData.inverseAlphaMap`** — webgi stubs it out as TODO (`MeshBasicMaterial2.ts:184-193`, `300-304`). threepipe also doesn't implement it for unlit. Match.
