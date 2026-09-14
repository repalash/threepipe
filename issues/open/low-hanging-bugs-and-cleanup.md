# Bugs, TODOs, and Improvements

Found across the codebase. Organized by category and estimated effort.

---

## Event Listener Leaks

### CameraViewPlugin — preFrame listener not removed
- `src/plugins/animation/CameraViewPlugin.ts:114` — `// todo: remove event listener`. preFrame listener added in onAdded but never removed in onRemove.
- **Effort:** 1-2 hours

### GLTFAnimationPlugin — object disposal listener missing
- `src/plugins/animation/GLTFAnimationPlugin.ts:704` — `// todo remove on object dispose/remove`. Animation listeners on objects persist after object removal.
- **Effort:** 2-4 hours

### TransformControlsPlugin — anonymous selectedObjectChanged listener
- `src/plugins/interaction/TransformControlsPlugin.ts:107` — Anonymous listener on PickingPlugin, not removed in onRemove. Short-circuits after removal but closure persists.
- **Effort:** 2-4 hours

### PivotControlsPlugin — same pattern
- `src/plugins/interaction/PivotControlsPlugin.ts:116` — Same anonymous listener issue.
- **Effort:** 2-4 hours

### PivotEditPlugin — hitObject + selectedObjectChanged listeners
- `src/plugins/interaction/PivotEditPlugin.ts:81,92` — Two listeners on PickingPlugin, not removed.
- **Effort:** 2-4 hours

### PickingPlugin — selected object dispose event
- `src/plugins/interaction/PickingPlugin.ts:195` — ObjectPicker listens to `__unregister` (scene removal) but not `dispose`. A disposed object can remain selected.
- **Effort:** 4-8 hours

---

## Missing Serialization

### PickingPlugin — autoFocusHover and autoApplyMaterialOnDrop
- `src/plugins/interaction/PickingPlugin.ts:72-76` — Two `// @serialize() // todo` comments. User preferences lost on reload.
- **Effort:** 1-2 hours

### CascadedShadowsPlugin — shadow configuration
- `src/plugins/rendering/CascadedShadowsPlugin.ts` — Critical shadow properties not serialized.
- **Effort:** 1-2 days

### RenderTarget textures not serializable
- `src/utils/serialization.ts:91` — `if (obj.isRenderTargetTexture) return undefined // todo: support render targets`
- **Effort:** 1-2 days

### TransformAnimationPlugin — TSavedTransform not properly serializable
- `src/plugins/animation/TransformAnimationPlugin.ts:7` — TODO: make a serializable object like CameraView.
- **Effort:** 1-2 days

---

## Missing Features

### AssetExporter — light export not implemented
- `src/assetmanager/AssetExporter.ts:149` — `console.error('AssetExporter: light export not implemented')`. Returns undefined for light assets.
- **Effort:** 1-2 days

### AssetExporter — missing image format exporters
- `src/assetmanager/AssetExporter.ts:31` — Commented TODO for PNG/JPEG/WebP export support.
- **Effort:** 1-2 days

### GLTFMaterialsVariantsExtensionExport — no multi-material support
- `src/plugins/extras/helpers/GLTFMaterialsVariantsExtensionExport.ts:28` — `// @TODO: support multi materials?`
- **Effort:** 1-2 days

### TonemapPlugin — GBuffer UI integration missing
- `src/plugins/postprocessing/TonemapPlugin.ts:144` — TODO: add gBufferData/tonemapEnabled to scene material UI.
- **Effort:** 1-2 days

### IObject.ts — sProperties selective serialization
- `src/core/IObject.ts:310` — Declared but not implemented: "Note - this is not implemented, added to userData for future."
- **Effort:** 1-2 days

### ~~SwitchNodeBasePlugin — PickingPlugin ordering dependency~~ FIXED
- ~~`src/plugins/configurator/SwitchNodeBasePlugin.ts:43` — TODO: subscribe to plugin add event if picking is not added yet. UI breaks if PickingPlugin added after this plugin.~~
- Fixed: now uses `viewer.forPlugin()` pattern matching MaterialConfiguratorBasePlugin.

### SwitchNodeBasePlugin — snapIcons `return` instead of `continue`
- `src/plugins/configurator/SwitchNodeBasePlugin.ts` — In `snapIcons()`, `if (child.userData.__icon) return` exits the entire method instead of skipping that child. Should be `continue`.
- **Effort:** 5 minutes — FIXED

### SwitchNodePlugin — context menus shadow DOM untested
- `plugins/configurator/src/SwitchNodePlugin.ts` — Context menus append to `document.body`, won't work in shadow DOM. Same issue exists in MaterialConfiguratorPlugin.
- **Effort:** 4-8 hours

### GridItemListPlugin — rebuildUi lacks throttling
- `plugins/configurator/src/GridItemListPlugin.ts:14` — `rebuildUi()` could benefit from throttling to avoid excessive DOM rebuilds.
- **Effort:** 1-2 hours

### Configurator plugins — no tests
- `plugins/configurator/` — No `.test.ts` or `.spec.ts` files exist for any of the configurator plugins (MaterialConfiguratorPlugin, SwitchNodePlugin, GridItemListPlugin).
- **Effort:** 1-2 days

---

## Incomplete Cleanup / Dead Code

### @ts-expect-error no longer needed
- `src/plugins/material/NoiseBumpMaterialPlugin.ts:71-72` — Comment says "this is not req anymore actually." Remove `shader.extensionDerivatives = true`.
- **Effort:** 5 minutes

### Leftover console.error
- `src/utils/serialization.ts:734` — `console.error('ThreeSerialization: TODO: check file format')` — code below handles the format. Remove or change to console.warn.
- **Effort:** 5 minutes

### Deprecated method not marked
- `src/three/controls/TransformControls.js:622-624` — `getMode()` has `// TODO: deprecate`. Add @deprecated JSDoc.
- **Effort:** 5 minutes

### PointerLockControls2 — dead vendor prefixes
- `src/three/controls/PointerLockControls2.ts:77-78` — `mozMovementX`/`webkitMovementY` fallbacks. Standard `movementX`/`movementY` supported in all modern browsers.
- **Effort:** 10 minutes

### TransformControls — unused properties
- `src/three/controls/TransformControls.js:139` — `// TODO: remove properties unused in plane and gizmo`.
- **Effort:** 4-8 hours (needs audit of which properties each mode uses)

---

## Type Safety

### ACameraControlsPlugin — @ts-expect-error hacks
- `src/plugins/base/ACameraControlsPlugin.ts:13,19` — Event type doesn't allow undefined camera/lastCamera. Fix: make event type accept `ICamera | undefined`.
- **Effort:** 2-4 hours

### Box3B — @ts-expect-error on computeBoundingBox
- `src/three/math/Box3B.ts:56` — `// @ts-expect-error why?`. IObject3D doesn't declare `computeBoundingBox`. Fix: add to interface or cast to Mesh.
- **Effort:** 1-2 hours

### Missing return types on public async methods
- `src/plugins/pipeline/FrameFadePlugin.ts:57,80` — `startTransition()` and `stopTransition()` missing return types.
- **Effort:** 10 minutes

---

## Performance

### GLTFMaterialsVariantsExtensionImport — O(N^2) name deduplication
- `src/plugins/extras/helpers/GLTFMaterialsVariantsExtensionImport.ts:31-33` — Comment: "O(N^2) in the worst scenario. Fix me if needed."
- **Effort:** 1-2 hours

### GBufferRenderPass — incomplete transparent material handling
- `src/postprocessing/GBufferRenderPass.ts:27,53,61,100` — Multiple TODOs for transparent/transmissive material state management. Potential visual artifacts.
- **Effort:** 1-2 days

### RenderManager — incomplete RenderTarget state restoration
- `src/rendering/RenderManager.ts:544` — `// todo: active cubeface etc`. Render target state leaks between passes.
- **Effort:** 2-4 hours

---

## Documentation

### InteractionPromptPlugin — missing example
- `src/plugins/interaction/InteractionPromptPlugin.ts:18` — `TODO - create example`. No example in examples/.
- **Effort:** 2-4 hours

### GLTFMeshOptDecodePlugin — missing compatibility check
- `src/plugins/import/GLTFMeshOptDecodePlugin.ts:18` — `todo: check if compatible?`. No browser/platform verification.
- **Effort:** 2-4 hours

---

## Larger Improvements

### ThreeViewer dispose — incomplete and not async
- `src/viewer/ThreeViewer.ts:743` — `// TODO - return promise?`. Dispose doesn't clean up all constructor-allocated resources. Should return Promise for async plugin cleanup.
- **Effort:** 1-2 days

### RootScene — missing lightsRoot
- `src/core/object/RootScene.ts:176` — Environment light system and lightsRoot commented out. Incomplete scene lighting hierarchy.
- **Effort:** 2-3 days

### CustomContextMenu — global listener
- `src/utils/CustomContextMenu.ts:23` — Static `document.addEventListener('pointerdown')` never removed. Persists after all viewers disposed.
- **Effort:** 4-8 hours

### HierarchyUiPlugin — missing UI element cleanup
- `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts:212,226` — `// todo: remove UI element` and `// todo destroy UI element`.
- **Effort:** 2-4 hours
