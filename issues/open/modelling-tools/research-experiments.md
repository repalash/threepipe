# Research: `experiments/` — prior art for the modelling tools

Status: research (2026-09-14). Read-only survey of `/Users/palash/Projects/threepipe/experiments/`, requested before continuing the modelling-tools design. Companion to `00-synthesis.md`, `research-threepipe.md`, `research-kokraf.md`, `research-blender.md`, `research-ecosystem.md`.

**Headline findings**

1. `EditModePlugin` in the Blueprint editor is **not** a mesh edit mode. It is the *editor viewport mode* (editor cameras, grid, light overrides, WASD fly, editor keymap) — the opposite of "play mode". The name is taken and the semantics clash with Blender's Object/Edit mode. **We must not ship a second `EditModePlugin`.**
2. The Blueprint editor contains **zero** mesh/geometry editing code. No vertex/edge/face concepts, no snapping, no 3D cursor, no measurement, no marquee. Grep for `vertex|snapping|3d cursor|bmesh|half-edge|loopcut` across `src/` only hits the vendored cannon-es physics helpers. The modelling plugin is greenfield from the editor's point of view.
3. The MCP bridge is already **a thin dumb pipe**: the Node process only relays JSON-RPC over a WebSocket; every tool schema and every implementation lives in the browser. Making a typed scripting API the source of truth and generating the tool list from it is a drop-in replacement, not a rewrite.
4. `experiments/webgi-legacy-src/` is the richest prior art in the folder — the ancestor of threepipe's `PickingPlugin` / `TransformControls2` / `PivotEditPlugin` / `MultiSelectHelper`, including a real modal sub-tool (`PivotEditPlugin`) and the `W/E/R/Q` gizmo keymap that will collide with Blender's `G/R/S`.

---

## 1. `experiments/threepipe-blueprint-editor/` — "Kite 3D" / Threepipe Editor

React 18 + Blueprint.js 5 + `uiconfig-blueprint` + Vite 6 SPA. `package.json` `name: threepipe-blueprint-editor`, `version: 0.12.0`, private. Deployed as both `kite-threepipe-v0/` and `threepipe-editor/` on R2 (`package.json` `deploy` / `deploy-tp` scripts). Last commit `7fac408`, 2026-09-13.

### 1.1 Versions and local links (important)

`/Users/palash/Projects/threepipe/experiments/threepipe-blueprint-editor/package.json`:

- `"threepipe": "file:./../threepipe/"` — resolved in `package-lock.json` as **threepipe 0.4.3**. The repo is currently on **0.5.1**, so the editor is one minor behind the modelling branch. `node_modules/threepipe` is a now-dangling symlink to `../../threepipe` (the sibling checkout it expects no longer exists at that path).
- `"uiconfig-blueprint": "file:./../uiconfig-blueprint"` (v0.1.0-dev.15) — the Blueprint renderer for `uiconfig.js`. **Not present in `experiments/`**; it lives in a separate sibling repo. This is where `ConfigObjectGenerators`, `InspectorStackComponent`, `useConfigToStackItem` come from.
- `@threepipe/webgi-plugins` 0.5.11, `@threepipe/plugin-geometry-generator` 0.6.3, `plugin-blend-importer` 0.1.0, plus 3d-tiles-renderer / assimpjs / configurator / gaussian-splatting / gltf-transform / network / path-tracing / troika-text / extra-importers.
- `@modelcontextprotocol/sdk` ^1.0.0, `ws` ^8.18.0, `zod` ^4.1.13 (zod is a devDep and is **not** currently used for tool schemas — schemas are hand-written JSON Schema literals).

**No local patches or forks of threepipe plugins.** `packages/` contains exactly one package (`packages/mcp-bridge`, the published `@kite3d/mcp-bridge` bundle). Editor-specific plugins live in `src/`:

| Plugin | File | Purpose |
| --- | --- | --- |
| `EditModePlugin` | `src/utils/EditModePlugin.ts` | editor viewport mode (see §1.3) |
| `BlueprintJsUiPlugin2` | `src/UiConfigRendererBlueprint2.tsx` | uiconfig renderer, owns the undo manager wiring |
| `CannonPhysicsPlugin` + components | `src/plugins/cannon/*` | physics for play mode |
| `HtmlUiComponent` | `src/plugins/HtmlUiComponent.ts` | an `Object3DComponent` |
| `CanvasFileDropHandler` | `src/utils/CanvasFileDropHandler.tsx` | drop-to-scene with undo |
| `AssetTracker` | `src/utils/AssetTracker.ts` | subclass of threepipe's asset tracker |

### 1.2 Docs

- `README.md` — 6 lines, a vite/classnames workaround note. Nothing architectural.
- `AssetSystem.md` — the asset-instance model: `assetRoot` / `assetChild` / `assetRootClone` (`assetComponent`) / `assetChildClone` / `embeddedAssetClone`, and which of `_sChildren`, `userData.rootPath`, `userData.sProperties`, `_tpRootPath`, `_tpRootUid`, `userData.tpAssetId` each carries. **Directly relevant**: an edited mesh belonging to a linked asset must not be edited in place — see `isGeomEditable` in §1.9.
- `TESTING.md` + `tests/README.md` — entirely about `getSceneStructureMd()` snapshot tests (§1.10).
- `docs/` — empty.
- `.github/copilot-instructions.md` — the project is "Kite 3D, an advanced web based game engine using threepipe"; users write `.script.js`/`.script.ts` `Object3DComponent`s; editor UI is React + Blueprint 5 + uiconfig.js.
- `src/data/AgentsMdTemplate.md` (~250 lines) — the AGENTS.md written into every new project. This is the maintainer's existing "API surface an agent gets" document: `Object3DComponent` lifecycle (`init/start/update/preFrame/stop/destroy`), `StateProperties` (with `uiConfig` overrides per property), `.plugin.js` vs `.script.js`, `EntityComponentPlugin` API, and explicitly "Use the Kite Editor MCP to inspect the editor and scene state at runtime". **Pattern worth copying for modelling: a typed, documented, hand-authored API doc that both humans and agents read, with the MCP as an inspection channel rather than the API.**

### 1.3 `src/utils/EditModePlugin.ts` — full read (607 lines)

```ts
// L34-39
@uiFolderContainer('Edit Mode', {expanded: true})
export class EditModePlugin extends AViewerPluginSync<{
    enableChanged: {}
    cameraChanged: {camera: 'perspective' | 'orthographic' | IObject3D}
} & AViewerPluginEventMap>{
    public static readonly PluginType = 'EditModePlugin';
```

Public surface (exact lines):

| Member | Line | Notes |
| --- | --- | --- |
| `PluginType = 'EditModePlugin'` | 39 | **name collision risk** |
| `get isEnabled2()` → `!this.isDisabled()` | 41 | UI binds to this, not `enabled` |
| `@onChange('setDirty') enabled = true` | 46 | |
| `dependencies = [PickingPlugin]` | 51 | |
| `cameraPerspective` / `cameraOrtho` (`PerspectiveCamera2`/`OrthographicCamera2`, `'orbit'`) | 53-54 | separate editor cameras, `userData.disableWidgets = true` |
| `@onChange('setDirty') cameraMode: CameraType` | 56-57 | `'perspective' \| 'orthographic' \| 'default' \| <uuid>` (type at L31) |
| `grid = new GridHelper(100, 100, 0x62793a, 0x4e4f4f)` | 60 | `isWidget = true`, `renderToGBuffer/renderToDepth = false`, `allowOverride = false`, shadows off (L139-147) |
| `lightOverrider = new LightMaterialOverrider()` | 62 | `src/utils/three/LightMaterialOverrider.ts` |
| `enableWASDMovement` / `wasdMovementSpeed` / `focusAnimDuration` | 189-202 | `@uiToggle`/`@uiNumber` + `@serialize` |
| `_viewerListeners.preFrame` → `editorCameraController(this)` + `lightOverrider.preFrame(this)` | 204-212 | `src/utils/three/EditorCameraController.ts` |
| `keyMap: {[key: string]: boolean}` | 214 | also holds `mouse0..4` from pointer events (L334-343) |
| `keyListeners: [{keys, metaKey?, ctrlKey?, shiftKey?, altKey?, onDown?, onUp?}]` | 216-290 | the editor's whole keymap, see below |
| `setDirty()` | 350-378 | edge-detects enable/disable → `onEnable()`/`onDisable()`; activates the editor camera and dispatches `cameraChanged` |
| `serializeWithViewer = false` | 380 | |
| `fitView()` / `resetView()` | 391-410 | `Box3B().expandByObject(modelRoot)` + `getFittingDistance` |
| `onEnable()` | 412-462 | `renderPass.renderBackground = false`, grid visible, cursor `default`, activate editor camera, set `OrbitControls3` props (L436-448), `picking.widgetEnabled = true`, `EditorViewWidgetPlugin.enabled = true`, dispatch `enableChanged` |
| `onDisable()` | 464-503 | restores all of the above, `scene.defaultCamera.activateMain()`, `controls.stopDamping()` |
| `toggleGrid` / `toggleBackgroundColor` (reducer-shaped `(cur, next) => next`) | 505-529 | consumed directly by React `useReducer` in the toolbar |
| `get viewer()` | 514 | |
| `setCameraMode(cameraType): boolean` | 536-573 | handles editor cameras and scene cameras by uuid |
| `getActiveCameraType(): CameraType` / `isUsingSceneCamera(): boolean` | 580-605 | |

**Keymap** (`keyListeners`, L216-290) — this is the entire *app-level* keymap; the editor's own `src/` binds no other viewport keys (grep-verified). It sits on top of threepipe core's own `window` handlers in `PickingPlugin` and `TransformControlsPlugin`, which it does not know about — hence the duplicate `F`, `Delete` and `Cmd+D` bindings noted in §4(d).

- `Backspace` / `Delete` → delete selected object, guarded by `isExternalObject()`, routed through `undoMan.performAction(undefined, iObjectCommons.deleteObject, [...], 'delete_object')` (L226-249).
- `f` → fit selected (or `modelRoot`) to view via `viewer.fitToView(sel, 1.5, focusAnimDuration, 'linear')` (L251-264).
- `Cmd/Meta+d` → duplicate via `undoMan.performAction(undefined, iObjectCommons.duplicateObject, [...], 'duplicate_object')` (L266-289).

Dispatch is by two `document`-level capture listeners (`_keyDownGlobal`/`_keyUpGlobal`, L298-332) with an `['INPUT','TEXTAREA','SELECT'].includes(target.tagName)` guard, plus canvas-level `_keyDown`/`_keyUp` that only maintain `keyMap` for the WASD fly camera. Modifier matching is `kl.metaKey !== undefined && kl.metaKey !== event.metaKey → skip`, i.e. unspecified modifiers are wildcards — `f` fires even with Ctrl held.

**What "edit mode" means here**: editing the *scene* (vs. previewing/playing it). Related helpers:

- `src/utils/EditPreviewHelper.ts` (33 lines) — `start()`/`stop()` disable/enable the `widgets`, `transform-controls` and `edit-mode` features under the key `'EditPreview'`.
- `src/utils/PlayModeHelper.ts` — `startRunMode/pauseRunMode/unpauseRunMode/stopRunMode`, toggles the `physics` feature under key `'PlayingMode'`.
- `src/utils/ViewerInstanceManager.ts:882-934, 957-998` — disables `edit-mode` and `picking` under key `'exportScene'` while exporting.

### 1.4 `EditorFeatures` — the mode/feature gating mechanism (adopt this)

`src/utils/EditorFeatures.ts:41-180` defines a table `editorFeatures` with keys `transform-controls`, `widgets`, `picking`, `edit-mode`, `configurators`, `prompts`, `post-processing`, `path-tracing`, `physics`, `damping`; each is `{enable(viewer, key), disable(viewer, key)}` delegating to threepipe's **keyed** `plugin.enable(key)` / `plugin.disable(key)`. `post-processing` (L96-143) additionally registers a `viewer.addPluginListener('add', listener, ...pluginTypes)` so plugins added *later* are disabled too.

`class EditorFeatures` (L182-216) wraps it: `set/enable/disable/enableOnly(features, key)` and `refresh(mode)` which does `enableOnly(editorModesList[mode].features, 'EditorModes')`.

This is exactly the mechanism D4 in `00-synthesis.md` calls for ("object-mode plugins get `disable('editmode')` while editing"). It already exists in the editor, keyed by an arbitrary token, and the modelling plugin should drive it rather than reinvent it.

`src/components/EditorModes.tsx:37-159` — `editorModesList: Record<EditorModes, {label, icon, tag, uiConfig?, plugins?, features[]}>` with modes `buffers | postProcess | animation | extras | import | export | configurators`. Note L54-61: a `viewer` and an `edit` mode were commented out (`edit: {label: 'Edit Scene', plugins: EditModePlugin, features: ['widgets','post-processing','transform-controls','picking','configurators','edit-mode']}`) — so a top-level mode switch was prototyped and abandoned. `L195-212` builds the settings panel from `viewer.getPlugin(name).uiConfig` plus `getPluginsByTag(viewer, tag, 'EditorMode-')`, i.e. **a plugin can opt into a settings tab purely by declaring `static PluginTags = ['EditorMode-Extras']`** — a zero-code registration hook for our plugin's settings.

### 1.5 Plugin composition

`src/utils/ViewerInstanceManager.ts:_create()` (L200-400). `new ThreeViewer({container, debug:true, rgbm:false, msaa:true, zPrepass:false, renderScale:'auto', assetManager:{simpleCache:false, storage:false}, plugins: []})` at L209-226, then:

- L261 `viewer.addPluginSync(BlueprintJsUiPlugin2)`
- L262-266 globals: `EntityComponentPlugin.AddObjectUiConfig = false`, `ThreeViewer.Dialog = htmlDialogWrapper`, `GLTFLoader2._EmbedResourcePath = false`, `JSONMaterialLoader.FindExistingMaterial = false`, `KTX2LoadPlugin.SAVE_SOURCE_BLOBS = true`
- L268-337 `addPluginsSync([...])`: `PopmotionPlugin`, `new EntityComponentPlugin(false)`, `CanvasFileDropHandler`, `GLTFAnimationPlugin`, `new GBufferPlugin(HalfFloatType, true, true, true)`, `new PickingPlugin(undefined, false)` (second arg `false` = suppress built-in picking uiConfig), `new TransformControlsPlugin(true)`, `new EditorViewWidgetPlugin('bottom-right', 100)`, `CannonPhysicsPlugin`, KTX2/KTX/PLY/Rhino3dm/STL/USDZ loaders, `new Object3DWidgetsPlugin(true, true)`, `Object3DGeneratorPlugin`, `GeometryGeneratorPlugin`, `CanvasSnapshotPlugin`, `new GLTFMeshOptDecodePlugin(true, document.head)`, `new AssetExporterPlugin()`. Most post-processing plugins are commented out.
- L339-355 post-setup: `timeline.endTime = 0`, `picking.widgetEnabled = false`, `EditorViewWidgetPlugin.enabled = false`, `TransformControlsPlugin.selectionFilterTest = (obj) => isExternalObject(obj) ? null : obj`
- **L359 `viewer.addPluginSync(EditModePlugin)`** — added last, after the filter is installed.
- L384 `picking.picker.pickingMode = 'object'` ← the only place picking mode is set; our element picking would need `'element'`/`'mesh'`-style modes here.
- L1147 `mcpBridge: MCPBridgeClient | undefined`; L1299 `this.mcpBridge = this.loadedProject ? initMCPBridge({manager: this}) : undefined`.

### 1.6 Selection and hover

Everything goes through `PickingPlugin`:

- Write: `picking.setSelectedObject(obj)` (`src/components/BPGeometriesTreeComponent.tsx:61`, `src/utils/ViewerInstanceManager.ts:194`).
- Read: `picking.getSelectedObject()` (EditModePlugin, MCPBridgeHandler, PlayModeHelper, AssetsProvider, EditorCameraController).
- Listen: `picking.addEventListener('selectedObjectChanged', ...)` — `src/utils/AssetTracker.ts:125-158` (via `viewer.forPlugin(PickingPlugin, ...)`), `src/utils/AssetsProvider.ts:190`, `src/components/BPHierarchyComponent.tsx:274,303`, `BPMaterialsTreeComponent.tsx:154,184`, `BPGeometriesTreeComponent.tsx:101,131`, `FilesPanel.tsx:534`.
- The other direction uses threepipe's object-level `'select'` scene event: `src/components/BPHierarchyComponent.tsx:114,123`, `src/components/UseOnObjectCreate.tsx:62` (`obj.dispatchEvent({type:'select', value: obj, object: obj, ui: true, trackUndo: false})`), `src/utils/objectApplyCommands.tsx:30,38`, `BPMaterialsTreeComponent.tsx:103` (with `bubbleToObject`/`bubbleToParent`).
- React consumes selection via `useAssets().selectedInspectorItems` (`src/utils/AssetsProvider.ts`, subscribing to `selectedObjectChanged`), not by reading the plugin directly.

**No hover state is tracked or rendered anywhere in the editor.** There is no outline pass wired up (`OutlinePlugin` is commented out in `EditorFeatures`/`EditorModes`).

### 1.7 Tools / toolbars

- `src/components/InteractionControlsButtonGroup.tsx` (264 lines) — the viewport overlay toolbar. Toggles are `transform-controls`, `post-processing`, `widgets` (via `manager.features.set(key, value, 'InteractionControlsButtonGroup')`, L20-22), `grid` and `backgroundColor` (via `useReducer(editModePlugin.toggleGrid)` / `toggleBackgroundColor`, L27-28), a camera popover, a scene-override-material popover, and an "add object" popover hosting `Object3DGenerationMenu`. Whole bar hides when edit mode is off: `return !editEnabled ? null : (...)` at L91, where `editEnabled = useListenProperty(editModePlugin, 'isEnabled2', 'enableChanged')` (L25).
- `src/components/TransformControlsSettingsMenu.tsx` — mode (translate/rotate/scale), space (world/local), size ±0.1; driven off `TransformControls2` `mode-changed` / `space-changed` / `size-changed` events (L10-17). **There is no keyboard binding for gizmo mode in this editor** (unlike webgi-legacy, §3.2) — only this menu.
- `src/components/Object3DGenerationMenu.tsx` — wraps `Object3DGeneratorPlugin` (`manager.get().getPlugin(Object3DGeneratorPlugin)` at L115); the same generator backs the MCP `createObject` tool.
- `src/components/EditorModes.tsx:216-250` `EditorModesButtonGroup` — the settings-tab icon bar.
- `src/components/PlayModeButtonGroup.tsx`, `EditPreviewButtonGroup.tsx` — play/pause/stop, preview.

### 1.8 Undo

Central plugin is threepipe's `UndoManagerPlugin`. Wiring: `src/UiConfigRendererBlueprint2.tsx:98-114` does `viewer.getOrAddPluginSync(UndoManagerPlugin)` and assigns `this.undoManager = undo.undoManager` on the uiconfig renderer, so **every uiconfig property edit is undoable for free**. Direct uses:

- `EditModePlugin.ts:240-246, 280-286` — `performAction(undefined, fn, args, 'delete_object' | 'duplicate_object')`.
- `src/components/ObjectInspectorUI.tsx:340-345, 460+` — `performAction(ecs, ecs.addComponent, [object, type], 'addComponent')`.
- `src/utils/CanvasFileDropHandler.tsx:302-303, 503` — `undoManager.record(cmd)`.
- `src/components/UseOnObjectCreate.tsx:58` — object creation.
- `src/utils/ai/MCPBridgeHandler.ts:392-395` — `executeCommand` can call `.undo()`/`.redo()` (currently the `undo`/`redo` enum values are commented out of the tool schema, `MCPToolsResources.ts:272`).

There is **no per-tool / modal-operator undo grouping** anywhere, and no redo-panel concept.

### 1.9 Per-object property panels

`src/components/InspectorPanelComponent.tsx` + `src/components/ObjectInspectorUI.tsx`. The panel is a Blueprint `PanelStack2` (`ThreeEditorComponent.tsx:346-390`) rendering `ConfigObject config={...}` for, in order: `object.uiConfig` (L119-138), `objectGeometry.uiConfig` (L152-153), then each `material.uiConfig` (L201-206), then components' `comp.uiConfig` (L304-306) via `CompsSectionComp`/`AddCompComp`.

Geometry and material panels are gated by `isGeomEditable` / `isMatEditable` (`src/utils/three/assetEditorChecks.ts:5-27`) — an object is not editable if `userData.rootPath` starts with `assetUrlPrefix` (i.e. it belongs to a library asset) or if `userData.isPlaceholder`. Plus `isExternalObject()` (`src/utils/projectUtils.ts`) guards delete/duplicate and `TransformControlsPlugin.selectionFilterTest`. **Our edit-mode entry must respect the same guards** — you cannot enter edit mode on a linked-asset mesh without either breaking the link or editing the asset file itself.

`ConfigObjectGenerators` overrides registered at module scope (`ThreeEditorComponent.tsx:84-96`): `reference`, `image`, `hierarchy`, `materials`, `textures`, `tree`. **This is the extension point for any new uiConfig `type` the modelling plugin introduces** (e.g. a select-mode segmented control, an operator redo panel): register a React component under a new key in `ConfigObjectGenerators`.

### 1.10 Scene/asset system and scripting

- Asset model per `AssetSystem.md`; implementation in `src/utils/AssetTracker.ts`, `AssetsProvider.ts`, `FileTracker.ts`, `BrowserFileStore.ts`, `fsApi.ts`, `fsImporter.ts` (File System Access API + `public/fs-sw.js` service worker), `idb` for persistence, `backend/assets-proxy` (Cloudflare Worker) for remote assets.
- **Scripting is real ES modules, not eval.** `src/utils/ScriptUtil.ts` (852 lines) loads project `.script.js` / `.plugin.js` files from the user's local folder, rewrites their import specifiers and cache-busts them (`src/utils/modules.ts` `patchDeps`, regexes at L29-31), serves them through a service-worker-backed virtual FS (`src/utils/fsImporter.ts`), and `import()`s them. Bare specifiers resolve through a browser **import map** (`src/utils/importMaps.ts` `ImportMapsManager.addDependency`, esm.sh with `?external=` for already-mapped packages; `virtual:importmap` from `importmap-vite-plugin`). `src/import-map/threepipe.ts` is literally `export * from 'threepipe'; export const url = import.meta.url` — i.e. the editor's own threepipe bundle is exposed to user scripts under the bare specifier `threepipe`. Public API: `addPlugin/removePlugin/addComponent/removeComponent/loadProjectScript/loadProjectPlugin/loadProjectExtScript/scriptFilesChanged` with hot reload on file change.
- `src/utils/SandboxPlugin.ts` is fully commented out (L1-128); only `export interface SupPluginModule {__tpPluginPath?, __tpModuleError?}` remains. Its docstring says "added as `DynamicImportPlugin` to threepipe".
- **There is no console/REPL/eval feature in the editor.** No `eval(`, no `new Function`. The "run arbitrary code" path is writing a `.script.js` file on disk, which the editor hot-reloads. This is the maintainer's stated preference (typed API over an MCP rabbit hole) already realised for components.

### 1.11 The MCP bridge

Three pieces:

**(a) `scripts/mcp-bridge-server.mjs` (257 lines)** — the MCP server proper. `new Server({name:'kite3d-dev-mcp', version:'1.0.0'}, {capabilities:{tools:{listChanged:true}, resources:{listChanged:true}}})` (L83-90). Handlers:

```js
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools.value }));          // L92
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {                                // L94
    const { name, arguments: args } = request.params;
    const result = await executeTool(name, args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: mcpResources.value })); // L102
```

Transports: stdio (default), `--http` StreamableHTTP on `--mcp-port` (default 3849, marked "NOT TESTED", L192-226), `--test` interactive REPL that types `createObject {"type":"box"}` straight at the editor (L141-190).

**(b) `scripts/mcp-bridge-common.mjs` (357 lines)** — the WebSocket side. `WebSocketServer({port: 3848})` (L186, `DEFAULT_WS_PORT = 3848`, env `MCP_BRIDGE_WS_PORT`). On editor connect it sends `{type:'request', action:'getState'}` and `{type:'request', action:'getToolsAndResources'}` (L202-236) and **populates `mcpTools.value` / `mcpResources.value` from the editor's reply**, then fires `mcpServer.sendToolListChanged()`. `requestFromEditor(action, params, timeout=30000)` (L271-305) is a JSON-RPC-ish correlation table keyed by `requestId`. `executeTool(name, args)` is one line: `return await requestFromEditor(name, args)` (L317). `readResource(uri)` maps `kite3d://scene/hierarchy` → `getSceneHierarchy`, `kite3d://editor/state` → `getEditorState` (L333-339). The commented-out HTTP `/health` + `/status` server is at L53-127.

> **The Node process contains no domain logic at all.** Tool names, schemas, descriptions and implementations all live in the browser. The bridge is already the thin wrapper the maintainer wants — it just currently wraps a hand-written ad-hoc handler instead of a typed API.

**(c) Browser side, `src/utils/ai/`**

- `MCPBridgeClient.ts` (215 lines) — `WebSocket` to `ws://localhost:3848`, auto-reconnect every 3 s, `BridgeMessage = {type: 'request'|'response'|'error'|'stateUpdate'|'event', requestId?, action?, params?, data?, error?, state?, event?}` (L8-17), `RequestHandler = (action, params) => Promise<unknown>` (L19), `setRequestHandler`, `sendStateUpdate`, `sendEvent`.
- `MCPToolsResources.ts` (358 lines) — **hand-written JSON Schema literals**, `export const mcpTools = [...]` and `export const mcpResources = [...]`. Tool list (name → required args):
  `getSceneHierarchy {maxDepth?, skipBones?, skipTypes?}`, `getSelectedObjects {}`, `selectObject {identifier}`, `createObject {type, name?, position?, parentUuid?, + ~20 flat geometry/light/camera params}` (enum of 17 types: `geometry-plane|sphere|box|circle|torus|cylinder|text|line`, `object-empty|group`, `camera-perspective|orthographic`, `light-point|ambient|directional|spot|hemisphere|rect-area`, `troika-text-plane`), `deleteObject {uuid}`, `modifyObject {identifier, properties}`, `duplicateObject {uuid}`, `setObjectParent {identifier, parentIdentifier?, keepWorldTransform?}`, `getObjectDetails {identifier, includeChildren?}`, `findObjects {namePattern?, type?, hasComponent?}`, `addComponent {objectIdentifier, componentType, properties?}`, `removeComponent {objectIdentifier, componentIdentifier}`, `getAvailableComponents {}`, `executeCommand {command: play|stop|pause}` (undo/redo commented out at L272), `getMaterials {}`, `getTextures {}`, `showToast {message, type?}`, `getEditorState {}`, `focusObject {uuid?, padding?, duration?}`, `refreshPackageJson {}`, `saveOpenedFile {}`. Resources: `kite3d://scene/hierarchy`, `kite3d://editor/state`.
  (Note `packages/mcp-bridge/README.md` also advertises `getProjectInfo`, which does not exist in `mcpTools` — the README has drifted.)
- `MCPBridgeHandler.ts` (711 lines) — `createMCPBridgeHandler({manager})` returns one big `switch (action)`. Helpers at L35-99: `getViewer/getScene/getPicking/getEntityComponent`, `findObject(identifier)` (name **or** uuid), `serializeObject(obj, includeChildren, options)`. Cases mirror the tool list; notable ones: `createObject` calls `generator.generate(type, {...params, type: undefined}, false, false)` (L190), `duplicateObject` calls `iObjectCommons.duplicateObject(obj, {shiftKey:true})` then hunts for the clone by `userData.cloneParent` (L505-530), `executeCommand` reaches `viewer.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')?.undo?.()` (L392). `initMCPBridge(options)` at L674-711 constructs the client, sets the handler, connects.
  **Notably absent: `addComponent` and `modifyObject` do not push undo entries.** Agent edits are not undoable.
- `ChatHistoryManager.ts` (165 lines) + `src/components/AIAgentTab.tsx` (314 lines, currently commented out of the layout at `ThreeEditorComponent.tsx:315-323`) — an in-editor chat agent that was built and then disabled.
- `src/components/AIMCPTab.tsx` (274 lines) — the live "AI MCP Bridge" right-hand tab: port field (default `3848`), Connect/Disconnect, polls `mcpBridge.isConnected` every 500 ms.

**(d) `packages/mcp-bridge/`** — published as `@kite3d/mcp-bridge` (v0.0.3-dev.1, MIT, bin `kite3d-mcp-bridge`). Built by `npm run build:mcp`: `esbuild scripts/mcp-bridge-server.mjs --bundle --outfile=packages/mcp-bridge/bridge-server.js --platform=node --format=esm --sourcemap --external:@modelcontextprotocol/sdk --external:ws --external:node:* --packages=external`. README documents the Claude Desktop `mcpServers` config.

### 1.12 Tests

`playwright.config.ts` — `testDir: './tests'`, one chromium project, `baseURL: http://localhost:5173`, `webServer: npm run dev`. Two specs, both about **AI-facing scene serialisation, not the editor UI**: `tests/editor-structure.spec.ts` and `tests/format-comparison.spec.ts`, running against `tests/test-page.html` (a bare ThreeViewer harness exposing `window.testViewer`). They snapshot `getSceneStructureMd(viewer, format)` from `src/utils/three/EditorStructure.ts` (442 lines) into `tests/__snapshots__/` for five formats — `markdown-v2` (default), `json`, `xml`, `compact`, `markdown` — with UUID normalisation and a ±10% size-regression warning (`tests/__snapshots__/format-sizes.json`). The file's docblock (L5-77) is a long argument about token efficiency for LLM consumption.

**There are no tests of selection, gizmos, keymap, undo, or any editor interaction.**

### 1.13 Other things found

- `src/utils/three/materials/GridMaterial.ts` exists (an infinite-grid shader material) but `EditModePlugin` uses `GridHelper` instead — the `GridMaterial` path is commented out at `EditModePlugin.ts:59`. Relevant if we want a proper Blender-style adaptive grid + floor axes.
- `src/utils/three/` also has `EditorCameraController.ts` (WASD fly + focus), `LightMaterialOverrider.ts`, `OverrideLightingPresets.ts`, `GeneratePreview.ts`, `filterObjectsInSceneRoot.ts`, and override materials `MeshMaterialIdOverride.ts` / `MeshBasicMaterialOverride.ts` / `MeshNormalMaterialWorldOverride.ts` / `MeshUVOverride.ts`. **`MeshMaterialIdOverride` is an id-buffer override material** — the nearest existing thing to the select-id render target we want for element picking and box select.
- `backend/` holds two Cloudflare Workers (`assets-proxy`, `kite3d-landing`); `public/player.html` + `src/player.ts` are the standalone runtime player.

---

## 2. `experiments/shader-flow-editor/` — node graph prior art (brief)

"shaders.app", v0.26.0, private. CRA 5 + **craco** (`craco.config.js` adds a `.glsl` loader); `src-tb/` is a second CRA entry (swapped by an entry-string replace in `craco.config.tb.js:4`) for a "table builder" experiment exposing a `postMessage` API (`src-tb/NodeEditorApi.ts:15-60`).

- **Stack: React Flow v11** (`reactflow@^11.7.2`). Entry `src/Flow.tsx:293-380`; `nodeTypes`/`edgeTypes` at `:54`; `isValidConnection` at `:314`; `deleteKeyCode={null}` at `:378`. Graph state is held in a React context (`src/contexts/FlowContext.ts:13-30`, `useSetupFlow` `:64-110`), not RF's store. A v11→v12 upgrade is scoped in `issues/open/reactflow-12-upgrade.md`.
- **Node data are class instances, not POJOs**: `BaseNodeData extends SimpleEventDispatcher` with threepipe `@serialize()` decorators and `toJSON`/`fromJSON` (`src/nodes/data/BaseNodeData.tsx:45-137`). Sockets are `NodeConnectionSlot {name, dataType, getValue/setValue, onChange[], defaultValue, maxInputs, data.schema}` (`src/nodes/data/NodeData.ts:66-145`) bound by accessor to live three.js objects; socket type table `ConnectionValueType` at `NodeData.ts:22-44`; legality in `src/utils/IsValidConnection.ts:8-58` (handle ids string-encoded `"<type>Out_<name>"`). Node registry: `NodeType = {label, create, Component, renderer}` in `src/NodeTypes.ts:23-52`, table `NodeTypeDefs` in `src/NodeTypeDefs.ts:114+`.
- **Evaluation is pull-based per frame, with no topological sort and no compiler** (`src/utils/plugins/flowRendererPlugin1.ts:82-110`, `src/utils/renderers/pass.ts:111-230`). GLSL is assembled by `#include` substitution with uniform-derived dynamic slots (`src/passes/NodeShaderPassBase.ts:120,182-360`); real codegen exists only for math nodes (`src/utils/cortex/compileGlsl.ts`). A modelling graph should not copy this — it wants a cached, topologically sorted, dirty-propagating DAG.
- **Undo/redo: none at all** (grep-verified; `issues/open/app-undo-redo-missing.md` proposes threepipe's `JSUndoManager` + a command stack). Autosave into an IDB `projects_versions` store is the only safety net (`src/utils/idb.tsx:24-105`).
- threepipe integration is deep: the runtime is a plugin chain `FlowRendererPlugin1 → FlowViewportRendererPlugin1 → FlowProjectPlugin1`, with `ThreeSerialization` + `@serialize()` for project files (`flowRendererPlugin1.ts:241-281`). Runtime `threepipe@0.0.40` vs types pointed at the parent repo (`tsconfig.json:20`) — a stalled 0.5.x migration (`issues/open/threepipe-0.5x-migration.md`). threepipe exposes **no `./graph` export today** (`package.json` exports are `.`, `./dist`, `./lib`, `./src/`).
- **Two directly reusable patterns for a future geometry-nodes UI**: (a) `src/nodes/data/GeometryNodeData.tsx:137-181` already derives one numeric socket per `GeometryGeneratorPlugin` parameter and re-runs `plugin.updateGeometry` on change — Blender-ish parametric nodes over threepipe generators; (b) `src/nodes/data/JSONSchemaNodeData.tsx:155-340` generates sockets *and* UI from a JSON Schema with schema-compatibility edge validation (`src/utils/CompareSchemas.ts`), and `src/utils/json-schema/generator/` derives those schemas from TS types via `ts-json-schema-generator`. That last pipeline (TS types → JSON Schema → sockets/UI/agent tool schema) is exactly the shape we want for the op-definition table.
- `issues/open/` is a 115-file audit (index `BACKLOG.md`) with nothing about geometry nodes as a feature; `issues/open/nodes-ui-reactivity-architecture.md` is a useful "don't do this" (four competing reactivity mechanisms + a full-card remount hack).

---

## 3. The other experiment folders

### 3.1 `experiments/threepipe-webgi/` — partially relevant

Source repo of the published `@threepipe/webgi-plugins` (v0.6.4; GPL-3.0-modified with a paid tier; webgi.dev). Targets `threepipe >= 0.4.0` peer, `0.4.2` devDep; last commit 2026-03-30. `src/` is all render pipeline: `plugins/postprocessing/` (Bloom, DoF, SSGI, SSReflection, SSContactShadows, TemporalAA, **Outline**), `plugins/buffer/VelocityBufferPlugin`, `plugins/extras/` (Anisotropy, AdvancedGround, WatchHands). Two things matter to us: `src/plugins/postprocessing/OutlinePlugin.ts` — the reference for "render a selection highlight driven by `PickingPlugin`" (`dependencies = [PickingPlugin, GBufferPlugin]`, listens to `selectedObjectChanged`, multi-object arrays, `enableDynamicSelection`, patches the `ScreenPass` material) — which is the obvious basis for edit-mode element highlight; and `examples/tweakpane-editor/ThreeEditor.ts`, a viewer subclass composing threepipe's editor-ish plugins. Also a clean template for how a separate threepipe plugin package is structured (vite lib + `lib/` tsc build + typedoc `docs/` + vitepress `website/` + per-plugin `examples/<name>/script.ts`) — worth mirroring for the modelling packages.

### 3.2 `experiments/webgi-legacy-src/` — **the most valuable folder here**

A raw copy of the legacy pre-threepipe WebGi TS tree (no package.json; `webgi/...` absolute specifiers; `interfaces.ts` at the root defines `IModel`/`IWidget`/`UiObjectConfig`). It is the ancestor of threepipe's editor plugins and contains several things threepipe core dropped:

- **Picking/selection**: `extras/interaction/ObjectPicker.ts` (raycaster, pointer down/up time+distance click discrimination, hover, Shift/Ctrl multi-select, `selectionCondition` predicate, `extraObjects` for widget roots), `extras/interaction/PickingPlugin.ts` (`selectAll` / `clearSelection` / `toggleSelectedObject`, widget attach/detach, `getRootIfWidget`, auto-focus, pushes selected object's `uiConfig` into the UI tree), `SelectionWidget.ts` / `BoxSelectionWidget.ts` / `SphereSelectionWidget.ts` / `AHelperWidget.ts`.
- **Gizmos and the keymap conflict**: `helpers/threejs/TransformControls2.ts` binds `window` keydown/keyup in its constructor (L127-130, disposed L133-136) and handles (verified by reading L25-70): `KeyQ` → toggle local/world space, `ShiftLeft` → snapping (`translationSnap 0.5`, `rotationSnap 15°`, `scaleSnap 0.25`), **`KeyW` → translate, `KeyE` → rotate, `KeyR` → scale**, `Equal/NumpadAdd/Plus` and `Minus/NumpadSubtract/Underscore` → gizmo size ±0.1, `KeyX`/`KeyY`/`KeyZ` → toggle `showX/showY/showZ`. That is a **Unity-style** keymap; Blender's is `G/R/S` with `X/Y/Z` as *axis constraints*. In threepipe 0.5.1 this same keymap has moved up into `TransformControlsPlugin` + a shared handler — see §4(d), which supersedes this paragraph for current-day conflicts.
- **A real modal sub-tool**: `plugins/PivotEditPlugin.ts` — `P` enters pivot-edit mode, `Escape` exits (L141-146), spawns a pickable pivot marker, snaps the pivot to clicked surface points / bbox centre, and records undo per move (`_recordUndo` L371-385, `undoManager` sourced from `TweakpaneUiPlugin` at L96-97). `00-synthesis.md` already names `PivotEditPlugin` as the secondary-mode template; this is its origin and it is worth re-reading in full before designing the modal-tool state machine.
- **Multi-select transforms**: `plugins/MultiSelectHelper.ts` (temporary common parent + combined undo record); `plugins/TransformControlsPlugin.ts` (disables the picking bbox widget while dragging).
- **Undo**: no dedicated plugin — `JSUndoManager` owned by `ui/TweakpaneWrapper.ts` with `bindHotKeys: true, limit: 100`, `{undo, redo}` command objects recorded from `ui/tpGenerators.ts`, `ui/tpImageGenerator.ts`, `core/threejs/objectUiConfig.ts`, `plugins/HierarchyUiPlugin.ts`, `PivotControlsPlugin.ts`, `PivotEditPlugin.ts`, `MultiSelectHelper.ts`. (threepipe's `UndoManagerPlugin` is the descendant.)
- **Keyboard handling**: ad-hoc per-plugin `window.addEventListener('keydown', ...)` with inline INPUT/TEXTAREA guards — the same pattern threepipe 0.5.1 still uses. **No central keymap or shortcut registry exists anywhere in any of these codebases** — confirming D4's "central mode-aware keymap" is genuinely new work, not a re-implementation.
- **Editor shell / modes**: `extras/viewer/CoreEditorApp.ts` (composes ~80 plugins), `ui/modesUi.ts` + `ui/editorModes.css` — a mode button bar where each "mode" is a named set of plugin classes (`setupModesUi(viewer, plugins, modes: {title, plugins, div?}[])`, with tippy tooltips). Same *workspace-mode* concept as `EditorModes.tsx`, not Blender modes.
- **Geometry ops (whole-mesh, no kernel)**: `plugins/CSGPluginBase.ts` / `CSGPluginBSP.ts` / `CSGPluginBVH.ts` (booleans off the picking selection), `plugins/GeometryGeneratorPlugin.ts` + `plugins/geometryGenerators/*` + `helpers/threejs/AGeometryGenerator.ts` (parametric primitives with live uiConfig regeneration), `SimplifyModifierPlugin.ts`, `MeshOptSimplifyModifierPlugin.ts`, `SSBevelPlugin.ts` (screen-space, not a real bevel), `ShapeTubeExtrudePlugin.ts`, `AutoUVMappingPlugin.ts` / `TriplanarUVMappingPlugin.ts` / `XAtlasPlugin.ts`, `helpers/threejs/geometryUtils.ts` (`fixGeometryEdgeNormals`, precision-based vertex welding — closest thing to kernel utility code), `helpers/threejs/snapObject.ts`, `helpers/removeDuplicateGeometries.ts`.
- **No scripting/console/eval API** anywhere in the tree.

### 3.3 `experiments/tweakpane-image-plugin/` — effectively irrelevant

A vendored fork of the MIT `tweakpane-image-plugin` v1.1.405 (Tweakpane **3** API, `pane.addInput`), an image-thumbnail input widget (`src/plugin.ts`, `controller.ts`, `view.ts`, `model.ts`, `sass/plugin.scss`). Only relevant if we ever need to author custom Tweakpane input views for edit-mode panels; note threepipe is on Tweakpane 4 (`addBinding`), so the API shown is outdated.

### 3.4 `experiments/tp-cf-test/` — relevant to Node-safe packaging

A Cloudflare Workers scratch project (`wrangler` v4, `@cloudflare/vitest-pool-workers`, `threepipe: "file:./../../"`) testing headless threepipe in a V8 isolate with no DOM. The artifact that matters is **`src/polyfill.ts`** — a hand-written minimal DOM shim (`ImageData`, `HTMLElement` with classList/style/children/appendChild/addEventListener/dispatchEvent/ownerDocument, `HTMLDocument` with createElement/createElementNS/getElementById/querySelector, `HTMLCanvasElement`, `HTMLImageElement`) sufficient to module-load three.js/threepipe and construct `new ThreeViewer({rmClass: DummyRenderManager})`. `src/index.ts` currently exercises `@gltf-transform` passes (dedup/weld/join/instance/palette/simplify/prune/quantize/draco/meshopt/textureCompress) with a WASM Draco encoder via `instantiateWasm`; the threepipe path is commented out with the note that it "works fine with polyfill". Directly useful as the precedent for running the mesh kernel and the scripting API headless (Node, workers, CI fixtures, an agent backend) — it enumerates exactly which globals must be stubbed.

### 3.5 `experiments/note-test/test1.js` — irrelevant

Three lines: stub `global.ImageData = class ImageData {}`, `import {ThreeViewer} from './../../dist/index.mjs'`, `console.log(ThreeViewer)`. The crudest version of the tp-cf-test question; confirms `ImageData` is the single module-level global that blocks a Node import of threepipe today (matching `research-threepipe.md`'s note on `constants.ts:3`).

---

## 4. Implications for the modelling plugin

### (a) Concepts and names to align with

1. **Do not name our plugin `EditModePlugin`.** That `PluginType` string is taken by `experiments/threepipe-blueprint-editor/src/utils/EditModePlugin.ts:39` and means "editor viewport mode". Two plugins with the same `PluginType` cannot coexist on one viewer (`viewer.getPlugin(type)` is keyed by it), and the editor adds it unconditionally at `ViewerInstanceManager.ts:359`. Proposed: **`MeshEditPlugin`** (`PluginType = 'MeshEditPlugin'`) for the Blender-style edit mode, in package `plugins/modelling`; kernel package stays UI-free. If we prefer the word "mode", `ObjectModePlugin` / `MeshEditModePlugin` are unambiguous. Whatever we pick, write it down before M4 so the editor can be updated in the same pass.
2. **Adopt the keyed `enable(key)` / `disable(key)` discipline** already used by `EditorFeatures` (`src/utils/EditorFeatures.ts:41-180`). Entering mesh-edit mode should `disable('meshEdit')` on `TransformControlsPlugin`, `Object3DWidgetsPlugin`, `EditorViewWidgetPlugin` (etc.) and restore on exit — never assign `enabled = false`, which would clobber the editor's own bookkeeping.
3. **Mirror `EditModePlugin`'s event/accessor shape** so the React layer can bind without new plumbing: an `enableChanged`-style event plus a plain boolean getter (the editor's `useListenProperty(plugin, 'isEnabled2', 'enableChanged')` pattern, `InteractionControlsButtonGroup.tsx:25`), and reducer-shaped `(current, next) => next` toggles like `toggleGrid` (`EditModePlugin.ts:505`) for anything the toolbar drives.
4. **Reuse `assetUrlPrefix` / `isGeomEditable` / `isExternalObject` semantics.** Entering edit mode on a linked-asset mesh must be blocked or must route through "edit the asset file", exactly as the geometry inspector panel is gated (`src/utils/three/assetEditorChecks.ts:13-20`).
5. `MeshMaterialIdOverride` (`src/utils/three/materials/MeshMaterialIdOverride.ts`) and `GridMaterial.ts` already exist in the editor; the select-id buffer and the adaptive grid should build on / replace them rather than duplicate.

### (b) What the Blueprint editor will need from us

1. **A mode signal**: `meshEdit.addEventListener('modeChanged'|'enableChanged')` + `isEditing: boolean` + `editObject: IObject3D | null`, so `InteractionControlsButtonGroup` can swap its toolbar and `EditorModes` can swap the settings panel.
2. **Toolbar/menu registration**: today the toolbar is hand-written JSX. Cheapest path that needs no editor change is `static PluginTags = ['EditorMode-Extras']` (consumed at `EditorModes.tsx:207` via `getPluginsByTag(viewer, tag, 'EditorMode-')`) so our plugin's `uiConfig` appears in a settings tab for free. For the viewport toolbar we should expose a declarative descriptor (`{id, label, icon, active, onClick, submenu}`) the editor can map to `InteractionIconButton`, rather than requiring the editor to know each tool.
3. **New uiConfig types**: register React renderers through `ConfigObjectGenerators` (`ThreeEditorComponent.tsx:84-96`) for (i) the select-mode segmented control (vert/edge/face), (ii) the operator redo panel (live props of the last operator), (iii) a mesh-stats/`validate()` readout. So our uiConfigs should use a small number of **new `type` strings** with well-documented data shapes, not bespoke DOM.
4. **Keymap registration API**, not `window` listeners. `EditModePlugin.keyListeners` (`:216-290`) is the existing shape (`{keys[], metaKey?, ctrlKey?, shiftKey?, altKey?, onDown?, onUp?}`) and the existing dispatcher already has the INPUT/TEXTAREA guard. The central keymap plugin from D4 should generalise exactly this: add a `mode` field, make unspecified modifiers mean "must be absent" (the current wildcard behaviour is a latent bug — `f` fires with Ctrl held), and let plugins register/unregister sets.
5. **Undo integration**: keep using `UndoManagerPlugin.record({undo, redo})` / `performAction(...)` so the editor's Cmd+Z keeps working unchanged. One record per committed operator (not per drag frame).
6. **Element-level selection events** distinct from `selectedObjectChanged`. The hierarchy/material/geometry trees all listen to `selectedObjectChanged` and will misbehave if we reuse it for sub-object selection — see (d).
7. **Geometry replacement contract**: the editor's asset tracker listens for `replaceItem` (`ViewerInstanceManager.ts:191-198`) and refreshes previews on `registryChanged`. Baking a new `BufferGeometry` onto `mesh.geometry` must go through the normal accessor + `setDirty({refreshScene:false})` so previews and the geometries tab stay correct.

### (c) The scripting API vs the MCP bridge

The maintainer's instinct is already borne out by the code: **the bridge is a dumb relay** (`scripts/mcp-bridge-common.mjs:317` is literally `return await requestFromEditor(name, args)`), while both the tool *schemas* (`MCPToolsResources.ts`, hand-written JSON Schema) and the tool *implementations* (`MCPBridgeHandler.ts`, a 711-line `switch`) live in the browser and duplicate each other. Concretely:

1. **Make the typed TS API the single source of truth** and emit the MCP tool list from the same op-definition table that `00-synthesis.md` §3.3 already proposes (the `bmesh_opdefines.cc` port). One table → TS types, runtime validation, docs, and `{name, description, inputSchema}` JSON Schema. The precedent for TS types → JSON Schema already exists in `shader-flow-editor/src/utils/json-schema/generator/` (`ts-json-schema-generator`), and `zod` is already a dependency of the editor if we prefer schema-first.
2. **Then `getToolsAndResources` becomes generated, not authored.** The handshake at `mcp-bridge-common.mjs:208-236` asks the editor for its tool list at connect time and calls `sendToolListChanged()` — so a dynamic, generated list (which can grow when the modelling plugin is added, and shrink when it isn't) is already supported end-to-end. No bridge changes needed.
3. **Keep the transport but shrink the handler to a dispatcher**: `handler(action, params)` should resolve `action` in a registry of API functions and call it, instead of a `switch`. The existing `RequestHandler = (action, params) => Promise<unknown>` signature (`MCPBridgeClient.ts:19`) already fits.
4. **Fix what the current surface gets wrong**, in our API design: (i) `findObject(identifier)` accepts *name or uuid* (`MCPBridgeHandler.ts:40-52`) which is ambiguous — Onshape-style queries / build123d selectors (already recommended in `00-synthesis.md` §3.4) are the answer; (ii) agent mutations (`modifyObject`, `addComponent`, `setObjectParent`) **do not record undo** — every API mutation must, since the same functions will back the UI; (iii) `createObject` flattens ~20 unrelated geometry/light/camera params into one schema — our op table's per-op typed slots fix this by construction; (iv) errors are returned as `{error: string}` strings, losing structure — return typed results with warnings (`00-synthesis.md` §3.4 "warnings instead of throwing").
5. **Scripting, not eval.** The editor's existing escape hatch is writing `.script.js` files that are hot-loaded as real ES modules through an import map (`ScriptUtil.ts`, `modules.ts`, `importMaps.ts`, `src/import-map/threepipe.ts`). That is the right home for user modelling scripts too: publish the kernel under a bare specifier in the import map, and the same `AGENTS.md`-style doc (`src/data/AgentsMdTemplate.md`) documents it. We should **not** add an `eval`/console tool — BlenderMCP's arbitrary-code escape hatch is already called out as the anti-pattern in `00-synthesis.md` §2.4, and nothing in this codebase has one.
6. **Node-safe from day one** so the API can be driven headless: `experiments/tp-cf-test/src/polyfill.ts` enumerates the required globals, and `note-test/test1.js` confirms `ImageData` is the one module-level blocker in threepipe today (D4's lazy-`Dialog` change covers the rest).

### (d) Conflicts to avoid

**The keymap situation is worse than `00-synthesis.md` §2.1 records.** Verified by reading threepipe 0.5.1 on this branch, there are already **three** `window`-level keydown handlers with no mode awareness between them:

| Source | File / lines | Keys |
| --- | --- | --- |
| `PickingPlugin._onKeyDown` | `src/plugins/interaction/PickingPlugin.ts:198-234` (bound `:545`, removed `:572`) | `Ctrl/Cmd+A` select all, `Ctrl/Cmd+D` duplicate (`Shift` flips simple/compound), `Ctrl/Cmd+C` copy, `Ctrl/Cmd+X` cut, `Ctrl/Cmd+V` paste, **`Escape` clear selection**, **`Delete`/`Backspace` delete selected**, **`H`** toggle visibility / `Shift+H` unhide all, **`F`** focus selected, **`Alt+G`/`Alt+R`/`Alt+S`** reset position/rotation/scale |
| `TransformControlsPlugin._keyDownListener` | `src/plugins/interaction/TransformControlsPlugin.ts:225-255`, keyup `:257-281` | **`W`** translate, **`E`** rotate, **`R`** scale, `Shift` (either) → snapping on, keyup → off |
| `handleGizmoKeyDown` (shared, also used by pivot controls) | `src/three/controls/gizmoKeyboardHandler.ts:6-44` | **`Q`** toggle local/world space, `Equal`/`NumpadAdd` and `Minus`/`NumpadSubtract` gizmo size ±0.1, **`X`/`Y`/`Z`** toggle gizmo axis handle visibility, **`Space`** toggle gizmo enabled |

All three guard only on `TEXTAREA`/`INPUT` targets and (for the gizmo ones) bail on `metaKey||ctrlKey`. `PickingPlugin` additionally respects `isDisabled()`; `TransformControlsPlugin` respects `enabled`.

| Conflict | Where | Mitigation |
| --- | --- | --- |
| `PluginType = 'EditModePlugin'` | `blueprint-editor/src/utils/EditModePlugin.ts:39` (no such plugin in threepipe core — verified) | name ours `MeshEditPlugin`/`MeshEditModePlugin` |
| **`X`/`Y`/`Z` toggle gizmo handle visibility** vs Blender's **axis constraint** during a modal transform | `gizmoKeyboardHandler.ts:30-38` | hard conflict. `TransformControlsPlugin` must be `disable('meshEdit')`d on entering edit mode; the central keymap must own `X/Y/Z` while a modal tool is running |
| **`R` = scale**, **`E` = rotate**, **`W` = translate** vs Blender **`R` = rotate**, **`E` = extrude**, **`G` = grab** | `TransformControlsPlugin.ts:249-251` | `G` and `S` are free; `R` and `E` must be re-bound per mode. Decide whether object mode keeps W/E/R (recommended: yes, don't break existing users) and edit mode uses G/R/S/E |
| **`F` = focus selected** vs Blender `F` = make edge/face | `PickingPlugin.ts:227-229` (and `blueprint-editor/src/utils/EditModePlugin.ts:251-264` binds `f` a second time) | mode-scope. Note `F` is currently handled **twice** in the editor — once by core picking, once by the editor plugin |
| **`Delete`/`Backspace` = delete object** vs Blender's delete-element menu | `PickingPlugin.ts:220-222`; again at `EditModePlugin.ts:226-249` | mode-scope; in edit mode these must delete elements, not the object |
| **`Escape` = clear selection** vs Blender `Escape` = cancel the running modal operator | `PickingPlugin.ts:218-219` | the modal-tool state machine must consume `Escape` first (capture phase or an explicit "modal owns input" flag) |
| **`Space` = toggle gizmo enabled** vs Blender `Space` = play / search menu | `gizmoKeyboardHandler.ts:39-41` | low priority, but mode-scope it |
| **`H` / `Shift+H`** hide semantics differ from Blender (`H` hide, `Shift+H` hide unselected, `Alt+H` unhide) | `PickingPlugin.ts:223-226` | align the edit-mode bindings with Blender; leave object mode alone |
| `Ctrl/Cmd+D` duplicate (core) and `Cmd+D` duplicate (editor) vs Blender `Shift+D` | `PickingPlugin.ts:205-207`, `EditModePlugin.ts:266-289` | duplicated binding again; edit mode should use `Shift+D` |
| `Alt+G`/`Alt+R`/`Alt+S` = reset position/rotation/scale | `PickingPlugin.ts:230-233` | **matches Blender** (clear location/rotation/scale) — verified, keep as-is |
| `p` = pivot-edit mode | `webgi-legacy-src/plugins/PivotEditPlugin.ts:141`; `PivotEditPlugin` exists in threepipe core | Blender `P` = separate. Mode-scope it |
| Free in both today (safe to claim for edit mode): `Tab`, `1`/`2`/`3`, `G`, `S`, `I`, `K`, `M`, `B`, `L`, `A` (unmodified), `Ctrl+R`, `Ctrl+B` | — | confirm again at implementation time |
| `Cmd+S` and pane shortcuts bound on `window` by the React shell | `blueprint-editor/src/components/SaveFileButton.tsx:21,97`, `WindowPanesLayout.tsx:72` (capture phase) | the keymap plugin must not swallow these; keep the INPUT/TEXTAREA guard and add a "editor chrome owns Cmd+*" rule |
| Modifier wildcarding: `kl.metaKey === undefined` means "don't care" | `EditModePlugin.ts:304-307` | our keymap must treat unspecified modifiers as "must be absent", or `G` will fire on `Cmd+G` |
| Reusing `PickingPlugin`'s `selectedObjectChanged` for element selection | 6 listeners across hierarchy/materials/geometries/files/asset-tracker/`AssetsProvider` (see §1.6) | emit a **separate** event (e.g. `elementSelectionChanged`) from the mesh-edit plugin; leave object selection frozen on the edit object while in edit mode |
| Reusing the object-level `'select'` scene event for elements | `objectApplyCommands.tsx:30,38`, `BPHierarchyComponent.tsx:114`, `UseOnObjectCreate.tsx:62` — it bubbles (`bubbleToParent`, `bubbleToObject`) | same: don't overload it |
| `picker.pickingMode = 'object'` is set once, globally | `ViewerInstanceManager.ts:384` | if we add element picking modes to the core picker, changing the mode must be scoped/restored, not left set |
| Editor targets threepipe **0.4.3**, repo is **0.5.1** | `blueprint-editor/package-lock.json` | the editor will need a 0.5.x bump before it can consume the modelling plugin; flag as a prerequisite, not a blocker for M1-M3 |
| `packages/mcp-bridge/README.md` advertises `getProjectInfo`, which is not in `mcpTools` | doc drift | when we generate the tool list, generate the README section too |

---

## 5. Suggested follow-ups (not done here)

- Re-read `webgi-legacy-src/plugins/PivotEditPlugin.ts` and `MultiSelectHelper.ts` end-to-end when designing the modal-tool state machine (M4) — they are the closest existing modal-tool + multi-select-undo implementations in the family.
- Decide the plugin name before M4 and record it in `00-synthesis.md` §4 as D7a, since the editor must be patched in lockstep.
- Add "generate MCP tool schemas from the op table" as an explicit deliverable of M0 (op-definition table), so the bridge never grows a second hand-written schema list.
- `uiconfig-blueprint` is not in `experiments/` — if we need new uiConfig `type`s rendered in the editor, that repo has to be located and extended too.
