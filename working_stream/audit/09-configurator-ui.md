# Audit: Configurator / Library / UI Plugins

## Summary

Threepipe has ported the **two core configurator plugins** (`MaterialConfiguratorBasePlugin`, `SwitchNodeBasePlugin`) into core (`src/plugins/configurator/`) and the two grid-UI variants (`MaterialConfiguratorPlugin`, `SwitchNodePlugin`) into the dedicated `@threepipe/plugin-configurator` package. These are not just ports — they have meaningful improvements: timeline-driven material variation, animated apply via PopmotionPlugin, undo-aware `applyOnLoad/reapplyAll`, plugin-ordering fixes via `viewer.forPlugin()`, the `snapIcons` early-exit fix, real context menus (vs. webgi's stubbed ones), and a reusable `GridItemListPlugin` (replacement for webgi's static `CustomContextGrid`).

The rest of the webgi family is **not ported**: `MaterialLibraryPlugin/Base`, `MaterialPresetPlugin`, `PresetLibraryPlugin`, the entire `VariationConfiguratorPlugin` family (object/material variation packs with zip-based persistence), and the misc webgi UI plugins (`ExtrasUiPlugin`, `LightsUiPlugin`, `SceneCamerasUiPlugin`, `SimpleViewerUi`, `MaterialConfiguratorOverlay*`). Note: `MaterialConfiguratorOverlay*` does not exist in any tree under either name — not present in webgi-legacy-src either.

The `experiments/threepipe-webgi/src/plugins/` tree contains only buffer/extras/postprocessing plugins; **no configurator/UI plugins** are staged there.

`HierarchyUiPlugin` (which serves the SimpleViewerUi role) lives in `@threepipe/plugin-tweakpane-editor` and has clearly diverged — it has full undo support (the only one in this audit set), pointer-shift-aware multi-selection, and a different DOM widget (`treejs`) than webgi's tweakpane folder approach.

The user-mentioned `return → continue` fix has **already landed in threepipe** (`SwitchNodeBasePlugin.snapIcons`, line 197). However, **the same `return` bug still exists in webgi** in `_preRender`/`_postRender` (which threepipe restructured away entirely), and the equivalent loops in webgi `snapIcons` (line 121) actually use `continue` — webgi's bug is in the per-render visibility-toggle loops, not snapIcons.

## Plugin matrix

| Plugin | webgi | threepipe core | threepipe plugin-configurator | threepipe-webgi exp | status |
|---|---|---|---|---|---|
| `MaterialConfiguratorBasePlugin` | `experiments/webgi-legacy-src/plugins/MaterialConfiguratorBasePlugin.ts` (344L) | `src/plugins/configurator/MaterialConfiguratorBasePlugin.ts` (472L) | — | — | ported + extended (timeline, animateApply, popmotion, frameFade) |
| `MaterialConfiguratorPlugin` (grid UI) | `…/MaterialConfiguratorPlugin.ts` (96L, tippy + CustomContextGrid) | — | `plugins/configurator/src/MaterialConfiguratorPlugin.ts` (119L) | — | ported + uses `GridItemListPlugin`, real context menus |
| `SwitchNodeBasePlugin` | `…/SwitchNodeBasePlugin.ts` (260L, pre/postRender visibility hack) | `src/plugins/configurator/SwitchNodeBasePlugin.ts` (305L) | — | — | ported, restructured (no pre/postRender), `applyOnLoad`, `reapplyAll`, `addNode`, `getPreview` |
| `SwitchNodePlugin` (grid UI) | `…/SwitchNodePlugin.ts` (48L) | — | `plugins/configurator/src/SwitchNodePlugin.ts` (110L) | — | ported + context menus |
| `MaterialLibraryBasePlugin` | `…/MaterialLibraryBasePlugin.ts` (83L, `_refreshUi` is dead) | — | — | — | NOT ported |
| `MaterialLibraryPlugin` | `…/MaterialLibraryPlugin.ts` (127L) | — | — | — | NOT ported |
| `MaterialPresetPlugin` | `…/MaterialPresetPlugin.ts` (111L) | — | — | — | NOT ported |
| `PresetLibraryPlugin` | `…/PresetLibraryPlugin.ts` (165L) | — | — | — | NOT ported |
| `VariationConfiguratorPlugin` | `…/VariationConfiguratorPlugin.ts` (364L, fflate zip) | — | — | — | NOT ported |
| `VariationConfiguratorEditorUiPlugin` | `…/VariationConfiguratorEditorUiPlugin.ts` (366L) | — | — | — | NOT ported |
| `VariationConfiguratorGridUiPlugin` | `…/VariationConfiguratorGridUiPlugin.ts` (73L) | — | — | — | NOT ported |
| `ExtrasUiPlugin` | `…/ExtrasUiPlugin.ts` (155L, RGBM/MSAA/cache toggles) | — | — | — | NOT ported (some actions duplicated piecemeal in `TweakpaneEditorPlugin`) |
| `LightsUiPlugin` | `…/LightsUiPlugin.ts` (106L) | — | — | — | NOT ported (light-add lives in editor/tree) |
| `SceneCamerasUiPlugin` | `…/SceneCamerasUiPlugin.ts` (86L) | — | — | — | NOT ported |
| `SimpleViewerUi` | `…/SimpleViewerUi.ts` (75L, scene tree placeholder) | — | `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts` (318L) | — | superseded — `HierarchyUiPlugin` (treejs DOM, undo, multi-select) |
| `CustomContextGrid` (host of grid items) | `…/extras/CustomContextGrid.ts` (159L static) | — | `plugins/configurator/src/GridItemList.ts` + `GridItemListPlugin.ts` | — | ported as a reusable plugin (better isolation, dispose path) |
| `MaterialConfiguratorOverlay*` | not found in webgi-legacy-src either | — | — | — | does not exist in source — likely renamed/removed before legacy snapshot |

## webgi-only / new in webgi

These exist only in webgi and are missing/not ported in threepipe:

- `MaterialLibraryBasePlugin` / `MaterialLibraryPlugin` — picker that displays *all* loaded materials by `typeSlug` (`MeshStandardMaterial2.TypeSlug`, `DiamondMaterial.TypeSlug`) and provides "Apply Material" dropdown + replace/copy logic via `setMaterial` or `copyProps`. (`experiments/webgi-legacy-src/plugins/MaterialLibraryPlugin.ts:55-77`). Note: webgi `MaterialLibraryBasePlugin._refreshUi` (line 61-74) is intentionally short-circuited (`return false` immediately) — most of the body is dead. The lookup of `__appliedMeshes` (line 111) is a webgi-only userData field.
- `MaterialPresetPlugin` — maps material `name`/regex → URL of `.pmat`/`.dmat` file; loads with `importer.importSinglePath`, applies via `setMaterial` or `copyMaterialProps`, persists `mapping[]` (`{name, path, regex?}[]`). `serializeWithViewer = false` so it only saves into custom JSON. (`MaterialPresetPlugin.ts:12-15, 54-99`).
- `PresetLibraryPlugin` — top-level orchestrator that aggregates `PresetGroup`s (Background/Environment/GemEnvironment/Plugin/ModelStage/MaterialLibPreset/VJSON). Provides export/import preset JSON, "Download Selection", "Export Preset Groups", `loadPresetGroups(url|object)`. Imports `webgi/helpers/presetGroups`, which threepipe doesn't have. (`PresetLibraryPlugin.ts:30-40, 45-78`).
- `VariationConfiguratorPlugin` family — declarative configurator with **separate persistence shape** from `MaterialConfiguratorPlugin`:
  - Stores `{objects, materials}` arrays of `IConfiguratorVariation` with `{name, prefix, title, icon, items[], itemFiles[], iconFiles[], titles[], icons[], selected?, data?}` (`VariationConfiguratorPlugin.ts:9-25`).
  - Loads object variations by *creating/finding a scene Object3D with that name*, replacing children with `importPath(path, {importedFile: blob, reimportDisposed: true})` (lines 65-89). Reapplies all material variations after object swap (line 92-96). Auto-disposes children (`autoDispose`, line 73).
  - Material swap is by name match across scene; respects `data.matType` typeSlug filter (line 109-113) and `data.traverse` (line 116-117).
  - Editor/Grid pair: `VariationConfiguratorEditorUiPlugin` provides a tweakpane folder UI for adding/removing local files & URLs, importing folders (`webkitRelativePath`), and exporting JSON or fflate-zipped bundle (config + objects/+materials/ folder tree). `VariationConfiguratorGridUiPlugin` provides `CustomContextGrid` overlay.
  - Threepipe has nothing equivalent — `MaterialConfiguratorPlugin` is for *property-copy* on existing materials, while `VariationConfiguratorPlugin` is for *full file-based* swap (closer to a `SwitchNodePlugin` × `MaterialConfiguratorPlugin` hybrid with file persistence).
- `ExtrasUiPlugin` — RGBM/MSAA/Depth-prepass/Debug toggles via URL query params + reload, "Auto GPU instance all", "Auto Center All Geometries", "Clear local storage", "Clear caches". (`ExtrasUiPlugin.ts:42-152`).
- `LightsUiPlugin` — buttons to add Directional/Ambient/Point/Spot lights with sane defaults; auto-rebuilds children from scene `sceneUpdate.hierarchyChanged`. (`LightsUiPlugin.ts:19-94`).
- `SceneCamerasUiPlugin` — adds new perspective camera with orbit controls + virtual-cameras integration + debug texture preview. (`SceneCamerasUiPlugin.ts:19-46`).

## threepipe-only / new in threepipe

`MaterialConfiguratorBasePlugin` (`src/plugins/configurator/MaterialConfiguratorBasePlugin.ts`):
- **Timeline animation** — `MaterialVariations.timeline?: {time, index, duration?}[]` with full sort/seek logic in `_preFrame()` (lines 215-268). Webgi has nothing similar.
- **`applyVariationAnimate()`** (lines 137-162) — animates between two materials over `duration` ms via `PopmotionPlugin`, disabling `FrameFadePlugin` during animation. Tracks `_animation` on the variation to allow re-trigger interruption.
- **`AnimateTime` / `from` material lerp** — `applyVariation` accepts `time?: AnimateTime & {from?: string|number}` (line 120), passing `{from, t, dt, rm}` into `materialManager.applyMaterial` (line 128), enabling property-level interpolation.
- **`refreshUi` event** — base type widened to `{'refreshUi': object} & AViewerPluginEventMap` (line 23), plus `dispatchEvent({type: 'refreshUi'})` in `refreshUi` (line 197). Webgi has no such event.
- **`getSelectedObject` works for materials directly** — `_selectedMaterial` (lines 274-283) handles both `IMaterial` and `IObject3D` (with array material support); webgi only handles `Mesh.material` (line 168).
- **`escapeRegExp` import** is used (line 431); webgi inlines the regex (line 313, with broken precedence — see Bugs below).
- **`forPlugin` plugin-ordering helper** — picks up `PickingPlugin` whether it's added before or after the configurator (lines 42-48). Webgi reads it once in `onAdded` (line 35) and silently fails if Picking is added later.
- `applyOnLoadForce` flag.

`MaterialConfiguratorPlugin` (grid UI in `@threepipe/plugin-configurator`):
- `animateApply` / `animateApplyDuration` — toggles whether grid clicks call `applyVariationAnimate` vs `applyVariation`.
- Real `materialContextMenuItems` / `variationsContextMenuItems` definitions (lines 76-116). Webgi's are inline closures inside `processDiv`.
- Uses `GridItemListPlugin` dependency rather than static `CustomContextGrid`.

`SwitchNodeBasePlugin` (`src/plugins/configurator/SwitchNodeBasePlugin.ts`):
- **No `_preRender` / `_postRender` visibility-swap dance** — webgi toggles all children visible/hidden every frame via scene `beforeRender`/`afterRender` events with `__oldVisible`/`__forcedVisible` userData markers (lines 50-78). Threepipe instead writes `child.visible` once, inside `selectNode` (lines 75-94), and persists it. Cleaner and undo-friendly.
- `applyOnLoad` + `reapplyAll()` + `fromJSON` override (lines 100-119). Webgi has no equivalent.
- `addNode()` helper (lines 178-181).
- `getPreview()` extracted as public method (lines 163-176); webgi inlines `snapObject(...)` inside `snapIcons`.
- `selectNode` accepts `string|number` (uuid/name or index). Webgi accepts only `Object3D|string`.
- `selectNode` returns `boolean` (changed) and only sets dirty if something changed.

`SwitchNodePlugin` (grid UI):
- `enableEditContextMenus` toggle.
- `nodeItemContextMenuItems`/`nodeContextMenuItems` (rename title, rename node, remove section, select). Webgi `SwitchNodePlugin` only adds tippy tooltips, no context menus.

`GridItemList` / `GridItemListPlugin` (`plugins/configurator/src/`):
- Wrapped as a real plugin; `Dispose` is wired through `onRemove`, mobile-aware sizing (`mobileAndTabletCheck`, line 38).
- Webgi `CustomContextGrid` is a static singleton with no lifecycle.

`HierarchyUiPlugin` (`plugins/tweakpane-editor/src/HierarchyUiPlugin.ts`):
- Native HTML treejs UI, **undo/redo for visibility changes** via `UndoManagerPlugin` (lines 267-293). None of the webgi UI plugins integrate with undo.
- Shift/Ctrl/Meta-aware multi-select toggle through `PickingPlugin.toggleSelectedObject` (lines 138-147).
- Filters out widget objects (`assetType === 'widget'`, `userData.isWidgetRoot`) to avoid rebuilds (lines 104-105).
- `forPlugin` for both `PickingPlugin` and `UndoManagerPlugin` (lines 170-179).
- `_refreshVisible` keeps tree state in sync when `visible` changes externally (line 91-101).

## Bugs in webgi

1. **`SwitchNodeBasePlugin._preRender` / `_postRender` early-exit bug** — `experiments/webgi-legacy-src/plugins/SwitchNodeBasePlugin.ts:55, 70, 72`: uses `return` inside `for (const variation of this.variations)`, which bails the whole loop on the first variation whose object is missing or whose `__oldVisible` was already cleared. Should be `continue`. This means a single mis-named variation breaks visibility for all later variations every frame. Already fixed structurally in threepipe (no per-frame visibility loop; `selectNode` sets `child.visible` once).
2. **`MaterialLibraryBasePlugin._refreshUi` is dead code** — `MaterialLibraryBasePlugin.ts:61-74`: `_refreshUiConfig()` is called but then the function unconditionally `return false`s, leaving lines 67-73 unreachable. Comment says `// todo: disabled for now`. The grid UI in `MaterialLibraryPlugin._refreshUi` calls `super._refreshUi()` and gates everything on it returning `true` (line 81), which it never does — so the **entire library grid never builds**.
3. **`MaterialConfiguratorBasePlugin.createVariation` regex precedence** — `MaterialConfiguratorBasePlugin.ts:313`: `variationKey ?? material.name.length > 0 ? ... : ...` — without parens, `??` binds tighter than `>`, so it evaluates as `(variationKey ?? material.name.length) > 0 ? ... : ...` — when `variationKey` is provided, it's coerced to number, almost always `NaN`, which is falsy. Threepipe has the same shape (line 431) so it's also affected — see Bugs in threepipe.
4. **`PresetLibraryPlugin.fromJSON` mutates input** — `PresetLibraryPlugin.ts:56-65`: spreads then deletes; benign but mutates caller-owned object intermittently due to shallow spread.
5. **`VariationConfiguratorPlugin.utils.getIcon`** — `VariationConfiguratorPlugin.ts:255`: `if (!icon || !(icon.startsWith('http') && icon.startsWith('data:')))` — `&&` between two `startsWith` checks is impossible (icon can't start with both); should be `||`. Causes the http/data branch to never trigger, so all icons get path-rewritten incorrectly.
6. **`VariationConfiguratorPlugin.applyVariation` returns silently when item is JSON** — line 78: `if (!objs.length) { if (!path.endsWith('json')) console.warn(...); return }` — for JSON variation files the warn is suppressed but the function still returns without applying anything. No mechanism to actually load the JSON. Comment says "add json file" — never implemented.
7. **`VariationConfiguratorEditorUiPlugin.uploadFile` on URL-add doesn't respect duplicate guard** — line 163-164: `if (iobj.items.includes(url)) await alert(...)` but does not `return`; pushes anyway. Threepipe doesn't ship this path.

## Bugs in threepipe

1. **Same regex precedence bug as webgi** — `src/plugins/configurator/MaterialConfiguratorBasePlugin.ts:431`: `uuid: variationKey ?? material.name.length > 0 ? escapeRegExp(material.name) : material.uuid` — same operator-precedence problem as webgi #3 above. When `variationKey` is provided (truthy string), `variationKey ?? material.name.length` is the string; `string > 0` is `false`; so it falls into `material.uuid`, ignoring `variationKey`. **Should be**: `uuid: variationKey ?? (material.name.length > 0 ? escapeRegExp(material.name) : material.uuid)`. Worth filing in `issues/open/`.
2. **`reapplyAll` ignores `_animation` mid-flight** — `MaterialConfiguratorBasePlugin.ts:67-72`: if a load happens while an animation is running on a variation, `applyVariation` sets the snapshot, but the animation's `onUpdate` will keep firing, racing the snapshot. Minor, edge case.
3. **`SwitchNodeBasePlugin.fromJSON` doesn't clear `applyOnLoad` reset behavior properly** — line 114-117: `if (data.applyOnLoad === undefined) { this.applyOnLoad = true }` — silently overrides a constructor-set `applyOnLoad = false` for old files; intentional but undocumented in the JSDoc comment ("setting true because all the items will be visible otherwise").
4. **`SwitchNodeBasePlugin.snapIcons` doesn't `continue` when `obj.children.length < 1`** — line 199-201: warns then falls through into the `for (const child of obj.children)` loop (which is empty so safe, but stylistically inconsistent with the early-exit on the prior check at line 195).
5. **`MaterialConfiguratorPlugin._refreshUi` builds an unused local** — `plugins/configurator/src/MaterialConfiguratorPlugin.ts:40`: `const container = grid.create(...)` — `container` is used by the outer-loop `oncontextmenu` handler at line 62, but the grid items also receive their own `processDiv` callback that overwrites the same container's children. OK but worth checking that hot-rebuild on `refreshUi` doesn't leak event handlers (`oncontextmenu` is set, not `addEventListener`, so it's overwritten — fine).
6. **`HierarchyUiPlugin._setVisible` uses `Map.entries().forEach`** — `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts:270, 281`: `changeMap.entries().forEach(...)` — iterator-helper API (only stable in newer JS engines). Should be `for (const [o, v] of changeMap)` for safety.

## Behavior divergences

### Variation persistence shape

- `MaterialConfiguratorBasePlugin`: shape is **identical** between webgi & threepipe for the core fields (`uuid`, `title`, `preview`, `materials[]`, `regex`, `selectedIndex`). Threepipe **adds** `timeline?: {time, index, duration?}[]` and runtime-only `_animation?: AnimationResult`. Backward-compatible.
- `SwitchNodeBasePlugin`: shape **identical** (`name, title, selected, camView, camDistance`). Threepipe adds `applyOnLoad` flag at plugin level (not per-variation).
- `VariationConfiguratorPlugin` (webgi-only): completely different shape — `{objects: IConfiguratorVariation[], materials: IConfiguratorVariation[]}` with embedded `Blob` arrays. Not portable as-is to threepipe (would need `__sourceBuffer` mechanism alluded to in the toJSON TODO at line 291).
- `MaterialPresetPlugin` (webgi-only): persists `mapping: {name, path, regex?}[]` only; `presets` and `basePath` are runtime.

### Material/object swap mechanics

- **Webgi `MaterialConfiguratorPlugin`** — `m.applyMaterial(material, uuid, regex)` (`MaterialConfiguratorBasePlugin.ts:113`). Copies properties to the existing material in-place — preserves UUIDs, references stay valid.
- **Threepipe `MaterialConfiguratorBasePlugin`** — same (`src/.../MaterialConfiguratorBasePlugin.ts:128`), plus optional `time` parameter for property lerp, plus optional `from` material for cross-fade animation. Disables `FrameFadePlugin` during animation.
- **Webgi `MaterialLibraryPlugin`** — has both modes: `replaceMaterial=true` does `setMaterial`, `false` does `copyProps` while preserving name/uuid (lines 59-71). Threepipe: not ported.
- **Webgi `VariationConfiguratorPlugin`** (objects) — finds object by name, removes children with `dispose` if `autoDispose`, imports new model into the parent. Reapplies all currently-selected material variations after — **important coupling**.
- **Webgi `VariationConfiguratorPlugin`** (materials) — finds by name, calls `obj.setMaterial(material)`, optionally with `traverse` and `matType` filtering. Then `manager.materials.applyMaterial(material, name)` to keep the material manager registry in sync.
- **Threepipe `SwitchNodeBasePlugin.selectNode`** — toggles `child.visible` on direct children of the parent named `node.name`. **No file load** — pure visibility swap. Sets dirty only if something changed (returns boolean).
- **Webgi `SwitchNodeBasePlugin`** — keeps `visible` toggling **inside `_preRender`/`_postRender`** so children are restored to their old visibility after each render. This is a non-destructive override; threepipe abandoned that approach in favor of writing `visible` once.

### UI rendering (overlay, tweakpane integration)

- Webgi grid UIs (`MaterialConfiguratorPlugin`, `SwitchNodePlugin`, `MaterialLibraryPlugin`, `VariationConfiguratorGridUiPlugin`) all use the same static `CustomContextGrid` (`extras/CustomContextGrid.ts`) singleton with `RemoveAll(tag)` + `Create(...)` + `RebuildUi(parent)` pattern, plus `tippy.js` for tooltips inline.
- Threepipe extracts that into a normal plugin: `GridItemListPlugin` (`plugins/configurator/src/GridItemListPlugin.ts`) wrapping `GridItemList`. `Dispose` is called on plugin remove, tippy is integrated inside `GridItemList.Create` (so individual configurator plugins don't import tippy directly).
- Tweakpane UI: webgi has `ui/TweakpaneUiPlugin.ts` (registers `tpImageInputGenerator`, `colorMode` themed), threepipe has `plugins/tweakpane/src/TweakpaneUiPlugin.ts` with same `colorMode` (typed `'black'|'white'|'blue'`), localStorage persistence under `'tpTheme'`. The webgi `ExtrasUiPlugin` exposes `colorMode` as a UI dropdown — threepipe does not (no equivalent ExtrasUi).

### Preview/snapshot generation

- Both `MaterialConfiguratorBasePlugin.getPreview()`s share the same logic (`generate:sphere|cube|...`, color circles, `imageBitmapToBase64`).
  - Webgi: `MaterialPreviewGenerator(viewer)` (constructor takes viewer); calls `_previewGenerator.generate(m, type)` (line 134).
  - Threepipe: `MaterialPreviewGenerator()` with no args; `generate(m, renderer, environment, type)` (line 182-186) — preview generator is decoupled from viewer.
- `SwitchNodeBasePlugin.snapIcons`:
  - Webgi: inline `snapObject(this._viewer!, child, undefined, 7, camOffset.multiplyScalar(camDistance * 0.5))` (line 136).
  - Threepipe: extracted `getPreview(variation, child, viewerSetDirty=false)` (line 192-205); `snapObject(renderer, child, scene, 7, camOffset.multiplyScalar(camDistance * 2))` — note **camDistance multiplier 2 vs webgi's 0.5** — 4x difference in camera distance. Likely intentional (different camera/scene setup) but worth verifying parity if porting webgi configs.
- `SwitchNodePlugin` (grid UI):
  - Webgi: regenerates icon every refresh (`snapObject` inline, line 32).
  - Threepipe: calls `this.getPreview(variation, child)` (line 48) — every refresh too, with no caching beyond `userData.__icon` set in `snapIcons`. `_refreshUi` doesn't read from `__icon`.

### Drag-drop, presets, library sync

- **Webgi presets**: `PresetLibraryPlugin` orchestrates groups (Background/Environment/etc.), `MaterialPresetPlugin` maps materials by URL. Both depend on `webgi/helpers/presetGroups`. Drag-drop flows through `DropzonePlugin`/`AssetManagerPlugin`.
- **Threepipe**: drag-drop handled by `DropzonePlugin` (in `src/plugins/`), but no preset library / preset mapping equivalent. Configurator plugins do not implement drag-drop themselves.
- **Library sync** (webgi) — `MaterialLibraryPlugin` calls `manager.getAllMaterials()` / `getMaterialsOfType()` and rebuilds grid in `_refreshUi`. Triggered by selection-changed event. Threepipe: not ported. Closest equivalent is `MaterialConfiguratorBasePlugin.getSelectedVariation()` which only operates on configured variations.

### Undo support

- **Webgi**: zero undo integration in any plugin in this audit set. None of `MaterialConfiguratorBase`, `SwitchNodeBase`, `MaterialLibrary`, `VariationConfigurator`, `ExtrasUi`, `LightsUi`, `SceneCamerasUi`, `SimpleViewerUi` reference an undo manager.
- **Threepipe**: only `HierarchyUiPlugin` (in plugin-tweakpane-editor) has undo, and only for visibility changes (`undoManager.record({redo, undo})`, lines 267-293). `MaterialConfiguratorBasePlugin` and `SwitchNodeBasePlugin` do not record undo entries. The `applyVariation`/`selectNode` calls are not wrapped — applying a variation cannot be undone. Worth filing (see Notes).

### Per-object userData persistence

- `SwitchNodeBasePlugin` writes `child.userData.__icon` for cached snapshot (both webgi line 137 and threepipe line 206). Compatible.
- Webgi `_preRender`/`_postRender` writes `child.userData.__oldVisible` and reads `child.userData.__forcedVisible` (lines 58-74) — threepipe doesn't use these userData keys at all (different visibility model).
- Webgi `MaterialLibraryPlugin` reads `material.userData.__appliedMeshes` (line 111) — webgi-specific Set tracking which meshes use this material. Threepipe's material manager has different bookkeeping.
- Webgi `VariationConfiguratorPlugin` writes `material.userData.__isVariation = true` (line 105) and reads `geometry.userData.__appliedMeshes` (in webgi `ExtrasUiPlugin.ts:136`). Threepipe has neither.
- Threepipe `HierarchyUiPlugin` reads `userData.isWidgetRoot` and `assetType === 'widget'` (line 105) — threepipe-only filtering.

## API / signature drift

- `MaterialConfiguratorBasePlugin.applyVariation`:
  - Webgi: `(variations, matUuidOrIndex: string|number): boolean`
  - Threepipe: `(variations, matUuidOrIndex, setSelectedIndex?: boolean, time?: AnimateTime & {from?: string|number}): boolean` — backward-compatible (extra optional args).
- `MaterialConfiguratorBasePlugin._refreshUiConfig` arguments:
  - Webgi: `uiConfig.uiRefresh?.('postFrame', true, 100)` (line 151)
  - Threepipe: `uiConfig.uiRefresh?.(true, 'postFrame', 500)` (line 203) — **argument order reversed and timeout 100→500**. Suggests `uiconfig.js` API itself drifted.
- `SwitchNodeBasePlugin.selectNode`:
  - Webgi: `(variation, child: Object3D|string, setDirty=true)`
  - Threepipe: `(node, nameOrUuid: string|number, setDirty=true): boolean|void` — **dropped `Object3D` param**, returns `boolean`. Not source-compatible.
- `MaterialConfiguratorBasePlugin.getPreview`:
  - Webgi: `(material, preview, viewerSetDirty=true)` — uses `_previewGenerator.generate(m, type)`.
  - Threepipe: same signature, but `_previewGenerator.generate(m, renderer, environment, type)` internally. API user-side identical.
- `MaterialConfiguratorBasePlugin._refreshUi` is `protected async` in both, return `Promise<boolean>`.
- `findVariation` parameter renamed `uuidOrName` → `mapping` (webgi line 85 vs threepipe line 98). Cosmetic.
- `MaterialConfiguratorBasePlugin._selectedMaterial` — webgi assumes `Mesh.material`; threepipe handles both `IMaterial` directly (PickingPlugin can select materials in threepipe) and array materials. Not webgi-compatible.
- `MaterialPreviewGenerator` constructor: `new MaterialPreviewGenerator(viewer)` (webgi) → `new MaterialPreviewGenerator()` (threepipe). Different module/path.
- `viewer.confirm` / `viewer.prompt` (webgi) → `viewer.dialog.confirm` / `viewer.dialog.prompt` (threepipe). All configurator UI calls updated.
- `setDirty`:
  - Webgi: `scene.setDirty({sceneUpdate, frameFade})`
  - Threepipe: `scene.setDirty({refreshScene, frameFade, source, updateGround})` — `sceneUpdate` renamed to `refreshScene`.
- `viewer.getManager()` (webgi) vs `viewer.materialManager` / `viewer.assetManager.materials` (threepipe).
- `addEventListener('preFrame'|'postFrame', ...)`:
  - Webgi `SwitchNodeBasePlugin` uses `viewer.scene.addEventListener('beforeRender'|'afterRender', ...)` for the pre/postRender hack — threepipe doesn't.
  - Webgi `MaterialConfiguratorBasePlugin` uses `viewer.addEventListener('preFrame', this._refreshUi)`. Threepipe uses both `'preFrame'` (for `_refreshUi`) and `'preFrame'` (for `_preFrame` timeline tick) (lines 50-51).

## Notes / open questions

1. **`MaterialConfiguratorOverlay*` files**: the prompt mentioned these but they don't exist in `experiments/webgi-legacy-src/` (grep-checked). They were either renamed before the legacy snapshot was taken or live in another webgi folder not present here. If the user expected `OverlayUiPlugin`-style HTML overlays, the closest existing webgi file is `VariationConfiguratorGridUiPlugin.ts` and `MaterialConfiguratorPlugin.ts`'s grid output. Threepipe equivalent: `GridItemListPlugin` rendering.
2. **`return → continue` fix**: threepipe `SwitchNodeBasePlugin.snapIcons:197` already uses `continue`, and the CHANGELOG.md (line 124) documents this fix landed in commit `41a1b41`. The user's note appears to refer to this already-fixed bug. The structurally-similar bug **still exists in webgi** (`SwitchNodeBasePlugin.ts:55, 70, 72` — `_preRender`/`_postRender`), but threepipe restructured those code paths away.
3. **Picking ordering fix**: threepipe added `viewer.forPlugin(PickingPlugin, ...)` to both `MaterialConfiguratorBasePlugin` (line 42) and `SwitchNodeBasePlugin` (line 43). Documented in CHANGELOG line 123. Webgi reads picking once in `onAdded` and silently fails if Picking is added later.
4. **Operator-precedence bug in `createVariation`** (`MaterialConfiguratorBasePlugin.ts:431` in threepipe; line 313 in webgi) — affects both. Should be filed in `issues/open/`. Test would be: call `addVariation(material, 'customKey')` and verify `variations[0].uuid === 'customKey'`. (Currently broken — falls to `material.uuid` instead.)
5. **No undo for variation apply / node select** in either webgi or threepipe. Worth a separate issue if undo support is desired.
6. **Should `MaterialLibraryPlugin` be ported?** The webgi version's base is half-broken (`_refreshUi` returns false unconditionally), so a port has to redesign the gating. Useful for editor flows; less useful for runtime configurators where variations are the right model.
7. **Should `VariationConfiguratorPlugin` be ported?** It's a substantial alternative model (file-based variations with zip persistence). Threepipe could implement it on top of `AssetManagerPlugin.importer` + `fflate`. Note webgi's `toJSON` is disabled (line 291 TODO) due to async issue; threepipe has `__sourceBuffer` infrastructure that may unblock this.
8. **Should `ExtrasUiPlugin`/`LightsUiPlugin`/`SceneCamerasUiPlugin` be ported?** Mostly editor-time conveniences; some may already be redundant given threepipe's `TweakpaneEditorPlugin`. The query-param toggles (RGBM/MSAA/depthPrepass) probably aren't relevant since threepipe configures these differently.
9. **`HierarchyUiPlugin._setVisible`** uses `Map.entries().forEach` (lines 270, 281) — iterator-helper API not universally supported. Switch to `for...of`. Minor.
10. **`getPreview` camDistance multiplier** for `SwitchNode`: webgi `* 0.5` vs threepipe `* 2` — 4× difference. If porting webgi configs (existing `camDistance` values), the icons will have a different framing in threepipe. Verify intent or document the change.
11. **threepipe-webgi experiment** has zero plugins from this audit set. If ports of MaterialLibrary/VariationConfigurator/PresetLibrary are planned, they'd presumably land there before being promoted to core/plugins/configurator.
