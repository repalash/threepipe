# Changelog for @threepipe/plugin-tweakpane-editor

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- `NotesPlugin`: a list of notes, each kept in a store: `file` (serialized, so saved in the viewer config and in an exported .glb), `browser` (`localStorage`, `BrowserNotesStore`), or a store of the app (`NotesStore`, `addStore`; `HttpNotesStore` for a server). Changes are saved per store 600 ms after the last one; notes made while a store loads are kept. Events `notesChanged` (with the note, or the notes that `clear` or a replaced store removed) and `storeStatusChanged`; `contextLine()` gives the time, the context and the selected names. Its UI folder, `Notes`, has the settings.
- `StickyNotesUiPlugin`: the notes as post-its over the canvas, in the `board` layout (a post-it per note; new ones, and "Arrange", inside the canvas and above the dock, also on a phone) or the `stack` layout (a pile that goes to the left and up; a click brings a post-it up), or `minimized` (off the canvas; one button with the number of notes brings back the layout from before). "+ Note" adds a note at once ("▾" picks the store), a badge moves a note to another store, "+ Context", "Copy" and "×" per note (the text is 16 px on a touch screen, so a phone does not zoom in on it); post-its are dragged by their bar and sized from their corner, and glide between layouts. The layout, the colour, the places, the sizes and the order are kept in `localStorage`. Its UI folder, `Sticky Notes`, has the settings; `dock` holds its buttons. The post-its show above the loading screen, and their menus with the popups of the page. The `notes-plugin` example and the Extras mode of the tweakpane editor example show both.
- Add `EditorCameraPlugin`: the editor's own camera (Edit, 1:1 with the pointer, no limits, never saved) and the scene's start view (View, through `previewCamera`, a copy of the default camera with the visitor's controls). `syncStartView` (on by default) saves each move in View as it happens (one undo step per move; with orbit controls, only a user gesture is a move, not a clamp of the orbit limits or a camera animation of another plugin); with it off, a move in View is a preview: `saveStartView()` keeps it, `resetStartView()` goes back; an export in View always has the saved start view. `setStartViewFromEditor()` with undo, `smooth`. The C key switches Edit and View (`hotkey`). Events `editingChange`, `startViewMovedChange` (`startViewMoved`), `startViewChange`, `syncStartViewChange` and `hotkeyChange`; `showsStartView`. In the `TweakpaneEditorPlugin`, while the plugin is added: a pill on the canvas in the style of the perf pill names the camera ("Editor camera" or "Scene camera", with a grey, blue or green camera icon and the key of `hotkey`; a frame in View; hidden while the plugin is disabled) and opens a card with a picture of the saved start view, a Sync toggle, an Edit / View toggle and the start view actions (Set as start view; Save and Reset after a move in View); `setupEditorCameraUi()` for other apps (it returns a function that removes the UI). Example `editor-camera-plugin`; also in the `tweakpane-editor` example (Viewer tab).

### Changed

- treejs comes from npm, `@repalash/treejs` 2.0.0 (the same code), instead of a git URL, which npm 12 refuses by default. `HierarchyUiPlugin.treeView` is typed `any`: treejs is bundled, so its type could not resolve in consumer declarations.

## [0.6.0]

### Added

- Add pivot controls and pivot edit toolbar buttons with toggle support
- Add pivot edit icon (`pivotEdit`) to icon set

### Changed

- `HierarchyUiPlugin` — support Shift/Ctrl/Cmd click for multi-select in hierarchy panel via `PickingPlugin.toggleSelectedObject`
- `HierarchyUiPlugin` — skip hierarchy rebuild for widget and widget root object changes to avoid unnecessary UI refreshes

## [0.5.5] - 2025-11-08

### Changed

- HierarchyUiPlugin - Bubble object `select` event to parent

## [0.5.4] - 2025-09-04

### Changed

- Update minimum version of `@threepipe/plugin-tweakpane` `peerDependency` to `0.8.4`

## [0.5.3] - 2025-09-03

### Changed

- Update [threepipe](https://threepipe.org/) in `peerDependencies` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/tweakpane-editor
[0.5.1]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-tweakpane-editor-0.5.1
