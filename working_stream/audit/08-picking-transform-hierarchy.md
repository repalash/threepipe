# Audit: Picking / Transform / Hierarchy / Widgets

Scope covers the selection / transform / pivot / widget surface across:
- **webgi (legacy)** — `experiments/webgi-legacy-src/`
- **threepipe core** — `src/plugins/interaction/`, `src/plugins/extras/`, `src/three/utils/`, `src/three/widgets/`
- **threepipe-webgi experiment** — `experiments/threepipe-webgi/src/`
- **plugins/** — `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts`

## Summary

Threepipe has clearly already absorbed most of the webgi 0.20.x picking/transform stack, with substantial extensions: it adds clipboard / duplicate / visibility / focus / reset-transform shortcuts in `PickingPlugin`, a hover widget, selection-mode auto-switching (object/material/geometry/texture), `selectedHandle`/`selectedWidget` plumbing, and `compensateSharedGeometry` on `pivotToPoint`. The `TransformControlsPlugin`, `PivotControlsPlugin`, `PivotEditPlugin`, and `MultiSelectHelper` are near-identical line-for-line ports of the webgi versions (only API names changed: `activeCamera` → `mainCamera`, `addSceneObject` → `addObject`, `getPluginByType` → `getPlugin`, etc.).

`threepipe-webgi/src/plugins/` contains no picking/transform/hierarchy code — those plugins were not re-experimented; threepipe core is the canonical destination.

The biggest visible gap is **`ObjectRotationPlugin` is not ported into threepipe at all** (still only in `experiments/webgi-legacy-src/plugins/ObjectRotationPlugin.ts`). It is the file that contains the `_syncing` re-entrancy guard the audit prompt flags as the webgi fix — that fix exists in webgi-legacy but has nowhere to land in threepipe yet.

`HierarchyUiPlugin` is in `plugins/tweakpane-editor/` (not `plugins/blueprintjs/` as the prompt assumed) and is mostly a clean port with `_postFrame`-coalesced rebuilds replacing the webgi `_resetting` lock + `timeout(500)` hack.

The prompt also asks about a few features that don't exist in this version of webgi-legacy at all: `rotateAroundParent` (zero hits in either codebase) — they appear to be from a newer or older webgi line; flagging as unverified.

## Plugin matrix

| Plugin | webgi (legacy-src) | threepipe core | threepipe-webgi | status |
|---|---|---|---|---|
| PickingPlugin | `extras/interaction/PickingPlugin.ts` (379L) | `src/plugins/interaction/PickingPlugin.ts` (989L) | — | threepipe is superset; webgi has unfixable inline listener leaks |
| ObjectPicker | `extras/interaction/ObjectPicker.ts` (442L) | `src/three/utils/ObjectPicker.ts` (455L) | — | threepipe adds `selectionMode`, `pickingMode`, `selectedWidget`/`selectedHandle`, `consumed`, undo, dispose |
| TransformControlsPlugin | `plugins/TransformControlsPlugin.ts` (207L) | `src/plugins/interaction/TransformControlsPlugin.ts` (404L) | — | line-for-line port; threepipe adds `TransformControls2 implements IWidget`, keyboard handlers, `selectionFilterTest`, `centerAllMeshes` button |
| PivotControlsPlugin | `plugins/PivotControlsPlugin.ts` (204L) | `src/plugins/interaction/PivotControlsPlugin.ts` (328L) | — | line-for-line port; threepipe adds `PivotControls2 implements IWidget` with rich UI bindings |
| PivotEditPlugin | `plugins/PivotEditPlugin.ts` (388L) | `src/plugins/interaction/PivotEditPlugin.ts` (386L) | — | nearly identical; uses `iObjectCommons.pivotToPoint` (with `compensateSharedGeometry`) instead of standalone `pivotToPoint` helper |
| MultiSelectHelper | `plugins/MultiSelectHelper.ts` (145L) | `src/plugins/interaction/MultiSelectHelper.ts` (146L) | — | identical, except threepipe types as `IObject3D` and uses `addObject(... addToRoot)` |
| Object3DWidgetsPlugin | `plugins/Object3DWidgetsPlugin.ts` (94L) | `src/plugins/extras/Object3DWidgetsPlugin.ts` (172L) | — | threepipe is significantly more robust: dedicated widget root, register/unregister + dispose listeners, `inSceneRoot`, `disableWidgets`, `LineHelper`, `SkeletonHelper2`, ancestor-aware ignore filter |
| ObjectRotationPlugin | `plugins/ObjectRotationPlugin.ts` (177L) | **MISSING** | — | not ported; webgi `_syncing` reentrancy fix has no landing site |
| HierarchyUiPlugin | `plugins/HierarchyUiPlugin.ts` (301L) | `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts` (318L) | — | threepipe replaces webgi's `_resetting` + `timeout(500)` debounce with `_needsReset`/`postFrame` coalescing; cleaner `forPlugin` lifecycle binding |
| SelectionWidget / BoxSelectionWidget / SphereSelectionWidget | `extras/interaction/{SelectionWidget,BoxSelectionWidget,SphereSelectionWidget}.ts` | `src/three/widgets/{SelectionWidget,BoxSelectionWidget,...}.ts` | — | both present; threepipe widgets directory also has `LineHelper`, `SkeletonHelper2`, `BoneHelper`, `CameraHelper2`, `*LightHelper2` |

## webgi-only / new in webgi (not in threepipe)

- **`ObjectRotationPlugin`** (`experiments/webgi-legacy-src/plugins/ObjectRotationPlugin.ts`) — entire plugin not ported. Notable contents:
  - `RotationCurveDef` type + `static CreateCurve(def)` factory (`:36-43`).
  - `CircleCurve3D` class (`:17-26`).
  - `_syncing` re-entrancy guard (`:67`, `:72-83`, `:89`) — the property write inside the `selectedObjectChanged` handler triggers `@onChange(_paramsChanged)` cascades; `_syncing` short-circuits `_paramsChanged` so switching selection doesn't clobber the just-loaded userData. **This is the bug fix the audit prompt asks about and it has no current home in threepipe.**
  - Per-object userData persistence on `obj.userData.rotationCount/rotationAxis/rotationOffset/rotationSkips/rotationCurve/rotationRoot`.
  - `Set Circle Curve` / `Clear Curve` UI buttons (`:144-175`).
  - Reads from / writes to `rotateDuplicatedMesh` and `autoScaleObject3D` helpers in `helpers/threejs/geometryUtils.ts` and `helpers/threejs/threeUtils.ts` — these helpers are also not ported.
  - Note: `rotateAroundParent` and `offset` (as a pure additive offset) are **not** in this version of `ObjectRotationPlugin.ts` (verified via grep across both repos). The audit prompt may be referencing a different webgi branch; flagging as unverified.

- **webgi `PickingPlugin.focusObject`** (`extras/interaction/PickingPlugin.ts:282-285`) uses `CameraViewPlugin.animateToFitObject` with a min/max distance band derived from `OrbitControls3.minDistance`. Threepipe's `focusObject` (`src/plugins/interaction/PickingPlugin.ts:737-739`) just delegates to `viewer.fitToView` — the min-distance clamp logic isn't carried over.

## threepipe-only / new in threepipe (not in webgi-legacy)

- **`PickingPlugin`** clipboard / object-op surface — `ObjectClipboard`, `DuplicateTracker`, `duplicateMode: 'simple' | 'compound'`, `deleteSelected/duplicateSelected/copySelected/cutSelected/pasteFromClipboard/toggleVisibilitySelected/unhideAll/focusSelected/resetTransform` (`src/plugins/interaction/PickingPlugin.ts:243-498`). Webgi has none of this.
- **Keyboard shortcuts** in threepipe `PickingPlugin._onKeyDown` (`:198-234`): Ctrl+A select-all, Ctrl+D duplicate (Shift toggles mode), Ctrl+C/X/V copy/cut/paste, Esc clear, Delete/Backspace delete, H toggle visibility, Shift+H unhide-all, F focus selected, Alt+G/R/S reset position/rotation/scale. Webgi only has Ctrl+A and Esc (`:326-335`).
- **`hoverWidget`** — second `SelectionWidget` instance with thin red lines for hover (`PickingPlugin.ts:148-153, 681-698`). Webgi has hover detection via `ObjectPicker.hoverEnabled` but no widget visualization.
- **`PickingPlugin.selectionMode`** + auto-switching by hit type (`object|material|texture|geometry`), `pickingMode: 'auto'`, `_selectionModeChanged` event (`ObjectPicker.ts:36-40, 148-160`). Not in webgi.
- **`PickingPlugin.refreshUiChildren`** — rich UI rebuild including `objectSelectionUiConfig` (Focus, Select Parent), per-material/per-geometry uiConfig nesting, `objectMaterialManageUiConfig` (Remove/New material buttons + line-material support) (`:839-986`). Webgi only pushes `selected.uiConfig` (`:153-159`).
- **`PickingPlugin._objCompChange`** listens for `materialChanged|geometryChanged|texturesChanged` to refresh UI when the selected object's components mutate (`:548-550, 630-634`). No equivalent in webgi.
- **`PickingPlugin.dependencies = [CameraViewPlugin]`** + `forPlugin('UndoManagerPlugin', ...)` and `forPlugin('DropzonePlugin', ...)` lifecycle binding (`:69, 553-567`). Webgi reads `TweakpaneUiPlugin.undoManager` lazily and has no dependency declarations.
- **`PickingPlugin.setDirty`** auto-clears selection when plugin becomes disabled (`:138-142`). Webgi's `setDirty` only calls `_viewer.setDirty`.
- **`ObjectPicker.dispose()`** removes all 7 pointer listeners (`src/three/utils/ObjectPicker.ts:107-118`). Webgi's `ObjectPicker` has **no** dispose; pointer listeners on the canvas are added with anonymous arrow functions (`:71-77`) — leaks if the picker is replaced.
- **`ObjectPicker._onSelectedRemoved`** subscribes to `__unregister` on each selected element so removing it from the scene auto-deselects (`:140-146, 177-186`). Webgi has no auto-deselect on remove (relied on PickingPlugin's `_sceneUpdate` only).
- **`ObjectPicker.setSelected` undo support** (`:200-203`). Webgi `setSelected` does not record undo.
- **`HitIntersects.consumed`** (`ObjectPicker.ts:18`) — typed flag honored both in `_onPointerClick` (`:308`) and used by `PivotEditPlugin` to suppress selection on pivot-marker click. Webgi shape is the same but only string-keyed.
- **`TransformControls2 implements IWidget, IObject3D`** with full uiconfig.js decorators (`mode`, `space`, `size`, `showX/Y/Z`), keyboard shortcuts (W/E/R/Q/X/Y/Z/+/-/Shift snap), `_savedSettings` to restore on detach (`src/plugins/interaction/TransformControlsPlugin.ts:215-404`). Webgi `TransformControls2` is just an alias; UI is generated dynamically.
- **`PivotControls2`** UI surface — `gizmoScale`, `fixed`, `depthTest`, `annotations`, `translationSnap`, `rotationSnap`, `scaleSnap`, `uniformScaleEnabled`, `disableAxes/Sliders/Rotations/Scaling` (`PivotControlsPlugin.ts:251-298`). Webgi `PivotControls2` only inherits the base class.
- **`Object3DWidgetsPlugin`** (`src/plugins/extras/Object3DWidgetsPlugin.ts`) is fully reworked:
  - Dedicated widget root container under scene root (`isWidgetRoot=true`) (`:55-66`).
  - Hooks `viewer.object3dManager` `objectAdd`/`objectRemove` events instead of relying on `addSceneObject` (`:67-69`).
  - `_widgetDisposed` listener auto-unregisters on widget dispose (`:98-108`).
  - `disableWidgets` userData flag and ancestor-walk to skip widgets-of-widgets (`:111-124`).
  - `inSceneRoot` constructor flag — widgets can attach to scene root or model root.
  - Adds `LineHelper`, `SkeletonHelper2` to the default helpers (`:31-39`).
- **`SkeletonHelper2`, `LineHelper`, `BoneHelper`** widgets exist in `src/three/widgets/`; webgi has only the four light/camera helpers.
- **`PickingPlugin.OldPluginType = 'PickingPlugin'`** legacy type alias (`:51`).

## Bugs in webgi (not present in threepipe)

1. **`PickingPlugin` event listener leaks** (`experiments/webgi-legacy-src/extras/interaction/PickingPlugin.ts:184, 188-210`):
   - `viewer.scene.addEventListener('select', (e)=>{...})` is registered with an anonymous arrow function and never removed in `onRemove` (`:215-232`). Repeated add/remove of the plugin will multiply this listener.
   - `viewer.scene.addEventListener('addSceneObject', async(e)=>{...})` (the material-drop variant) is also anonymous and never removed. The plugin **does** keep a named `_addSceneObject` for the widget-root variant and removes that one (`:142, 217`), but two distinct listeners are added on the same event and only one is cleaned up.
   - The comment `// todo: remove these event listeners` (`:146`) admits this.
   - Threepipe addresses both with named instance handlers `_onObjectSelectEvent` and the consolidated `_addSceneObject`/`_sceneUpdate` (`src/plugins/interaction/PickingPlugin.ts:533-579`).

2. **`ObjectPicker` pointer listeners leak** (webgi `ObjectPicker.ts:71-77`): `addEventListener('pointermove', v => this.onPointerMove(v))` etc. — no removal path; the class has no `dispose()`. Threepipe binds them as named arrow fields (`_onPointerMove` etc.) and removes them in `dispose()` (`src/three/utils/ObjectPicker.ts:97-118`).

3. **`HierarchyUiPlugin` debounce is timing-based** (`HierarchyUiPlugin.ts:188-194`): `await timeout(500)` between resets is a hardcoded delay; large scene updates can stack while waiting. Threepipe replaces this with a `_needsReset` flag drained on `postFrame` (`plugins/tweakpane-editor/src/HierarchyUiPlugin.ts:107, 220-223`) — bounded, single rebuild per frame.

4. **`MultiSelectHelper.setup`** calls `viewer.scene.add(dummy)` (webgi `MultiSelectHelper.ts:25`) — adds the dummy directly to the scene without `isWidgetRoot` flag, so the dummy can be picked. Threepipe also has this issue but routes through `viewer.scene.addObject(... addToRoot: true)` (`MultiSelectHelper.ts:26`) — still no `isWidgetRoot`. Both should set `userData.userSelectable = false` and/or `bboxVisible = false` to keep the picker from grabbing the dummy when the gizmo is not on top of it. (See "Bugs in threepipe" #1.)

## Bugs in threepipe

1. **`MultiSelectHelper` dummy is pickable** (`src/plugins/interaction/MultiSelectHelper.ts:21-39`): the dummy `Object3D` is added to the scene with only `userData.isMultiSelectDummy = true`. It has no geometry/material so the raycaster won't hit it directly, but selection logic that walks ancestors or filters by `assetType` may still consider it. Recommend setting `userData.userSelectable = false`, `bboxVisible = false`, and possibly `isWidgetRoot = true` to align with the rest of the widget surface. (Same bug in webgi.)

2. **No "force-world-space for multi-select dummy"** in either codebase. The audit prompt mentions this; verified absent. The dummy is created with `quaternion.identity()` and `scale=1`, but the gizmo's `space` ('world'/'local') is left to whatever the user last set. With multi-select active, `local` space is meaningless because the dummy has identity rotation — but the gizmo will still render in local mode and confuse rotations. Both `TransformControlsPlugin` (`:108-131`) and `PivotControlsPlugin` (`:118-141`) attach the dummy directly without saving/forcing space. Recommendation: when `_multi.hasMultiSelect`, save the previous space and force `space = 'world'`; restore on detach. **Carry the same fix to webgi if porting back.**

3. **`PickingPlugin._setSelectedFromArray` for visibility/transform-reset multi-undo does not restore `selectedIntersects`** — selection-state restore is value-only. If undoing a delete brings back an object that originally had `selectedHandle`/`selectedWidget` context, that context is lost. Minor; webgi has no such code so no regression.

4. **`PickingPlugin.duplicateSelected` mutates clones in-place before recording undo** (`:280-302`) — the saved `preOffsetMatrix` is the clones' position at index 0 _after_ `clone()` but before `applyOffset`; if `clones[0]` is later moved by something else, the redo path's `onDuplicated(preOffsetMatrix)` will re-base the offset incorrectly. Likely fine in practice but worth noting.

5. **`PickingPlugin._onObjectHit` mutates the dispatched event** (`:700-718`): rewrites `e.intersects.selectedObject/selectedWidget/selectedHandle` and then redispatches via `this.dispatchEvent(e)`. Subsequent listeners cannot see the original hit object. The webgi version does the same. Fine if intentional; worth a comment.

6. **`TransformControls2._keyDownListener` and `_keyUpListener` are bound to `window`** (`src/plugins/interaction/TransformControlsPlugin.ts:303-304`) and only removed in `dispose()` (`:344-348`). Plugin lifecycle calls `transformControls.dispose()` on `onRemove` (`:196`), so this is safe — but the keydown listener fires whenever the gizmo is constructed, even when the plugin is disabled. Listener checks `this.enabled && this.object` (`:223`) so the actual side effects are gated, but the listener still runs on every keystroke globally.

7. **`PivotEditPlugin._attachGizmo` creates a fresh `Object3D` dummy each time the gizmo is first attached** (`:292-296`) and does not flag it as `isWidgetRoot`/`userSelectable=false`. Same as MultiSelectHelper bug. Webgi has the same bug.

8. **`PickingPlugin.toggleSelectedObject` skips the `setSelected(intersects)` form** (`:177`). When a user shift-clicks via the hierarchy UI or external code, the resulting selection has no `intersects.selectedHandle` context — the transform gizmo loses any handle-target it would have gotten from a direct canvas click. The internal `ObjectPicker._onPointerClick` deliberately does **not** pass `intersects` for multi-select either (`:319-321`) with the comment "Don't pass intersects for multi-select". Behavior consistent; documenting.

## Behavior divergences

| Behavior | webgi | threepipe |
|---|---|---|
| Camera ref | `viewer.scene.activeCamera.cameraObject`, `activeCameraChange` event | `viewer.scene.mainCamera`, `mainCameraChange` event |
| Add-to-scene API | `viewer.scene.add(...)`, `viewer.scene.addSceneObject(...)`, `viewer.scene.addWidget(...)` | `viewer.scene.addObject(obj, {addToRoot: true})` |
| Plugin lookup | `getPluginByType<T>('Type')` | `getPlugin<T>('Type')` |
| Picker root | `IScene` (uses `scene.modelRoot.modelObject`) | `IObject3D` (uses `scene.modelRoot` directly) |
| Multi-select picker filter | tests `(obj.userData.iModel ?? obj).assetType === 'model'` (iModel-aware) | tests `obj.assetType === 'model'` directly (no iModel indirection) |
| `selectAll` walk | `viewer.scene.modelRoot.modelObject.traverse(...)` | `viewer.scene.modelRoot.traverse(...)` |
| `focusObject` | `CameraViewPlugin.animateToFitObject(o, 1.25, 1000, 'easeOut', {min: ctrl.minDistance+0.5, max: 50})` | `viewer.fitToView(o, 1.25, 1000, 'easeOut')` (no min/max) |
| `setSelectedObject` undo | not tracked | tracked (`trackUndo` parameter, default true) |
| Hover widget | none | extra `SelectionWidget` instance with red thin lines |
| `enabled=false` selection cleanup | none — selection persists when plugin disabled | `setDirty` clears selection on disable |
| Pivot marker `userData.allowOverride` | set via `MeshBasicMaterial2` config | not set (uses `MeshBasicMaterial`) |
| Pivot marker scale target | `_markerRoot.scale` | `_pivotMarker.scale` (root stays at unit; only the mesh scales) |
| `pivotToPoint` impl | top-level `pivotToPoint(obj, target, compensateSharedGeometry=true)` helper | `iObjectCommons.pivotToPoint` method on `IObject3D` |
| Hierarchy debounce | `_resetting` lock + `await timeout(500)` | `_needsReset` flag + `postFrame` drain |
| Hierarchy undo source flag | `e.fromHierarchyPlugin` (custom field) | `e.source === HierarchyUiPlugin.PluginType` (standardized) |
| `Object3DWidgetsPlugin` event source | `viewer.scene.addEventListener('addSceneObject', ...)` | `viewer.object3dManager.addEventListener('objectAdd'/'objectRemove', ...)` |
| Widget root structure | each widget added via `viewer.scene.addWidget(w)` directly under scene | all widgets parented under one `_widgetRoot: Group2` with `isWidgetRoot=true` |

## API / signature drift

- `PickingPlugin` constructor: webgi `(selection, controls, pickUi, autoFocus)` (4 args, `controls` deprecated, errors if `true`); threepipe `(selection, pickUi, autoFocus)` (3 args, `controls` removed entirely).
- `PickingPlugin.setSelectedObject(object, focusCamera)` (webgi) → `setSelectedObject(object, focusCamera=false, trackUndo=true)` (threepipe). Adds `trackUndo`.
- `MultiSelectHelper.setup(objects: Object3D[], viewer: ViewerApp)` (webgi) → `setup(objects: IObject3D[], viewer: ThreeViewer)` (threepipe).
- `ObjectPicker` constructor: webgi `(scene: IScene, domElement, camera?, selectionCondition?)` (camera optional); threepipe `(root: IObject3D, domElement, camera: ICamera, selectionCondition?)` (root replaces scene; camera required).
- `ObjectPicker.setSelected(object, record=true)` → `setSelected(object, record=true, intersects?: HitIntersects)`. New `intersects` param threads through `selectedIntersects` for handle/widget context.
- `ObjectPicker.hoverObject` setter (webgi) → `setHoverObject(object, _record=true, intersects?)` method (threepipe). The setter signature is intentionally retired; setter on `selectedObject` is also commented out (`:136-138`).
- `ObjectPicker` event payload `selectedObjectChanged`: webgi `{type, object, objects, lastValue, lastValues}`; threepipe `{type, object, objects, material, value, lastValue, lastValues, intersects}` — adds `material`, `value` (typed any-of), `intersects`.
- `PivotEditPlugin.pivotToCenter`: webgi calls free function `pivotToBBoxCenter(obj)`; threepipe calls `obj.pivotToBoundsCenter(true)` interface method.
- `PivotEditPlugin.pivotToPoint`: webgi calls `pivotToPoint(obj, target)`; threepipe calls `obj.pivotToPoint(target, true)` returning the undo function.
- `Object3DWidgetsPlugin.PluginType`: webgi `'WidgetsPlugin'`, threepipe `'Object3DWidgetsPlugin'`. **Renaming is breaking** for serialized scenes — both `Object3DWidgetsPlugin.PluginType` references differ.
- `Object3DWidgetsPlugin` constructor: webgi `(enabled = true)`; threepipe `(enabled = true, inSceneRoot = false)`.
- `HierarchyUiPlugin.reset()` is `async` in webgi (returns Promise) and synchronous-ish (returns void) in threepipe.

## Notes / open questions

- **`rotateAroundParent`** — not present in this version of `ObjectRotationPlugin.ts` (verified by repo-wide grep, zero matches). Either it's in a newer webgi branch the user has locally or the audit prompt was conflating with another plugin. Flag for clarification before porting.
- **`ObjectRotationPlugin` should be ported** before any feature-parity claim. The `_syncing` re-entrancy guard pattern (private flag set true while writing to `@onChange`-decorated properties from inside another `@onChange` handler) is the correct fix and should be replicated. It applies generally to any threepipe plugin that mirrors selection state into its own `@onChange` properties — worth checking other plugins (`MaterialConfigurator`, `LightsUi`, etc.) for the same antipattern.
- **`ObjectRotationPlugin` dependencies** — porting requires `rotateDuplicatedMesh` (`webgi-legacy-src/helpers/threejs/geometryUtils.ts:51-99`) and `autoScaleObject3D` (`webgi-legacy-src/helpers/threejs/threeUtils.ts`). Neither helper is in threepipe; both should be evaluated for inclusion or replacement.
- **Multi-select gizmo space** — should be forced to `world` on `setup` and saved/restored on `clear`. Current code in both webgi and threepipe lets the gizmo run in `local` space against an identity-rotation dummy, which is a UX trap (rotations look correct, but they apply via the dummy's local frame which is world-aligned, so it _happens_ to work — but it's unprincipled).
- **Widget picking & `getRootIfWidget`** — both implementations walk parents until finding `assetType==='widget'` or `userData.allowPicking`. Threepipe's variant is identical (`PickingPlugin.ts:34-40`). Confirmed parity.
- **`isWidgetRoot` discovery** — both read from `viewer.scene.children` filtered by `userData.isWidgetRoot` and listen on `addSceneObject`. Identical logic. Threepipe additionally cleans up on `sceneUpdate` with `change === 'removedFromParent'` (`:622-628`); webgi does the same (`:234-254`).
- **Drag-end / `dragging-changed` reset** — both plugins call `controls.stopDamping()` on `dragging-changed` and pause camera interactions via `setInteractions(!event.value, PluginType)`. Identical.
- **`detach()` behavior on TransformControls/PivotControls** — both `setDirty` flows call `detach()` when no objects selected, multi-select cleared, or plugin disabled. Threepipe additionally reads `selectionFilterTest` to allow apps to veto a candidate object before attach (`TransformControlsPlugin.ts:121, PivotControlsPlugin.ts:131`); webgi has no such hook.
- **`PivotEditPlugin` widget-as-pickable-handle** structure (`_markerRoot/Group2[isWidgetRoot]` → `_markerWidget/Group2[assetType=widget,object=selected]` → `_pivotMarker/Mesh[isWidgetHandle,isPivotMarker]`) is identical in both — uses `setupIModel` in webgi (`:168`) but vanilla `Group2` in threepipe (`:143`). Verify this didn't change behavior re: scene ancestor lookups in `iObjectCommons`.
- **`HierarchyUiPlugin` drag-drop** — neither version implements drag-drop reparenting. The audit prompt lists this as a comparison point; current state is "neither has it." File as separate feature request if desired.
- **`HierarchyUiPlugin` search** — also not implemented in either version.
- **Multi-select highlighting in hierarchy** — both versions iterate `picking.getSelectedObjects()` and apply `treejs-node-selected` class to all matching `<li>` elements (webgi `:163-186`, threepipe `:186-209`). Identical.
- **Shift-click multi-select from hierarchy** — both versions check `_lastPointerShift` (set via `pointerdown` listener) and call `picking.toggleSelectedObject(obj1)` (webgi `:128-137`, threepipe `:138-147`). Identical.
- **threepipe-webgi experiment** — confirmed empty for this domain. Don't expect to find diverged plugins there.
