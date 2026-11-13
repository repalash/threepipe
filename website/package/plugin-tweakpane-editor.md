---
prev: 
    text: '@threepipe/plugin-blueprintjs'
    link: './plugin-blueprintjs'

next: 
    text: '@threepipe/plugin-configurator'
    link: './plugin-configurator'

---

# @threepipe/plugin-tweakpane-editor

Tweakpane Editor Plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tweakpane-editor/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/TweakpaneEditorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/TweakpaneEditorPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-tweakpane-editor.svg)](https://www.npmjs.com/package/@threepipe/plugin-tweakpane-editor)

```bash
npm install @threepipe/plugin-tweakpane-editor
```

`TweakpaneEditorPlugin` uses `TweakpaneUiPlugin` and other custom ui to create an editor for editing viewer, plugins, model and material configurations in the browser.

```typescript
import {IObject3D, ThreeViewer, TonemapPlugin} from 'threepipe'
import {TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(new TweakpaneUiPlugin(true))
// TweakpaneEditorPlugin.DefaultLayout = 'classic' // before the plugin is made: the layout when none is stored
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

// Add some plugins to the viewer
await viewer.addPlugins([
    new ViewerUiConfigPlugin(),
    // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
    new DepthBufferPlugin(HalfFloatType, true, true),
    new NormalBufferPlugin(HalfFloatType, false),
    new RenderTargetPreviewPlugin(false),
])

// Load the plugin UI in the editor and tweakpane ui with categories.
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin, SceneUiConfigPlugin, DropzonePlugin, FullScreenPlugin],
    ['GBuffer']: [DepthBufferPlugin, NormalBufferPlugin],
    ['Post-processing']: [TonemapPlugin],
    ['Debug']: [RenderTargetPreviewPlugin],
})
```

## Page layout, frame and mode bar

`TweakpaneEditorPlugin.layout` sets the layout of the page. The first three layouts put the editor in a page frame (`EditorFrame`). In a frame, the modes are coloured icons on the right (`EditorModeBar`) instead of the tabs at the bottom.

- `'titlebar'` (the default): a slim bar on top with the app name and the file name. The canvas and the panel are edge to edge below it.
- `'statusbar'`: the same bar at the bottom (the logo, the app name and the file name, a bit smaller), like a code editor.
- `'floating'`: the canvas fills the window. The panel and the mode bar float over it as one card (side by side, with a line between them), with the same gap to the window on every side (no gap on a phone in portrait, where the room is small). It has no bar, so it does not show the file name.
- `'classic'`: no frame. The page has the mode tabs at the bottom, as before.

In the frame:
- A click on a mode shows its panels. A click on the open mode hides the panel, and the canvas takes its room.
- The button at the bottom of the mode bar steps through three states: the mode names and the panel, the icons and the panel, the icons only (the panel hidden), then back. Ctrl+\\ (Cmd+\\ on a Mac) does the same. Its tooltip names the next step. A window without room for the names skips them. A click on the open mode still hides or shows the panel.
- Shift+T switches between the light and the dark theme of the same family (`clean` and `clean-dark`, `light` and `dark`, `white` and `black`).
- On iOS and iPadOS, the browser zooms the page into a focused text field with text under 16 px (a search field, a Tweakpane text field) and does not zoom back out. The plugin stops that zoom while it is added (`editor.preventIosInputZoom`, on by default): it adds `maximum-scale=1` to the viewport meta tag of the page, and puts the tag back when it is removed or the setting is off. A pinch zoom still works in Safari, since it ignores the tag for it. An in-app browser (WKWebView) or a web app on the home screen follows the tag and blocks the pinch zoom: turn the setting off there. Other systems do not change (an Android browser would block the pinch zoom). The same helper is exported for other pages: `preventIosInputZoom()` returns a function that puts the tag back; `isIOS()`.
- The light or dark button and the layout button are at the bottom of the mode bar, above the names toggle, in each layout. The layout button opens the layout menu, with Classic too.
- The bar has a slot for the name of the open file or project: the app sets it with `editor.documentName` (empty: no name), and it is kept when the frame is made again. A click on the name in the bar renames it (Enter or a click outside keeps it, Escape goes back). Each change sends the `documentNameChange` event (`{name}`), so the app can use the name elsewhere. The plugin does not follow the loads. The tweakpane-editor example shows `Untitled`, then the name of the first loaded model or viewer config file (a URL or a dropped file); later files, or a name that the person typed, do not change it. The example also names the exported file with it (`AssetExporterPlugin.exportOptions.name`).

The plugin has a UI folder, `Editor`, with the page layout and the mode names. Add `TweakpaneEditorPlugin` to a mode (`loadPlugins`) to show it; it works in the classic layout too.

The layout that the person picks (in the menu or the UI) is kept in `localStorage` (`TweakpaneEditorPlugin.LayoutStorageKey`), and so is the names setting that the person picks in the mode bar (`EditorModeBar.StorageKey`; set a key to `null` to not keep it). A layout or a names setting set from code (`editor.layout = 'floating'`, `editor.modeNames = false`) applies, but is not kept, so the person's pick is back at the next visit. `TweakpaneEditorPlugin.DefaultLayout` is the layout when none is stored. The plugin reads the stored layout when it is made, so set `TweakpaneEditorPlugin.LayoutStorageKey` and `TweakpaneEditorPlugin.DefaultLayout` before `new TweakpaneEditorPlugin()`. For the old page with the mode tabs at the bottom in an app, set `TweakpaneEditorPlugin.DefaultLayout = 'classic'`, or `editor.layout = 'classic'` (this one also replaces a layout that the person picked).

### Panels and places

[Example](https://threepipe.org/examples/#editor-frame-areas/) (sample panels in the left and the bottom place, the floating layout first)

The frame has three fixed places (areas): the left sidebar, the bottom strip below the canvas (between the left sidebar and the panel), and the top of the right sidebar (in the panel of the Tweakpane UI, above the settings of the mode). An app adds panels to them: `editor.addPanel(id, element, {name, icon, color, area})` puts the element in the place `area` (`'left'` by default), with an entry in the mode bar. `editor.removePanel(id)` takes it out. The element fills its part of the place, and the plugin adds the panels again when it makes the frame again (the classic layout has no frame and no panels).

- The person moves a panel to another place: a right-click on its entry, or a long press on a touch screen (`EditorFrame.LongPressTime`, 500 ms), opens a menu of the places, its own checked. The panel shows in its new place (the right sidebar opens when the mode bar hid it); in a narrow window, that place takes the place of the panel. From code: `editor.frame.movePanel(id, 'bottom')`.
- A tap on the entry shows or hides the panel (`editor.frame.setPanelHidden(id, hidden)`, `isPanelHidden(id)`); hiding the last shown panel of a place collapses the place, and so does a move or a remove of the last shown panel when only hidden panels stay (they show in the place when it opens). While the panel cannot be seen (the mode bar hid it, or a narrow window shows another place), a tap on the entry of a panel in the right place shows it. `panelArea(id)` and `panelIds` give the state.
- The place, the place in the stack and the hidden state that the person picks, and the sizes in the stacks, are kept by the id of the panel in `localStorage`, with the sizes (`EditorFrame.AreaStorageKey`); a change from code is not kept, unless the last argument `keep` is `true`.
- An empty place takes no room, so a page without panels looks the same as before.
- A shown area is 240 px wide (left) or 160 px tall (bottom): the CSS variables `--lay-left-area-size` and `--lay-bottom-area-size` on `body.lay-frame`. To change them, use a more specific rule, like `html body.lay-frame { --lay-left-area-size: 280px; }`.
- In the title bar and the status bar layouts, the canvas gets smaller and the areas are edge to edge, with a line to the canvas. In the floating layout, the areas are cards over the canvas, with the same gap as the panel card.
- The perf pill and the bar of the sticky notes follow the left area: in the floating layout they move right of the left card, and up above the bottom card; the tool bar also moves up. In the other layouts they move with the canvas.
- The body has the class `lay-has-left`, `lay-has-bottom` or `lay-has-right` while that place has a panel. The CSS variables `--lay-left-area`, `--lay-right-area` and `--lay-bottom-area` are the width or height of each area (`0px` when it is empty). In the floating layout, `--lay-left-inset` and `--lay-bottom-inset` are the parts of the canvas that the left and the bottom card cover, with their gap.
- The mode bar has an entry for each panel, after the modes, with a line above them. `editor.addPanel('layers', layers, {name: 'Layers', icon: svg, color: '#7c5cff'})` gives it a name, an icon and a colour, like a mode (default: the name of its place, a sidebar or strip icon, and the grey of the labels). The entries follow the places (left, bottom, right), then the order of the panels in each place. An entry is marked while its panel shows.
- A narrow window has no room for the areas next to the canvas (see the breakpoints below). The place of the panel then shows one view at a time: a mode shows the panel there, and an entry shows its area. A tap on the one shown hides it, as a tap on the open mode does. From code: `editor.frame.setStackedArea('left')` (`'right'` for the panel), `editor.frame.stackedArea`. The pick of the person is kept with the sizes.

**Stacks.** The panels of a place are a stack, in the order they were added (a moved panel goes to the end): the place is split between them, top to bottom in the left and the right place, left to right in the bottom place.

- A line between two panels moves the split with a drag; each panel keeps at least `EditorFrame.MinSectionSize` (48 px). A double-click makes them equal. The sizes are kept by the ids of the panels, with the sizes; a new panel gets an equal share.
- In the floating layout, each panel is a card, and the split is the gap between two cards, with drag dots (blue on hover).

**The right place.** The panels in the right place are at the top of the panel of the Tweakpane UI, above the settings of the mode, with a line between them (in the floating layout, two cards with a gap and drag dots). A drag of the line sets the part of each (kept); a double-click puts it at the middle. Each part scrolls on its own.

- While the right place shows, a click on the open mode hides the settings of the mode, and the right place takes the whole panel (the mode bar marks no mode then); a click on a mode shows them again (also when the mode bar hid the panel: the click opens it with the settings). From code: `editor.frame.setModeSettingsHidden(true)`, `modeSettingsHidden`; a panel that leaves the right place (a move or a remove) shows them again; `setSelectedMode` shows them. Without panels in the right place, a click on the open mode hides the panel, as before.
- For example, an inspector of the selection that takes the panel while something is selected: `editor.frame.setPanelHidden('inspector', !selected)` and `editor.frame.setModeSettingsHidden(selected)`. A new frame (a change of the layout, like classic and back) starts with the mode settings shown: set it again on the `frameChange` event of the plugin (`{frame}`, also `undefined` when the frame is removed).
- The body has the classes `lay-right-shown` and `lay-mode-hidden`.

**The head of the floating layout.** The floating layout has no bar, so a slim card at the top of the left column (the head, `.lay-head`) shows the logo, the app name and the file name (renamable, as in the bar). It is as wide as the left card and moves with it on the x axis; the left card starts one gap below it, and a drag of its top edge opens the gap. Its height is the CSS variable `--lay-head` (36 px).

**Size and collapse.** The left area, the bottom area and the panel (`right`) can change size and collapse:

- A drag on the inner edge of an area changes its size: the right edge of the left area, the top edge of the bottom area, the left edge of the panel. A line shows on the edge on hover. The size stays between the limits of `EditorFrame.AreaLimits` (left 160 to 480 px, bottom 80 to 400 px, panel 240 to 600 px). The bottom area is at most half of the window, and the left area and the panel leave at least `EditorFrame.MinCanvasWidth` (240 px) for the canvas, next to each other and the mode bar. When the window gets smaller, or another area, the panel or the names of the mode bar show, an area gets smaller to keep that room; its size comes back when there is room again.
- A drag past half of the smallest size collapses the area: it is hidden and takes no room, and its edge stays at the side of the window. A drag out of the edge opens it again. The panel collapses as the mode bar hides it, and the mode bar shows it again.
- A double-click on an edge sets the default size, or opens a collapsed area.
- The sizes and the collapsed left and bottom areas that the person picks are kept in `localStorage` (`EditorFrame.AreaStorageKey`, `null` to not keep them), in every layout.
- From code: `editor.frame.setAreaSize('left', 320)`, `setAreaSize(area, null)` for the default size, `setAreaCollapsed('bottom', true)` and `isAreaCollapsed(area)`. A change from code is not kept, unless the last argument `keep` is `true`.
- A narrow portrait window has no edges.

```typescript
editor.frame?.setAreaSize('right', 360) // a wider panel
editor.frame?.setAreaCollapsed('left', true)
```

**Move the floating cards.** In the floating layout, with the areas next to the canvas, each card can move and take a part of its side: the left card, the bottom card, and the panel with the mode bar (one card).

- A grip is a strip in the gap on the side of the window of each card (its dots always show, blue on hover). A drag moves the card on both axes: away from its side (the left card to the right, the bottom card up, the panel to the left; `setAreaOffset`), and along its side (`setAreaSpan`). The card keeps its length while it moves. A double-click puts the card back.
- After a drag, an end of a card that touches the end of its side stays there: the card grows and shrinks with its side (for example, the bottom card when the left card hides). A card that touches both ends fills its side again. Only a card that is shorter than its side keeps its length.
- The ends of a card along its side (the top and the bottom edge of the left card and the panel, the left and the right end of the bottom card) resize it, at least `EditorFrame.MinCardLength` (120 px) long. A double-click fills the side again.
- The offset and the size of a card share the room that leaves `EditorFrame.MinCanvasWidth` for the canvas (the bottom card: half of the window height). When the window gets smaller, the offset gets smaller first, then the size.
- The perf pill, the bar of the sticky notes and the tool bar keep out of the whole column of the left card and the row of the bottom card, also when the card is shorter.
- The CSS variables `--lay-<area>-offset`, `--lay-<area>-start` and `--lay-<area>-length` on the body. They are kept with the sizes. Other layouts and narrow windows do not use them.
- From code: `editor.frame.setAreaOffset('left', 40)`, `setAreaSpan('right', {start: 60, length: 480})` (no `length`: to the end of the side), `null` for none; `areaOffset(area)` and `areaSpan(area)` give the values on screen.

```typescript
editor.frame?.setAreaOffset('left', 40) // the left card 40 px from the window edge
editor.frame?.setAreaSpan('right', {start: 60, length: 480}) // a shorter panel, 60 px below the top gap
```

```typescript
const layers = document.createElement('div')
editor.addPanel('layers', layers, {name: 'Layers', area: 'left'}) // an entry "Layers" in the mode bar
editor.frame?.movePanel('layers', 'bottom') // from code; the person uses the menu of the entry
// later
editor.removePanel('layers')
```

The layout changes at two window widths, `EditorFrame.Breakpoints` (`{stack: 920, singleView: 700}`, in px; set other numbers before the frame is made). The frame sets body classes for them, and the CSS of the frame uses the classes:

| Window | Layout | Body classes |
|---|---|---|
| `stack` (920 px) wide or more, or landscape and `singleView` (700 px) wide or more | Side by side: the left area, the canvas with the bottom strip under it, the panel, the mode bar. Areas at the size of the CSS also get smaller when the window has no room for them | `lay-side` |
| Landscape and narrower than `singleView` | Side by side, but the left and the bottom area show in the place of the panel, one at a time. `singleView` is 700 px because the smallest left area, panel, mode bar and canvas need 160 + 240 + 44 + 240 = 684 px | `lay-side lay-single` |
| Portrait and narrower than `stack` (a phone) | The canvas on top, below it the panel or one area at a time, next to the mode bar | `lay-stack lay-single` |

The names in the mode bar show at the first visit in a window 920 px wide or more (`EditorModeBar.WideQuery`), and the perf pill is larger under 920 px; these two are CSS and media queries, not breakpoints of the frame.

The frame applies in every window size. With `lay-side`, the canvas, the panel and the mode bar are side by side. In a portrait window under 920 px wide (a phone), the layout keeps its bars (floating has no gap there). The canvas is on top at full width, and the panel and the mode bar are below it, with the same height. The CSS variable `--lay-split` is the part of the height for the canvas: `0.45`, set on `body.lay-frame`. To change it, use a more specific rule, like `html body.lay-frame { --lay-split: 0.5; }`. A mode bar taller than its room scrolls. When the panel is hidden, the mode bar is a row at the bottom, and a tap on a mode brings the panel back. The mode names are hidden at the first visit in a window under 920 px wide (`EditorModeBar.WideQuery`).

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorModeBar, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

viewer.addPluginSync(new TweakpaneUiPlugin(true))
// TweakpaneEditorPlugin.DefaultLayout = 'classic' // before the plugin is made: the layout when none is stored
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
editor.frameOptions = {title: 'My app'} // before loadPlugins, which makes the frame
// the colour and icon of a mode (an SVG string), also before loadPlugins, which makes the mode bar
EditorModeBar.Looks['My mode'] = {color: '#0d99ff', icon: '<svg ...></svg>'}
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin, TweakpaneEditorPlugin], // with the Editor folder
    ['Export']: [AssetExporterPlugin],
    ['My mode']: [MyPlugin],
})

editor.layout = 'floating'
editor.modeNames = false // icons only
editor.documentName = 'Ring.glb'
// a rename in the bar, or a change from the code
editor.addEventListener('documentNameChange', ({name}) => console.log('name', name))

// back to the mode tabs at the bottom
editor.layout = 'classic'
```

In the [Tweakpane Editor example](https://threepipe.org/examples/tweakpane-editor/), add `?layout=titlebar`, `?layout=statusbar`, `?layout=floating` or `?layout=classic` to the URL.

## LayersPanelPlugin

[Example](https://threepipe.org/examples/#layers-panel-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/LayersPanelPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/LayersPanelPlugin.html)

`LayersPanelPlugin` shows the objects of the scene (`scene.modelRoot`) as a tree, like the layers panel of Figma or the outliner of Blender. It replaces the `HierarchyUiPlugin`, which is deprecated.

- A click on a row selects its object in the `PickingPlugin`. Ctrl, Cmd or Shift + click adds the object to the selection, or takes it out.
- A selection in the viewport marks its rows. It also opens the groups that hold it and scrolls the list to it (`revealSelection`).
- The arrow on a row opens or closes it. Alt + click on the arrow also opens or closes all the levels below it.
- A hovered row outlines its object in the viewport, with the `SelectionOutlinePlugin` (`viewportHover`). The outline must follow the picking (`followPicking`, the default). The outline shows when the pointer rests on a row for `LayersPanelPlugin.HoverDelay` ms (80; `0` for at once), so a move across many rows renders no frames. A hover renders one more frame. It does not restart the progressive render. The object hovered in the viewport is marked in the list.
- The eye button hides or shows the object. The lock button locks or unlocks it. When the row is in the selection, the button changes all the selected objects. A hidden or locked parent dims the buttons of its children.
- A double-click on a name (or F2) renames the object. Enter or a click outside keeps the name, Escape goes back.
- With the focus in the list, Up and Down select the next row (Shift adds it). Right opens a row or goes to its first child. Left closes a row or goes to its parent.
- The search field shows the objects whose name has the text, with the groups that hold them. Escape or the × button at its end clears it (the button shows while the field has text).
- Lights and cameras have the icon and the colour of their kind (`widgetKinds` of threepipe), as in the viewport.
- The Objects tab starts with the scene and the default camera (`sceneRows`, on), dimmer: they are not in the model, so they have no eye, lock or arrow. A search shows them when their name has the text (`camera` finds the default camera). A click selects them, so the UI of the editor shows their settings.
- Meshes, lines, points, cameras and lights show no children (their helpers, targets or parts): `leafTypes` lists the kinds (set a new list to change it), and `showLeafChildren` (off, in the UI) shows the children of all kinds.
- A double-click on a row selects it and moves the camera to it (`doubleClickFocus`, on; the scene row frames the whole model). A double-click on the name renames it. With `clickToUnselect` (off), a click on a selected row unselects it.
- **Tabs**: Objects, Materials, Textures and Geometry, each turned on or off with `objectsTab`, `materialsTab`, `texturesTab` and `geometryTab` (all on by default, in the UI folder). With one tab on, there is no tab bar. `layers.tabs` lists the tabs that are on, `layers.tab` is the open one, `layers.setTab('materials')` opens one. The counts are in the tooltips of the tabs and in the header.
- A tab of assets lists the materials, textures or geometries that the objects in the scene use (from `viewer.object3dManager`). An asset row has a swatch (a material), a picture (a texture) or an icon, the name, and a short text: the size of a texture, the generator and the vertices of a geometry, and the number of objects that use it (`scene` for a texture of the scene). Its arrow lists those objects under it.
- In a tab of assets, a click selects the asset in the `PickingPlugin` (the UI of the editor shows its settings), a double-click selects the objects that use it, and a double-click on the name or F2 renames a material or a texture (`renameAsset(asset, name)`, one undo step). A hover outlines the objects that use it. Up and Down select the next row, Right opens an asset, Left closes it or goes from a user back to its asset.
- An open row shows its first `maxChildren` children (5), then a "… N more" row. A click on it shows all of them (`showAllChildren(object)`), until the row is closed. The objects at the top level, a search, and children that hold the selection always show; `maxChildren = 0` shows all. The Up and Down keys pass over the "… N more" row.
- Only the rows in view are in the DOM (a virtual list), so a scene with many objects stays fast.

The visibility, the lock and the name changes are undo steps with the `UndoManagerPlugin`.

**Lock.** A locked object has `userData.userSelectable` set to `false`. That is the rule of the `PickingPlugin`: it does not pick the object, or the objects inside it, in the viewport. The list can still select it, and then the transform controls can move it. An unlock gives back the value from before the lock (for example `true` on a text that has no material). The glTF export leaves out the `false` values of `userData`, so an exported file does not keep the lock.

**Where the panel goes.**

The plugin does not depend on the editor: the app places the panel.

- In the page frame of a `TweakpaneEditorPlugin`: add `layers.element` as a panel, with a Layers entry in the mode bar (the person can move it to another place with the menu of the entry). `LayersPanelPlugin.AreaEntry` has a name, an icon and a colour for the entry. The `enabledChange` event (`{enabled}`) tells when the panel is turned on or off (Enabled, `enable`, `disable`), so the app can take the panel out and add it back. The classic layout has no frame, so it does not show the panel.

  ```ts
  const layers = viewer.addPluginSync(LayersPanelPlugin)
  const editor = viewer.getPlugin(TweakpaneEditorPlugin)!
  const place = () => layers.isDisabled() ? editor.removePanel('layers') : editor.addPanel('layers', layers.element, {...LayersPanelPlugin.AreaEntry, area: 'left'})
  place()
  layers.addEventListener('enabledChange', place)
  ```

- Without the editor: give an element to the constructor, `new LayersPanelPlugin(container)`. The panel goes in it while the plugin is added. The panel fills its parent, so give the parent a height.
- Or place `layers.element` in the page yourself.

The plugin removes the panel from the page when it is removed. Its UI folder, `Layers Panel`, has the settings: Enabled, Hover in viewport, Reveal selection, Max children, Scene and camera rows, Show children of meshes, lights, cameras, the two click settings, and the four tabs. The settings and the open rows are not saved with the viewer config.

```typescript
import {PickingPlugin, ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {LayersPanelPlugin, SelectionOutlinePlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(UndoManagerPlugin)
const picking = viewer.addPluginSync(PickingPlugin) // also added by the panel, if it is not there
picking.hoverEnabled = true // the object under the pointer is marked in the list
viewer.addPluginSync(SelectionOutlinePlugin) // the outline of a hovered row

// in an element of the page (it fills it); with a TweakpaneEditorPlugin, leave out the element
const layers = viewer.addPluginSync(new LayersPanelPlugin(document.getElementById('layers')!))

layers.setExpanded(model, true) // open a row
layers.setVisible([model], false) // hide, as one undo step
layers.setLocked([model], true) // not picked in the viewport
layers.renameObject(model, 'Ring')
layers.materialsTab = false // no Materials tab
layers.setTab('textures') // open a tab
console.log(layers.listedObjects) // the objects in the list, from the top
```

Not in the panel yet: drag and drop to move objects, and a context menu.

## InspectorPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/InspectorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/InspectorPlugin.html)

`InspectorPlugin` shows the settings of the selection of the `PickingPlugin`, like the inspector of Unity or the properties panel of Blender. Try it in the [tweakpane editor example](https://threepipe.org/examples/#tweakpane-editor/) (`?inspector=swap|right|left`).

- A head with the name of the selection (and `+N` for more selected objects), and tabs for its parts: Object, Material and Geometry, and Texture for a selected texture (`InspectorTab`, `tab`, `setTab`). One tab shows no tab bar. A pick of another object keeps the open tab when the new selection has it, so a click from mesh to mesh keeps the Material tab.
- The open tab shows the uiConfig of that part, in a second Tweakpane renderer inside `element`, with the theme of the page. While the inspector is in the page and enabled, it turns off the selection UI of the `PickingPlugin` (`PickingPlugin.selectionUi`), since a uiConfig renders in one UI at a time; the Picker folder keeps the picking settings. Out of the page (the classic layout has no areas, or the app took it out), the Picker folder shows the selection again (checked at each change of the selection and at each viewer `update`). The actions that the Picker folder showed with the selection are in the inspector: Focus and Select Parent on the Object tab, Remove Material(s) and New … Material on the Material tab.
- The Object tab has a card for each material of the selected mesh: a small preview (`InspectorPlugin.CardPreviewSize`, 64 px for a 32 px card), the name and the type (a material with no name shows its type). A click opens the Material tab on that material. The previews follow the changes of their material (an edit, an undo), the environment map and the tone mapping of the viewer.
- The Material tab has a large live preview of the material, from the `MaterialPreviewPlugin` (`preview`, on by default; a click on its head, Preview, folds it, so a short place has room for the settings): a sphere, a cube or the selected mesh alone (`previewShape`, also the buttons under it). A drag on it turns it, the wheel zooms, and a double-click resets the view; a finger drag turns it on a phone (`touch-action: none`, so the panel does not scroll under it). A mesh with more than one material has a list of its materials. The preview is `InspectorPlugin.PreviewSize` px (256). It follows the changes of the material, of the environment map (its intensity and rotation) and the tone mapping of the viewer, and of the selected geometry when it changes in place (a geometry generator; the This mesh shape).
- The selected object takes another material or geometry: the inspector shows the new one. A rename updates the head.
- A search field above the settings shows only the settings whose name (or button title) has the text, and the folders whose title has it, with all their settings; the folders open while it has text, and the text stays for the next selection. Escape in the field, or the × button at its end, clears it (the next Escape clears the selection). The tab bar and the search field have the sizes and the font of the ones in the Layers panel.
- A right-click on a setting (a long press on a touch screen, `InspectorPlugin.LongPressTime`) offers Reset to default when its value is not the default: the value in a new object of the same class (made once per class; a class that needs arguments has no default, nor a value that is an object with no `clone`). A disabled or read-only setting, like the uuid, has no reset. The reset goes through the renderer, so Ctrl+Z undoes it.
- Escape (the PickingPlugin) clears the selection.
- `hasSelection`, and the events `selectionChange` (`{hasSelection}`, on each change of the selection, not on a new material of the selected object) and `enabledChange` (`{enabled}`).

**Where the panel goes.** The plugin does not depend on the editor: the app places the panel. In the page frame it is a panel, in any of the three places, and the person can move it with the menu of its entry in the mode bar:

```ts
const inspector = viewer.addPluginSync(InspectorPlugin)
const editor = viewer.getPlugin(TweakpaneEditorPlugin)!

// right: in the right sidebar, the top of the panel above the mode settings, with its entry in the mode bar
editor.addPanel('inspector', inspector.element, {...InspectorPlugin.AreaEntry, area: 'right'})

// swap: also in the right sidebar; while something is selected it takes the whole panel (the mode settings hide)
inspector.addEventListener('selectionChange', e => {
    const frame = editor.frame
    if (!frame || frame.panelArea('inspector') !== 'right') return // the person moved it
    frame.setPanelHidden('inspector', !e.hasSelection)
    frame.setModeSettingsHidden(e.hasSelection)
})

// or under the layers panel, in the left sidebar (a stack, in the order the panels are added)
editor.addPanel('layers', layers.element, {...LayersPanelPlugin.AreaEntry, area: 'left'})
editor.addPanel('inspector', inspector.element, {...InspectorPlugin.AreaEntry, area: 'left'})
```

`InspectorPlugin.AreaEntry` has a name, an icon and a colour for its entry in the mode bar. On a phone, the right place and the mode settings share the part below the canvas, and swap shows one of them at a time; the left place shares the narrow left card with the layers. The classic layout has no frame and no panels. Without the editor: give an element to the constructor, `new InspectorPlugin(container)`, or place `inspector.element` yourself; give its parent a height. On `enabledChange`, take it out of its place or put it back (`editor.removePanel('inspector')`, `editor.addPanel(...)`). Its UI folder, `Inspector`, has Enabled, Material preview and Preview shape; they are not saved with the viewer config.

Not in the inspector yet: pinch zoom on the preview, and the settings of more than one selected object at once.

## NotesPlugin and StickyNotesUiPlugin

[Example](https://threepipe.org/examples/#notes-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/NotesPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/NotesPlugin.html)

`NotesPlugin` keeps a list of notes. Each note is kept in a store:

- `file`: the `fileNotes` property is serialized, so these notes are saved in the viewer config, inside an exported .glb, and come back when the file loads.
- `browser`: `localStorage` (`BrowserNotesStore`). A page in a sandbox without `allow-same-origin` (a `sandbox` iframe or a `Content-Security-Policy: sandbox` header, as on the preview pages of files.threepipe.org) has no `localStorage`, so this store finds no notes there and cannot save: after the first save, the store icon of its notes is red ("it could not be saved or loaded" in its tooltip), and the console shows the warning `NotesPlugin: could not save the notes of browser`. This is expected. The notes stay in the page until it closes; to keep them, move them to the `file` store and export, or use a store of the app.
- A store of the app: any object with `id`, `label`, `load()` and `save(notes)` (`NotesStore`), added with `addStore()` or the `stores` option. `HttpNotesStore` is one for a server: GET returns `{notes}`, POST takes `{notes}`; a save under 64 KiB is a `keepalive` request, so the last changes reach the server also when the page closes.

Changes are saved per store, 600 ms after the last one, and when the plugin is removed. Notes made in a store while it loads are kept and saved. The plugin has no notes UI. Its UI folder (`Notes`) has the settings: the store of new notes, and clear the notes in the file.

`StickyNotesUiPlugin` shows the notes as post-its over the canvas, in one of two layouts:

- `board`: each note is its own post-it. A post-it from "Add a note" opens by the dock, where the + button is: above it, or below it when the dock is at the top of the canvas, and inside the canvas. A note added in code (`notes.addNote`) goes below the last post-it in its column, inside the canvas and above the dock; when no column has room (a phone has room for one), the columns start again a little lower and to the right. "Arrange" puts all of them in columns by the same rule. "Stack" switches to the other layout.
- `stack`: the post-its lie on a pile, each one a little to the left of and above the one on it, so the pile stays on the canvas. A click on a post-it behind brings it to the top; the pile is dragged and sized as one. "Spread" switches back.

"Minimise" (the `minimized` layout) takes the post-its off the canvas. Only one button stays in the dock, with the number of notes; a click on it brings back the layout from before. The post-its start minimized on each page load, so they do not cover the canvas; the button brings back the layout set last. `new StickyNotesUiPlugin(storageKey, false)` starts in that layout instead.

In both layouts:

- The buttons are icons with a tooltip each (tippy.js, the `editor` theme; the plugin adds their CSS).
- "Add a note" (+) adds a note at once, in the store of new notes (`NotesPlugin.defaultStore`), with the cursor in it. The button next to it shows the icon of that store (a file, a browser window, or a cloud for a store of the app); a click opens a menu of the stores.
- The icon at the top left of a note shows its store; a click opens the same menu, to move the note.
- Each note has "Add the time and the selection" (the time, `contextProvider` and the objects selected in the `PickingPlugin`), "Copy the text" (the icon shows a check and "Copied" for a moment) and "Delete the note". Escape leaves the note. On a touch screen the text is 16 px, so a phone does not zoom in when the note gets the cursor.
- Drag a post-it by its bar, and size it from its bottom right corner. A click on a post-it brings it up.
- The buttons are `dock`, at the bottom left of the canvas. When that corner is taken, place it with its style, e.g. `sticky.dock.style.bottom = '56px'`.
- Drag the dock by its handle (the dots at its left) or its free part to move it out of the way; its buttons still click (a press that moves less than 3 px is a click). It stays inside the canvas, also when the canvas gets smaller. A double click on the handle, or Reset places, puts it back in its corner. The board and the pile keep their places above the corner. The move is the dock's `transform`, so do not set one on it.
- The post-its fill the nearest positioned ancestor, so the viewer container must be positioned (for example `position: relative`) for the post-its to stay inside the canvas.
- The post-its and the dock are above the loading screen and the overlays of the canvas (`z-index` 150), below the bars of the editor; their menus are with the popups (2000). With the open card of `PerfPanelPlugin` in the same layer, the one pressed last is in front (`raiseOnPress`): a press on a post-it or the dock brings the notes forward, opening or pressing the perf card brings it forward.

The layout, the colour, the places and sizes of the post-its and the place of the dock are kept in `localStorage` (the `storageKey` of the plugin), not in the file. Its UI folder (`Sticky Notes`) has the settings: Show, Layout, Colour (yellow, pink, blue, green, or `theme` for the Tweakpane theme), Arrange and Reset places.

```typescript
import {PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {HttpNotesStore, NotesPlugin, NotesStore, StickyNotesUiPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(PickingPlugin)
const notes = viewer.addPluginSync(new NotesPlugin({
    browser: 'my-app-notes', // the localStorage key; false: no browser store
    stores: [new HttpNotesStore('/api/notes')], // optional: a server
    contextProvider: () => 'Move tool', // optional, extra text for "+ Context"
}))
const sticky = viewer.addPluginSync(new StickyNotesUiPlugin())
sticky.layout = 'stack' // a pile; 'board': a post-it per note; 'minimized': off the canvas

// a store of the app
const myStore: NotesStore = {
    id: 'project', label: 'This project',
    load: async() => (await api.getNotes()) ?? [],
    save: async(list) => api.setNotes(list),
}
notes.addStore(myStore)
notes.addNote('Check the prongs', 'file')

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(StickyNotesUiPlugin) // the settings
ui.setupPluginUi(NotesPlugin)
```

Another view can show the same notes: read `notes.notes`, listen to the `notesChange` event (`change` is `add`, `update`, `remove` or `load`; `note` is the note added, changed or removed, and `notes` the notes that `clear` or a store replaced with `addStore` removed) and the `defaultStoreChange` event (the store of new notes changed), and change them with `addNote`, `updateNote` and `removeNote`. Set `StickyNotesUiPlugin.InjectStyles = false` before the plugin is made to style the `snp-` classes yourself.

## EditorCameraPlugin

[Example](https://threepipe.org/examples/#editor-camera-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/EditorCameraPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/EditorCameraPlugin.html)

`EditorCameraPlugin` gives an editor its own camera, separate from the scene's camera.

- **Edit** (`editing = true`, the default): the view is through the editor camera. It moves 1:1 with the pointer (no damping) and has no orbit limits or ground limit.
- **View** (`editing = false`): the view is through `previewCamera`, a copy of the scene's default camera (the start view, saved in the file) with its controls (orbit limits, damping). This is what a visitor sees. With `syncStartView` (on by default), each move in View changes the start view as it happens (one undo step per move). With it off, a move in View is a preview: `saveStartView()` keeps it, `resetStartView()` goes back. So an export in View (`exportConfig()`, `exportScene()`) always has the saved start view, never a preview that is not saved.

The editor camera and the preview camera are added to the scene outside the model root, so they are not saved in a file or exported. The preview camera is made again from the start camera each time View starts, so a change of the start camera settings in Edit is in the next View.

When a file with a viewer config loads, the editor camera takes its start view (in View, the view does too). `setStartViewFromEditor()` moves the start view to the view that is seen: the editor view in Edit, the preview in View. With the `UndoManagerPlugin`, each change of the start view is one undo step.

The C key switches between Edit and View (`hotkey`, a `KeyboardEvent.code`; `''` turns it off; the `hotkeyChange` event tells a UI when it changes). It does nothing in a text field, with Ctrl, Cmd, Alt or Shift, while held down, or when another handler used the key. The `editingChange` event tells a UI when the view changes, from the code, the key or the panel, and when the plugin is turned off or on (`enabled`, `disable(key)` / `enable(key)`, a remove; `editing` is `false` while it is off):

```typescript
import {ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {EditorCameraPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...plugins: [UndoManagerPlugin]})
const editorCamera = viewer.addPluginSync(EditorCameraPlugin)

// look through the start view, as a visitor. Each move here changes the start view (syncStartView is on by default;
// Ctrl+Z undoes a move)
editorCamera.editing = false
// or make a move in View a preview only
editorCamera.syncStartView = false
// after a move: keep the view as the start view (Ctrl+Z undoes it)
editorCamera.saveStartView()
// or go back to the saved start view
editorCamera.resetStartView()
// back to the editor camera
editorCamera.editing = true

// the start view takes the view that is seen, here the editor view (Ctrl+Z undoes it)
editorCamera.setStartViewFromEditor()

// the editor camera takes the start view
editorCamera.copyStartView()

// a button that follows the view
editorCamera.addEventListener('editingChange', ({editing}) => {
    button.classList.toggle('on', editing)
})
// another key than C
editorCamera.hotkey = 'KeyK'
```

Options and state:
- `smooth`: a light damping on the editor camera. Off: 1:1 with the pointer.
- `syncStartView`: in View, each move changes the start view at once. A move (with the glide of damping, or wheel steps close together) is one undo step; `EditorCameraPlugin.SyncGestureDelay` (ms) is the pause that ends it. On by default. Turned on in View after a move, it saves the view. Off: a move in View is a preview only. The `syncStartViewChange` event (`{sync}`) tells a UI when it changes.
- With orbit controls, only a user gesture on the controls of the preview camera is a move: from their `start` event to their `end` event, and the glide after it (with `autoRotate`, it ends `EditorCameraPlugin.SyncGestureDelay` ms after the `end` event). A change that the user did not make is not synced and does not count as a move: a clamp of the orbit limits (a start view outside them), an animation of the camera by another plugin. The keyboard pan of `OrbitControls` sends no `start` and `end` events, so it is not a move either. Other controls (first person, pointer lock) send no gesture events: each change of the view is a move, and a move ends when the view is still for `SyncGestureDelay` ms. Without controls (`controlsMode` `''`), no change is a move.
- `startViewMoved`: in View, a user gesture moved the view away from the saved start view and the move is not saved. `saveStartView()` keeps it (one undo step), `resetStartView()` goes back. The `startViewMovedChange` event (`{moved}`) tells a UI when it changes.
- The `startViewChange` event (`{camera}`): the saved start view changed (a save, a sync, an undo, a load, a change in the camera panel).
- `showsStartView`: the view shows the saved start view now (in View when the preview is at it, not after a move, an auto rotation or a clamp of the orbit limits; in Edit when the editor camera is at the start view and the start camera is perspective, as the editor camera). A UI can take a picture of the start view from the canvas then.
- `EditorCameraPlugin.ControlProps`: the orbit controls of the editor camera.

The plugin is not saved with the viewer config (`serializeWithViewer = false`).

In the `TweakpaneEditorPlugin`, while the plugin is added (before or after the editor):
- A pill at the top centre of the canvas, in the style of the `PerfPanelPlugin` pill, names the camera: "Editor camera" (a grey camera icon) or "Scene camera" (a blue icon; green when `syncStartView` is on). An amber corner tells that a move in View is not saved. In View, a frame in the same colour is around the canvas. The pill shows the key of `hotkey` (none when it is `''`), and a click on it switches Edit and View, as the key. The pill and the frame are hidden while the plugin is disabled.
- A card under the pill opens on hover (with a mouse), on a tap on a touch screen or on keyboard focus, and stays open until a press outside it or Escape. It shows a picture of the saved start view. A click on the picture looks through the start view; in View after a move, it goes back to it. The Sync toggle over the picture is `syncStartView`. Under it: an Edit / View toggle; "Set as start view" in Edit; "Save" and "Reset" in View, on after a move that is not saved (they stay in the card when off, so it keeps its size). Ctrl+Z undoes a change of the start view.
- The picture is taken from the canvas right after a render, when the view shows the saved start view (`showsStartView`): after a load, in View before a move, after a save, a sync or "Set as start view". It is a small copy of the canvas (448 px wide); it is taken again when the render ends (progressive rendering), and shows faded while it is out of date.
- On the classic page on a phone, the pill is on the right, under the title bar of the settings panel, so it does not cover the view widget.
- `setupEditorCameraUi(viewer, plugin)` adds the pill, the card, the frame and their styles in another app (and the CSS of the tooltips). It returns a function that removes them. The [Tweakpane Editor](https://threepipe.org/examples/#tweakpane-editor/) example has the settings in the Viewer tab.

## SelectionOutlinePlugin

[Example](https://threepipe.org/examples/#selection-outline-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/SelectionOutlinePlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/SelectionOutlinePlugin.html)

`SelectionOutlinePlugin` draws the outline of the selected and hovered objects in the render pipeline, as in Figma or Blender. A mask pass renders the meshes of these objects with their own depth. An extension of the screen pass then draws, after tonemapping:

- an outer outline around each selected object and the hovered object, with anti-aliased edges when `antialias` is on,
- thin lines between the parts of a selected object (`parts`; the parts come from `partsOf`),
- a dashed outline where the selection is behind other objects (`xray`, needs the `GBufferPlugin`, which the plugin adds),
- optionally, a fill tint (`fill`) and a dim of all other objects (`dimOthers`).

`antialias` (off by default) smooths both edges of the outline. The outer edge fades over about 1 px at the distance `width` from the mask edge, at each angle: the plugin finds that distance by a bisection along the edge normal (and 15 degrees to each side of it in the outer 1 px). The outline also goes half a pixel into the edge of the object, with an alpha from the part of the 3x3 pixels around it in the mask, so the pixel steps of the mask do not show next to the anti-aliased edge of the object. Mask reads per pixel: 49 when off; when on, up to 63 in the outline and up to 79 in its outer 1 px. Set it to `true` to turn it on.

The mask follows the alpha of each material (`opacity`, the alpha of `map`, `alphaMap`, `alphaTest`), so a mesh that its texture cuts has the same shape in the outline.

The outline replaces the selection widget (the box) of the `PickingPlugin`, as the `OutlinePlugin` does: while the plugin outlines the selection, it sets `widgetEnabled` of the `PickingPlugin` to `false`, and it sets it back to `true` when it stops (disabled, `outlineSelected` off, or removed). A selection that gets no outline keeps the widget: a camera, a light, a group without meshes, or a line. A widget that was off before stays off. A change of the selection or the hover renders one more frame. It does not restart the progressive render. The mask is drawn once after each change, not in each frame of the progressive render.

```typescript
import {ThreeViewer, PickingPlugin} from 'threepipe'
import {SelectionOutlinePlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})

// by default, the outline follows the selection and the hover of the PickingPlugin
const picking = viewer.addPluginSync(PickingPlugin)
picking.hoverEnabled = true
picking.widgetEnabled = false // the outline replaces the box widget

const outline = viewer.addPluginSync(SelectionOutlinePlugin)
outline.width = 2 // CSS pixels
outline.antialias = true // smooth edges, off by default
outline.color.set('#0d99ff')
outline.redraw() // after a change of a color in place

// or set the objects yourself
outline.followPicking = false
outline.selected = [object1, object2]
outline.hovered = [object3]
```

The plugin is not saved with the viewer config (`serializeWithViewer = false`).

## UiConfigForm

[Example](https://threepipe.org/examples/#ui-config-form/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/ui/UiConfigForm.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/UiConfigForm.html)

`UiConfigForm` draws a list of uiconfig.js configs (the same configs that the Tweakpane panels use) as a small plain-DOM form. Use it for a popup or a card next to an object, where a Tweakpane panel is too large.

- Fields: number (drag the name to scrub, Shift for 10x), slider, checkbox, dropdown, vector, color, text, button, monitor, and folders (always open). An `input` bound to a boolean or a number gets a checkbox or a number field.
- A button's function can return an undo function or `{action, undo, redo}`, as in uiconfig.js: the action runs, and with an `undoManager` it is one undo step.
- A change sets the value through the binding of the config, then calls `onChange` of the config and of each parent folder (a function or a list of functions), as the Tweakpane renderer does. When a Tweakpane panel also draws the configs, each handler runs once, and the change goes on to the folders above the form.
- A scrub, the slider and the colour picker send changes with `last: false` while they move, and a final change with `last: true` when they end, as Tweakpane does. A config that waits for the final change (e.g. to rebuild a geometry) gets it.
- With an `undoManager`, each edit is one undo step. Quick edits of the same field (a scrub, the slider) merge into one step.
- A number field takes whole numbers when its `stepSize` is a whole number of 1 or more, or when its name is a count (segments, sides, steps...). Change this with the `isInteger` option.
- The form adds its stylesheet once (`UiConfigForm.InjectStyles`). The colours follow the Tweakpane theme variables (`--tp-...`) when the page sets them.

```typescript
import {UiConfigMethods, UndoManagerPlugin} from 'threepipe'
import {UiConfigForm} from '@threepipe/plugin-tweakpane-editor'

const undo = viewer.addPluginSync(UndoManagerPlugin)

// the fields of the material, in a popup
const form = new UiConfigForm(UiConfigMethods.GetChildren(material.uiConfig), {
    undoManager: undo.undoManager,
    onChange: () => viewer.setDirty(),
    // a dropdown or a button can change which fields there are: make the form again (in this call)
    onStructureChange: () => {/* form.dispose(); make a new form */},
})
popup.appendChild(form.element)

// after a change from elsewhere
form.refresh()
```

The form does not watch the values: call `refresh()` after a change from elsewhere (code, another panel). Its own undo and redo steps refresh it. A form made in `onStructureChange` takes the place of the old one: the undo and redo of edits made in the old form refresh the new one. A config that is `hidden` when the form is made is not drawn.
